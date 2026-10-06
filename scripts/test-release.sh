#!/usr/bin/env bash
# Uses only disposable, uniquely named installations and loopback ports.
set -euo pipefail
archive=${1:?Usage: scripts/test-release.sh ARCHIVE.tar.gz}
archive=$(cd "$(dirname "$archive")" && pwd)/$(basename "$archive")
root=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d)
name="tgc-release-test-$$"
port=${RELEASE_TEST_PORT:-18388}
restore_port=$((port + 2))
mail_port=$((port + 4))
shared_port=$((port + 6))
customer_port=$((port + 8))
legacy_port=$((port + 10))
migrated_port=$((port + 12))
upgrade_image="tracegenie-community:release-upgrade-$$"
shared_image="tracegenie-community:release-shared-$$"
dc() { docker compose --env-file "$work/$1/.env" -f "$work/$1/compose.yaml" "${@:2}"; }
cleanup() {
  result=$?
  if [ "$result" -ne 0 ]; then
    for log in "$work"/*.log; do
      [ -f "$log" ] && tail -25 "$log" | sed -E 's/(Setup code.*:).*/\1 [REDACTED]/'
    done
    for target in install restore shared legacy migrated; do
      [ ! -f "$work/$target/.env" ] || dc "$target" logs --tail 35 2>&1 || true
    done
  fi
  if [ "${KEEP_RELEASE_TEST:-0}" = 1 ]; then
    printf 'Private verification directory: %s\n' "$work"
  else
    docker rm -f "$name-mail" >/dev/null 2>&1 || true
    for target in install restore shared legacy migrated; do
      [ ! -f "$work/$target/.env" ] || dc "$target" down --volumes --remove-orphans >/dev/null 2>&1 || true
    done
    docker image rm "$upgrade_image" "$shared_image" >/dev/null 2>&1 || true
    rm -rf "$work"
  fi
  exit "$result"
}
trap cleanup EXIT
mkdir "$work/unpacked" "$work/install" "$work/restore" "$work/shared" "$work/migrated" "$work/refused"
tar -xzf "$archive" -C "$work/unpacked"
release=$(find "$work/unpacked" -mindepth 1 -maxdepth 1 -type d)
[ -f "$release/source.tar.gz" ] && [ -f "$release/NOTICE" ]
tar -tzf "$release/source.tar.gz" | grep '^LICENSE$' > /dev/null
docker load -i "$release/image.tar.gz" > "$work/image-load.log"
for target in install restore shared migrated refused; do
  cp "$release/compose.yaml" "$release/tracegenie" "$work/$target/"
done
"$work/install/tracegenie" install --url "http://localhost:$port" --name "$name" > "$work/install.log" 2>&1
image=$(sed -n 's/^COMMUNITY_IMAGE=//p' "$work/install/.env")
single_container() {
  [ "$(dc "$1" ps -q | wc -l | tr -d ' ')" = 1 ]
  id=$(dc "$1" ps -q community)
  [ "$(docker inspect -f '{{len .Mounts}}' "$id")" = 1 ]
  dc "$1" exec -T community node /app/deploy/healthcheck.mjs
  echo "PASS $1 uses one healthy container and one persistent volume"
}
single_container install
docker run -d --name "$name-mail" --network "${name}_default" -p "127.0.0.1:$mail_port:8025" axllent/mailpit:v1.27.8 >/dev/null
cd "$root"
smoke() { node scripts/release-smoke.mjs "$1" "http://localhost:$2" "$work/$3" "$work/$4.json" "http://localhost:$mail_port" "$name-mail"; }
smoke initialize "$port" install state
"$work/install/tracegenie" stop > "$work/restart.log" 2>&1
"$work/install/tracegenie" start >> "$work/restart.log" 2>&1
smoke verify "$port" install state
# Replacement (not just restart) must retain the database, uploads and secrets.
dc install up -d --force-recreate --wait --wait-timeout 240 community > "$work/replace.log" 2>&1
single_container install
smoke verify "$port" install state
# A stopped worker must make the installation unhealthy. A crashed worker must recover.
dc install exec -T community supervisorctl stop worker > "$work/worker.log"
if dc install exec -T community node /app/deploy/healthcheck.mjs >> "$work/worker.log" 2>&1; then
  echo 'Health check accepted a stopped worker' >&2; exit 1
fi
dc install exec -T community supervisorctl start worker >> "$work/worker.log"
old_pid=$(dc install exec -T community supervisorctl pid worker)
dc install exec -T community supervisorctl signal KILL worker >> "$work/worker.log"
recovered=0
for ((i=0; i<60; i++)); do
  new_pid=$(dc install exec -T community supervisorctl pid worker)
  if [ "$new_pid" != "$old_pid" ] && [ "$new_pid" != 0 ] && dc install exec -T community node /app/deploy/healthcheck.mjs >/dev/null 2>&1; then recovered=1; break; fi
  sleep 1
done
[ "$recovered" = 1 ]
echo 'PASS failed worker is detected and restarted by the process manager'
"$work/install/tracegenie" backup > "$work/backup.log" 2>&1
backup=$(find "$work/install/backups" -mindepth 1 -maxdepth 1 -type d ! -name '.partial-*' | head -n 1)
"$work/restore/tracegenie" restore "$backup" --url "http://localhost:$restore_port" --name "$name-restored" > "$work/restore.log" 2>&1
docker network connect "${name}-restored_default" "$name-mail"
single_container restore
smoke verify "$restore_port" restore state
# Reject a corrupt archive before creating any installation resources.
cp -R "$backup" "$work/corrupt"
printf 'tampered' >> "$work/corrupt/database.dump"
if "$work/refused/tracegenie" restore "$work/corrupt" --url "http://localhost:$restore_port" --name "$name-refused" > "$work/refused.log" 2>&1; then
  echo 'Restore accepted a corrupt backup' >&2; exit 1
fi
[ ! -e "$work/refused/.env" ]
[ -z "$(docker volume ls -q --filter "label=com.docker.compose.project=$name-refused")" ]
echo 'PASS corrupt backup is rejected before creating volumes'
# A distinct test image proves replacement through the real upgrade command.
# This exercises deployment/persistence; it does not simulate a future schema change.
printf 'FROM %s\nLABEL org.tracegenie.upgrade-test="%s"\n' "$image" "$$" | docker build -t "$upgrade_image" - > "$work/upgrade-build.log" 2>&1
"$work/install/tracegenie" upgrade --image "$upgrade_image" > "$work/upgrade.log" 2>&1
[ "$(docker inspect -f '{{.Image}}' "$(dc install ps -q community)")" = "$(docker image inspect -f '{{.Id}}' "$upgrade_image")" ]
single_container install
smoke verify "$port" install state
# Build and run the actual distributed example with both products in one container.
docker build --build-arg "TRACEGENIE_IMAGE=$image" -t "$shared_image" "$release/examples/shared-container" > "$work/shared-build.log" 2>&1
awk -v port="$customer_port" '{print} /^    ports:/ {print "      - \"127.0.0.1:" port ":3000\""}' "$work/shared/compose.yaml" > "$work/shared/compose.pending"
mv "$work/shared/compose.pending" "$work/shared/compose.yaml"
"$work/shared/tracegenie" install --url "http://localhost:$shared_port" --name "$name-shared" --image "$shared_image" > "$work/shared.log" 2>&1
docker network connect "${name}-shared_default" "$name-mail"
single_container shared
node -e 'fetch(process.argv[1]).then(async r=>{if(!r.ok||!(await r.text()).includes("same container"))process.exit(1)})' "http://localhost:$customer_port"
dc shared exec -T community supervisorctl status customer-app
smoke initialize "$shared_port" shared shared-state
echo 'PASS customer app and complete reporting workflow run inside the same container'
if [ -n "${LEGACY_RELEASE_ARCHIVE:-}" ]; then
  mkdir "$work/legacy-unpacked" "$work/legacy"
  tar -xzf "$LEGACY_RELEASE_ARCHIVE" -C "$work/legacy-unpacked"
  legacy=$(find "$work/legacy-unpacked" -mindepth 1 -maxdepth 1 -type d)
  docker load -i "$legacy/image.tar.gz" > "$work/legacy-load.log"
  cp "$legacy/compose.yaml" "$legacy/Caddyfile" "$legacy/tracegenie" "$work/legacy/"
  "$work/legacy/tracegenie" install --url "http://localhost:$legacy_port" --name "$name-legacy" > "$work/legacy.log" 2>&1
  docker network connect "${name}-legacy_default" "$name-mail"
  smoke initialize "$legacy_port" legacy legacy-state
  "$work/legacy/tracegenie" backup > "$work/legacy-backup.log" 2>&1
  legacy_backup=$(find "$work/legacy/backups" -mindepth 1 -maxdepth 1 -type d ! -name '.partial-*')
  "$work/migrated/tracegenie" restore "$legacy_backup" --url "http://localhost:$migrated_port" --name "$name-migrated" > "$work/migrate.log" 2>&1
  docker network connect "${name}-migrated_default" "$name-mail"
  single_container migrated
  smoke verify "$migrated_port" migrated legacy-state
  # Migration must not claim, overwrite or remove the source installation.
  smoke verify "$legacy_port" legacy legacy-state
  echo 'PASS legacy backup migrates to one container and the source remains intact'
else
  echo 'NOT RUN legacy 0.1 migration (set LEGACY_RELEASE_ARCHIVE to exercise it)'
fi
printf 'Single-container release passed installation, reporting, local email, restart, replacement, worker recovery, backup, restore, upgrade and shared-app checks.\n'

#!/usr/bin/env bash
# Destructive only to the disposable installation names created by this run.
set -euo pipefail
archive=${1:?Usage: scripts/test-release.sh ARCHIVE.tar.gz}
archive=$(cd "$(dirname "$archive")" && pwd)/$(basename "$archive")
root=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d)
name="tgc-release-test-$$"
port=${RELEASE_TEST_PORT:-18388}
restore_port=$((port + 2))
mail_port=$((port + 4))
cleanup() {
  result=$?
  if [ "$result" -ne 0 ]; then
    for log in "$work"/*.log; do
      [ -f "$log" ] && tail -25 "$log" | sed -E 's/(Setup code.*:).*/\1 [REDACTED]/'
    done
  fi
  if [ "${KEEP_RELEASE_TEST:-0}" = 1 ]; then
    printf 'Private verification directory: %s\n' "$work"
  else
    docker rm -f "$name-mail" >/dev/null 2>&1 || true
    for dir in "$work/install" "$work/restore"; do
      [ ! -f "$dir/.env" ] || (cd "$dir" && docker compose --env-file .env -f compose.yaml down --volumes --remove-orphans >/dev/null 2>&1) || true
    done
    rm -rf "$work"
  fi
  exit "$result"
}
trap cleanup EXIT
mkdir "$work/unpacked" "$work/install" "$work/restore"
tar -xzf "$archive" -C "$work/unpacked"
release=$(find "$work/unpacked" -mindepth 1 -maxdepth 1 -type d)
[ -f "$release/source.tar.gz" ] && [ -f "$release/NOTICE" ]
tar -tzf "$release/source.tar.gz" | grep '^LICENSE$' > /dev/null
# Exercise the distributed images and operator files, not a local source checkout.
docker load -i "$release/image.tar.gz" > "$work/image-load.log"
for target in install restore; do
  cp "$release/compose.yaml" "$release/Caddyfile" "$release/tracegenie" "$work/$target/"
done
"$work/install/tracegenie" install --url "http://localhost:$port" --name "$name" > "$work/install.log" 2>&1
docker run -d --name "$name-mail" --network "${name}_default" -p "127.0.0.1:$mail_port:8025" axllent/mailpit:v1.27.8 >/dev/null
cd "$root"
node scripts/release-smoke.mjs initialize "http://localhost:$port" "$work/install" "$work/state.json" "http://localhost:$mail_port" "$name-mail"
"$work/install/tracegenie" stop > "$work/restart.log" 2>&1
"$work/install/tracegenie" start >> "$work/restart.log" 2>&1
node scripts/release-smoke.mjs verify "http://localhost:$port" "$work/install" "$work/state.json" "http://localhost:$mail_port" "$name-mail"
"$work/install/tracegenie" backup > "$work/backup.log" 2>&1
backup=$(find "$work/install/backups" -mindepth 1 -maxdepth 1 -type d ! -name '.partial-*')
"$work/restore/tracegenie" restore "$backup" --url "http://localhost:$restore_port" --name "$name-restored" > "$work/restore.log" 2>&1
docker network connect "${name}-restored_default" "$name-mail"
node scripts/release-smoke.mjs verify "http://localhost:$restore_port" "$work/restore" "$work/state.json" "http://localhost:$mail_port" "$name-mail"
printf 'Release archive passed installation, reporting, local email, reporter replies, restart, backup and restore.\n'

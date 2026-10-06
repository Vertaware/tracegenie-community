#!/usr/bin/env bash
set -euo pipefail
export COPYFILE_DISABLE=1
cd "$(dirname "$0")/.."
version=${1:?Usage: scripts/package-release.sh VERSION}
[[ "$#" -eq 1 ]] || { echo "Build a fresh release from source; --existing-image is not supported." >&2; exit 1; }
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-z0-9.-]+)?$ ]] || { echo "Use a semantic version." >&2; exit 1; }
image="tracegenie-community:$version"
release_name="tracegenie-community-$version-$(docker info --format '{{.Architecture}}')"
output=".local/releases/$release_name"
staging=$(mktemp -d)
trap 'rm -rf "$staging"' EXIT
release="$staging/release/$release_name"
mkdir -p "$staging/source"
# Snapshot the shareable tree once, including uncommitted work. Exclude private
# and generated files even if someone accidentally added them to Git.
git ls-files --cached --others --exclude-standard -z -- . \
  ':(glob,exclude)**/node_modules/**' ':(glob,exclude)**/dist/**' ':!:.local/**' ':!:backlog/**' \
  ':(glob,exclude)**/.env' ':(glob,exclude)**/.env.*' ':(glob,exclude)**/*.log' ':(glob,exclude)**/*.tsbuildinfo' \
  ':(glob,exclude)**/.DS_Store' ':!:apps/api/uploads/**' ':(glob,exclude)**/backups/**' \
  ':(glob,exclude)**/coverage/**' ':(glob,exclude)**/test-results/**' ':(glob,exclude)**/playwright-report/**' \
  > "$staging/source-files"
# The public example is a build/setup input, not a credential file.
printf '.env.example\0' >> "$staging/source-files"
tar --null --no-recursion -czf "$staging/source.tar.gz" -T "$staging/source-files"
tar -xzf "$staging/source.tar.gz" -C "$staging/source"
docker build -t "$image" "$staging/source"
mkdir -p "$release/docs" "$release/packages/shared" "$release/examples"
cp "$staging/source/deploy/compose.yaml" "$release/"
cp -R "$staging/source/examples/shared-container" "$release/examples/"
cp "$staging/source/docs/SHARED_CONTAINER.md" "$release/docs/"
cp "$staging/source/LICENSE" "$staging/source/NOTICE" "$staging/source.tar.gz" "$release/"
cp "$staging/source/docs/LICENSING.md" "$release/docs/"
cp "$staging/source/packages/shared/MOTION-LICENSE-NOTICE.txt" "$release/packages/shared/"
sed -e 's|](LICENSING.md)|](docs/LICENSING.md)|g' -e 's|](SHARED_CONTAINER.md)|](docs/SHARED_CONTAINER.md)|g' "$staging/source/docs/SELF_HOSTING.md" > "$release/README.md"
# The one image includes PostgreSQL, the gateway, the worker and the application.
docker save "$image" | gzip > "$release/image.tar.gz"
sed "s/tracegenie-community:local/$image/g" "$staging/source/deploy/tracegenie" > "$release/tracegenie"
chmod +x "$release/tracegenie"
mkdir -p "$(dirname "$output")"
tar -czf "$output.tar.gz" -C "$(dirname "$release")" "$(basename "$release")"
(cd "$(dirname "$output")" && shasum -a 256 "$(basename "$output").tar.gz" > "$(basename "$output").tar.gz.sha256")
printf 'Release: %s/%s.tar.gz\n' "$PWD" "$output"

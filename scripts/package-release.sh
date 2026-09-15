#!/usr/bin/env bash
set -euo pipefail
export COPYFILE_DISABLE=1
cd "$(dirname "$0")/.."
version=${1:?Usage: scripts/package-release.sh VERSION}
[[ "$#" -eq 1 ]] || { echo "Build a fresh release from source; --existing-image is not supported." >&2; exit 1; }
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-z0-9.-]+)?$ ]] || { echo "Use a semantic version." >&2; exit 1; }
image="tracegenie-community:$version"
release=".local/releases/tracegenie-community-$version-$(docker info --format '{{.Architecture}}')"
staging=$(mktemp -d)
trap 'rm -rf "$staging"' EXIT
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
mkdir -p "$release/docs" "$release/packages/shared"
cp "$staging/source/deploy/compose.yaml" "$staging/source/deploy/Caddyfile" "$release/"
cp "$staging/source/LICENSE" "$staging/source/NOTICE" "$staging/source.tar.gz" "$release/"
cp "$staging/source/docs/LICENSING.md" "$release/docs/"
cp "$staging/source/packages/shared/MOTION-LICENSE-NOTICE.txt" "$release/packages/shared/"
sed 's|](LICENSING.md)|](docs/LICENSING.md)|g' "$staging/source/docs/SELF_HOSTING.md" > "$release/README.md"
# Ship the exact built app plus support images, so the archive needs no registry account.
docker pull postgres:17-alpine
docker pull caddy:2.10.2-alpine
docker save "$image" postgres:17-alpine caddy:2.10.2-alpine | gzip > "$release/image.tar.gz"
sed "s/tracegenie-community:local/$image/g" "$staging/source/deploy/tracegenie" > "$release/tracegenie"
chmod +x "$release/tracegenie"
tar -czf "$release.tar.gz" -C "$(dirname "$release")" "$(basename "$release")"
(cd "$(dirname "$release")" && shasum -a 256 "$(basename "$release").tar.gz" > "$(basename "$release").tar.gz.sha256")
printf 'Release: %s/%s.tar.gz\n' "$PWD" "$release"

# Self-host TraceGenie Community

One installation contains one project, the original consumer app, secure reporter pages, hosted feedback form, and widget. The application and worker run from the same versioned image; PostgreSQL and uploaded files use persistent Docker volumes.

## Install from a release archive

Install Docker with Compose v2 and a Bash terminal (Linux, macOS, or Windows with WSL2). Start Docker. Download the archive matching your CPU, verify its SHA-256 checksum against the release checksum, extract it, and open that directory in a terminal. No Node, npm, source checkout, database account or external mail account is needed on the host.

```sh
./tracegenie install
```

Open http://localhost:8088. The installer displays a private setup code. Enter it, your real name/email/password and project name. It works only before the first administrator exists. Continue through the existing Email and Installation settings. Email can be configured later, but external email delivery, password recovery and reporter access codes need a working provider. Reports can still be captured without email.

The setup code is stored in the private `.env`; `./tracegenie setup-code` shows it again. It is never put in a URL, browser bundle or public API response. Existing installations cannot be re-claimed after restart. Keep `.env` with your backups: it includes the key needed to decrypt saved email credentials.

## Public HTTPS installation

Point a domain at your server and allow incoming ports 80 and 443. In a fresh release directory:

```sh
./tracegenie install --url https://feedback.example.com --name my-feedback
```

Caddy requests and renews HTTPS certificates. API, consumer pages, reporter pages and widget assets share this address; no per-customer image rebuild is necessary. The database has no published port. Local installs bind only to 127.0.0.1. A public installation deliberately binds ports 80/443 on all interfaces. Domain/DNS and certificate issuance must be verified on your own server; local tests do not prove public TLS issuance.

For another local port use `--url http://localhost:8090`. The adjacent port is reserved for the gateway's HTTPS listener. Each installation needs its own directory and unique `--name`. Reusing a Docker installation name is refused.

## Widget and hosted form

Open Settings → Installation. Add your website's exact origin, generate a project secret, and follow the existing frontend and backend snippets. Keep the project secret on your website's server. The normal widget requires that server-side session-token endpoint; static sites need a serverless endpoint. The hosted feedback URL works without modifying your website:

`https://feedback.example.com/feedback/?projectKey=community&mode=feedback`

The script bundle is served at `/widget/embed.js`. Submit a real test report and check it in Issues before considering the integration verified.

## Start, stop and diagnose

```sh
./tracegenie start
./tracegenie status
./tracegenie logs
./tracegenie stop
```

Start waits for PostgreSQL, applies migrations, and waits for API/storage readiness and a live worker processing loop. Containers restart after a process exit or Docker restart. An unhealthy container is reported by Docker; health status alone does not restart a hung process. If startup fails, fix the reported cause and rerun start. Do not remove Docker volumes to troubleshoot a startup failure.

## Back up and restore

```sh
./tracegenie backup
```

This briefly stops application writes and the worker, captures a consistent database dump, uploads and private `.env`, writes a checksum manifest, and resumes services. Copy the completed backup directory to secure storage on another machine. Partial backup directories are not restorable. Backups contain credentials and customer data.

Restore into a fresh release directory using a NEW installation name and an available address:

```sh
./tracegenie restore /secure/path/to/backup --url http://localhost:8090 --name feedback-restored
```

Restore verifies checksums and refuses existing Docker volumes or a nonempty database. It preserves accounts, reports, uploads, JWT and email encryption keys; it replaces only the previous first-party origin if the address changed. Customer website origins remain configured. Reconfigure DNS or website snippets if the public address changes. Restoring does not send a test email, but the restarted worker resumes any pending notifications, so keep a recovery environment isolated from external SMTP if you do not want delivery.

## Upgrade

Obtain the next versioned application image (a release archive includes it; load with `docker load -i image.tar.gz`) and retain any supplied updated operator files. Run from the existing installation directory:

```sh
./tracegenie upgrade --image tracegenie-community:0.1.1
```

The command validates the image reference, obtains the image, takes a backup, stops application writes, applies migrations and waits for readiness. Data volumes and `.env` secrets are preserved. Use an explicit version or digest, never `latest`. Follow release notes for changes to Compose or the installer. A failed migration does not trigger an automatic downgrade: recover the pre-upgrade backup in a fresh installation with the earlier image.

## Build a release (maintainers)

```sh
scripts/package-release.sh 0.1.0
```

This builds from source inside Docker and writes an architecture-specific archive and SHA-256 checksum under `.local/releases/`. The archive includes the app image, PostgreSQL and Caddy images, installer, Compose configuration, this guide, license notices and the matching application source in `source.tar.gz`. The packager requires Git and creates a source snapshot before building, so the archived source matches the build input; reusing an existing image is not supported. Publish `source.tar.gz` alongside any separately distributed app image or widget bundle. See the [licensing guide](LICENSING.md). ARM64 is verified on this Mac. Build/test AMD64 separately before publishing that platform. Versioned registry distribution can replace the included image archive once the Community GitHub/registry account is chosen. Nothing is published by this script.

The README's npm commands remain the developer workflow. This Docker workflow never uses or changes that development database, ports or credentials.

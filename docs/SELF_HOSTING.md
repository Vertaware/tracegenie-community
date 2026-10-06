# Self-host TraceGenie Community

The 0.2 packaging runs the application, email worker, PostgreSQL 17 and Caddy in **one container**, with one persistent volume. It contains one project, the consumer app, reporter pages, hosted form and widget. It can run alongside your app on an existing Docker host, or be included in a rebuilt application image using the [shared-container guide](SHARED_CONTAINER.md).

Version 0.1.0 uses the previous four-container layout. These single-container instructions apply to version 0.2.0 or later. Existing 0.1 installations should use the migration procedure below.

## Install from a release archive

Install Docker with Compose v2 and a Bash terminal (Linux, macOS, or Windows with WSL2). Choose `aarch64` for ARM64 or `x86_64` for AMD64/Intel, as reported by `docker info --format '{{.Architecture}}'`. Download the matching installer archive and checksum from [GitHub Releases](https://github.com/Vertaware/tracegenie-community/releases).

For example, using a 0.2.0 ARM64 archive:

```sh
shasum -a 256 -c tracegenie-community-0.2.0-aarch64.tar.gz.sha256
tar -xzf tracegenie-community-0.2.0-aarch64.tar.gz
cd tracegenie-community-0.2.0-aarch64
./tracegenie install
```

On Linux, `sha256sum -c FILE.sha256` also verifies the checksum. Substitute `x86_64` for AMD64. No host Node installation, source checkout, separate database service or registry account is needed: the archive includes the combined image. Email delivery still needs your Resend or SMTP provider.

Open http://localhost:8088. Enter the private setup code printed by the installer and create your administrator account and project. Setup closes after the first administrator is created. Configure Email and Installation in Settings; reports can be captured before email is configured, but external delivery, password recovery and reporter access codes need a working provider.

The installer generates private `.env` configuration; `./tracegenie setup-code` shows its setup code again. Keep `.env` with your backups: it contains the encryption key for saved email credentials. Never put it in a public repository.

## Existing server or application container

You do not need a dedicated server: use an existing Docker host with sufficient resources and available ports. The standard installer runs one additional TraceGenie container. It does not install reporting into your application's process.

To put both products in the **same container**, rebuild your application image from the Community base and register its startup command with Supervisor. The [shared-container example](SHARED_CONTAINER.md) documents the tested Node example, ports, runtime requirements and backup boundaries. This involves rebuilding/redeploying your image, not modifying a running container.

## Public HTTPS installation

Point a domain at the server and make ports 80 and 443 available. In a fresh release directory:

```sh
./tracegenie install --url https://feedback.example.com --name my-feedback
```

Caddy requests and renews certificates. API, consumer pages, reporter pages and widget assets share this address. PostgreSQL and the API listen only inside the container. Local installations publish gateway ports on 127.0.0.1; public installations publish ports 80/443 on all interfaces. The image uses ports 8080/8443 internally so the gateway runs without root privileges. Public DNS, external email delivery and certificate issuance require verification on your own deployment.

Use `--url http://localhost:8090` for a different local port. The adjacent port is reserved for HTTPS. Each installation needs a fresh directory and unique `--name`; reusing a name that owns Docker volumes is refused. The public installer expects to own host ports 80/443. If another gateway already uses them, adapt and test your existing proxy routing instead of stopping another application or claiming those ports.

## Widget and hosted form

Open Settings → Installation. Add your app's exact origin and follow the existing frontend and backend snippets. Keep the project secret on your app's server. The widget needs a server-side session-token endpoint; static sites need a serverless endpoint. Sharing a server or container does not remove this integration step.

The hosted form works without changing your app:

`https://feedback.example.com/feedback/?projectKey=community&mode=feedback`

Widget assets are served at `/widget/embed.js`. Submit a report and check its screenshot and replies before considering your integration verified.

## Start, stop and diagnose

```sh
./tracegenie start
./tracegenie status
./tracegenie logs
./tracegenie stop
```

Supervisor starts PostgreSQL, applies migrations before the API starts, waits for API readiness before running the worker, and manages the gateway. It restarts exited services. Shutdown stops the web services before PostgreSQL and gives the database time to stop cleanly. The health check verifies all supervised processes, database/API readiness, the gateway and a recent worker processing heartbeat. A hung process is reported as unhealthy; Docker does not automatically restart a container merely because its health check fails.

If startup fails, inspect the logs, fix the cause and retry `start`. Never delete volumes to troubleshoot startup. The named volume mounts at `/var/lib/postgresql/data`; `/data` inside the image points there. It contains `postgres/`, `uploads/` and `caddy/`. Retain both this volume and `.env` when replacing the container. Do not use `docker compose down --volumes` on an installation you want to keep.

## Back up and restore

```sh
./tracegenie backup
```

This briefly stops TraceGenie's web and worker processes, captures a consistent PostgreSQL dump and attachments, copies `.env`, writes a checksum manifest, and resumes service. The container and database remain running. Partial backups are not restorable. Copy the completed directory to secure storage on another machine. The backup includes credentials and customer reports; it excludes gateway certificates (reissued on a public deployment) and any separately bundled application's data.

Restore into a fresh release directory with a new installation name and available address:

```sh
./tracegenie restore /secure/path/to/backup --url http://localhost:8090 --name feedback-restored
```

The installer verifies checksums before creating resources and refuses existing volumes or a nonempty database. It starts only the database during restore, loads the backup, applies migrations and updates the first-party origin before starting the web services. Accounts, reports, uploads, JWT and email encryption keys are preserved; customer website origins remain configured. Use `--image YOUR_CUSTOM_IMAGE:VERSION` for a combined app image.

The worker resumes queued notifications once restoration completes. Isolate a recovery environment from external email if it must not deliver them. A failed restore remains in maintenance mode; inspect logs and recover into another fresh installation rather than forcing the partial data into service.

## Upgrade a single-container installation

Load the desired version's `image.tar.gz` and use any updated operator files supplied in its release. From the existing installation directory:

```sh
./tracegenie upgrade --image tracegenie-community:0.2.1
```

This is an example future version. Use an actually available version or digest. The command validates the image packaging, backs up, stops the container, replaces it, applies migrations and waits for readiness. The data volume and secrets remain. Never use `latest`. A failed migration is not automatically downgraded: restore the pre-upgrade backup into a fresh installation with a compatible image. PostgreSQL major-version changes require a documented migration; do not reuse raw database files across majors.

For a custom app image, rebuild that image using the new Community version and upgrade to your custom tag. A stock image does not contain your application.

## Migrate from the 0.1 four-container installation

Keep the original 0.1 directory and its operator files intact. Run its `./tracegenie backup`, then `./tracegenie stop` when ready to cut over. Extract the 0.2 archive into a **new directory** and restore that backup using a **new name** and an available URL. The new installer reads the old logical backup format and creates the single-container volume. It does not rename, mount or overwrite the old database volume.

Verify login, reports, screenshots, replies and email on the restored installation before changing widget URLs or retiring the old installation. Keep the original backup and stopped installation for recovery. Copying new Compose/operator files over a live 0.1 installation is not the migration procedure.

## Build and verify a release (maintainers)

```sh
scripts/package-release.sh 0.2.0
LEGACY_RELEASE_ARCHIVE=/path/to/tracegenie-community-0.1.0-aarch64.tar.gz \
  scripts/test-release.sh .local/releases/tracegenie-community-0.2.0-aarch64.tar.gz
```

The packager snapshots shareable source before building and writes one architecture-specific image archive, its SHA-256 checksum, installer, Compose file, shared-container example, guide, license notices and matching `source.tar.gz`. No reused prebuilt app image is accepted. See [licensing](LICENSING.md).

Release tests exercise fresh setup, reports/screenshots, local SMTP, replies, restart, container replacement, worker recovery, backup, restore, upgrades and the bundled shared-container example. With `LEGACY_RELEASE_ARCHIVE`, they also create and migrate a disposable 0.1 installation and verify the original remains intact. The workflow runs this on native ARM64 and AMD64 runners before publishing a tagged release. Running the local packager does not publish anything.

The source development workflow (`npm run dev`) is separate and unchanged.

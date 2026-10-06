# Run TraceGenie inside your application container

You can rebuild your application's image to include both your app and TraceGenie. The single-container Community image supplies Node 24, PostgreSQL 17, the reporting application, email worker, Caddy and Supervisor. The example in `examples/shared-container` starts a small Node application alongside them.

This is a custom image build, not an installation into an already-running container. Your application must be compatible with the Debian Bookworm runtime, or you must adapt and test its runtime dependencies. The documented route uses the Community image as the final base image; copying an arbitrary existing image into it is not supported.

## Build the example

Load the single-container release image with `docker load -i image.tar.gz` (the installer also loads it automatically). From the extracted release directory, or this repository:

```sh
docker build --build-arg TRACEGENIE_IMAGE=tracegenie-community:0.2.0 \
  -t my-internal-app:0.1.0 examples/shared-container
```

The example Dockerfile adds the application's files and a Supervisor program definition. Replace `server.mjs` with your built app and dependencies, and update `customer-app.conf` to run its startup command. Use an absolute executable path and keep the program's `user=node`, signal handling, logging and `autostart` setting. The latter prevents it starting during a restoration.

Keep the base image's `ENTRYPOINT`, `CMD` and health check. Supervisor needs to start as root to manage PostgreSQL and file ownership; PostgreSQL, the reporting app, worker, gateway and example application run as unprivileged users. Do not replace the container command with `npm start`: put your app's command in its Supervisor program instead.

## Install the combined image

Use a fresh copy of the release's `tracegenie` and `compose.yaml` files. Add your application's port to `community.ports` in that copy of `compose.yaml`:

```yaml
    ports:
      - "127.0.0.1:3000:3000"
      - "${BIND_ADDRESS}:${HTTP_PORT}:8080"
      - "${BIND_ADDRESS}:${HTTPS_PORT}:8443"
```

Then install your custom image:

```sh
./tracegenie install --image my-internal-app:0.1.0 \
  --name my-internal-app --url http://localhost:8088
```

The example app is at http://localhost:3000; TraceGenie is at http://localhost:8088. Both run inside the same container. Complete owner setup, configure email, and use Settings → Installation to add your app's origin and frontend/backend widget snippets. Sharing the container does not automatically add the widget or its token endpoint to your application.

For public access, configure the appropriate host routing for your app. TraceGenie's built-in gateway handles the TraceGenie address; it does not automatically publish or configure HTTPS for your custom application's port. Pick free ports if the server already has a web gateway. The processes reserve internal ports 4310 (API), 5432 (PostgreSQL), 2019 (Caddy administration), 8080 and 8443 (gateway).

## Operate and upgrade

The combined app shares restart, resources and upgrade timing with TraceGenie. The container health check requires every supervised program to be running and additionally checks TraceGenie's API/database readiness, gateway and worker heartbeat. Add your own application-level checks if its process can remain running while unhealthy.

Rebuild your custom image on the desired Community version before upgrading with `./tracegenie upgrade --image my-internal-app:NEW_VERSION`. Upgrading to the stock Community image would remove your bundled application from the container. Keep the updated operator files with the installation and follow the Community release notes.

The persistent volume holds TraceGenie's database, attachments and gateway certificates. `./tracegenie backup` saves TraceGenie's database, uploads and configuration. It does **not** back up your application's own database/files or gateway certificates. Define and verify those backups separately; keep any custom volumes in your Compose configuration. Use `--image my-internal-app:VERSION` when restoring a combined installation into a fresh directory.

TraceGenie remains AGPL-3.0-only. See [licensing](LICENSING.md) for the existing terms and integration guidance; container sharing does not change the license.

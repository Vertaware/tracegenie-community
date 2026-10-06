# Replace this example server with your built application and dependencies.
ARG TRACEGENIE_IMAGE=tracegenie-community:0.2.0
FROM ${TRACEGENIE_IMAGE}
COPY --chown=node:node server.mjs /srv/customer-app/server.mjs
COPY customer-app.conf /etc/supervisor/conf.d/customer-app.conf
EXPOSE 3000
# Keep TraceGenie's ENTRYPOINT and CMD: Supervisor starts both applications.

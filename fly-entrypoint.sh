#!/bin/sh
set -e

# Fly mounts empty volumes as root-owned, and this image shares its lifecycle
# with plain `docker run` deployments, so the entrypoint runs as root just long
# enough to make the data directory writable by the unprivileged node user,
# then drops privileges permanently before starting the server.

DATA_DIR="${DATA_DIR:-/app/data}"

if [ -n "$DATA_DIR" ]; then
  mkdir -p "$DATA_DIR"
  chown -R node:node "$DATA_DIR"
fi

exec su node -s /bin/sh -c 'exec node /app/src/service/server.js'
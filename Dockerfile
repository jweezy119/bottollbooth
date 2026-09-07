FROM node:22-alpine

ENV NODE_ENV=production
ENV PORT=8080

WORKDIR /app

# Zero-dependency service: no build step, no npm install in the image.
COPY package.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node audit.html ./audit.html
COPY --chown=node:node app.html ./app.html

# Persistent workspace store (JSON files); pre-created writable by node.
RUN mkdir -p /app/data && chown node:node /app/data

# The entrypoint runs as root only to chown an (initially empty) attached data
# volume, then permanently drops to the unprivileged node user via busybox su.
# Healthchecks and default `docker run` behave as before; the server itself
# never runs as root.
COPY --chown=node:node fly-entrypoint.sh ./fly-entrypoint.sh
RUN chmod +x /app/fly-entrypoint.sh

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8080) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "src/service/server.js"]
ENTRYPOINT ["/app/fly-entrypoint.sh"]
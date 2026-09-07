FROM node:22-alpine

ENV NODE_ENV=production
ENV PORT=8080

WORKDIR /app

# Zero-dependency service: no build step, no npm install in the image.
COPY package.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node audit.html ./audit.html

# Run as the unprivileged node user, never as root.
USER node

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8080) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "src/service/server.js"]
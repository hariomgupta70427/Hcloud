# HCloud Relay — production image
#
# Targets Oracle Cloud's always-free Ampere A1 instances, which are arm64. The
# base image is multi-arch so this same Dockerfile also builds on x86_64 (AMD
# always-free shape, or a local machine) with no changes.
#
# Multi-stage: the build stage keeps TypeScript and dev dependencies out of the
# final image, which is production dependencies plus compiled JavaScript only.

# ---------- build ----------
FROM node:22-alpine AS build

WORKDIR /build

# Copy manifests first so dependency install is cached independently of source.
COPY package*.json ./
RUN npm install --no-audit --no-fund

COPY tsconfig.json ./
COPY server.ts ./
RUN npx tsc

# ---------- runtime ----------
FROM node:22-alpine AS runtime

# dumb-init gives the container a real PID 1 that forwards SIGTERM to Node, so
# the graceful-shutdown handler actually runs on `docker stop`. Without it Node
# is PID 1, ignores the default signal disposition, and gets SIGKILLed after the
# timeout — cutting off in-flight uploads.
RUN apk add --no-cache dumb-init

ENV NODE_ENV=production
# Listen on all interfaces *inside* the container; Docker publishes only to
# 127.0.0.1 on the host (see docker-compose.yml), so Caddy remains the only
# public entrypoint.
ENV HOST=0.0.0.0
ENV PORT=3001
# Staging area for upload chunks — mounted as a named volume.
ENV TEMP_ROOT=/data/tmp

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund \
    && npm cache clean --force

COPY --from=build /build/dist ./dist

# Run unprivileged. `node` (uid 1000) ships with the base image.
RUN mkdir -p /data/tmp && chown -R node:node /data
USER node

EXPOSE 3001

# Compose/Caddy both rely on this to know when the process is actually serving.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/server.js"]

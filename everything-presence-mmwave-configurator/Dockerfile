ARG BUILD_FROM=ghcr.io/hassio-addons/base:19.0.0

# Image identity, stamped into OCI labels on every runnable stage.
# BUILD_VERSION mirrors `version:` in config.yaml and is supplied by CI (and by
# the Home Assistant Supervisor, which injects it automatically) — the "dev"
# default only applies to a plain local `docker build`.
ARG BUILD_VERSION=dev
ARG BUILD_REF=unknown

FROM node:20-alpine AS build
WORKDIR /app
ENV NODE_ENV=development

# Source copied before install so install+build+prune is one atomic layer
# invalidated by source changes — fixes stale-install failure (#306).
COPY package.json package-lock.json ./
COPY backend backend
COPY frontend frontend
RUN npm ci --include=dev \
 && npm run build --workspaces \
 && npm prune --omit=dev --workspaces

FROM ${BUILD_FROM} AS addon
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
ENV NODE_ENV=production \
    PORT=42069 \
    FIRMWARE_LAN_PORT=38080 \
    FRONTEND_DIST=/app/frontend/dist
WORKDIR /app

RUN apk add --no-cache nodejs npm

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/backend/package.json ./backend/package.json
COPY --from=build /app/backend/node_modules ./backend/node_modules
COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/frontend/dist ./frontend/dist
COPY config.yaml ./config.yaml
COPY config ./config
COPY rootfs/ /

RUN rm -rf /etc/services.d/zone-configurator && \
    chmod +x /etc/s6-overlay/s6-rc.d/zone-configurator/run

EXPOSE 42069/tcp 38080/tcp

# Last instruction in the stage so a version-only change rebuilds one tiny layer.
# These explicitly override the org.opencontainers.image.* values inherited from
# BUILD_FROM, which otherwise describe the base image rather than this add-on.
ARG BUILD_VERSION
ARG BUILD_REF
LABEL org.opencontainers.image.version="${BUILD_VERSION}" \
      org.opencontainers.image.revision="${BUILD_REF}" \
      org.opencontainers.image.title="Everything Presence Zone Configurator (add-on)" \
      org.opencontainers.image.description="Visualise and configure Everything Presence Lite, One and Pro mmWave presence sensors for Home Assistant." \
      org.opencontainers.image.source="https://github.com/EverythingSmartHome/everything-presence-addons" \
      org.opencontainers.image.url="https://github.com/EverythingSmartHome/everything-presence-addons" \
      org.opencontainers.image.vendor="Everything Smart Home"

FROM node:20-alpine AS standalone
WORKDIR /app
ENV NODE_ENV=production \
    PORT=42069 \
    FIRMWARE_LAN_PORT=38080 \
    FRONTEND_DIST=/app/frontend/dist

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/backend/package.json ./backend/package.json
COPY --from=build /app/backend/node_modules ./backend/node_modules
COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/frontend/dist ./frontend/dist
COPY config.yaml ./config.yaml
COPY config ./config

EXPOSE 42069/tcp 38080/tcp
CMD ["node", "backend/dist/index.js"]

# Last instruction in the stage so a version-only change rebuilds one tiny layer.
ARG BUILD_VERSION
ARG BUILD_REF
LABEL org.opencontainers.image.version="${BUILD_VERSION}" \
      org.opencontainers.image.revision="${BUILD_REF}" \
      org.opencontainers.image.title="Everything Presence Zone Configurator" \
      org.opencontainers.image.description="Visualise and configure Everything Presence Lite, One and Pro mmWave presence sensors for Home Assistant." \
      org.opencontainers.image.source="https://github.com/EverythingSmartHome/everything-presence-addons" \
      org.opencontainers.image.url="https://github.com/EverythingSmartHome/everything-presence-addons" \
      org.opencontainers.image.vendor="Everything Smart Home"

# Default build target for Home Assistant add-on builds.
FROM addon AS final

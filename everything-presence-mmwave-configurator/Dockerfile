ARG BUILD_FROM=ghcr.io/hassio-addons/base:19.0.0

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

# Default build target for Home Assistant add-on builds.
FROM addon AS final

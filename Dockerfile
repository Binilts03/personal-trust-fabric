# PTF operator image (ticket 12). Single-operator production runtime:
# pinned Node 22 slim, non-root, read-only filesystem with /data + /tmp
# writable. Build: docker build -t ptf:0.1.0 .  Run e.g.:
# docker run --read-only -v ptf-store:/data ptf:0.1.0 dist/src/cli.js --dir /data audit --verify
# Record the built digest alongside the release (`docker inspect ptf:0.1.0
# --format '{{.RepoDigests}}'` → docs/audit/public-flip.md §7). The base tag
# floats on patch releases by design (debian security rebuilds); the digest
# recorded at release time is the pin — never retag a released digest.
# HEALTHCHECK is deliberately host-composed, not baked in: the CLI exits
# after one command (nothing to probe) and the PDP/MCP probes differ (see
# docs/audit/operations.md for the compose/k8s probe lines).

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY LICENSE README.md ./
# Non-root: use the image's unprivileged `node` user for everything.
USER node
# Store + temp are the only writable paths under --read-only.
VOLUME ["/data", "/tmp"]
EXPOSE 3000
# Bare `node` so every bin is runnable: dist/src/cli.js (default),
# dist/src/mcp-server.js, dist/src/pdp-server.js (with its env + TLS mount).
ENTRYPOINT ["node"]
CMD ["dist/src/cli.js", "--help"]

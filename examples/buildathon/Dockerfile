# Build only the explicitly synthetic Buildathon presentation service.
# Not the PTF PDP production service. Never embed keys or real user data.
FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY src/ ./src/
RUN npm ci --ignore-scripts && npm run build && npm prune --omit=dev --ignore-scripts

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node examples/buildathon/ ./examples/buildathon/
USER node
EXPOSE 8080
CMD ["node", "examples/buildathon/server.mjs"]

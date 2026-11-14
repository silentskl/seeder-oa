# Seeder upstream v2.1.0 supports RUNTIME=node and local SQLite.
# Apply the OA overlay to seeder-oa-app BEFORE building.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY seeder-oa-app/package.json seeder-oa-app/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY seeder-oa-app/ ./
ENV RUNTIME=node
RUN npm run build:node

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production RUNTIME=node PORT=3000 HOSTNAME=0.0.0.0 \
    SQLITE_DB_PATH=/data/seeder.db UPLOADS_DIR=/data/uploads
# Full node_modules retained: native SQLite is dynamically required at runtime.
COPY --from=build --chown=node:node /app /app
COPY --chown=node:node deploy/ubuntu/finance-scheduler.mjs /app/finance-scheduler.mjs
USER node
EXPOSE 3000
CMD ["npm","run","start:node"]

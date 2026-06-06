# Gloss — single image: build the SPA, then run the Node server that serves
# both the static SPA and the API on one origin (port 8787).

# ---- build stage: compile the web app ----
FROM node:20-alpine AS build
WORKDIR /app

# Workspace manifests first for layer caching.
COPY package.json package-lock.json ./
COPY packages/core/package.json ./packages/core/
COPY packages/anchor/package.json ./packages/anchor/
COPY packages/git/package.json ./packages/git/
COPY packages/server/package.json ./packages/server/
COPY apps/web/package.json ./apps/web/

RUN npm ci

# Source, then build the SPA → apps/web/dist
COPY . .
RUN npm run build --workspace @gloss/web

# ---- runtime stage: server + built SPA + prod deps only ----
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8787

# Production dependencies only (server has just workspace deps; no external prod deps).
COPY package.json package-lock.json ./
COPY packages/core/package.json ./packages/core/
COPY packages/anchor/package.json ./packages/anchor/
COPY packages/git/package.json ./packages/git/
COPY packages/server/package.json ./packages/server/
COPY apps/web/package.json ./apps/web/
RUN npm ci --omit=dev --ignore-scripts

# App source (server + the protocol packages it imports).
COPY packages ./packages
# The built SPA from the build stage.
COPY --from=build /app/apps/web/dist ./apps/web/dist

EXPOSE 8787
CMD ["node", "packages/server/src/index.js"]

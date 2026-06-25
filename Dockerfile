# ----------- Build Stage -----------
FROM node:22 AS builder
WORKDIR /usr/src/app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ----------- Production Deps Stage -----------
FROM node:22 AS prod-deps
WORKDIR /usr/src/app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

# ----------- Production Stage -----------
FROM node:22-bookworm-slim AS production
WORKDIR /usr/src/app

RUN groupadd -r appgroup && useradd -r -g appgroup appuser

COPY --chown=appuser:appgroup --from=prod-deps /usr/src/app/node_modules ./node_modules
COPY --chown=appuser:appgroup --from=builder /usr/src/app/dist ./dist
COPY --chown=appuser:appgroup package.json package-lock.json ./

EXPOSE 8083

ENV NODE_ENV=production

USER appuser

CMD ["dist/index.handler"]

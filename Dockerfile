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
FROM public.ecr.aws/lambda/nodejs:22 AS production
WORKDIR ${LAMBDA_TASK_ROOT}

COPY --from=prod-deps /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/dist ./dist
COPY package.json package-lock.json ./

ENV NODE_ENV=production

CMD ["dist/index.handler"]

# Build multi-stage — NestJS. Corepack fija la versión exacta de pnpm que
# ya usa el proyecto (ver "packageManager" en package.json), sin depender
# de qué pnpm tenga instalado la imagen base.
FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm run build

# Runtime — solo dependencias de producción, sin devDependencies ni código
# fuente TypeScript (queda `dist/` compilado).
FROM node:22-alpine AS runtime
WORKDIR /app
RUN corepack enable
ENV NODE_ENV=production
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY --from=build /app/dist ./dist

EXPOSE 3000
CMD ["node", "dist/main"]

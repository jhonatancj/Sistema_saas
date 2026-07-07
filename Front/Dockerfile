# Build multi-stage — Angular (SPA pura, sin SSR: la resolución de tenant
# por subdominio es 100% client-side vía window.location.hostname, ver
# TenantService — nginx solo sirve estáticos + fallback de SPA).
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
# @jhonatancj/dforms es un paquete privado en GitHub Packages (ver su
# propio README) — requiere un token con scope read:packages. pnpm rechaza
# expandir variables de entorno en credenciales que vengan del .npmrc DEL
# PROYECTO (protección contra un .npmrc committeado que filtre el secreto a
# un registry controlado por un atacante) — el token tiene que ir en un
# .npmrc de usuario (~/.npmrc), nunca en el del repo. Se escribe temporal
# a partir de un BUILD SECRET (nunca ARG/ENV — no queda persistido en
# ninguna capa de la imagen ni en `docker history`) y se borra en el mismo
# RUN antes de que termine esa capa:
#   docker build --secret id=npm_auth_token,env=NODE_AUTH_TOKEN -f Dockerfile .
RUN --mount=type=secret,id=npm_auth_token \
    echo "//npm.pkg.github.com/:_authToken=$(cat /run/secrets/npm_auth_token)" > /root/.npmrc && \
    pnpm install --frozen-lockfile && \
    rm -f /root/.npmrc
COPY . .
RUN pnpm run build --configuration production

FROM nginx:1.27-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/Saas_Inventario/browser /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]

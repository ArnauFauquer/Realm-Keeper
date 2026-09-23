# Build stage
FROM node:20-alpine AS build
WORKDIR /app
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
ARG VITE_APP_VERSION
ENV VITE_APP_VERSION=$VITE_APP_VERSION
COPY package*.json ./
# npm ci installs exactly what package-lock.json pins (and fails if it's out
# of sync with package.json), so the image ships the audited dependency tree
# rather than whatever npm install resolves on the day. It does demand that
# the lockfile's optionalDependencies entries (e.g. esbuild's per-platform
# binaries) match what the installing npm would write, which breaks across
# npm major versions — node:20-alpine bundles npm 10.x, so pin the npm the
# lockfile is generated with. Bump this together with the lockfile.
RUN npm install -g npm@11.11.0 && npm ci
COPY . .
RUN npm run build

# Production stage
FROM nginxinc/nginx-unprivileged:alpine
# Processed by the base image's own entrypoint (envsubst-on-templates) into
# /etc/nginx/conf.d/default.conf, with NGINX_LOCAL_RESOLVERS filled in from
# the container's actual /etc/resolv.conf at startup (see nginx.conf.template).
ENV NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]

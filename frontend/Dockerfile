# Build stage
FROM node:20-alpine AS build
WORKDIR /app
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
COPY package*.json ./
# npm ci demands the lockfile's optionalDependencies entries (e.g. esbuild's
# per-platform binaries) match byte-for-byte what the installing npm would
# write itself, which breaks across npm major versions — contributors on a
# newer local npm than node:20-alpine's bundled 10.x hit this constantly.
# npm install resolves from package.json instead of demanding that exact
# match, so it isn't affected.
RUN npm install
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

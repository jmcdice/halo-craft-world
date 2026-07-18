# Halo Craft: Installation 04 — self-contained image.
# Stage 1 builds the Vite bundle; stage 2 serves the static dist with nginx.

FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci || npm install
COPY . .
RUN npm run build

FROM nginx:alpine
LABEL org.opencontainers.image.title="Halo Craft: Installation 04" \
      org.opencontainers.image.description="Photoreal Halo campaign on a procedural lakeside world (Three.js)"
COPY --from=build /app/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80

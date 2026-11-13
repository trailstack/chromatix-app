# ======================================================================
# Stage 1: Build
# ======================================================================
FROM node:24-alpine AS build

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

COPY . .
RUN npm run build

# ======================================================================
# Stage 2: Serve
# ======================================================================
FROM caddy:alpine

COPY --from=build /app/build /srv

EXPOSE 8080

CMD ["caddy", "file-server", "--root", "/srv", "--listen", ":8080"]

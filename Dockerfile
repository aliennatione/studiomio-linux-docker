FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx vite build

FROM node:22-alpine
WORKDIR /app
ENV STATIC_DIR=/app/dist
ENV PORT=8080
COPY --from=build /app/dist ./dist
COPY scripts/remote-server.mjs ./scripts/remote-server.mjs
EXPOSE 8080
CMD ["node", "scripts/remote-server.mjs"]

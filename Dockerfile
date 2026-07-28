# Build stage — needs dev deps for TypeScript
FROM node:22-alpine AS builder
RUN apk add --no-cache ffmpeg python3 make g++
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ src/
RUN npm run build
RUN npm ci --omit=dev

# Runtime stage — minimal
FROM node:22-alpine
RUN apk add --no-cache ffmpeg
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./

ENV NODE_OPTIONS="--max-old-space-size=2048"
ENTRYPOINT ["node", "dist/index.js"]
CMD ["--config", "config.yaml"]

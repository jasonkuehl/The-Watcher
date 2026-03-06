# syntax=docker/dockerfile:1
FROM node:lts-alpine

# Install iputils for ICMP ping support.
# NET_RAW capability must be granted at runtime (see docker-compose.yml or run docs).
RUN apk add --no-cache iputils

# Run as non-root user
RUN addgroup -S watcher && adduser -S watcher -G watcher

WORKDIR /app

# Copy dependency manifest first — lets Docker cache the install layer
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Copy application source
COPY server.js ./
COPY public/ ./public/
COPY config/ ./config/

# Switch to non-root user
USER watcher

EXPOSE 3000

ENV NODE_ENV=production \
    PORT=3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/summary || exit 1

CMD ["node", "server.js"]

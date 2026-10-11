# ==============================================================================
# Multi-Stage Production Dockerfile for resilient-backend-core
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: Build & Compilation
# ------------------------------------------------------------------------------
FROM node:20-alpine AS builder

WORKDIR /usr/src/app

# Install dependencies needed for node-gyp if native addons are used
RUN apk add --no-cache python3 make g++

# Copy dependency manifests
COPY package*.json tsconfig.json ./

# Install all dependencies (including devDependencies for TypeScript build)
RUN npm install

# Copy source tree
COPY src/ ./src/

# Compile TypeScript into JavaScript
RUN npm run build

# ------------------------------------------------------------------------------
# Stage 2: Production Image Runtime
# ------------------------------------------------------------------------------
FROM node:20-alpine AS runner

# Add dumb-init for proper signal handling and PID 1 reap
RUN apk add --no-cache dumb-init

WORKDIR /usr/src/app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Copy dependency manifests
COPY package*.json ./

# Install only production dependencies
RUN npm install --omit=dev && npm cache clean --force

# Copy built distribution from builder stage
COPY --from=builder /usr/src/app/dist ./dist

# Security hardening: Run as non-privileged 'node' user
USER node

# Health check probe against liveness endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/health/liveness || exit 1

EXPOSE 3000

# Use dumb-init to handle SIGTERM/SIGINT signals correctly
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "dist/server.js"]

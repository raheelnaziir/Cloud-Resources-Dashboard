# Stage 1: Build
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files first (layer caching)
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production

# Stage 2: Production Image
FROM node:18-alpine

# Add metadata labels
LABEL maintainer="Your Name"
LABEL project="cloud-computing-dashboard"
LABEL version="1.0.0"

# Create non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Copy dependencies from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy application source
COPY server.js .
COPY public/ ./public/
COPY package.json .

# Change ownership to non-root user
RUN chown -R appuser:appgroup /app

USER appuser

# Expose application port
EXPOSE 3000

# Health check (used by Docker & Kubernetes)
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Start the application
CMD ["node", "server.js"]
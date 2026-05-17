# ─── Build stage ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies first (layer cache optimisation)
COPY package*.json ./
RUN npm ci --ignore-scripts

# Copy source and compile TypeScript
COPY tsconfig.json drizzle.config.ts ./
COPY src/ ./src/
RUN npm run build

# ─── Production stage ─────────────────────────────────────────────────────────
FROM node:20-alpine AS production

# Security: run as non-root user
RUN addgroup -g 1001 -S finbridge && \
    adduser  -u 1001 -S finbridge -G finbridge

WORKDIR /app

# Install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && \
    npm cache clean --force

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist

# Create logs directory with proper ownership
RUN mkdir -p logs && chown -R finbridge:finbridge /app

USER finbridge

# Expose application port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3000/health/live || exit 1

# Default environment
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

CMD ["node", "dist/src/server/index.js"]

# AEX Scaffold — Dockerfile for Railway deployment
#
# Zero-dependency Bun app. LMSR-priced agent execution market.
# Build:   docker build -t aex-scaffold .
# Run:     docker run -p 8080:8080 aex-scaffold
# Deploy:  push to Railway, set PORT env (auto-detected)

FROM oven/bun:1.3 AS base
WORKDIR /app

# Copy lockfile and package metadata
COPY package.json tsconfig.json ./

# No runtime deps needed, but install dev deps for type checking
RUN bun install --production

# Copy source code
COPY src/ ./src/

# Expose port (Railway sets PORT env var, default 8080)
EXPOSE 8080

# Start the API server
CMD ["bun", "run", "src/server.ts"]

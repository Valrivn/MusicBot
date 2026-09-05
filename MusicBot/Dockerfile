# Stage 1: Build contracts (build context should be repo root: C:\Bot)
FROM node:20-slim AS contracts-builder
WORKDIR /contracts
COPY voxaria-contracts/package*.json ./
RUN npm ci
COPY voxaria-contracts/ .
RUN npm run build

# Stage 2: Build MusicBot with Python dependencies
FROM node:20-slim AS builder

# Install system dependencies for Python/Demucs/FFmpeg
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv \
    ffmpeg \
    gcc g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install Node.js production dependencies
RUN npm ci --production=false

# Copy contracts build
COPY --from=contracts-builder /contracts/dist ./node_modules/@voxaria/contracts/dist

# Stage 3: Production image
FROM node:20-slim AS production

# Install runtime dependencies only
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip \
    ffmpeg \
    && pip3 install --no-cache-dir demucs torch torchaudio --index-url https://download.pytorch.org/whl/cpu \
    && rm -rf /var/lib/apt/lists/* /root/.cache/pip

WORKDIR /app

# Copy node_modules from builder (production deps only)
COPY --from=builder /app/node_modules ./node_modules

# Copy application code
COPY . .

# Create necessary directories
RUN mkdir -p /app/data /app/audio_cache/stems /app/cache/tracks

# Set environment
ENV NODE_ENV=production
ENV MUSIC_API_PORT=3002

EXPOSE 3002

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3002/health/live', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["npm", "start"]
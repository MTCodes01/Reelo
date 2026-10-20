# Build stage
FROM python:3.11-slim as builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY backend/requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# Final stage
FROM python:3.11-slim

WORKDIR /app

# Install runtime dependencies (ffmpeg and nodejs for JS challenges)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    nodejs \
    && rm -rf /var/lib/apt/lists/*

# Copy installed python packages from builder
COPY --from=builder /install /usr/local

# Copy application code
COPY backend /app/backend
COPY frontend /app/frontend

# Create downloads directory
RUN mkdir -p /app/downloads

# Environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
# Concurrency defaults -- override at runtime via docker-compose environment or -e flag.
# MAX_WORKERS=2 : concurrent yt-dlp/ffmpeg jobs (safe for 16 GB shared host)
# FFMPEG_THREADS=2 : CPU threads per ffmpeg invocation (0 = auto, risky on shared hosts)
ENV MAX_WORKERS=2
ENV FFMPEG_THREADS=2

EXPOSE 7654

WORKDIR /app/backend
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "7654"]

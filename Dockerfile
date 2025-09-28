# syntax=docker/dockerfile:1.5

FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# Install system dependencies
RUN apt-get update -y && apt-get install -y --no-install-recommends \
        curl \
        gcc \
        python3-dev \
        unzip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy and install Python dependencies
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Initialize Reflex (downloads bun and node)
RUN reflex init

# Create data directory for persistence
RUN mkdir -p /data

EXPOSE 8080

# Run Reflex in production mode
# The app will read environment variables at runtime
CMD reflex run --env prod --backend-host 0.0.0.0 --backend-port 8080
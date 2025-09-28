# Stage 1: Build frontend
FROM python:3.11-slim as frontend-builder

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

# Initialize Reflex and export frontend
RUN reflex init
RUN reflex export --frontend-only --no-zip

# Stage 2: Runtime with Caddy reverse proxy
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# Install system dependencies including Caddy
RUN apt-get update -y && apt-get install -y --no-install-recommends \
        curl \
        gcc \
        python3-dev \
        unzip \
        gnupg \
        debian-keyring \
        debian-archive-keyring \
        apt-transport-https \
    && curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg \
    && curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list \
    && apt-get update -y \
    && apt-get install -y caddy \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy Python dependencies and install
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Copy built frontend from stage 1
COPY --from=frontend-builder /app/.web/build/client /var/www/html

# Initialize Reflex for backend
RUN reflex init

# Create data directory for persistence
RUN mkdir -p /data

# Copy Caddyfile
COPY Caddyfile /etc/caddy/Caddyfile

# Create startup script
COPY start.sh /start.sh
RUN chmod +x /start.sh

EXPOSE 8080

# Run both Caddy and Reflex backend
CMD ["/start.sh"]
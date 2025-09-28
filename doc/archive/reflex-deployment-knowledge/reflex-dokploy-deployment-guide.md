# Reflex to Dokploy Deployment Guide

## Key Lessons Learned from FocusFlow Deployment

### 🎯 Critical Understanding: Build-time vs Runtime

**THE PROBLEM:**
Reflex apps can be built in two ways:
1. **Static Export** (build-time): `reflex export` creates static HTML/JS files
2. **Dynamic Runtime**: `reflex run` runs the app dynamically

**THE ISSUE WE HIT:**
- Static exports capture environment variables AT BUILD TIME
- If you build without env vars, features appear as "OFF" permanently
- Docker builds happen without your deployment env vars

**THE SOLUTION:**
- Use `reflex run` in production, NOT `reflex export`
- Let the app read environment variables at RUNTIME
- This ensures your deployment platform's env vars are used

### 📦 Correct Dockerfile Pattern for Reflex + Dokploy

```dockerfile
# GOOD - Runtime approach
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

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Initialize Reflex (downloads bun/node)
RUN reflex init

# Create data directory
RUN mkdir -p /data

EXPOSE 8080

# Run dynamically - reads env vars at runtime!
CMD reflex run --env prod --host 0.0.0.0 --port 8080
```

### ❌ Common Mistakes to Avoid

1. **Don't use static export for apps with environment variables**
   ```dockerfile
   # BAD - This captures env vars at build time
   RUN reflex export --frontend-only --no-zip
   ```

2. **Don't use complex multi-service setups initially**
   - Avoid Caddy reverse proxy for simple deployments
   - Avoid Redis unless you need it
   - Reflex can handle both frontend and backend from one process

3. **Don't hardcode environment variables**
   - Never put real API keys in `.env.example`
   - Always use placeholders in example files

### ✅ Best Practices for Reflex Internal Apps

#### 1. Environment Variable Pattern
```python
# In your Reflex state class
import os

class AppState(rx.State):
    # These are evaluated at runtime when state initializes
    api_enabled: bool = bool(os.getenv("API_KEY"))

    def some_method(self):
        api_key = os.getenv("API_KEY", "")
        if not api_key:
            return "API_KEY not configured"
        # Use the API key...
```

#### 2. File Structure for Deployment
```
your-app/
├── main/
│   ├── __init__.py
│   └── main.py          # Your Reflex app
├── requirements.txt     # Keep minimal
├── rxconfig.py         # Reflex config
├── Dockerfile          # Simple runtime version
├── .dockerignore       # Exclude .env, .venv, etc.
├── .env.example        # Template with placeholders
└── .gitignore         # Never commit .env
```

#### 3. Essential .dockerignore
```
.git
.gitignore
__pycache__
*.pyc
.venv
venv/
.env
.env.*
.web
.states
data/
*.db
```

#### 4. Reflex Config Tips (rxconfig.py)
```python
import reflex as rx

config = rx.Config(
    app_name="your_app",
    # These work well for Dokploy
    api_url="",  # Let Reflex figure it out
    deploy_url="",  # Will be set by deployment platform
)
```

### 🚀 Dokploy-Specific Setup

1. **Create Application**
   - Choose "Docker" deployment type
   - Point to your GitHub repo

2. **Environment Variables**
   - Add all your secrets in Dokploy UI
   - These are injected at container runtime
   - Format: `KEY=value` (one per line)

3. **Port Configuration**
   - Set to 8080 (or whatever you exposed)
   - Dokploy handles the reverse proxy

4. **Persistent Storage**
   - Configure volume mounts for `/data` if needed
   - SQLite databases should go in persistent volumes

### 🐛 Debugging Tips

1. **Check if env vars are loaded:**
   ```python
   # Add debug endpoint in your app
   @app.api.get("/debug/env")
   def check_env():
       return {
           "api_configured": bool(os.getenv("API_KEY")),
           "db_configured": bool(os.getenv("DATABASE_URL"))
       }
   ```

2. **Common Issues:**
   - "API: OFF" in UI → Environment variables not set or not reading at runtime
   - Build fails → Missing system dependencies (gcc, unzip)
   - App hangs → Reflex trying to open browser (use `--env prod`)
   - 404 errors → Wrong port or path configuration

### 📝 Quick Deployment Checklist

- [ ] Remove all hardcoded secrets
- [ ] Create .env.example with placeholders
- [ ] Use simple Dockerfile with `reflex run`
- [ ] Set all env vars in Dokploy
- [ ] Configure persistent volumes if needed
- [ ] Test locally with: `docker run --env-file .env -p 8080:8080 image`

### 🎯 Key Takeaway

**For Reflex + Dokploy: Keep it simple!**
- One container
- Runtime environment variables
- Let Reflex handle both frontend and backend
- Use Dokploy's built-in reverse proxy

This approach works reliably and avoids the complexity of multi-service orchestration, static builds, and environment variable timing issues.
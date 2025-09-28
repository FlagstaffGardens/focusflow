# Reflex Internal App Quick Start Template

## 🚀 Copy-Paste Boilerplate for New Internal Apps

### Step 1: Create Project Structure
```bash
mkdir my-internal-app
cd my-internal-app
mkdir main
touch main/__init__.py main/main.py
touch requirements.txt rxconfig.py Dockerfile .dockerignore .env.example
```

### Step 2: Minimal requirements.txt
```txt
reflex==0.4.9.post1
python-dotenv==1.0.1
requests==2.32.3
# Add your specific dependencies here
```

### Step 3: Basic rxconfig.py
```python
import reflex as rx

config = rx.Config(
    app_name="main",
)
```

### Step 4: Starter main/main.py
```python
import reflex as rx
import os
from typing import Optional

class AppState(rx.State):
    """Main application state."""

    # Check environment variables at runtime
    api_configured: bool = bool(os.getenv("API_KEY"))
    message: str = ""
    loading: bool = False

    def process_data(self):
        """Example async operation."""
        if not self.api_configured:
            self.message = "API_KEY not configured"
            return

        self.loading = True
        yield

        # Your API call here
        api_key = os.getenv("API_KEY", "")
        # ... do something ...

        self.message = "Process completed!"
        self.loading = False
        yield

def index() -> rx.Component:
    """Main page."""
    return rx.center(
        rx.vstack(
            rx.heading("Internal App", size="8"),
            rx.cond(
                AppState.api_configured,
                rx.badge("API: Connected", color="green"),
                rx.badge("API: Not Configured", color="red"),
            ),
            rx.input(
                placeholder="Enter data...",
                on_change=AppState.set_message,
            ),
            rx.button(
                "Process",
                on_click=AppState.process_data,
                loading=AppState.loading,
            ),
            rx.text(AppState.message),
            spacing="4",
            width="100%",
            max_width="600px",
        ),
        width="100%",
        height="100vh",
        padding="4",
    )

app = rx.App()
app.add_page(index)
```

### Step 5: Production Dockerfile
```dockerfile
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

RUN apt-get update -y && apt-get install -y --no-install-recommends \
    curl gcc python3-dev unzip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN reflex init
RUN mkdir -p /data

EXPOSE 8080

CMD reflex run --env prod --host 0.0.0.0 --port 8080
```

### Step 6: .dockerignore
```
.git
__pycache__
*.pyc
.venv
.env
.env.*
.web
.states
*.db
.DS_Store
```

### Step 7: .env.example
```env
# API Configuration
API_KEY=your-api-key-here
API_URL=https://api.example.com

# Database (optional)
DATABASE_URL=sqlite:////data/app.db

# App Configuration
SECRET_KEY=change-me-in-production
DEBUG=false
```

## 🎨 Common Patterns for Internal Apps

### Pattern 1: API Integration
```python
import os
import requests

def call_api(endpoint: str, data: dict):
    """Reusable API caller with env var support."""
    api_key = os.getenv("API_KEY", "")
    api_url = os.getenv("API_URL", "")

    if not api_key or not api_url:
        raise ValueError("API not configured")

    headers = {"Authorization": f"Bearer {api_key}"}
    response = requests.post(f"{api_url}/{endpoint}",
                            json=data,
                            headers=headers)
    response.raise_for_status()
    return response.json()
```

### Pattern 2: File Upload Handler
```python
class AppState(rx.State):
    async def handle_upload(self, files: list[rx.UploadFile]):
        """Process uploaded files."""
        for file in files:
            upload_data = await file.read()
            # Save to /data directory (persistent in Docker)
            path = f"/data/{file.filename}"
            with open(path, "wb") as f:
                f.write(upload_data)
```

### Pattern 3: Background Task with Progress
```python
class AppState(rx.State):
    progress: int = 0
    status: str = "idle"

    def long_running_task(self):
        """Show progress for long operations."""
        self.status = "running"
        self.progress = 0
        yield

        for i in range(100):
            # Do work...
            time.sleep(0.1)
            self.progress = i + 1
            if i % 10 == 0:  # Update UI every 10%
                yield

        self.status = "complete"
        yield
```

## 🚢 Deployment Checklist

1. **Local Test:**
   ```bash
   docker build -t my-app .
   docker run -p 8080:8080 --env-file .env my-app
   ```

2. **Push to GitHub:**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin <your-repo>
   git push -u origin main
   ```

3. **Deploy on Dokploy:**
   - Create new app
   - Connect GitHub repo
   - Add environment variables
   - Set port to 8080
   - Deploy!

## 🔧 Troubleshooting Quick Fixes

| Problem | Solution |
|---------|----------|
| "API: OFF" showing | Check env vars are set in deployment platform |
| Build fails | Add missing system deps to Dockerfile |
| App won't start | Check logs, usually missing `reflex init` |
| Can't connect | Verify port 8080 and host 0.0.0.0 |
| Data not persisting | Mount volume to `/data` directory |

## 🎯 Pro Tips

1. **Keep it simple** - Start with single container
2. **Environment first** - Design around env vars from the start
3. **Use /data** - Always store persistent data in `/data`
4. **Version your deps** - Pin versions in requirements.txt
5. **Test locally** - Always test Docker build before deploying

This template gets you from zero to deployed in under 30 minutes!
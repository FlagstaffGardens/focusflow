# Reflex Patterns & Gotchas Reference

## ⚠️ Critical Gotchas We Learned the Hard Way

### 1. State Variables Can't Use .get() Method
```python
# ❌ WRONG - Will fail at build time
def _render_item(item: dict):
    return rx.text(item.get("name", ""))  # State var has no .get()

# ✅ CORRECT - Use direct indexing
def _render_item(item: dict):
    return rx.cond(
        item["name"],  # Check if exists
        rx.text(item["name"]),  # Use if exists
        rx.text("No name")  # Fallback
    )
```

### 2. Environment Variables Must Load at Runtime
```python
# ❌ WRONG - Evaluated once at import
api_key = os.getenv("API_KEY", "")

class AppState(rx.State):
    has_api = bool(api_key)  # Always False in Docker build

# ✅ CORRECT - Evaluated when State initializes
class AppState(rx.State):
    has_api: bool = bool(os.getenv("API_KEY"))  # Checked at runtime
```

### 3. rx.foreach Requires Specific Pattern
```python
# ❌ WRONG - Direct function
rx.foreach(State.items, lambda x: rx.text(x["name"]))

# ✅ CORRECT - Separate render function
def render_item(item: dict) -> rx.Component:
    return rx.text(item["name"])

rx.foreach(State.items, render_item)
```

## 📋 Common UI Patterns

### Real-time Status Updates
```python
class AppState(rx.State):
    status: str = "idle"
    logs: list[str] = []

    def process_with_updates(self):
        self.status = "starting"
        self.logs.append("Starting process...")
        yield  # Update UI

        # Do work...
        self.logs.append("Processing step 1...")
        yield  # Update UI again

        self.status = "complete"
        yield

# In your UI
rx.vstack(
    rx.badge(AppState.status,
             color_scheme=rx.cond(
                 AppState.status == "complete", "green",
                 rx.cond(AppState.status == "error", "red", "yellow")
             )),
    rx.box(
        rx.foreach(AppState.logs, lambda log: rx.text(log)),
        height="200px",
        overflow="auto"
    )
)
```

### File Upload with Progress
```python
class AppState(rx.State):
    upload_progress: int = 0

    async def handle_upload(self, files: list[rx.UploadFile]):
        for file in files:
            self.upload_progress = 0
            yield

            data = await file.read()
            total = len(data)
            chunk_size = 1024 * 100  # 100KB chunks

            for i in range(0, total, chunk_size):
                # Process chunk
                chunk = data[i:i+chunk_size]
                # ... do something ...

                self.upload_progress = int((i / total) * 100)
                yield

# UI Component
rx.vstack(
    rx.upload(
        rx.button("Upload File"),
        on_drop=AppState.handle_upload,
    ),
    rx.progress(value=AppState.upload_progress),
)
```

### Dynamic Form Fields
```python
class AppState(rx.State):
    form_data: dict = {}

    def update_field(self, field_name: str, value: str):
        self.form_data[field_name] = value

# Create dynamic form
def create_form_field(name: str, placeholder: str):
    return rx.input(
        placeholder=placeholder,
        on_change=lambda v: AppState.update_field(name, v),
    )

# Usage
rx.vstack(
    create_form_field("name", "Enter name"),
    create_form_field("email", "Enter email"),
    rx.button("Submit", on_click=AppState.submit_form),
)
```

## 🔥 Performance Tips

### 1. Batch Yields for Updates
```python
# ❌ Slow - Too many UI updates
for item in items:
    self.process_item(item)
    yield  # Updates UI 100 times for 100 items

# ✅ Fast - Batched updates
for i, item in enumerate(items):
    self.process_item(item)
    if i % 10 == 0:  # Update every 10 items
        yield
```

### 2. Use rx.var for Computed Properties
```python
class AppState(rx.State):
    items: list[dict] = []

    @rx.var
    def total_count(self) -> int:
        """Computed only when items changes."""
        return len(self.items)

    @rx.var
    def filtered_items(self) -> list[dict]:
        """Cached and recomputed only when needed."""
        return [i for i in self.items if i.get("active")]
```

### 3. Conditional Rendering > Hidden Elements
```python
# ❌ Inefficient - Element still in DOM
rx.box(
    rx.text("Hidden content"),
    display=rx.cond(State.show, "block", "none")
)

# ✅ Efficient - Element not rendered
rx.cond(
    State.show,
    rx.text("Visible content"),
    rx.fragment()  # Nothing rendered when false
)
```

## 🎨 Styling Patterns

### Responsive Mobile-First Design
```python
rx.flex(
    # Content here
    width="100%",
    max_width=["100%", "768px", "1024px"],  # Mobile, tablet, desktop
    padding=["2", "4", "6"],  # Responsive padding
    direction=["column", "column", "row"],  # Stack on mobile
)
```

### Dark Mode Support
```python
rx.box(
    rx.text("Adaptive text"),
    bg=rx.color("gray", 2),  # Uses theme color
    color=rx.color("gray", 11),  # Adapts to dark/light
    _dark={
        "bg": rx.color("gray", 10),
        "color": rx.color("gray", 1),
    }
)
```

### Loading States
```python
rx.cond(
    State.loading,
    rx.center(
        rx.spinner(size="3"),
        min_height="200px"
    ),
    rx.box(
        # Your content
    )
)
```

## 🐛 Debugging Helpers

### Add Debug Mode
```python
class AppState(rx.State):
    debug_mode: bool = os.getenv("DEBUG", "false").lower() == "true"

# In UI - show debug info conditionally
rx.cond(
    AppState.debug_mode,
    rx.box(
        rx.text(f"API Status: {AppState.api_configured}"),
        rx.text(f"Item Count: {len(AppState.items)}"),
        position="fixed",
        bottom="0",
        right="0",
        bg="red.100",
        padding="2",
    )
)
```

### Log Helper
```python
def log_to_console(message: str):
    """Log to both Python console and browser console."""
    print(f"[DEBUG] {message}")
    return rx.console_log(message)

# Usage in State
def some_action(self):
    yield log_to_console(f"Action started with {len(self.items)} items")
    # ... do work ...
```

## 🚀 Deployment Readiness Checklist

- [ ] All `os.getenv()` calls have defaults
- [ ] No `.get()` on State variables
- [ ] File operations use `/data` directory
- [ ] Dockerfile includes all system dependencies
- [ ] Error handling for missing env vars
- [ ] Loading states for async operations
- [ ] Mobile-responsive design
- [ ] No hardcoded URLs or ports

## 💡 Final Pro Tips

1. **State Updates**: Always `yield` after changing state in async functions
2. **Type Hints**: Use them! Reflex relies on types for optimization
3. **Component Keys**: Add keys to `rx.foreach` items for better performance
4. **Event Handlers**: Use lambdas for parameterized handlers
5. **File Paths**: Always use absolute paths in Docker (`/app`, `/data`)

Remember: Reflex is React under the hood, so React best practices apply!
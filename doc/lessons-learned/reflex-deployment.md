# Reflex Deployment: Lessons Learned

## Executive Summary
Attempted to deploy a Reflex-based audio transcription app. Encountered significant deployment challenges that ultimately led to migration to Next.js.

## Timeline
- **Initial Development**: Reflex app working locally
- **First Deploy Attempt**: Permission errors, State var issues
- **Second Attempt**: CLI flag incompatibility between versions
- **Third Attempt**: Environment variable build-time evaluation
- **Fourth Attempt**: Caddy reverse proxy integration
- **Final Status**: "Bad Gateway" in production, decision to migrate

## Critical Issues Encountered

### 1. Version Compatibility Nightmare
```bash
# Reflex 0.4.9
reflex run --host 0.0.0.0 --port 8080

# Reflex 0.8.12
reflex run --backend-host 0.0.0.0 --backend-port 8080
```
**Lesson**: Lock framework versions early and test deployment with exact version.

### 2. Environment Variables at Build Time
```python
# This evaluates at Docker build time, not runtime!
api_key = os.getenv("OPENAI_API_KEY", "OFF")
```
**Lesson**: Always use runtime evaluation for secrets:
```python
@property
def api_key(self):
    return os.getenv("OPENAI_API_KEY")
```

### 3. State Management Limitations
```python
# Doesn't work in Reflex
title = job.get("title", "")

# Must use
title = job["title"] if "title" in job else ""
```
**Lesson**: Test framework-specific patterns thoroughly.

### 4. Single Port Requirement = Complexity
- Reflex runs frontend on 3000, backend on 8000
- Cloud platforms expect single PORT
- Solution required Caddy reverse proxy
- Added significant complexity

**Lesson**: Choose frameworks with simple deployment models.

### 5. WebSocket Routing Issues
```caddyfile
handle_path /socket.io/* {
    reverse_proxy localhost:8000
}
```
**Lesson**: WebSockets add deployment complexity. SSE is simpler.

## What Went Wrong

### Testing Discipline
- **Problem**: Committed without local testing
- **Impact**: Multiple broken commits, lost trust
- **Fix**: Always test locally first, especially Docker builds

### Documentation Gaps
- **Problem**: Reflex deployment docs incomplete
- **Impact**: Trial-and-error approach, wasted time
- **Fix**: Choose well-documented frameworks

### Complexity Creep
- **Problem**: Simple app became complex deployment
- **Impact**: Dockerfile grew from 20 to 78 lines
- **Fix**: Start with deployment in mind

## What Worked

### Multi-stage Docker Builds
```dockerfile
FROM python:3.11-slim as frontend-builder
# Build frontend separately
FROM python:3.11-slim
# Copy built assets
```

### Debugging Strategy
- Used debugger agent effectively
- Added environment checks in startup script
- Incremental problem solving

### Documentation
- Created comprehensive guides
- Preserved knowledge for future

## Red Flags to Watch For

1. **"It works locally"** - Test in Docker immediately
2. **Complex deployment docs** - Indicates poor deployment story
3. **Reverse proxy required** - Adds failure points
4. **Build-time configuration** - Kills 12-factor app principles
5. **Version-specific CLI changes** - Indicates unstable framework

## Deployment Checklist for Next Project

- [ ] Single PORT support out of the box
- [ ] Runtime environment variables
- [ ] No reverse proxy needed
- [ ] SSE over WebSockets
- [ ] Docker-first development
- [ ] Test deployment Day 1, not Day 30
- [ ] Choose boring, stable technology

## Migration Decision Matrix

| Factor | Reflex | Next.js |
|--------|--------|---------|
| Deployment | Complex | Simple |
| Documentation | Sparse | Extensive |
| Community | Small | Large |
| Port handling | Multiple | Single |
| Env vars | Build-time | Runtime |
| Stability | Changing | Mature |

## Key Takeaways

1. **Test deployment early and often**
2. **Boring technology > exciting features**
3. **Single process > multi-process**
4. **SSE > WebSockets for simple streaming**
5. **Runtime config > build-time config**
6. **Framework maturity matters**

## Quotes from the Trenches

> "dude stop git commiting you mother fucker test locally first"

> "got bad gateway when deployed mother fucker and it seriously pissed me off"

> "so let me know why was it such a pain in the ass to do this reflex deployment"

## Final Recommendation

For internal tools requiring quick deployment:
- **Use**: Next.js, FastAPI, Express
- **Avoid**: Beta frameworks, complex architectures
- **Prioritize**: Deployment simplicity over development convenience

## Next Steps

1. Complete Next.js migration
2. Document new deployment process
3. Create deployment smoke tests
4. Never touch Reflex again for production apps
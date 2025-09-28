# Reflex Deployment Knowledge Base

## 📚 What's in this folder?

This folder contains valuable lessons learned from deploying Reflex apps to Dokploy and other Docker-based platforms. Save this for future internal tool development!

### Files:

1. **`reflex-dokploy-deployment-guide.md`**
   - Critical understanding of build-time vs runtime environment variables
   - Correct Dockerfile patterns for Reflex + Dokploy
   - Common mistakes and how to avoid them
   - Debugging tips

2. **`reflex-app-template.md`**
   - Complete boilerplate for starting new Reflex apps
   - Copy-paste ready code templates
   - Common patterns (API integration, file uploads, etc.)
   - Quick 30-minute deployment guide

3. **`reflex-patterns-reference.md`**
   - Critical gotchas (like no `.get()` on State variables)
   - UI patterns and performance tips
   - Styling patterns for responsive design
   - Debugging helpers

## 🎯 When to use this?

- Starting a new internal tool with Reflex
- Deploying to Dokploy or similar platforms
- Debugging environment variable issues
- Looking for Reflex best practices
- Need quick copy-paste templates

## 💡 Key Lessons Summary

1. **Always use runtime environment variables** (not build-time)
2. **State variables can't use `.get()` method**
3. **Use simple `reflex run` in production** (not static export)
4. **Store persistent data in `/data`**
5. **Test Docker builds locally first**

These guides will save you hours of debugging!
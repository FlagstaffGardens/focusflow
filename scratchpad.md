# Dokploy Debug Scratchpad

Use this file to capture exact commands and outputs while we debug the deployment.

## Steps

1. Open a shell inside the running container:
   ```bash
   docker exec -it focusflow-3wzejs-focusflow-1 /bin/sh
   ```
   You should see the prompt change to something like `/app $`.

2. From that container shell, run the Node health probe (single line to avoid heredoc issues):
   ```bash
   node -e "(async () => { try { const res = await fetch('http://127.0.0.1:3000/api/health', { cache: 'no-store' }); console.log('status:', res.status); console.log('body:', await res.text()); process.exit(res.ok ? 0 : 1); } catch (err) { console.error('error:', err); process.exit(1); } })();"
   ```
   Copy the `status:` and `body:` (or `error:`) output.

3. Still inside the container shell (after the Node command finishes), show process command line:
   ```bash
   cat /proc/1/cmdline
   ```
   Copy that output too.

4. Exit the container shell with `exit` when done.

Paste the outputs from steps 2 and 3 back into our chat so we can see exactly what the app is returning.

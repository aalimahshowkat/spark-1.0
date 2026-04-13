# SPARK (Vite) + SPARK AI (Vercel)

This repo is a Vite + React SPA with an `/api/*` backend for SPARK AI.

## Deploy to Vercel

### 1) Add environment variables (Vercel Project → Settings → Environment Variables)

- **Required for full AI**
  - `ANTHROPIC_API_KEY`: your Anthropic key (server-side only)

- **Optional: require login**
  - `SPARK_AUTH_MODE=password`
  - `SPARK_LOGIN_PASSWORD`: password users will enter
  - `SPARK_SESSION_SECRET`: random secret for signing session cookies

If `ANTHROPIC_API_KEY` is not set, SPARK AI runs in **Demo / Offline mode** (no external API calls) but the UI still works.

### 2) Build settings

Vercel should auto-detect Vite.

- **Build Command**: `npm run build`
- **Output Directory**: `dist`

## Local development

```bash
npm install
npm run dev
```

Local dev uses `server.js` (Express) for `/api/*` and Vite for the frontend.


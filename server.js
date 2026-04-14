/**
 * server.js — SPARK AI Proxy Server
 *
 * Why this exists:
 *   The Anthropic API key must never be in the browser — anyone who opens
 *   DevTools could read it, steal it, and run up your bill. The standard
 *   solution used by every production application (ChatGPT, Claude.ai,
 *   every AI product you've ever used) is a server-side proxy:
 *
 *     Browser → YOUR server (no key exposed) → Anthropic API (key added here)
 *
 *   The key lives in a .env file on the server. The browser calls /api/chat
 *   on localhost. This server adds the key and forwards to Anthropic.
 *   The browser never sees the key at all.
 *
 * Usage:
 *   1. Create a .env file:  ANTHROPIC_API_KEY=sk-ant-api03-...
 *   2. npm run dev          (starts both Vite + this server via concurrently)
 */

import express from 'express'
import cors from 'cors'
import { createRequire } from 'module'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { execFileSync } from 'child_process'

const require = createRequire(import.meta.url)

const app  = express()
const PORT = 3001

const SESSION_COOKIE = 'spark_session'
const sessions = new Map() // sid -> { user, createdAt }

function parseDotenv(src) {
  const out = {}
  const lines = String(src || '').split(/\r?\n/)
  for (const raw of lines) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if (!key) continue

    const quoted =
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    if (quoted) val = val.slice(1, -1)

    // Minimal unescape for common sequences
    val = val.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\'/g, "'")
    out[key] = val
  }
  return out
}

function readDotenvFile() {
  try {
    const p = path.join(process.cwd(), '.env')
    const src = fs.readFileSync(p, 'utf8')
    return parseDotenv(src)
  } catch {
    return {}
  }
}

function isPlaceholderKey(key) {
  if (!key) return true
  const k = String(key).trim()
  if (!k) return true
  return (
    k === 'sk-ant-api03-your-key-here' ||
    k.includes('your-key-here') ||
    k.includes('sk-ant-api03-...') ||
    k.includes('sk-ant-...')
  )
}

function getEnvVar(name) {
  // Prefer the file value so "Retry" works without restart.
  const fileVars = readDotenvFile()
  if (Object.prototype.hasOwnProperty.call(fileVars, name)) return fileVars[name]
  return process.env[name]
}

function isAuthEnabled() {
  const mode = String(getEnvVar('SPARK_AUTH_MODE') || '').trim().toLowerCase()
  if (mode === 'none' || mode === 'off' || mode === 'false') return false
  if (mode === 'password') return true
  // Auto-enable if a password is set (so users can "just login")
  return !!String(getEnvVar('SPARK_LOGIN_PASSWORD') || '').trim()
}

function getLoginPassword() {
  return String(getEnvVar('SPARK_LOGIN_PASSWORD') || '').trim()
}

function getLoginUsername() {
  return String(getEnvVar('SPARK_LOGIN_USERNAME') || '').trim()
}

function parseCookies(header) {
  const out = {}
  if (!header) return out
  const parts = String(header).split(';')
  for (const p of parts) {
    const idx = p.indexOf('=')
    if (idx === -1) continue
    const k = p.slice(0, idx).trim()
    const v = p.slice(idx + 1).trim()
    if (!k) continue
    out[k] = decodeURIComponent(v)
  }
  return out
}

function newSessionId() {
  return crypto.randomBytes(24).toString('base64url')
}

function attachAuth(req, res, next) {
  if (!isAuthEnabled()) {
    req.auth = { enabled: false, user: { name: 'local' } }
    return next()
  }
  const cookies = parseCookies(req.headers.cookie)
  const sid = cookies[SESSION_COOKIE]
  const session = sid ? sessions.get(sid) : null
  req.auth = { enabled: true, user: session?.user || null, sid: session ? sid : null }
  next()
}

function requireAuth(req, res, next) {
  if (!isAuthEnabled()) return next()
  if (req.auth?.user) return next()
  return res.status(401).json({ error: 'not_authenticated' })
}

function getAnthropicApiKey() {
  // 1) .env / process env
  const envKey = getEnvVar('ANTHROPIC_API_KEY')
  if (!isPlaceholderKey(envKey)) return String(envKey).trim()

  // 2) macOS Keychain (for “no key steps” end users)
  //    Provision once on the host machine; users just log in.
  const service = String(getEnvVar('SPARK_KEYCHAIN_SERVICE') || 'SPARK_ANTHROPIC_API_KEY').trim()
  const account = String(getEnvVar('SPARK_KEYCHAIN_ACCOUNT') || 'default').trim()
  if (process.platform === 'darwin') {
    try {
      const val = execFileSync(
        'security',
        ['find-generic-password', '-s', service, '-a', account, '-w'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
      )
      const key = String(val || '').trim()
      if (!isPlaceholderKey(key)) return key
    } catch {
      // ignore: key not found / security not available
    }
  }

  return ''
}

function isInsecureTlsEnabled() {
  return String(getEnvVar('SPARK_INSECURE_TLS') || '').trim() === '1'
}

// Allow the Vite dev server (port 5173) to call this proxy
app.use(cors({ origin: ['http://localhost:5173', 'http://127.0.0.1:5173'] }))
app.use(express.json({ limit: '2mb' }))
app.use(attachAuth)

// ── Auth ───────────────────────────────────────────────────────────────────
app.get('/api/auth/status', (req, res) => {
  res.json({
    ok: true,
    authRequired: isAuthEnabled(),
    authenticated: !!req.auth?.user,
    user: req.auth?.user || null,
  })
})

app.post('/api/auth/login', (req, res) => {
  if (!isAuthEnabled()) return res.json({ ok: true, authenticated: true, user: { name: 'local' } })

  const { username, password } = req.body || {}
  const expectedUser = getLoginUsername()
  const expected = getLoginPassword()
  if (!expected) return res.status(500).json({ error: 'auth_misconfigured' })

  if (expectedUser && String(username || '').trim() !== expectedUser) {
    return res.status(401).json({ error: 'invalid_credentials' })
  }
  if (String(password || '') !== expected) {
    return res.status(401).json({ error: 'invalid_credentials' })
  }

  const sid = newSessionId()
  const user = { name: String(username || 'user').slice(0, 80) }
  sessions.set(sid, { user, createdAt: Date.now() })

  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(sid)}; Path=/; HttpOnly; SameSite=Lax`)
  res.json({ ok: true, authenticated: true, user })
})

app.post('/api/auth/logout', (req, res) => {
  const cookies = parseCookies(req.headers.cookie)
  const sid = cookies[SESSION_COOKIE]
  if (sid) sessions.delete(sid)
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`)
  res.json({ ok: true })
})

// ── Health check ──────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  const hasKey = !!getAnthropicApiKey()
  const authRequired = isAuthEnabled()
  const authenticated = !!req.auth?.user
  res.json({
    ok: true,
    authRequired,
    authenticated,
    // If auth is enabled, don’t leak server config to unauthenticated callers.
    keyConfigured: authRequired ? (authenticated ? hasKey : null) : hasKey,
    mode: hasKey ? 'anthropic' : 'demo',
    message: hasKey
      ? 'SPARK proxy ready'
      : 'No Anthropic key configured. SPARK AI will run in demo mode (no external API calls).',
    insecureTls: isInsecureTlsEnabled(),
  })
})

function sseWrite(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`)
}

function sseText(res, text) {
  // Emit in the exact event shape the client expects.
  const chunks = String(text || '').match(/[\s\S]{1,700}/g) || ['']
  for (const c of chunks) {
    sseWrite(res, { type: 'content_block_delta', delta: { type: 'text_delta', text: c } })
  }
}

function buildDemoAnswer({ system, messages }) {
  const lastUser = [...(messages || [])].reverse().find(m => m?.role === 'user')?.content || ''
  const sys = String(system || '')

  // Very lightweight “offline assistant”: extract the breach section if present.
  const breachIdx = sys.indexOf('=== CAPACITY BREACH MONTHS ===')
  let breachBlock = ''
  if (breachIdx !== -1) {
    breachBlock = sys.slice(breachIdx, breachIdx + 1600).split('\n').slice(0, 18).join('\n')
  }

  const annualIdx = sys.indexOf('=== ANNUAL CAPACITY SUMMARY BY ROLE ===')
  let annualBlock = ''
  if (annualIdx !== -1) {
    annualBlock = sys.slice(annualIdx, annualIdx + 1200).split('\n').slice(0, 12).join('\n')
  }

  const lines = []
  lines.push('SPARK AI is running in **Demo / Offline mode** (no Anthropic key configured on the server).')
  lines.push('You can still ask questions, but responses are heuristic and based only on the plan context text sent from the browser.')
  lines.push('')
  lines.push(`You asked: "${String(lastUser).trim()}"`)
  lines.push('')

  if (breachBlock) {
    lines.push('Here are the current breach months visible in your plan context:')
    lines.push('')
    lines.push(breachBlock)
    lines.push('')
  } else if (annualBlock) {
    lines.push('Here is the annual summary visible in your plan context:')
    lines.push('')
    lines.push(annualBlock)
    lines.push('')
  } else {
    lines.push('I did not find the expected plan summary sections in the system context, so I can’t extract quantified results.')
    lines.push('Try loading a plan and re-asking, or switch to Anthropic mode by configuring the server key.')
  }

  lines.push('')
  lines.push('To enable full AI: configure the server-side Anthropic key (env/.env or macOS Keychain). End users should not handle keys.')
  return lines.join('\n')
}

// ── AI proxy endpoint ─────────────────────────────────────────────────────
app.post('/api/chat', requireAuth, async (req, res) => {
  const apiKey = getAnthropicApiKey()

  const { messages, system, model, max_tokens } = req.body

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array is required' })
  }

  // Set up SSE streaming headers
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no') // prevent nginx from buffering

  // If no key is configured, still allow chat in a deterministic demo mode.
  if (!apiKey) {
    const demo = buildDemoAnswer({ system, messages })
    sseText(res, demo)
    return res.end()
  }

  try {
    // If you're behind a corporate proxy / TLS inspection, Node may fail with:
    // "self signed certificate in certificate chain" or similar.
    // Set SPARK_INSECURE_TLS=1 to allow TLS without verification (dev only).
    if (isInsecureTlsEnabled()) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: model || 'claude-sonnet-4-20250514',
        max_tokens: max_tokens || 1024,
        system: system || '',
        messages,
        stream: true,
      }),
    })

    if (!upstream.ok) {
      const errBody = await upstream.json().catch(() => ({}))
      const msg = errBody?.error?.message || `Anthropic API error ${upstream.status}`
      res.write(`data: ${JSON.stringify({ type: 'error', error: msg, status: upstream.status })}\n\n`)
      return res.end()
    }

    // Pipe the SSE stream straight through to the browser
    const reader  = upstream.body.getReader()
    const decoder = new TextDecoder()

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = decoder.decode(value, { stream: true })
      res.write(chunk)
    }

    res.end()

  } catch (err) {
    const msg = err?.message || 'Proxy error'
    const cause = err?.cause
    const code = cause?.code || err?.code
    const causeMsg = cause?.message

    let hint = null
    const combined = `${code || ''} ${msg || ''} ${causeMsg || ''}`.toLowerCase()
    if (combined.includes('self signed certificate') || combined.includes('unable to verify the first certificate') || combined.includes('cert')) {
      hint = 'TLS certificate verification failed. If you are behind corporate TLS inspection, set SPARK_INSECURE_TLS=1 for local dev, or configure NODE_EXTRA_CA_CERTS to trust your corporate root CA.'
    } else if (combined.includes('enotfound') || combined.includes('eai_again')) {
      hint = 'DNS lookup failed. Check your network / VPN / DNS settings.'
    } else if (combined.includes('timeout')) {
      hint = 'Network timeout reaching Anthropic. Check connectivity and proxy/VPN.'
    }

    try {
      res.write(`data: ${JSON.stringify({ type: 'error', error: msg, code: code || null, hint })}\n\n`)
      res.end()
    } catch {}
  }
})

app.listen(PORT, () => {
  const hasKey = !!getAnthropicApiKey()
  console.log(`\n🚀 SPARK proxy running at http://localhost:${PORT}`)
  console.log(`   Key configured: ${hasKey ? '✓ yes' : '✗ NO — add ANTHROPIC_API_KEY to .env'}`)
  if (isInsecureTlsEnabled()) console.log(`   TLS verify: ✗ disabled (SPARK_INSECURE_TLS=1)`)
  if (isAuthEnabled()) console.log(`   Auth: ✓ enabled (password)`)
  if (!hasKey) {
    console.log(`   Mode: demo (offline)`)
    console.log(`   To enable full AI, set ANTHROPIC_API_KEY (env/.env) or provision macOS Keychain:`)
    console.log(`     security add-generic-password -s SPARK_ANTHROPIC_API_KEY -a default -w "sk-ant-..." -U`)
  }
})

import crypto from 'crypto'

export const SESSION_COOKIE = 'spark_session'

export function isPlaceholderKey(key) {
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

export function getAnthropicApiKey() {
  const key = process.env.ANTHROPIC_API_KEY
  if (!isPlaceholderKey(key)) return String(key).trim()
  return ''
}

export function isAuthEnabled() {
  const mode = String(process.env.SPARK_AUTH_MODE || '').trim().toLowerCase()
  if (mode === 'none' || mode === 'off' || mode === 'false') return false
  if (mode === 'password') return true
  return !!String(process.env.SPARK_LOGIN_PASSWORD || '').trim()
}

export function getLoginPassword() {
  return String(process.env.SPARK_LOGIN_PASSWORD || '').trim()
}

export function getLoginUsername() {
  return String(process.env.SPARK_LOGIN_USERNAME || '').trim()
}

export function getSessionSecret() {
  // Required for stateless sessions on serverless.
  return String(process.env.SPARK_SESSION_SECRET || process.env.SPARK_LOGIN_PASSWORD || '').trim()
}

export function parseCookies(header) {
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

export function base64urlEncode(buf) {
  return Buffer.from(buf).toString('base64url')
}

export function base64urlDecode(str) {
  return Buffer.from(String(str), 'base64url')
}

export function signSession(payloadObj, secret) {
  const payload = base64urlEncode(JSON.stringify(payloadObj))
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

export function verifySession(token, secret) {
  if (!token || !secret) return null
  const [payload, sig] = String(token).split('.')
  if (!payload || !sig) return null
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url')
  // timing safe compare
  const a = Buffer.from(expected)
  const b = Buffer.from(sig)
  if (a.length !== b.length) return null
  if (!crypto.timingSafeEqual(a, b)) return null
  try {
    const obj = JSON.parse(base64urlDecode(payload).toString('utf8'))
    if (obj?.exp && Date.now() > obj.exp) return null
    return obj
  } catch {
    return null
  }
}

export function makeSetCookie({ name, value, maxAgeSeconds = 60 * 60 * 24 * 7, httpOnly = true }) {
  const isProd = process.env.NODE_ENV === 'production' || !!process.env.VERCEL
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'SameSite=Lax',
  ]
  if (httpOnly) parts.push('HttpOnly')
  if (isProd) parts.push('Secure')
  if (maxAgeSeconds !== null) parts.push(`Max-Age=${maxAgeSeconds}`)
  return parts.join('; ')
}

export async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body
  const chunks = []
  for await (const c of req) chunks.push(c)
  const raw = Buffer.concat(chunks).toString('utf8') || '{}'
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

export function sseHeaders(res) {
  res.statusCode = 200
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
}

export function sseWrite(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`)
}

export function sseText(res, text) {
  const chunks = String(text || '').match(/[\s\S]{1,700}/g) || ['']
  for (const c of chunks) {
    sseWrite(res, { type: 'content_block_delta', delta: { type: 'text_delta', text: c } })
  }
}

export function buildDemoAnswer({ system, messages }) {
  const lastUser = [...(messages || [])].reverse().find(m => m?.role === 'user')?.content || ''
  const sys = String(system || '')

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
  lines.push('Ask questions as normal; responses are heuristic and based only on the plan context text.')
  lines.push('')
  lines.push(`You asked: "${String(lastUser).trim()}"`)
  lines.push('')

  if (breachBlock) {
    lines.push('Here are the breach months visible in your plan context:')
    lines.push('')
    lines.push(breachBlock)
  } else if (annualBlock) {
    lines.push('Here is the annual summary visible in your plan context:')
    lines.push('')
    lines.push(annualBlock)
  } else {
    lines.push('I did not find the expected plan summary sections in the system context, so I can’t extract quantified results.')
    lines.push('Load a plan and retry, or enable full AI by configuring the server-side key.')
  }

  return lines.join('\n')
}


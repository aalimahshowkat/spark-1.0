import { isAuthEnabled, getLoginUsername, getLoginPassword, getSessionSecret, signSession, makeSetCookie, readJson, SESSION_COOKIE } from '../_utils.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405
    return res.end('Method Not Allowed')
  }

  if (!isAuthEnabled()) {
    res.setHeader('Content-Type', 'application/json')
    res.statusCode = 200
    return res.end(JSON.stringify({ ok: true, authenticated: true, user: { name: 'local' } }))
  }

  const expectedUser = getLoginUsername()
  const expected = getLoginPassword()
  const secret = getSessionSecret()
  if (!expected || !secret) {
    res.setHeader('Content-Type', 'application/json')
    res.statusCode = 500
    return res.end(JSON.stringify({ error: 'auth_misconfigured' }))
  }

  const body = await readJson(req)
  const usernameRaw = String(body?.username || '')
  const username = String(usernameRaw).trim().slice(0, 80)
  const password = String(body?.password || '')

  if (expectedUser && username !== expectedUser) {
    res.setHeader('Content-Type', 'application/json')
    res.statusCode = 401
    return res.end(JSON.stringify({ error: 'invalid_credentials' }))
  }
  if (password !== expected) {
    res.setHeader('Content-Type', 'application/json')
    res.statusCode = 401
    return res.end(JSON.stringify({ error: 'invalid_credentials' }))
  }

  const now = Date.now()
  const session = { user: { name: username }, iat: now, exp: now + 1000 * 60 * 60 * 24 * 7 }
  const token = signSession(session, secret)

  res.setHeader('Set-Cookie', makeSetCookie({ name: SESSION_COOKIE, value: token, maxAgeSeconds: 60 * 60 * 24 * 7 }))
  res.setHeader('Content-Type', 'application/json')
  res.statusCode = 200
  res.end(JSON.stringify({ ok: true, authenticated: true, user: session.user }))
}


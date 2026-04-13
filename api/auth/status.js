import { isAuthEnabled, parseCookies, SESSION_COOKIE, verifySession, getSessionSecret } from '../_utils.js'

export default function handler(req, res) {
  const authRequired = isAuthEnabled()
  const secret = getSessionSecret()
  const cookies = parseCookies(req.headers.cookie)
  const token = cookies[SESSION_COOKIE]
  const session = authRequired ? verifySession(token, secret) : { user: { name: 'local' } }

  res.setHeader('Content-Type', 'application/json')
  res.statusCode = 200
  res.end(JSON.stringify({
    ok: true,
    authRequired,
    authenticated: !!session?.user,
    user: session?.user || null,
  }))
}


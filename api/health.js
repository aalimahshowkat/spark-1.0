import { getAnthropicApiKey, isAuthEnabled, parseCookies, SESSION_COOKIE, verifySession, getSessionSecret } from './_utils.js'

export default function handler(req, res) {
  const authRequired = isAuthEnabled()
  const secret = getSessionSecret()
  const cookies = parseCookies(req.headers.cookie)
  const token = cookies[SESSION_COOKIE]
  const session = authRequired ? verifySession(token, secret) : { user: { name: 'local' } }
  const authenticated = !!session?.user

  const hasKey = !!getAnthropicApiKey()

  res.setHeader('Content-Type', 'application/json')
  res.statusCode = 200
  res.end(JSON.stringify({
    ok: true,
    authRequired,
    authenticated,
    keyConfigured: authRequired ? (authenticated ? hasKey : null) : hasKey,
    mode: hasKey ? 'anthropic' : 'demo',
    message: hasKey
      ? 'SPARK API ready'
      : 'No Anthropic key configured. SPARK AI will run in demo mode (no external API calls).',
  }))
}


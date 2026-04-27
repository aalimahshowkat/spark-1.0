import { getOpenRouterApiKey, isAuthEnabled, parseCookies, SESSION_COOKIE, verifySession, getSessionSecret } from './_utils.js'

export default function handler(req, res) {
  const authRequired = isAuthEnabled()
  const secret = getSessionSecret()
  const cookies = parseCookies(req.headers.cookie)
  const token = cookies[SESSION_COOKIE]
  const session = authRequired ? verifySession(token, secret) : { user: { name: 'local' } }
  const authenticated = !!session?.user

  const hasKey = !!getOpenRouterApiKey()
  const hasKeyVisible = authRequired ? (authenticated ? hasKey : null) : hasKey
  const model = String(process.env.SPARK_OPENROUTER_MODEL || '').trim() || 'openrouter/auto'

  res.setHeader('Content-Type', 'application/json')
  res.statusCode = 200
  res.end(JSON.stringify({
    ok: true,
    authRequired,
    authenticated,
    keyConfigured: hasKeyVisible,
    mode: hasKey ? 'openrouter' : 'demo',
    provider: 'openrouter',
    model,
    message: hasKey
      ? 'SPARK API ready (OpenRouter)'
      : 'No OpenRouter key configured. Set OPENROUTER_API_KEY. SPARK AI will run in demo mode (no external API calls).',
  }))
}


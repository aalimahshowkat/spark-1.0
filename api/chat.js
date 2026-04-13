import {
  buildDemoAnswer,
  getAnthropicApiKey,
  getSessionSecret,
  isAuthEnabled,
  parseCookies,
  readJson,
  sseHeaders,
  sseText,
  sseWrite,
  SESSION_COOKIE,
  verifySession,
} from './_utils.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405
    return res.end('Method Not Allowed')
  }

  // Auth (stateless signed cookie)
  if (isAuthEnabled()) {
    const secret = getSessionSecret()
    const cookies = parseCookies(req.headers.cookie)
    const token = cookies[SESSION_COOKIE]
    const session = verifySession(token, secret)
    if (!session?.user) {
      res.setHeader('Content-Type', 'application/json')
      res.statusCode = 401
      return res.end(JSON.stringify({ error: 'not_authenticated' }))
    }
  }

  const body = await readJson(req)
  const { messages, system, model, max_tokens } = body || {}
  if (!messages || !Array.isArray(messages)) {
    res.setHeader('Content-Type', 'application/json')
    res.statusCode = 400
    return res.end(JSON.stringify({ error: 'messages array is required' }))
  }

  sseHeaders(res)

  const apiKey = getAnthropicApiKey()
  if (!apiKey) {
    sseText(res, buildDemoAnswer({ system, messages }))
    return res.end()
  }

  try {
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
      sseWrite(res, { type: 'error', error: msg, status: upstream.status })
      return res.end()
    }

    const reader = upstream.body.getReader()
    const decoder = new TextDecoder()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      res.write(decoder.decode(value, { stream: true }))
    }
    res.end()
  } catch (err) {
    const msg = err?.message || 'Proxy error'
    sseWrite(res, { type: 'error', error: msg })
    res.end()
  }
}


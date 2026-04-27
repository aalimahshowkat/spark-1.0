import {
  buildDemoAnswer,
  buildRagSystemPrompt,
  getOpenRouterApiKey,
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
  try { res.flushHeaders?.() } catch { /* ignore */ }

  const openRouterKey = getOpenRouterApiKey()
  if (!openRouterKey) {
    sseText(res, buildDemoAnswer({ system: buildRagSystemPrompt(system || ''), messages }))
    return res.end()
  }

  try {
    const hasImage = Array.isArray(messages) && messages.some(m => !!m?.image)
    const orModel =
      String(model || '').trim() ||
      String(process.env[hasImage ? 'SPARK_OPENROUTER_VISION_MODEL' : 'SPARK_OPENROUTER_MODEL'] || '').trim() ||
      (hasImage ? 'openai/gpt-4o-mini' : 'openrouter/auto')

    const ragSystem = buildRagSystemPrompt(system || '')

    // Convert into OpenAI-compatible chat format.
    const orMessages = []
    if (ragSystem) orMessages.push({ role: 'system', content: String(ragSystem) })
    for (const m of (messages || [])) {
      const role = m?.role === 'assistant' ? 'assistant' : 'user'
      const text = String(m?.content || '')
      if (m?.image) {
        orMessages.push({
          role,
          content: [
            ...(text ? [{ type: 'text', text }] : []),
            { type: 'image_url', image_url: { url: String(m.image) } },
          ],
        })
      } else {
        orMessages.push({ role, content: text })
      }
    }

    const upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openRouterKey}`,
        // Optional but recommended by OpenRouter for attribution.
        'HTTP-Referer': process.env.OPENROUTER_SITE_URL || 'http://localhost',
        'X-Title': process.env.OPENROUTER_APP_NAME || 'SPARK',
      },
      body: JSON.stringify({
        model: orModel,
        messages: orMessages,
        stream: true,
        max_tokens: Number(max_tokens) || 1024,
        temperature: 0.3,
      }),
    })

    if (!upstream.ok) {
      const errBody = await upstream.json().catch(() => ({}))
      const msg = errBody?.error?.message || errBody?.message || `OpenRouter API error ${upstream.status}`
      sseWrite(res, { type: 'error', error: msg, status: upstream.status })
      return res.end()
    }

    // OpenRouter streams OpenAI-style SSE. Translate → Anthropic-shaped SSE the UI expects.
    const reader = upstream.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop()
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const payload = trimmed.slice(5).trim()
        if (!payload || payload === '[DONE]') continue
        let obj
        try { obj = JSON.parse(payload) } catch { continue }
        const text = obj?.choices?.[0]?.delta?.content
        if (text) sseWrite(res, { type: 'content_block_delta', delta: { type: 'text_delta', text } })
      }
    }
    return res.end()
  } catch (err) {
    const msg = err?.message || 'Proxy error'
    sseWrite(res, { type: 'error', error: msg })
    res.end()
  }
}


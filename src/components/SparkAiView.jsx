/**
 * SparkAiView.jsx — SPARK AI
 *
 * HOW THIS WORKS (no API key required from users)
 * ────────────────────────────────────────────────
 * Browser → /api/chat (same origin, no CORS) → Express server (server.js)
 *                                            → Anthropic API (key added here)
 *
 * The Anthropic API key lives in .env on the server. The browser never
 * sees it. This is how every production AI product works — the key is
 * always server-side. Users never need to know it exists.
 *
 * The browser calls /api/chat (a relative URL). Vite proxies it to
 * localhost:3001 during development. In production, your web server
 * (nginx, etc.) routes /api/* to the Node process.
 *
 * WHAT GETS SENT TO CLAUDE AS CONTEXT
 * ─────────────────────────────────────
 * Every message includes a system prompt containing:
 *   - Annual + monthly demand for all 4 roles (with breach flags)
 *   - Every project: name, VIBE, dates, PM, CSM, LMs, status
 *   - Which months have concurrent breaches across roles
 *   - Peak demand month per role with actual vs effective cap
 *   - Top 5 most-loaded people per role
 *   - All saved scenarios
 *   - VIBE type mix
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MONTHS, PRIMARY_ROLES } from '../engine/schema.js'
import { loadScenarios } from '../engine/scenarioEngine.js'
import { useEngineInsightsData } from './useEngineInsightsData.js'

const MODEL = 'claude-sonnet-4-20250514'
const PROXY_URL = '/api/chat'

// ── Context builders ───────────────────────────────────────────────────────

function buildCapacityContext(calc, insightsData, planName) {
  if (!calc) return 'No plan is currently loaded in SPARK.'

  const lines = [`ACTIVE PLAN: ${planName || 'Current plan'}`, '']
  const cap = calc?.capacity || {}
  const effMonthly = (role, i) => cap?.[role]?.effectiveMonthlyByMonth?.[i] ?? 0
  const effAnnual = (role) => cap?.[role]?.effectiveAnnual ?? 0
  const fteCount = (role) => cap?.[role]?.fte ?? 0

  // 1. Annual summary per role
  lines.push('=== ANNUAL CAPACITY SUMMARY BY ROLE ===')
  // Analyst 2 is incremental demand; capacity pool is Analyst 1.
  for (const role of ['CSM', 'PM', 'Analyst 1']) {
    const annual   = Math.round(calc.annualDemand?.[role] || 0)
    const over     = calc.monthsOverEffective?.[role] || 0
    const fte      = fteCount(role)
    const effAnn   = Math.round(effAnnual(role))
    const util     = effAnn > 0 ? ((annual / effAnn) * 100).toFixed(1) : '0'
    const status   = over > 6 ? 'CRITICAL' : over > 3 ? 'ELEVATED' : over > 0 ? 'WATCH' : 'HEALTHY'
    lines.push(`  ${role.padEnd(12)} ${annual.toLocaleString().padStart(7)} hrs/yr | ${util.padStart(5)}% utilisation | ${over}/12 months over cap | ${fte} FTE | ${status}`)
  }

  // 2. Monthly demand table
  lines.push('')
  lines.push('=== MONTHLY DEMAND IN HOURS (⚡ = over effective cap) ===')
  lines.push('  ' + [''.padEnd(12), ...MONTHS.map(m => m.padStart(7))].join(''))
  for (const role of ['CSM', 'PM', 'Analyst 1']) {
    const monthly    = calc.demandByRole?.[role] || new Array(12).fill(0)
    const row = role.padEnd(12) + monthly.map((v, i) => {
      const flag = v > effMonthly(role, i) ? '⚡' : ' '
      return (flag + Math.round(v)).padStart(7)
    }).join('')
    lines.push('  ' + row)
  }
  lines.push(`  Eff. cap/month (varies by month in calendar mode)`)

  // 3. Concurrent breach months
  const breachByMonth = MONTHS.map((m, i) => {
    const roles = PRIMARY_ROLES.filter(role => {
      const d   = calc.demandByRole?.[role]?.[i] || 0
      const eff = effMonthly(role, i)
      return d > eff && eff > 0
    })
    return { month: m, roles }
  }).filter(x => x.roles.length > 0)

  if (breachByMonth.length) {
    lines.push('')
    lines.push('=== CAPACITY BREACH MONTHS ===')
    for (const { month, roles } of breachByMonth) {
      const details = roles.map(role => {
        const i   = MONTHS.indexOf(month)
        const d   = Math.round(calc.demandByRole?.[role]?.[i] || 0)
        const eff = Math.round(effMonthly(role, i))
        return `${role}: ${d} vs ${eff} cap (+${d - eff})`
      }).join(' | ')
      lines.push(`  ${month}: ${details}`)
    }
  }

  // 4. Peak month per role
  lines.push('')
  lines.push('=== PEAK DEMAND MONTH PER ROLE ===')
  for (const role of ['CSM', 'PM', 'Analyst 1']) {
    const pk = calc.peakMonths?.[role]
    if (pk) {
      const eff = Math.round(effMonthly(role, pk.monthIndex))
      lines.push(`  ${role}: ${pk.month} — ${Math.round(pk.hours).toLocaleString()} hrs vs ${eff || 0} effective cap`)
    }
  }

  // 5. Every project
  const projects = insightsData?.projects || []
  if (projects.length) {
    lines.push('')
    lines.push(`=== ALL PROJECTS IN PLAN (${projects.length}) ===`)
    for (const p of projects) {
      const s   = MONTHS[p.start] || '?'
      const e   = MONTHS[p.end]   || '?'
      const pm  = p.pm  ? ` PM:${p.pm}`   : ''
      const csm = p.csm ? ` CSM:${p.csm}` : ''
      lines.push(`  "${p.name}" | ${p.type} | ${s}→${e} | ${p.status} | LMs:${p.lms}${pm}${csm}`)
    }
  }

  // 6. VIBE mix
  const vc = insightsData?.vibeProjectCounts
  if (vc) {
    const total = Object.values(vc).reduce((a, b) => a + b, 0)
    lines.push('')
    lines.push('=== VIBE TYPE MIX ===')
    for (const [v, c] of Object.entries(vc)) {
      if (c > 0) lines.push(`  ${v}: ${c} projects (${total ? Math.round(c/total*100) : 0}%)`)
    }
  }

  // 7. Team utilisation
  const people = insightsData?.people
  if (people) {
    lines.push('')
    lines.push('=== TEAM UTILISATION (top 5 per role) ===')
    for (const role of ['CSM', 'PM', 'Analyst']) {
      const list = (people[role] || []).slice(0, 5)
      if (!list.length) continue
      const fteName = role === 'Analyst' ? 'Analyst 1' : role
      const eff = effAnnual(fteName)
      lines.push(`  ${role}:`)
      for (const p of list) {
        const pct = eff > 0 ? Math.round(p.total / eff * 100) : 0
        lines.push(`    ${p.name}: ${p.total.toLocaleString()} hrs/yr (${pct}% annual utilisation)`)
      }
    }
  }

  // 8. Saved scenarios
  try {
    const scenarios = loadScenarios()
    if (scenarios.length) {
      lines.push('')
      lines.push('=== SAVED SCENARIOS ===')
      for (const s of scenarios) {
        const po = Object.keys(s.projectOverrides  || {}).length
        const ro = Object.keys(s.resourceOverrides || {}).length
        const ao = Object.keys(s.assumptionOverrides || {}).length
        const changes = [
          po ? `${po} project overrides` : null,
          ro ? `${ro} FTE changes` : null,
          ao ? `${ao} assumption changes` : null,
        ].filter(Boolean).join(', ')
        lines.push(`  "${s.name}" — ${changes || 'no overrides'} | ${s.description || ''}`)
      }
    }
  } catch {}

  // 9. Meta
  lines.push('')
  lines.push(`=== PLAN META ===`)
  lines.push(`  Projects calculated: ${calc.meta?.projectsCalculated || 0}`)
  lines.push(`  Total assignments: ${calc.meta?.totalAssignments || 0}`)

  return lines.join('\n')
}

function buildSystemPrompt(calc, insightsData, planName) {
  return `You are SPARK AI — an expert capacity planning assistant for the CS&T (Customer Success & Technology) delivery team at AiDash.

You have full access to the current plan data. Use it to give specific, quantified answers. Never invent numbers.

PLANNING RULES:
- Effective capacity = FTE count × 160 hrs/month × 0.80 (attrition factor)
- Analyst 2 is INCREMENTAL demand — it adds pressure but NOT capacity (capacity = Analyst 1 only)
- VIBE types: Bond (ongoing), Validate (assessment), Integrate (technical), Explore (discovery)
- Orbit A/B/C/D = customer complexity (A = most complex, highest demand)
- LMs (Landmarks) drive demand scaling via a multiplier table
- Planning year: 2026

CURRENT PLAN DATA:
${buildCapacityContext(calc, insightsData, planName)}

HOW TO ANSWER:
- Cite specific numbers. "CSM has 1,340 hrs demanded in Sep vs 1,120 effective cap (+220 hrs, 20% over)"
- For what-if questions, reason through step by step using the project list above
- For people questions, use the team utilisation data
- For scenario questions, reference saved scenarios by name
- Use bullet points for lists. Use **bold** for key numbers.
- If data doesn't answer the question, say so and explain what you can see`
}

function getDefaultQuestions(calc, insightsData) {
  if (!calc) return [
    'What is SPARK AI and what can you help with?',
    'How does the capacity model work?',
    'What data do I need to upload to get started?',
  ]

  const qs = []

  const worst = PRIMARY_ROLES.reduce((w, r) =>
    (calc.monthsOverEffective?.[r] || 0) > (calc.monthsOverEffective?.[w] || 0) ? r : w,
    PRIMARY_ROLES[0]
  )
  const worstN = calc.monthsOverEffective?.[worst] || 0
  if (worstN > 0) qs.push(`${worst} is over capacity in ${worstN} months — what's driving it and what are my options?`)

  const peaks = PRIMARY_ROLES.map(r => calc.peakMonths?.[r]).filter(Boolean).sort((a, b) => b.hours - a.hours)
  if (peaks[0]) qs.push(`Which projects are causing the ${peaks[0].month} demand spike?`)

  if ((insightsData?.projects || []).length > 0) qs.push('Which projects are the highest capacity risk this year?')

  qs.push('What would adding one more CSM do to our position?')
  qs.push('Summarise capacity health for a leadership update')

  return qs.slice(0, 5)
}

// ── Main component ─────────────────────────────────────────────────────────

export default function SparkAiView({ engineCalc, engineInput, planName }) {
  const { data: insightsData } = useEngineInsightsData(engineInput, !!engineInput)

  const [messages,   setMessages]   = useState([])
  const [input,      setInput]      = useState('')
  const [streaming,  setStreaming]  = useState(false)
  const [error,      setError]      = useState(null)
  const [proxyOk, setProxyOk] = useState(null) // null=checking, true=reachable, false=not reachable
  const [keyConfigured, setKeyConfigured] = useState(null) // null=unknown, boolean when proxyOk=true
  const [proxyMessage, setProxyMessage] = useState('')
  const [mode, setMode] = useState(null) // 'anthropic' | 'demo' | null
  const [authRequired, setAuthRequired] = useState(false)
  const [authenticated, setAuthenticated] = useState(true)
  const [loginUser, setLoginUser] = useState('')
  const [loginPass, setLoginPass] = useState('')
  const [loginBusy, setLoginBusy] = useState(false)
  const [loginError, setLoginError] = useState(null)

  const messagesEndRef = useRef(null)
  const textareaRef    = useRef(null)

  const suggested    = useMemo(() => getDefaultQuestions(engineCalc, insightsData), [engineCalc, insightsData])
  const systemPrompt = useMemo(() => buildSystemPrompt(engineCalc, insightsData, planName), [engineCalc, insightsData, planName])

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  // Check proxy is running on mount
  useEffect(() => {
    fetch('/api/auth/status')
      .then(r => r.json())
      .then(d => {
        setAuthRequired(!!d.authRequired)
        setAuthenticated(!!d.authenticated)
      })
      .catch(() => {
        // If auth endpoint doesn't exist, assume not required.
        setAuthRequired(false)
        setAuthenticated(true)
      })

    fetch('/api/health')
      .then(r => r.json())
      .then(d => {
        setProxyOk(!!d.ok)
        setKeyConfigured(d.keyConfigured === null ? null : !!d.keyConfigured)
        setProxyMessage(d.message || '')
        setMode(d.mode || null)
        if (typeof d.authRequired === 'boolean') setAuthRequired(d.authRequired)
        if (typeof d.authenticated === 'boolean') setAuthenticated(d.authenticated)
      })
      .catch(() => {
        setProxyOk(false)
        setKeyConfigured(null)
        setProxyMessage('')
        setMode(null)
      })
  }, [])

  const refreshStatus = useCallback(() => {
    setProxyOk(null)
    setKeyConfigured(null)
    setProxyMessage('')
    setMode(null)
    fetch('/api/auth/status')
      .then(r => r.json())
      .then(d => {
        setAuthRequired(!!d.authRequired)
        setAuthenticated(!!d.authenticated)
      })
      .catch(() => {
        setAuthRequired(false)
        setAuthenticated(true)
      })
    fetch('/api/health')
      .then(r => r.json())
      .then(d => {
        setProxyOk(!!d.ok)
        setKeyConfigured(d.keyConfigured === null ? null : !!d.keyConfigured)
        setProxyMessage(d.message || '')
        setMode(d.mode || null)
        if (typeof d.authRequired === 'boolean') setAuthRequired(d.authRequired)
        if (typeof d.authenticated === 'boolean') setAuthenticated(d.authenticated)
      })
      .catch(() => {
        setProxyOk(false)
        setKeyConfigured(null)
        setProxyMessage('')
        setMode(null)
      })
  }, [])

  const doLogin = useCallback(async () => {
    setLoginBusy(true)
    setLoginError(null)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: loginUser, password: loginPass }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.error || `Login failed (${res.status})`)
      }
      setAuthenticated(true)
      setLoginPass('')
      refreshStatus()
    } catch (e) {
      setLoginError(e?.message || 'Login failed')
    } finally {
      setLoginBusy(false)
    }
  }, [loginUser, loginPass, refreshStatus])

  const sendMessage = useCallback(async (text) => {
    const userText = (text || input).trim()
    if (!userText || streaming) return

    if (proxyOk !== true) {
      setError('SPARK AI proxy is not reachable. Run `npm run dev` and retry.')
      return
    }
    if (authRequired && !authenticated) {
      setError('Please sign in to use SPARK AI.')
      return
    }

    setInput('')
    setError(null)
    if (textareaRef.current) textareaRef.current.style.height = 'auto'

    const userMsg = { role: 'user', content: userText }
    const history = [...messages, userMsg]
    setMessages([...history, { role: 'assistant', content: '', streaming: true }])
    setStreaming(true)

    try {
      const res = await fetch(PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // No API key here — the server adds it. The browser just sends the messages.
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 1024,
          system: systemPrompt,
          messages: history.map(m => ({ role: m.role, content: m.content })),
        }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.error || `Server error ${res.status}`)
      }

      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let accumulated = ''
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() // keep incomplete last line

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6).trim()
          if (data === '[DONE]') continue
          try {
            const parsed = JSON.parse(data)
            // Handle error events from the proxy
            if (parsed.type === 'error') throw new Error(parsed.error)
            if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
              accumulated += parsed.delta.text
              setMessages(prev => {
                const next = [...prev]
                next[next.length - 1] = { role: 'assistant', content: accumulated, streaming: true }
                return next
              })
            }
          } catch (parseErr) {
            if (parseErr.message !== 'SyntaxError') throw parseErr
          }
        }
      }

      setMessages(prev => {
        const next = [...prev]
        next[next.length - 1] = { role: 'assistant', content: accumulated || '(empty response)', streaming: false }
        return next
      })

    } catch (e) {
      setMessages(prev => prev.filter(m => !(m.role === 'assistant' && m.streaming)))
      setError(e?.message || 'Request failed')
    } finally {
      setStreaming(false)
      setTimeout(() => textareaRef.current?.focus(), 50)
    }
  }, [input, messages, streaming, systemPrompt])

  const hasData   = !!engineCalc
  const projCount = engineCalc?.meta?.projectsCalculated || 0

  // ── Proxy not running ────────────────────────────────────────────────────
  if (proxyOk === false) {
    return (
      <div style={{ maxWidth: 540, margin: '40px auto', padding: '0 8px' }}>
        <div style={{ background: 'var(--amber-light)', border: '1px solid #fde68a', borderRadius: 10, padding: '20px 22px', marginBottom: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: '#92400e', marginBottom: 8 }}>⚠ SPARK AI proxy is not running</div>
          <div style={{ fontSize: 13, color: '#92400e', lineHeight: 1.7 }}>
            The AI proxy server isn't responding. Start it with:
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, background: '#fef3c7', borderRadius: 6, padding: '10px 14px', marginTop: 10, color: '#78350f' }}>
            npm run dev
          </div>
        </div>
        <div style={{ fontSize: 13, color: 'var(--ink-muted)', lineHeight: 1.7 }}>
          <strong>If you see this after running npm run dev</strong>, check that your <code>.env</code> file exists with <code>ANTHROPIC_API_KEY=sk-ant-...</code>
        </div>
        <button onClick={refreshStatus} style={{ marginTop: 16, padding: '8px 16px', background: 'var(--accent)', color: 'white', border: 'none', borderRadius: 7, cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-sans)' }}>
          Retry connection
        </button>
      </div>
    )
  }

  // ── Checking proxy ───────────────────────────────────────────────────────
  if (proxyOk === null) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '40px 0', color: 'var(--ink-muted)', fontSize: 13 }}>
        <div style={{ width: 14, height: 14, border: '2px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
        Connecting to SPARK AI…
      </div>
    )
  }

  // ── Login gate (if enabled server-side) ──────────────────────────────────
  if (authRequired && !authenticated) {
    return (
      <div style={{ maxWidth: 520, margin: '46px auto', padding: '0 8px' }}>
        <div style={{ background: 'var(--surface-0)', border: '1px solid var(--border)', borderRadius: 12, padding: '18px 18px', boxShadow: 'var(--shadow-md)' }}>
          <div style={{ fontWeight: 900, fontSize: 16, color: 'var(--ink)', marginBottom: 6 }}>Sign in to SPARK</div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-muted)', lineHeight: 1.6, marginBottom: 14 }}>
            This deployment requires login before using SPARK AI.
          </div>

          <div style={{ display: 'grid', gap: 10 }}>
            <input
              value={loginUser}
              onChange={e => setLoginUser(e.target.value)}
              placeholder="Name (optional)"
              style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface-0)', fontSize: 13 }}
            />
            <input
              value={loginPass}
              onChange={e => setLoginPass(e.target.value)}
              placeholder="Password"
              type="password"
              onKeyDown={e => { if (e.key === 'Enter') doLogin() }}
              style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface-0)', fontSize: 13 }}
            />
            {loginError && (
              <div style={{ background: 'var(--red-light)', border: '1px solid #fecaca', color: '#991b1b', borderRadius: 10, padding: '10px 12px', fontSize: 12.5 }}>
                <strong>Login error:</strong> {loginError}
              </div>
            )}
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={doLogin}
                disabled={loginBusy || !loginPass}
                style={{
                  padding: '9px 14px',
                  borderRadius: 10,
                  border: 'none',
                  background: (loginBusy || !loginPass) ? 'var(--border)' : 'var(--accent)',
                  color: 'white',
                  cursor: (loginBusy || !loginPass) ? 'not-allowed' : 'pointer',
                  fontWeight: 800,
                  fontSize: 13,
                  flex: 1,
                }}
              >
                {loginBusy ? 'Signing in…' : 'Sign in'}
              </button>
              <button
                onClick={refreshStatus}
                style={{
                  padding: '9px 14px',
                  borderRadius: 10,
                  border: '1px solid var(--border)',
                  background: 'transparent',
                  color: 'var(--ink-muted)',
                  cursor: 'pointer',
                  fontWeight: 700,
                  fontSize: 13,
                }}
              >
                Retry
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── Main chat UI ──────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 56px - 56px)', minHeight: 500 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, paddingBottom: 14, borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 3 }}>
            <AiIcon />
            <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--ink)', letterSpacing: '-0.02em' }}>SPARK AI</span>
            <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 4, background: hasData ? 'var(--green-light)' : 'var(--amber-light)', color: hasData ? 'var(--green)' : 'var(--amber)' }}>
              {hasData ? `${projCount} projects loaded` : 'No plan loaded'}
            </span>
            {mode === 'demo' && (
              <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 4, background: 'var(--amber-light)', color: 'var(--amber)' }}>
                Demo mode
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
            {hasData ? `Full plan context active — ${planName || 'current plan'}` : 'Load a plan for data-grounded answers'}
          </div>
        </div>
        {messages.length > 0 && (
          <button onClick={() => { setMessages([]); setError(null) }} style={{ padding: '5px 11px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, color: 'var(--ink-muted)', cursor: 'pointer', fontFamily: 'var(--font-sans)' }}>
            Clear chat
          </button>
        )}
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', marginBottom: 12 }}>

        {messages.length === 0 && (
          <div style={{ paddingTop: 16 }}>
            <div style={{ textAlign: 'center', marginBottom: 22 }}>
              <div style={{ fontSize: 30, marginBottom: 10 }}>⚡</div>
              <div style={{ fontWeight: 700, fontSize: 17, color: 'var(--ink)', marginBottom: 6, letterSpacing: '-0.02em' }}>
                Ask anything about your plan
              </div>
              <div style={{ fontSize: 13, color: 'var(--ink-muted)', maxWidth: 440, margin: '0 auto', lineHeight: 1.65 }}>
                {hasData
                  ? `Full plan loaded — ${projCount} projects, all demand data, team utilisation, and saved scenarios.`
                  : 'Load a plan to get answers grounded in your actual capacity numbers.'}
              </div>
            </div>
            {suggested.map((q, i) => (
              <button key={i} onClick={() => sendMessage(q)} disabled={streaming}
                style={{ display: 'flex', alignItems: 'flex-start', gap: 10, width: '100%', maxWidth: 580, margin: '0 auto 8px', textAlign: 'left', padding: '11px 14px', background: 'var(--surface-0)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, color: 'var(--ink)', cursor: 'pointer', fontFamily: 'var(--font-sans)' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.background = 'var(--accent-light)' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)';  e.currentTarget.style.background = 'var(--surface-0)' }}
              >
                <span style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 1 }}>→</span>
                {q}
              </button>
            ))}
          </div>
        )}

        {messages.map((msg, i) => <MessageBubble key={i} msg={msg} />)}

        {error && (
          <div style={{ background: 'var(--red-light)', border: '1px solid #fecaca', borderRadius: 8, padding: '12px 14px', fontSize: 13, color: '#991b1b', marginTop: 8, maxWidth: 600, lineHeight: 1.6 }}>
            <strong>Error:</strong> {error}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div style={{ flexShrink: 0, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', background: 'var(--surface-0)', border: `1px solid ${streaming ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 10, padding: '10px 12px', transition: 'border-color 0.15s' }}>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
            placeholder={hasData ? 'Ask about capacity, risks, projects, scenarios…' : 'Load a plan to ask data-grounded questions…'}
            rows={1}
            style={{ flex: 1, border: 'none', outline: 'none', resize: 'none', fontSize: 13.5, fontFamily: 'var(--font-sans)', color: 'var(--ink)', background: 'transparent', lineHeight: 1.5, maxHeight: 120, overflowY: 'auto' }}
            onInput={e => { e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px' }}
          />
          <button onClick={() => sendMessage()} disabled={!input.trim() || streaming}
            style={{ width: 34, height: 34, borderRadius: 7, border: 'none', background: (!input.trim() || streaming) ? 'var(--border)' : 'var(--accent)', color: 'white', cursor: (!input.trim() || streaming) ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'background 0.12s' }}
          >
            {streaming ? <Spinner /> : <SendIcon />}
          </button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 5, textAlign: 'center' }}>
          Enter to send · Shift+Enter for new line · Powered by Claude
        </div>
      </div>
    </div>
  )
}

// ── Message bubble ─────────────────────────────────────────────────────────

function MessageBubble({ msg }) {
  const isUser = msg.role === 'user'
  return (
    <div style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start', marginBottom: 14, gap: 8 }}>
      {!isUser && <AiIcon small />}
      <div style={{ maxWidth: isUser ? '72%' : '82%', padding: '10px 14px', borderRadius: isUser ? '12px 12px 4px 12px' : '4px 12px 12px 12px', background: isUser ? 'var(--accent)' : 'var(--surface-0)', color: isUser ? 'white' : 'var(--ink)', border: isUser ? 'none' : '1px solid var(--border)', fontSize: 13.5, lineHeight: 1.65, boxShadow: isUser ? 'none' : 'var(--shadow-sm)' }}>
        {msg.content ? <FormattedText text={msg.content} isUser={isUser} /> : <span style={{ opacity: 0.4 }}>…</span>}
        {msg.streaming && <span style={{ display: 'inline-block', width: 8, height: 14, background: 'var(--accent)', borderRadius: 2, marginLeft: 4, animation: 'blink 0.8s infinite', verticalAlign: 'text-bottom' }} />}
      </div>
    </div>
  )
}

function FormattedText({ text, isUser }) {
  if (!text) return null
  return (
    <>
      {text.split('\n').map((line, i) => {
        const t = line.trim()
        if (!t) return <br key={i} />
        if (t.startsWith('- ') || t.startsWith('• ')) {
          return (
            <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 3 }}>
              <span style={{ color: isUser ? 'rgba(255,255,255,0.7)' : 'var(--accent)', flexShrink: 0 }}>•</span>
              <span>{renderBold(t.slice(2), isUser)}</span>
            </div>
          )
        }
        if (/^\d+\.\s/.test(t)) {
          const num = t.match(/^(\d+)\./)[1]
          return (
            <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 3 }}>
              <span style={{ color: isUser ? 'rgba(255,255,255,0.7)' : 'var(--accent)', flexShrink: 0, fontWeight: 600, minWidth: 16 }}>{num}.</span>
              <span>{renderBold(t.replace(/^\d+\.\s/, ''), isUser)}</span>
            </div>
          )
        }
        return <div key={i} style={{ marginBottom: 4 }}>{renderBold(line, isUser)}</div>
      })}
    </>
  )
}

function renderBold(text, isUser) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={i} style={{ fontWeight: 700 }}>{part.slice(2, -2)}</strong>
      : part
  )
}

function AiIcon({ small }) {
  const size = small ? 26 : 28
  return (
    <div style={{ width: size, height: size, borderRadius: small ? 7 : 8, flexShrink: 0, marginTop: small ? 2 : 0, background: 'linear-gradient(135deg, var(--accent), var(--accent-hover))', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg width={small ? 12 : 14} height={small ? 12 : 14} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
      </svg>
    </div>
  )
}
function Spinner() {
  return <div style={{ width: 13, height: 13, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: 'white', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
}
function SendIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" /></svg>
}

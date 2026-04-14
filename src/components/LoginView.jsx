import React, { useMemo, useState } from 'react'

export default function LoginView({
  busy = false,
  error = null,
  onLogin,
}) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  const canSubmit = useMemo(() => {
    return String(username || '').trim().length > 0 && String(password || '').length > 0 && !busy
  }, [username, password, busy])

  const submit = async () => {
    if (!canSubmit) return
    await onLogin?.({ username: String(username).trim(), password: String(password) })
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '36px 16px',
      background: 'radial-gradient(1200px 600px at 30% 20%, rgba(124,58,237,0.22) 0%, rgba(37,99,235,0.12) 40%, rgba(244,245,250,1) 75%)',
    }}>
      <div style={{ width: 'min(92vw, 520px)' }}>
        <div style={{ textAlign: 'center', marginBottom: 18 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 42,
              height: 42,
              borderRadius: 12,
              background: 'linear-gradient(135deg, #7c3aed 0%, #2563eb 100%)',
              color: 'white',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 22,
              boxShadow: '0 12px 30px rgba(37,99,235,0.25)',
            }}>
              ⚡
            </div>
            <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: '-0.03em', color: 'var(--ink)' }}>
              SPARK
            </div>
          </div>
          <div style={{ marginTop: 10, fontFamily: 'var(--font-serif)', fontSize: 18, color: 'var(--ink)', letterSpacing: '-0.02em' }}>
            Plan Capacity. Simulate Scenarios. Decide Proactively.
          </div>
          <div style={{ marginTop: 6, fontSize: 12.5, color: 'var(--ink-muted)', lineHeight: 1.6 }}>
            Sign in to continue to your capacity plan and insights.
          </div>
        </div>

        <div style={{
          background: 'rgba(255,255,255,0.85)',
          backdropFilter: 'blur(10px)',
          border: '1px solid var(--border)',
          borderRadius: 14,
          boxShadow: '0 18px 60px rgba(15,23,42,0.12)',
          overflow: 'hidden',
        }}>
          <div style={{
            padding: '14px 18px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <div style={{ fontWeight: 800, fontSize: 13.5, color: 'var(--ink)' }}>
              Sign in
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--ink-muted)' }}>
              Shared access
            </div>
          </div>

          <div style={{ padding: 18 }}>
            <div style={{ display: 'grid', gap: 10 }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--ink-muted)', fontWeight: 900, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>
                  Username
                </div>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter username"
                  autoComplete="username"
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: '1px solid var(--border)',
                    background: 'var(--surface-0)',
                    fontSize: 13,
                    outline: 'none',
                  }}
                  onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
                />
              </div>

              <div>
                <div style={{ fontSize: 11, color: 'var(--ink-muted)', fontWeight: 900, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>
                  Password
                </div>
                <input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password"
                  autoComplete="current-password"
                  type="password"
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: '1px solid var(--border)',
                    background: 'var(--surface-0)',
                    fontSize: 13,
                    outline: 'none',
                  }}
                  onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
                />
              </div>

              {error && (
                <div style={{
                  background: 'var(--red-light)',
                  border: '1px solid #fecaca',
                  color: '#991b1b',
                  borderRadius: 10,
                  padding: '10px 12px',
                  fontSize: 12.5,
                  lineHeight: 1.5,
                }}>
                  <strong>Login error:</strong> {error}
                </div>
              )}

              <button
                onClick={submit}
                disabled={!canSubmit}
                style={{
                  padding: '10px 14px',
                  borderRadius: 10,
                  border: 'none',
                  background: canSubmit ? 'linear-gradient(135deg, #7c3aed 0%, #2563eb 100%)' : 'var(--border)',
                  color: 'white',
                  cursor: canSubmit ? 'pointer' : 'not-allowed',
                  fontWeight: 900,
                  fontSize: 13,
                  letterSpacing: '-0.01em',
                  boxShadow: canSubmit ? '0 10px 24px rgba(37,99,235,0.22)' : 'none',
                }}
              >
                {busy ? 'Signing in…' : 'Sign in'}
              </button>
            </div>

            <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div style={{ fontSize: 11.5, color: 'var(--ink-faint)' }}>
                  © 2026 AiDash Inc. All rights reserved.
                </div>

                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <div style={{ fontSize: 11.5, color: 'var(--ink-faint)', letterSpacing: '0.02em' }}>
                    Powered by
                  </div>
                  <div style={{
                    fontSize: 18,
                    fontWeight: 900,
                    letterSpacing: '-0.04em',
                    color: '#1E293B',
                    fontStyle: 'italic',
                    lineHeight: 1,
                  }}>
                    AiDash
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}


import React, { useState } from 'react'
import SparkAiView from './SparkAiView'

export default function SparkAssistantWidget({ engineCalc, engineInput, planName }) {
  const [open, setOpen] = useState(false)

  return (
    <div style={{
      position: 'fixed', right: 18, bottom: 18, zIndex: 999,
      width: open ? 490 : 'auto',
      maxWidth: 'calc(100vw - 36px)',
    }}>
      {open && (
        <div style={{
          background: 'var(--surface-0)',
          border: '1px solid var(--border)',
          borderRadius: 14,
          boxShadow: 'var(--shadow-lg)',
          overflow: 'hidden',
          marginBottom: 10,
          height: 580,
          display: 'flex',
          flexDirection: 'column',
        }}>
          <div style={{
            padding: '10px 14px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            borderBottom: '1px solid var(--border)',
            background: 'linear-gradient(135deg, var(--accent-light), var(--surface-0))',
            flexShrink: 0,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                width: 22, height: 22, borderRadius: 6,
                background: 'linear-gradient(135deg, var(--accent), var(--accent-hover))',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
                </svg>
              </div>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink)' }}>SPARK AI</span>
              {engineCalc && (
                <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 5px', borderRadius: 3, background: 'var(--green-light)', color: 'var(--green)' }}>
                  Live data
                </span>
              )}
            </div>
            <button
              onClick={() => setOpen(false)}
              style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink-muted)', fontSize: 18, lineHeight: 1, padding: 4 }}
              aria-label="Close"
            >×</button>
          </div>

          <div style={{ flex: 1, overflow: 'hidden', padding: '12px 14px', display: 'flex', flexDirection: 'column' }}>
            <SparkAiView engineCalc={engineCalc} engineInput={engineInput} planName={planName} />
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 52, height: 52,
          borderRadius: 999,
          border: '1px solid rgba(255,255,255,0.18)',
          background: 'var(--sidebar-bg)',
          boxShadow: 'var(--shadow-lg)',
          cursor: 'pointer', color: '#ffffff',
        }}
        title={open ? 'Close SPARK AI' : 'Ask SPARK AI'}
        aria-label={open ? 'Close SPARK AI' : 'Ask SPARK AI'}
      >
        {open
          ? <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          : <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
        }
      </button>
    </div>
  )
}

import React from 'react'
import { Card, CardBody, Pill } from './ui'

export default function SparkAiCenterPreview() {
  const chipStyle = {
    padding: '8px 14px',
    borderRadius: 999,
    border: '1px solid var(--border)',
    background: 'var(--surface-1)',
    color: 'var(--ink-muted)',
    fontSize: 12.5,
    fontWeight: 650,
    cursor: 'default',
    boxShadow: 'var(--shadow-sm)',
    whiteSpace: 'nowrap',
  }

  return (
    <div style={{ padding: '10px 8px 6px' }}>
      <div style={{ textAlign: 'center', marginBottom: 14 }}>
        <div style={{ fontSize: 26, fontWeight: 900, letterSpacing: '-0.03em', color: 'var(--ink)' }}>
          SPARK AI
        </div>
        <div style={{ fontSize: 13, color: 'var(--ink-muted)', marginTop: 6, lineHeight: 1.6 }}>
          Ask questions in plain English. Get instant answers backed by your real capacity data.
        </div>
      </div>

      <Card style={{ maxWidth: 860, margin: '0 auto', boxShadow: 'var(--shadow-md)' }}>
        <CardBody style={{ padding: 14 }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 12px',
            borderRadius: 12,
            border: '1px solid var(--border)',
            background: 'var(--surface-0)',
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--ink-faint)' }}>
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.3-4.3" />
            </svg>

            <div style={{ flex: 1, color: 'var(--ink-faint)', fontSize: 13 }}>
              Ask anything… “Where are we over capacity in Q3?”
            </div>

            <button
              type="button"
              style={{
                padding: '9px 14px',
                borderRadius: 10,
                border: '1px solid rgba(167,139,250,0.55)',
                background: 'var(--accent)',
                color: '#fff',
                fontWeight: 800,
                fontSize: 12.5,
                cursor: 'not-allowed',
                opacity: 0.9,
              }}
              title="Coming soon"
              aria-disabled="true"
            >
              Ask
            </button>
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
            <div style={chipStyle}>What happens if Project X is delayed 2 months?</div>
            <div style={chipStyle}>Which roles are over capacity in Sep?</div>
            <div style={chipStyle}>Summarise risk for Q3</div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
            <Pill type="purple">Preview</Pill>
          </div>
        </CardBody>
      </Card>
    </div>
  )
}


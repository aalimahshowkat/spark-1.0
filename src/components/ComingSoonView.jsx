import React from 'react'
import { SectionHeader, Card, CardHeader, CardBody, Pill } from './ui'

export default function ComingSoonView({ title, subtitle, bullets = [], center = null }) {
  return (
    <div style={{ width: '100%', maxWidth: 'none' }}>
      <SectionHeader title={title} subtitle={subtitle} />

      <Card>
        <CardHeader title="Coming Soon" tag="Planned capability">
          <Pill type="amber">Soon</Pill>
        </CardHeader>
        <CardBody>
          <div style={{ fontSize: 12.5, color: 'var(--ink-muted)', lineHeight: 1.7 }}>
            This feature is visible to reflect SPARK’s product architecture and roadmap, but it isn’t enabled in Spark 1.0.
          </div>

          {center && (
            <div style={{ marginTop: 18, display: 'flex', justifyContent: 'center' }}>
              <div style={{ width: '100%', maxWidth: 920 }}>
                {center}
              </div>
            </div>
          )}

          {bullets.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-muted)', marginBottom: 8 }}>
                What it will do
              </div>
              <ul style={{ marginLeft: 18, color: 'var(--ink-muted)', fontSize: 12.5, lineHeight: 1.7 }}>
                {bullets.map((b) => <li key={b}>{b}</li>)}
              </ul>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  )
}


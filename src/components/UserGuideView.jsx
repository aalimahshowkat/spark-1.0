import React from 'react'
import { SectionHeader, Card, CardHeader, CardBody, Pill } from './ui'

export default function UserGuideView({ onNavigate }) {
  return (
    <div style={{ width: '100%', maxWidth: 'none', animation: 'fadeUp 0.22s ease both' }}>
      <SectionHeader
        title="Master Your Plan"
        subtitle="Master your plan · Guided tour, workflows, and best practices"
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 14, alignItems: 'start' }}>
        <Card>
          <CardHeader title="Quick start" tag="5 steps" />
          <CardBody>
            <ol style={{ margin: 0, paddingLeft: 18, color: 'var(--ink-muted)', lineHeight: 1.75, fontSize: 13 }}>
              <li>
                Go to <strong>Plan</strong> and upload your Excel workbook (Project List + Demand Base Matrix).
              </li>
              <li>
                Use <strong>Manage roster</strong> to confirm team members and FTE are correct.
              </li>
              <li>
                Open <strong>Advanced planning</strong> to set working model + allocations + coverage/backfills.
              </li>
              <li>
                Review <strong>Overview</strong> and <strong>Capacity</strong> to find peak months and shortfalls.
              </li>
              <li>
                Use <strong>Scenarios</strong> to test “what‑ifs” (PTO/weekend work, backfills, multipliers) before committing changes to the saved plan.
              </li>
            </ol>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Key concepts" tag="cheat sheet" />
          <CardBody>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12.5, color: 'var(--ink-muted)', lineHeight: 1.6 }}>
              <div><strong>Capacity</strong> is calendar-aware (business days vary by month).</div>
              <div><strong>Allocations</strong> split a person across roles + “other responsibilities” (PMO, specialist work).</div>
              <div><strong>PTO/non-project</strong> reduces capacity and can create <strong>Unassigned</strong> work until backfilled.</div>
              <div><strong>Weekend work</strong> increases capacity only (does not move demand).</div>
              <div><strong>Backfills</strong> reassign project hours between people for a date range (baseline or scenario-only).</div>
            </div>
          </CardBody>
        </Card>
      </div>

      <div style={{ marginTop: 14, display: 'grid', gap: 14 }}>
        <Card>
          <CardHeader title="Where do I do X?" tag="navigation map" />
          <CardBody>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {[
                ['Upload / refresh plan', 'Plan → Upload (or drop file)'],
                ['Save as plan (persist)', 'Plan → Save as plan'],
                ['Edit projects', 'Plan → Edit projects'],
                ['Manage roster', 'Plan → Manage roster'],
                ['Working days & calendars', 'Plan → Advanced planning → Working days & calendars'],
                ['Working hours by role', 'Plan → Advanced planning → Working hours (by role)'],
                ['People allocations', 'Plan → Advanced planning → People allocations'],
                ['Coverage & backfills', 'Plan → Advanced planning → Coverage & backfills'],
                ['Scenario PTO / weekend work', 'Scenarios → Assumptions/Overrides → Availability & coverage'],
                ['Scenario backfills', 'Scenarios → Assumptions/Overrides → Availability & coverage → Backfills'],
                ['PM multipliers (scenario)', 'Scenarios → Assumptions/Overrides → PM multipliers (scenario-only)'],
              ].map(([k, v]) => (
                <div key={k} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 12, background: 'white' }}>
                  <div style={{ fontWeight: 900, color: 'var(--ink)' }}>{k}</div>
                  <div style={{ marginTop: 4, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-muted)' }}>
                    {v}
                  </div>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Tips for clean data" tag={<Pill type="blue">recommended</Pill>} />
          <CardBody>
            <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--ink-muted)', lineHeight: 1.75, fontSize: 13 }}>
              <li>Keep person names consistent between Project List assignments and roster.</li>
              <li>If you remove someone from the roster, their project assignments should become <strong>Unassigned</strong> (so demand stays visible).</li>
              <li>If demand looks “missing”, check whether the role on the project is set to <strong>Unassigned</strong> (Edit projects).</li>
            </ul>
          </CardBody>
        </Card>
      </div>

      {typeof onNavigate === 'function' && (
        <div style={{ marginTop: 14, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button onClick={() => onNavigate('plan')} style={navBtn}>Go to Plan</button>
          <button onClick={() => onNavigate('overview')} style={navBtn}>Go to Overview</button>
          <button onClick={() => onNavigate('capacity')} style={navBtn}>Go to Capacity</button>
          <button onClick={() => onNavigate('workload')} style={navBtn}>Go to Workload Explorer</button>
          <button onClick={() => onNavigate('scenarios')} style={navBtn}>Go to Scenarios</button>
        </div>
      )}
    </div>
  )
}

const navBtn = {
  padding: '8px 12px',
  borderRadius: 10,
  border: '1px solid var(--border)',
  background: 'white',
  color: 'var(--ink)',
  fontWeight: 850,
  cursor: 'pointer',
  fontFamily: 'var(--font-sans)',
}


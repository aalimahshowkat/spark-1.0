import React, { useRef } from 'react'

const TAB_LABELS = {
  plan:       'Plan',
  capacitySetup: 'Advanced planning',
  dataEngine: 'Data Engine',
  overview:   'Overview',
  capacity:   'Capacity',
  workload:   'Workload Explorer',
  people:     'People',
  projects:   'Projects',
  logic:      'Logic Layer',
  validation: 'Validation',
  exports:    'Exports',
  scenarios:  'Scenarios',
  ai:         'SPARK AI',
  guide:      'User Guide',
}

const TAB_SUBTITLES = {
  plan:       'Your active capacity plan · upload, refresh or edit projects',
  capacitySetup: 'Capacity control center · working model, allocations & demand drivers',
  dataEngine: 'Schema ingestion · parsing · data quality checks',
  overview:   'Year-at-a-glance · demand, capacity & utilization',
  capacity:   'Monthly demand vs capacity by role · team utilisation heatmap',
  workload:   'Explain why someone is busy · projects, overlaps & monthly drivers',
  people:     'Individual workload & allocation heatmap',
  projects:   'Pipeline, phases & delivery timeline',
  logic:      'Phase engine · demand lookup · aggregation',
  validation: 'Engine outputs vs Excel ground truth',
  exports:    'Download capacity model, project list and scenario outputs',
  scenarios:  'Model what-if changes · compare against baseline',
  ai:         'AI-powered capacity intelligence · grounded in your plan data',

}



export default function TopBar({ onUpload, fileName, activeTab, loading, onLogout }) {
  const ref = useRef()

  const handleChange = (e) => {
    const file = e.target.files[0]
    if (file) onUpload(file)
    e.target.value = ''
  }

  return (
    <header style={{
      position: 'sticky', top: 0, zIndex: 100,
      background: 'rgba(244,245,250,0.90)',
      backdropFilter: 'blur(12px)',
      borderBottom: '1px solid var(--border)',
      padding: '0 36px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      height: 56, minHeight: 56,
    }}>
      {/* Page title */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div>
          <div style={{ fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 14.5, color: 'var(--ink)', lineHeight: 1.2 }}>
            {TAB_LABELS[activeTab] || activeTab}
          </div>
          {TAB_SUBTITLES[activeTab] && (
            <div style={{ fontSize: 11.5, color: 'var(--ink-muted)', marginTop: 1 }}>
              {TAB_SUBTITLES[activeTab]}
            </div>
          )}
        </div>
      </div>

      {/* Right controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {onLogout && (
          <button
            onClick={onLogout}
            style={{
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '7px 12px', borderRadius: 7,
              background: 'transparent',
              color: 'var(--ink-muted)',
              border: '1px solid var(--border)',
              fontFamily: 'var(--font-sans)', fontSize: 12.5, fontWeight: 700,
              cursor: 'pointer', transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-1)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
            title="Logout"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <path d="M16 17l5-5-5-5"/>
              <path d="M21 12H9"/>
            </svg>
            Logout
          </button>
        )}
        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--ink-muted)' }}>
            <div style={{ width: 14, height: 14, border: '2px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
            Parsing…
          </div>
        )}

        <input type="file" ref={ref} accept=".xlsx,.xls" onChange={handleChange} style={{ display: 'none' }} />

        <button
          onClick={() => ref.current.click()}
          style={{
            display: 'flex', alignItems: 'center', gap: 7,
            padding: '7px 14px', borderRadius: 7,
            background: fileName ? 'var(--surface-0)' : 'var(--accent)',
            color: fileName ? 'var(--ink-soft)' : 'white',
            border: fileName ? '1px solid var(--border)' : '1px solid transparent',
            fontFamily: 'var(--font-sans)', fontSize: 12.5, fontWeight: 600,
            cursor: 'pointer', transition: 'all 0.15s',
            boxShadow: fileName ? 'var(--shadow-sm)' : '0 1px 3px rgba(37,99,235,0.3)',
          }}
          onMouseEnter={e => {
            if (fileName) { e.currentTarget.style.background = 'var(--surface-1)' }
            else { e.currentTarget.style.background = 'var(--accent-hover)' }
          }}
          onMouseLeave={e => {
            if (fileName) { e.currentTarget.style.background = 'var(--surface-0)' }
            else { e.currentTarget.style.background = 'var(--accent)' }
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
          </svg>
          {fileName ? 'Replace File' : 'Upload Excel'}
        </button>
      </div>
    </header>
  )
}

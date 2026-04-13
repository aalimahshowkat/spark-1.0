/**
 * DataEngineView.jsx
 *
 * The new "Data Engine" tab added to the existing dashboard.
 * This sits ALONGSIDE the existing views — it does not replace them.
 *
 * What this view shows:
 *   1. Ingestion summary: what was parsed, from which sheets
 *   2. Schema preview: parsed projects in structured form
 *   3. Data quality report: all flags organised by severity
 *   4. Demand Matrix preview: parsed lookup table
 *   5. Raw project table: every field we extracted
 *
 * The existing dashboard (Executive, Capacity, People, Projects views)
 * continues to use parseExcel.js untouched.
 * This view uses the new engine/ingest.js layer in parallel.
 */

import React, { useState, useEffect, useCallback } from 'react'
import { ingestExcelFile } from '../engine/ingest.js'
import {
  MONTHS, VIBE_TYPES, PRIMARY_ROLES, SCHEMA_VERSION,
  FTE_COUNT, RAW_CAPACITY, EFFECTIVE_CAPACITY, ATTRITION_FACTOR,
} from '../engine/schema.js'

// ─────────────────────────────────────────────────────────────────────────
// STYLES — local to this file, consistent with existing dashboard palette
// ─────────────────────────────────────────────────────────────────────────
const S = {
  // Layout
  page:      { padding: '0' },
  section:   { marginBottom: 24 },

  // Cards
  card:      { background: 'white', border: '1px solid var(--rule)', borderRadius: 10, overflow: 'hidden', marginBottom: 20 },
  cardHead:  { padding: '14px 20px', borderBottom: '1px solid var(--rule)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { fontFamily: 'DM Serif Display, serif', fontSize: 16, letterSpacing: '-0.3px' },
  cardBody:  { padding: 20 },

  // Grid
  grid3:     { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 20 },
  grid2:     { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 },

  // KPI mini
  kpi:       { background: 'white', border: '1px solid var(--rule)', borderRadius: 8, padding: '14px 16px' },
  kpiLabel:  { fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.8px', color: 'var(--ink-muted)', marginBottom: 6 },
  kpiValue:  { fontFamily: 'DM Serif Display, serif', fontSize: 28, letterSpacing: '-0.5px', lineHeight: 1 },
  kpiSub:    { fontSize: 11, color: 'var(--ink-muted)', marginTop: 4 },

  // Table
  tableWrap: { overflowX: 'auto', overflowY: 'auto' },
  table:     { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  th:        { padding: '8px 12px', border: '1px solid var(--rule)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--ink-muted)', background: 'var(--paper-warm)', textAlign: 'left', whiteSpace: 'nowrap' },
  td:        { padding: '8px 12px', border: '1px solid var(--rule)', verticalAlign: 'top' },
  tdMono:    { padding: '8px 12px', border: '1px solid var(--rule)', fontFamily: 'DM Mono, monospace', fontSize: 11 },

  // Severity badges
  errorBadge:   { display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, background: 'var(--red-light)', color: 'var(--red)' },
  warnBadge:    { display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, background: 'var(--amber-light)', color: 'var(--amber)' },
  infoBadge:    { display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, background: 'var(--blue-light)', color: 'var(--blue)' },
  successBadge: { display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, background: 'var(--green-light)', color: 'var(--green)' },

  // Status pill
  pill: (type) => {
    const map = {
      Open:        { bg: 'var(--blue-light)',   fg: 'var(--blue)'   },
      'In Progress':{ bg: 'var(--amber-light)', fg: 'var(--amber)'  },
      Done:        { bg: 'var(--green-light)',  fg: 'var(--green)'  },
    }
    const s = map[type] || { bg: 'var(--paper-warm)', fg: 'var(--ink-muted)' }
    return { display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, background: s.bg, color: s.fg }
  },

  // Sub-tabs
  subTabBar: { display: 'flex', gap: 0, borderBottom: '1px solid var(--rule)', marginBottom: 20 },
  subTab:    (active) => ({
    padding: '10px 18px', fontSize: 13, fontWeight: active ? 600 : 500,
    color: active ? 'var(--accent)' : 'var(--ink-muted)',
    borderBottom: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
    cursor: 'pointer', background: 'none', border: 'none',
    borderBottomWidth: 2, borderBottomStyle: 'solid',
    borderBottomColor: active ? 'var(--accent)' : 'transparent',
    fontFamily: 'Instrument Sans, sans-serif',
  }),

  tag: { fontFamily: 'DM Mono, monospace', fontSize: 10, padding: '3px 8px', borderRadius: 4, background: 'var(--paper-warm)', color: 'var(--ink-muted)', fontWeight: 500 },
}

// ─────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────

export default function DataEngineView({ uploadedFile }) {
  const [result,   setResult]   = useState(null)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState(null)
  const [subTab,   setSubTab]   = useState('overview')

  // Re-run ingestion whenever the uploaded file changes
  useEffect(() => {
    if (!uploadedFile) return
    setLoading(true)
    setError(null)
    setResult(null)

    // Support persisted base ingest (no re-upload required)
    if (uploadedFile?.kind === 'ingest' && uploadedFile.ingest) {
      setResult(uploadedFile.ingest)
      setLoading(false)
      return
    }

    const file =
      (uploadedFile?.kind === 'file' && uploadedFile.file) ? uploadedFile.file :
      (uploadedFile instanceof File ? uploadedFile : null)

    if (!file) {
      setError('No workbook file available. Upload a workbook to run ingestion, or switch to a saved Base dataset.')
      setLoading(false)
      return
    }

    ingestExcelFile(file)
      .then(r => { setResult(r); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [uploadedFile])

  return (
    <div style={S.page}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 24 }}>
        <h1 style={{ fontFamily: 'DM Serif Display, serif', fontSize: 26, letterSpacing: '-0.5px' }}>
          Data Engine
        </h1>
        <span style={{ fontSize: 13, color: 'var(--ink-muted)' }}>
          Ingestion · Schema · Quality checks — powered by Project List + Demand Matrix only
        </span>
        <span style={S.tag}>v{SCHEMA_VERSION}</span>
      </div>

      {/* State: no file */}
      {!uploadedFile && !result && (
        <NoFileState />
      )}

      {/* State: loading */}
      {loading && <LoadingState />}

      {/* State: error */}
      {error && <ErrorState message={error} />}

      {/* State: loaded */}
      {result && !loading && (
        <>
          {/* Sub-navigation */}
          <div style={S.subTabBar}>
            {[
              { id: 'overview',  label: 'Overview' },
              { id: 'quality',   label: `Data Quality ${result.quality.errorCount > 0 ? `⚠ ${result.quality.errorCount}` : result.quality.warningCount > 0 ? `· ${result.quality.warningCount} warnings` : '✓'}` },
              { id: 'projects',  label: 'Project Schema' },
              { id: 'matrix',    label: 'Demand Matrix' },
              { id: 'schema',    label: 'Config Constants' },
            ].map(t => (
              <button key={t.id} style={S.subTab(subTab === t.id)} onClick={() => setSubTab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>

          {subTab === 'overview' && <OverviewTab result={result} />}
          {subTab === 'quality'  && <QualityTab  result={result} />}
          {subTab === 'projects' && <ProjectsTab result={result} />}
          {subTab === 'matrix'   && <MatrixTab   result={result} />}
          {subTab === 'schema'   && <SchemaTab />}
        </>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// SUB-TABS
// ─────────────────────────────────────────────────────────────────────────

function OverviewTab({ result }) {
  const { projects, demandMatrix, quality, meta } = result

  const byVibe    = VIBE_TYPES.reduce((acc, v) => { acc[v] = projects.filter(p => p.vibeType === v).length; return acc }, {})
  const byStatus  = ['Open','In Progress','Done'].reduce((acc, s) => { acc[s] = projects.filter(p => p.status === s).length; return acc }, {})

  const clean = quality.isClean

  return (
    <>
      {/* Ingestion summary KPIs */}
      <div style={S.grid3}>
        <div style={S.kpi}>
          <div style={S.kpiLabel}>Projects Parsed</div>
          <div style={S.kpiValue}>{projects.length}</div>
          <div style={S.kpiSub}>from Project List</div>
        </div>
        <div style={S.kpi}>
          <div style={S.kpiLabel}>Demand Matrix Rows</div>
          <div style={S.kpiValue}>{demandMatrix.length}</div>
          <div style={S.kpiSub}>role × VIBE × phase entries</div>
        </div>
        <div style={S.kpi}>
          <div style={S.kpiLabel}>Parse Duration</div>
          <div style={S.kpiValue}>{meta.durationMs}ms</div>
          <div style={S.kpiSub}>full ingestion time</div>
        </div>
      </div>

      {/* Quality summary */}
      <div style={{ ...S.card }}>
        <div style={S.cardHead}>
          <span style={S.cardTitle}>Data Quality Summary</span>
          <span style={clean ? S.successBadge : S.errorBadge}>
            {clean ? '✓ Clean' : `${quality.errorCount} errors · ${quality.warningCount} warnings`}
          </span>
        </div>
        <div style={{ ...S.cardBody, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
          {[
            { label: 'Errors',              value: quality.errorCount,         badge: quality.errorCount > 0 ? 'error' : 'success' },
            { label: 'Warnings',            value: quality.warningCount,       badge: quality.warningCount > 0 ? 'warn' : 'success' },
            { label: 'Info flags',          value: quality.infoCount,          badge: 'info' },
            { label: 'Projects with issues',value: quality.projectsWithIssues, badge: quality.projectsWithIssues > 0 ? 'warn' : 'success' },
          ].map(({ label, value, badge }) => (
            <div key={label}>
              <div style={S.kpiLabel}>{label}</div>
              <div style={{ ...S.kpiValue, fontSize: 24 }}>{value}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={S.grid2}>
        {/* VIBE breakdown */}
        <div style={S.card}>
          <div style={S.cardHead}><span style={S.cardTitle}>Projects by VIBE Type</span></div>
          <div style={S.cardBody}>
            {VIBE_TYPES.map(v => (
              <div key={v} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '7px 0', borderBottom: '1px solid var(--rule)' }}>
                <div style={{ width: 10, height: 10, borderRadius: 2, flexShrink: 0, background: VIBE_COLOR[v] }} />
                <div style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{v}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 80, height: 6, background: 'var(--paper-warm)', borderRadius: 3 }}>
                    <div style={{ width: `${(byVibe[v] / projects.length * 100)}%`, height: '100%', background: VIBE_COLOR[v], borderRadius: 3 }} />
                  </div>
                  <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, width: 20, textAlign: 'right' }}>{byVibe[v]}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Sheets found */}
        <div style={S.card}>
          <div style={S.cardHead}><span style={S.cardTitle}>Ingestion Source</span></div>
          <div style={S.cardBody}>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.8px', color: 'var(--ink-muted)', marginBottom: 8 }}>
                Sheets Used (source of truth)
              </div>
              {['Project List', 'Demand Base Matrix'].map(s => (
                <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0' }}>
                  <span style={{ color: 'var(--green)', fontSize: 14 }}>✓</span>
                  <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 12 }}>{s}</span>
                </div>
              ))}
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.8px', color: 'var(--ink-muted)', marginBottom: 8 }}>
                Sheets Ignored (not required)
              </div>
              {meta.sheetsFound
                .filter(s => !['Project List', 'Demand Base Matrix'].includes(s))
                .map(s => (
                  <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0' }}>
                    <span style={{ color: 'var(--ink-muted)', fontSize: 14 }}>—</span>
                    <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, color: 'var(--ink-muted)' }}>{s}</span>
                  </div>
                ))}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

function QualityTab({ result }) {
  const { quality } = result
  const [filter, setFilter] = useState('all')

  const allFlags = quality.flags
  const shown = filter === 'all' ? allFlags : allFlags.filter(f => f.severity === filter)

  const severityOrder = { error: 0, warning: 1, info: 2 }
  const sorted = [...shown].sort((a, b) =>
    (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9)
  )

  return (
    <>
      {/* Summary bar */}
      {quality.isClean ? (
        <div style={{ background: 'var(--green-light)', border: '1px solid #b2dfcd', borderRadius: 8, padding: '12px 16px', marginBottom: 20, fontSize: 13, color: 'var(--green)', display: 'flex', gap: 8 }}>
          <span>✓</span>
          <strong>All data quality checks passed.</strong> No errors or warnings found across {result.projects.length} projects.
        </div>
      ) : (
        <div style={{ background: 'var(--red-light)', border: '1px solid #f5ccc4', borderRadius: 8, padding: '12px 16px', marginBottom: 20, fontSize: 13, color: '#7a2e1e', display: 'flex', gap: 8 }}>
          <span>⚠️</span>
          <span>
            <strong>{quality.errorCount} error{quality.errorCount !== 1 ? 's' : ''}</strong> and{' '}
            <strong>{quality.warningCount} warning{quality.warningCount !== 1 ? 's' : ''}</strong> found across{' '}
            <strong>{quality.projectsWithIssues} projects</strong>.
            Errors will cause incorrect calculations — fix before relying on output.
          </span>
        </div>
      )}

      {/* Filter buttons */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {[
          { id: 'all',     label: `All (${allFlags.length})` },
          { id: 'error',   label: `Errors (${quality.errorCount})` },
          { id: 'warning', label: `Warnings (${quality.warningCount})` },
          { id: 'info',    label: `Info (${quality.infoCount})` },
        ].map(btn => (
          <button key={btn.id} onClick={() => setFilter(btn.id)} style={{
            padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600,
            border: `1.5px solid ${filter === btn.id ? 'var(--accent)' : 'var(--rule)'}`,
            background: filter === btn.id ? 'var(--accent-light)' : 'white',
            color: filter === btn.id ? 'var(--accent)' : 'var(--ink-muted)',
            cursor: 'pointer', fontFamily: 'Instrument Sans, sans-serif',
          }}>
            {btn.label}
          </button>
        ))}
      </div>

      {/* Flags table */}
      <div style={S.card}>
        <div style={{ ...S.cardBody, padding: 0 }}>
          <div style={{ ...S.tableWrap, maxHeight: 500 }}>
            <table style={S.table}>
              <thead>
                <tr>
                  {['Rule', 'Severity', 'Project', 'Field', 'Parsed Value', 'Issue', 'Impact'].map(h => (
                    <th key={h} style={S.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.length === 0 ? (
                  <tr><td colSpan={7} style={{ ...S.td, textAlign: 'center', padding: 32, color: 'var(--ink-muted)' }}>No flags match this filter.</td></tr>
                ) : sorted.map((f, i) => (
                  <tr key={i} style={{ background: i % 2 === 0 ? 'white' : 'var(--paper-warm)' }}>
                    <td style={S.tdMono}>{f.ruleId}</td>
                    <td style={S.td}><SeverityBadge s={f.severity} /></td>
                    <td style={{ ...S.td, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>{f.entityName}</td>
                    <td style={S.tdMono}>{f.field}</td>
                    <td style={{ ...S.tdMono, fontSize: 10, color: 'var(--ink-muted)', maxWidth: 120, wordBreak: 'break-all' }}>
                      {f.value !== null && f.value !== undefined ? String(f.value).slice(0, 40) : <span style={{color:'var(--rule)'}}>—</span>}
                    </td>
                    <td style={{ ...S.td, maxWidth: 260 }}>{f.message}</td>
                    <td style={{ ...S.td, color: 'var(--ink-muted)', fontSize: 11, maxWidth: 220 }}>{f.impact}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  )
}

function ProjectsTab({ result }) {
  const { projects } = result
  const [search, setSearch] = useState('')
  const [vibeFilter, setVibeFilter] = useState('all')

  const shown = projects.filter(p => {
    if (vibeFilter !== 'all' && p.vibeType !== vibeFilter) return false
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  return (
    <>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center' }}>
        <input
          placeholder="Search projects…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ padding: '7px 12px', border: '1px solid var(--rule)', borderRadius: 6, fontSize: 13, fontFamily: 'Instrument Sans, sans-serif', outline: 'none', width: 240 }}
        />
        <select value={vibeFilter} onChange={e => setVibeFilter(e.target.value)}
          style={{ padding: '7px 12px', border: '1px solid var(--rule)', borderRadius: 6, fontSize: 13, background: 'white', fontFamily: 'Instrument Sans, sans-serif', cursor: 'pointer', outline: 'none' }}>
          <option value="all">All VIBE Types</option>
          {VIBE_TYPES.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
        <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{shown.length} of {projects.length}</span>
      </div>

      <div style={S.card}>
        <div style={{ ...S.cardBody, padding: 0 }}>
          <div style={{ ...S.tableWrap, maxHeight: 520 }}>
            <table style={S.table}>
              <thead>
                <tr>
                  {['ID','Project Name','VIBE','Status','Start','Delivery','LMs','Multiplier','Orbit','PM','CSM','Flags'].map(h => (
                    <th key={h} style={S.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((p, i) => (
                  <tr key={p.id ?? (i + 1)} style={{ background: i % 2 === 0 ? 'white' : 'var(--paper-warm)' }}>
                    <td style={{ ...S.tdMono, color: 'var(--ink-muted)', fontSize: 10 }}>{(p.displayId && String(p.displayId).trim())
  ? String(p.displayId).slice(0, 15)
  : (i + 1)}</td>
                    <td style={{ ...S.td, fontWeight: 500, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</td>
                    <td style={S.td}><VibeDot type={p.vibeType} /></td>
                    <td style={S.td}><span style={S.pill(p.status)}>{p.status}</span></td>
                    <td style={S.tdMono}>{fmtDateShort(p.startDate)}</td>
                    <td style={S.tdMono}>{fmtDateShort(p.deliveryDate)}</td>
                    <td style={S.tdMono}>{p.totalLMs ? p.totalLMs.toLocaleString() : '—'}</td>
                    <td style={S.tdMono}>{p.lmMultiplier}×</td>
                    <td style={S.td}><OrbitBadge orbit={p.orbit} /></td>
                    <td style={{ ...S.td, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 }}>{p.assignedPM || '—'}</td>
                    <td style={{ ...S.td, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 }}>{p.assignedCSM || '—'}</td>
                    <td style={S.td}>
                      {p.qualityFlags.length > 0 ? (
                        <span style={{ ...S.errorBadge, fontSize: 10 }}>{p.qualityFlags.length}</span>
                      ) : (
                        <span style={{ color: 'var(--green)', fontSize: 12 }}>✓</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  )
}

function MatrixTab({ result }) {
  const { demandMatrix } = result

  return (
    <>
      <div style={{ ...S.card, marginBottom: 16 }}>
        <div style={S.cardHead}>
          <span style={S.cardTitle}>Parsed Demand Matrix</span>
          <span style={S.tag}>{demandMatrix.length} role × VIBE entries</span>
        </div>
        <div style={{ ...S.cardBody, padding: '12px 16px', fontSize: 12, color: 'var(--ink-muted)' }}>
          These are the base hours per phase per role per VIBE type, as parsed from the "Demand Base Matrix" sheet.
          The engine uses these values before applying LM and Orbit multipliers.
          If the base hours change in the Excel, re-upload to refresh.
        </div>
      </div>

      {VIBE_TYPES.map(vibe => {
        const rows = demandMatrix.filter(r => r.vibeType === vibe)
        if (rows.length === 0) return null
        return (
          <div key={vibe} style={S.card}>
            <div style={S.cardHead}>
              <span style={S.cardTitle}>{vibe}</span>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: VIBE_COLOR[vibe] }} />
            </div>
            <div style={{ ...S.cardBody, padding: 0 }}>
              <div style={S.tableWrap}>
                <table style={S.table}>
                  <thead>
                    <tr>
                      <th style={S.th}>Role</th>
                      <th style={{ ...S.th, textAlign: 'center' }}>Start M0</th>
                      <th style={{ ...S.th, textAlign: 'center' }}>Start M1</th>
                      <th style={{ ...S.th, textAlign: 'center' }}>Mid</th>
                      <th style={{ ...S.th, textAlign: 'center' }}>End M-1</th>
                      <th style={{ ...S.th, textAlign: 'center' }}>End M0</th>
                      <th style={{ ...S.th, textAlign: 'center' }}>End M1</th>
                      <th style={{ ...S.th, textAlign: 'center' }}>End M1+</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i}>
                        <td style={{ ...S.td, fontWeight: 500 }}>{r.role}</td>
                        {['Project Start M0','Project Start M1','Project Mid','Project End M-1','Project End M0','Project End M1','Project End M1+'].map(phase => (
                          <td key={phase} style={{ ...S.tdMono, textAlign: 'center', color: (r.phaseHours[phase] || 0) > 0 ? 'var(--ink)' : 'var(--rule)' }}>
                            {(r.phaseHours[phase] || 0) > 0 ? r.phaseHours[phase] : '—'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )
      })}
    </>
  )
}

function SchemaTab() {
  return (
    <>
      <div style={S.card}>
        <div style={S.cardHead}><span style={S.cardTitle}>Capacity Constants</span><span style={S.tag}>src/engine/schema.js</span></div>
        <div style={{ ...S.cardBody, padding: 0 }}>
          <table style={S.table}>
            <thead><tr>
              <th style={S.th}>Role</th>
              <th style={S.th}>FTE Count</th>
              <th style={S.th}>Raw Cap (hrs/mo)</th>
              <th style={S.th}>Eff. Cap (hrs/mo)</th>
              <th style={S.th}>Eff. Cap (hrs/yr)</th>
            </tr></thead>
            <tbody>
              {Object.keys(FTE_COUNT).map((role, i) => (
                <tr key={role} style={{ background: i % 2 === 0 ? 'white' : 'var(--paper-warm)' }}>
                  <td style={{ ...S.td, fontWeight: 500 }}>{role}</td>
                  <td style={S.tdMono}>{FTE_COUNT[role]}</td>
                  <td style={S.tdMono}>{RAW_CAPACITY[role]?.toLocaleString()}</td>
                  <td style={S.tdMono}>{EFFECTIVE_CAPACITY[role]?.toLocaleString()}</td>
                  <td style={S.tdMono}>{(EFFECTIVE_CAPACITY[role] * 12)?.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={S.card}>
        <div style={S.cardHead}><span style={S.cardTitle}>LM Bucket Multipliers</span></div>
        <div style={S.cardBody}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
            {[
              { range: '≤ 1,000 LMs',   mult: '0.75×' },
              { range: '≤ 5,000 LMs',   mult: '1.00×' },
              { range: '≤ 10,000 LMs',  mult: '1.25×' },
              { range: '≤ 25,000 LMs',  mult: '1.50×' },
              { range: '≤ 100,000 LMs', mult: '2.00×' },
            ].map(({ range, mult }) => (
              <div key={range} style={{ background: 'var(--paper-warm)', borderRadius: 8, padding: '12px 14px', textAlign: 'center' }}>
                <div style={{ fontFamily: 'DM Serif Display, serif', fontSize: 22 }}>{mult}</div>
                <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: 4 }}>{range}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={S.card}>
        <div style={S.cardHead}><span style={S.cardTitle}>Orbit × VIBE Final Multipliers</span></div>
        <div style={{ ...S.cardBody, padding: 0 }}>
          <table style={S.table}>
            <thead><tr>
              <th style={S.th}>Orbit</th>
              {VIBE_TYPES.map(v => <th key={v} style={{ ...S.th, textAlign: 'center' }}>{v}</th>)}
            </tr></thead>
            <tbody>
              {['A','B','C','D'].map((orbit, i) => (
                <tr key={orbit} style={{ background: i % 2 === 0 ? 'white' : 'var(--paper-warm)' }}>
                  <td style={{ ...S.td, fontWeight: 600 }}>Orbit {orbit}</td>
                  {VIBE_TYPES.map(v => {
                    const key = `${orbit}_${v}`
                    const val = ORBIT_VIBE_MULT[key]
                    return <td key={v} style={{ ...S.tdMono, textAlign: 'center' }}>{val ?? '—'}×</td>
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={S.card}>
        <div style={S.cardHead}><span style={S.cardTitle}>Global Constants</span></div>
        <div style={S.cardBody}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
            {[
              { label: 'Hrs / Person / Month', value: '160 hrs' },
              { label: 'Attrition Factor',     value: `${ATTRITION_FACTOR * 100}%` },
              { label: 'Schema Version',        value: `v${SCHEMA_VERSION}` },
            ].map(({ label, value }) => (
              <div key={label} style={{ background: 'var(--paper-warm)', borderRadius: 8, padding: '14px 16px' }}>
                <div style={S.kpiLabel}>{label}</div>
                <div style={{ fontFamily: 'DM Serif Display, serif', fontSize: 22, marginTop: 6 }}>{value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// STATE COMPONENTS
// ─────────────────────────────────────────────────────────────────────────

function NoFileState() {
  return (
    <div style={{ textAlign: 'center', padding: '64px 40px', background: 'white', borderRadius: 10, border: '1px solid var(--rule)' }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>🔬</div>
      <div style={{ fontFamily: 'DM Serif Display, serif', fontSize: 22, marginBottom: 8 }}>No file loaded</div>
      <div style={{ fontSize: 13, color: 'var(--ink-muted)' }}>
        Upload an Excel file using the button in the top-right to run the data engine.
        <br />This view reads only <strong>Project List</strong> and <strong>Demand Base Matrix</strong> sheets.
      </div>
    </div>
  )
}

function LoadingState() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '24px 0', color: 'var(--ink-muted)' }}>
      <div style={{ width: 20, height: 20, border: '2px solid var(--rule)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
      <span style={{ fontSize: 14 }}>Running data engine — parsing Project List and Demand Matrix…</span>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

function ErrorState({ message }) {
  return (
    <div style={{ background: 'var(--red-light)', border: '1px solid #f5ccc4', borderRadius: 8, padding: '16px 20px', color: '#7a2e1e', fontSize: 13 }}>
      <strong>Ingestion failed:</strong> {message}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// SMALL UI HELPERS
// ─────────────────────────────────────────────────────────────────────────

const VIBE_COLOR = { Bond: '#2857a4', Validate: '#2a7a52', Integrate: '#c84b31', Explore: '#c47b1a' }

const ORBIT_VIBE_MULT = {
  'A_Validate':1.75,'A_Integrate':1.25,'A_Bond':1.225,'A_Explore':1.75,
  'B_Validate':1.5,'B_Integrate':1.0,'B_Bond':1.05,'B_Explore':1.5,
  'C_Validate':1.0,'C_Integrate':0.8,'C_Bond':0.7,'C_Explore':1.0,
  'D_Validate':1.0,'D_Integrate':0.8,'D_Bond':0.7,'D_Explore':1.0,
}

function VibeDot({ type }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: VIBE_COLOR[type] || '#888', flexShrink: 0 }} />
      {type}
    </span>
  )
}

function OrbitBadge({ orbit }) {
  const colors = { A: '#2857a4', B: '#2a7a52', C: '#7c8090', D: '#c47b1a', '-': '#e2dfd8' }
  return (
    <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, fontWeight: 600, color: colors[orbit] || '#888' }}>
      {orbit || '—'}
    </span>
  )
}

function SeverityBadge({ s }) {
  const map = { error: S.errorBadge, warning: S.warnBadge, info: S.infoBadge }
  return <span style={map[s] || S.infoBadge}>{s}</span>
}

function fmtDateShort(d) {
  if (!d || isNaN(d?.getTime?.())) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
}

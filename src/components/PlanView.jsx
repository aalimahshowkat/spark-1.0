/**
 * PlanView.jsx — "Plan" tab
 *
 * Replaces the old UploadView. Single clear mental model:
 *   - Shows the current active plan (loaded from IndexedDB or session)
 *   - Lets the planner refresh the plan by uploading a new file
 *   - Provides inline project list editing via ProjectListManagerModal
 *   - No "base vs override" language — just "current plan"
 */
import React, { useCallback, useState } from 'react'
import { Card, CardHeader, CardBody, Pill } from './ui'
import ProjectListManagerModal from './ProjectListManagerModal'
import OrgRosterModal from './OrgRosterModal'

const C = {
  accent: 'var(--accent)',
  border: 'var(--border)',
  surface: 'var(--surface-0)',
  surface1: 'var(--surface-1)',
  ink: 'var(--ink)',
  muted: 'var(--ink-muted)',
  faint: 'var(--ink-faint)',
  green: 'var(--green)',
  amber: 'var(--amber)',
  red: 'var(--red)',
}

export default function PlanView({
  onFile,
  loading,
  baseLoading,
  base,
  baseSummary,
  datasetMode,
  onUseBase,
  onPromoteOverrideToBase,
  onClearBase,
  onUpdateBaseProjects,
  onUpdateBaseRoster,
  hasOverride,
  uploadedFileName,
}) {
  const [dragging, setDragging] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)
  const [rosterOpen, setRosterOpen] = useState(false)
  const [confirmRefresh, setConfirmRefresh] = useState(null) // { file } | null

  const hasPlan = !!(base?.ingest || hasOverride)
  const showBaseBootLoading = !!(baseLoading && !hasPlan)
  const planName = datasetMode === 'base'
    ? (base?.sourceFileName || baseSummary?.fileName || 'Saved plan')
    : uploadedFileName || 'Uploaded plan'
  const planDate = base?.savedAt
    ? new Date(base.savedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : null
  const projectCount = base?.ingest?.projects?.length || baseSummary?.totalProjects || 0
  const roster = base?.ingest?.roster || []

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file && (file.name.endsWith('.xlsx') || file.name.endsWith('.xls'))) {
      if (hasPlan) {
        setConfirmRefresh({ file })
      } else {
        onFile(file)
      }
    }
  }, [hasPlan, onFile])

  const handleFileInput = useCallback((e) => {
    const file = e.target.files[0]
    if (!file) return
    e.target.value = ''
    if (hasPlan) {
      setConfirmRefresh({ file })
    } else {
      onFile(file)
    }
  }, [hasPlan, onFile])

  const confirmAndRefresh = () => {
    if (confirmRefresh?.file) {
      onFile(confirmRefresh.file)
    }
    setConfirmRefresh(null)
  }

  return (
    <div style={{ width: '100%', maxWidth: 'none', animation: 'fadeUp 0.22s ease both' }}>

      {/* Confirm refresh dialog */}
      {confirmRefresh && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 500,
          background: 'rgba(0,0,0,0.35)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: C.surface, borderRadius: 12, padding: 28,
            width: 'min(92vw, 420px)', boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
            border: `1px solid ${C.border}`,
          }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: C.ink, marginBottom: 8 }}>
              Refresh the current plan?
            </div>
            <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.6, marginBottom: 20 }}>
              This will replace <strong>{planName}</strong> with{' '}
              <strong>{confirmRefresh.file.name}</strong> as the active plan.
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={confirmAndRefresh} style={primaryBtn}>
                Yes, refresh plan
              </button>
              <button onClick={() => setConfirmRefresh(null)} style={ghostBtn}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontWeight: 700, fontSize: 22, color: C.ink, letterSpacing: '-0.03em', marginBottom: 4 }}>
          Current Plan
        </div>
        <div style={{ fontSize: 13, color: C.muted }}>
          Capacity and demand data that powers all SPARK views and scenarios.
        </div>
      </div>

      {/* Current plan card */}
      {showBaseBootLoading ? (
        <Card style={{ marginBottom: 16, borderStyle: 'dashed', borderColor: C.border }}>
          <CardBody>
            <div style={{ textAlign: 'center', padding: '16px 0', color: C.muted, fontSize: 13 }}>
              Loading default plan…
              <div style={{ marginTop: 8, width: 16, height: 16, border: '2px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.7s linear infinite', marginLeft: 'auto', marginRight: 'auto' }} />
              <div style={{ marginTop: 10, fontSize: 11.5, color: C.faint }}>
                First load can take a few seconds (Excel ingest + engine prep).
              </div>
            </div>
          </CardBody>
        </Card>
      ) : hasPlan ? (
        <Card style={{ marginBottom: 16 }}>
          <CardHeader title="Active Plan">
            <Pill type="green">Loaded</Pill>
          </CardHeader>
          <CardBody>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
                <Stat label="Source" value={planName} mono />
                <Stat label="Projects" value={String(projectCount)} />
                <Stat label="Roster" value={`${roster.length}`} />
                {planDate && <Stat label="Last updated" value={planDate} />}
                {baseSummary?.matrixRows > 0 && (
                  <Stat label="Demand matrix rows" value={String(baseSummary.matrixRows)} />
                )}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {base?.ingest && (
                  <button onClick={() => setManageOpen(true)} style={ghostBtn}>
                    Edit projects
                  </button>
                )}
                {base?.ingest && (
                  <button onClick={() => setRosterOpen(true)} style={ghostBtn}>
                    Manage roster
                  </button>
                )}
                {base?.ingest && (
                  <button
                    onClick={onClearBase}
                    style={{ ...ghostBtn, color: C.red, borderColor: 'rgba(248,113,113,0.4)' }}
                  >
                    Clear plan
                  </button>
                )}
              </div>
            </div>
          </CardBody>
        </Card>
      ) : (
        <Card style={{ marginBottom: 16, borderStyle: 'dashed', borderColor: C.border }}>
          <CardBody>
            <div style={{ textAlign: 'center', padding: '16px 0', color: C.muted, fontSize: 13 }}>
              No plan loaded yet. Upload an Excel file to get started.
            </div>
          </CardBody>
        </Card>
      )}

      {/* Promote override to plan */}
      {hasOverride && datasetMode === 'override' && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          background: 'var(--accent-light)', border: '1px solid var(--accent-dim)',
          borderRadius: 8, padding: '11px 14px', marginBottom: 16, fontSize: 12.5,
          color: 'var(--ink)',
        }}>
          <span style={{ fontSize: 15 }}>💾</span>
          <span style={{ flex: 1 }}>
            You uploaded <strong>{uploadedFileName}</strong>. Save it as the current plan so it loads automatically next time.
          </span>
          <button onClick={onPromoteOverrideToBase} style={primaryBtn}>
            Save as plan
          </button>
        </div>
      )}

      {/* Upload drop zone */}
      <label
        htmlFor="plan-file-input"
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        style={{
          display: 'block',
          border: `2px dashed ${dragging ? 'var(--accent)' : C.border}`,
          borderRadius: 10,
          padding: '32px 24px',
          textAlign: 'center',
          background: dragging ? 'var(--accent-dim)' : C.surface1,
          cursor: 'pointer',
          transition: 'all 0.16s',
          marginBottom: 20,
        }}
      >
        <input id="plan-file-input" type="file" accept=".xlsx,.xls"
          style={{ display: 'none' }} onChange={handleFileInput} />

        <div style={{ fontSize: 22, marginBottom: 8 }}>{loading ? '⏳' : '📂'}</div>
        <div style={{ fontWeight: 600, fontSize: 14, color: C.ink, marginBottom: 4 }}>
          {loading ? 'Parsing…' : hasPlan ? 'Upload to refresh plan' : 'Upload your Excel plan'}
        </div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 16 }}>
          Requires <strong>Project List</strong> and <strong>Demand Base Matrix</strong> sheets
        </div>
        {!loading && (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: 'var(--accent)', color: 'white',
            padding: '7px 16px', borderRadius: 6, fontSize: 12.5, fontWeight: 600,
          }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
            </svg>
            {hasPlan ? 'Choose new file' : 'Choose file'}
          </div>
        )}
      </label>

      {/* Schema reference */}
      <Card>
        <CardHeader title="Expected workbook structure" />
        <CardBody style={{ padding: 0 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: C.surface1 }}>
                {['Sheet', 'Purpose', 'Required'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '9px 14px', borderBottom: `1px solid ${C.border}`, fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: C.muted }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                ['Project List', 'Project metadata, dates, VIBE type, orbit, and scale', 'Yes'],
                ['Demand Base Matrix', 'Base hours by role × VIBE × phase — drives all demand calculations', 'Yes'],
                ['Capacity Model', 'Used only for parity validation during transition', 'No'],
              ].map(([sheet, purpose, req], i) => (
                <tr key={sheet} style={{ background: i % 2 ? C.surface1 : C.surface }}>
                  <td style={{ padding: '9px 14px', fontFamily: 'var(--font-mono)', fontSize: 11.5, fontWeight: 500, color: C.ink, borderBottom: `1px solid ${C.border}` }}>{sheet}</td>
                  <td style={{ padding: '9px 14px', color: C.muted, fontSize: 12, borderBottom: `1px solid ${C.border}` }}>{purpose}</td>
                  <td style={{ padding: '9px 14px', borderBottom: `1px solid ${C.border}` }}>
                    <Pill type={req === 'Yes' ? 'green' : 'amber'}>{req}</Pill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>

      <ProjectListManagerModal
        isOpen={manageOpen}
        onClose={() => setManageOpen(false)}
        projects={base?.ingest?.projects || []}
        roster={roster}
        baseLabel={planName}
        onSaveProjects={async ({ projects, editorName, note }) => {
          await onUpdateBaseProjects?.({ projects, editorName, note })
        }}
      />

      <OrgRosterModal
        isOpen={rosterOpen}
        onClose={() => setRosterOpen(false)}
        roster={roster}
        planLabel={planName}
        seedFromProjects={() => {
          const byId = new Map()
          const add = (role, name) => {
            const n = String(name || '').trim()
            if (!n) return
            if (['Unassigned','Need to allocate','?','TBD','BA1','BA2','New PM1','New PM2'].includes(n)) return
            const id = `${role}__${n}`
            if (byId.has(id)) return
            byId.set(id, { id, name: n, role, fte: 1 })
          }
          for (const p of (base?.ingest?.projects || [])) {
            add('CSM', p.assignedCSM)
            add('PM', p.assignedPM)
            add('SE', p.assignedSE)
            add('Analyst 1', p.assignedAnalyst1)
            add('Analyst 2', p.assignedAnalyst2)
          }
          return [...byId.values()].sort((a, b) => (a.role + a.name).localeCompare(b.role + b.name))
        }}
        onSaveRoster={async ({ roster, editorName, note }) => {
          await onUpdateBaseRoster?.({ roster, editorName, note })
        }}
      />

      {/* Branding footer (Plan page) */}
      <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
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
  )
}

function Stat({ label, value, mono }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--ink-muted)', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', fontFamily: mono ? 'var(--font-mono)' : undefined }}>{value}</div>
    </div>
  )
}

const primaryBtn = {
  padding: '7px 14px', background: 'var(--accent)', color: 'white',
  border: 'none', borderRadius: 6, fontSize: 12.5, fontWeight: 600,
  cursor: 'pointer', fontFamily: 'var(--font-sans)',
}

const ghostBtn = {
  padding: '7px 14px', background: 'transparent', color: 'var(--ink)',
  border: '1px solid var(--border)', borderRadius: 6, fontSize: 12.5, fontWeight: 500,
  cursor: 'pointer', fontFamily: 'var(--font-sans)',
}

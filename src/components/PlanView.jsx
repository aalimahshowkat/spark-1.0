/**
 * PlanView.jsx — "Plan" tab
 *
 * Replaces the old UploadView. Single clear mental model:
 *   - Shows the current active plan (loaded from IndexedDB or session)
 *   - Lets the planner refresh the plan by uploading a new file
 *   - Provides inline project list editing via ProjectListManagerModal
 *   - No "base vs override" language — just "current plan"
 */
import React, { useCallback, useMemo, useState } from 'react'
import { Card, CardHeader, CardBody, Pill, Mono } from './ui'
import ProjectListManagerModal from './ProjectListManagerModal'
import OrgRosterModal from './OrgRosterModal'
import * as XLSX from 'xlsx'
import { PROJECT_LIST_COLUMN_MAP } from '../engine/schema.js'

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
  planIssues,
  onDismissPlanIssues,
  base,
  baseSummary,
  datasetMode,
  onUseBase,
  onPromoteOverrideToBase,
  onUpdateBaseProjects,
  onUpdateBaseRoster,
  onUpdateCapacityConfig,
  onResetToBundledDefaultPlan,
  onResetBaseToSourceWorkbook,
  onRemoveUploadedWorkbook,
  onClearUploadedPlanEdits,
  onUpdateOverrideProjects,
  onUpdateOverrideRoster,
  engineIngest,
  effectiveCapacityConfig,
  onGoToCapacitySetup,
  hasOverride,
  uploadedFileName,
  onGoToOverview,
}) {
  const [dragging, setDragging] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)
  const [rosterOpen, setRosterOpen] = useState(false)
  const [confirmRefresh, setConfirmRefresh] = useState(null) // { file } | null
  const [clearOpen, setClearOpen] = useState(false)
  const [clearMode, setClearMode] = useState('reset_changes') // reset_changes | remove_workbook | remove_both

  const hasPlan = !!(base?.ingest || hasOverride)
  const hasUploadedWorkbook = datasetMode === 'override' && !!hasOverride
  const isBundledDefault = !!(base?.isBundledDefault || (base?.audit || []).some(a => a?.action === 'base_seed_default_plan'))
  const showBaseBootLoading = !!(baseLoading && !hasPlan)
  const planName = datasetMode === 'base'
    ? (base?.sourceFileName || baseSummary?.fileName || 'Saved plan')
    : uploadedFileName || 'Uploaded plan'
  const planDate = base?.savedAt
    ? new Date(base.savedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : null
  const activeIngest = engineIngest?.projects ? engineIngest : base?.ingest
  const projectCount = activeIngest?.projects?.length || baseSummary?.totalProjects || 0
  const roster = activeIngest?.roster || []
  const projects = activeIngest?.projects || []
  const capacityConfig = effectiveCapacityConfig ?? (base?.capacityConfig || null)

  const safeText = (s) => String(s || '').trim()
  const sameName = (a, b) => safeText(a).toLowerCase() === safeText(b).toLowerCase()

  const PROJECT_ASSIGN_FIELDS = ['assignedCSM', 'assignedPM', 'assignedSE', 'assignedAnalyst1', 'assignedAnalyst2']

  const applyPersonRenameRemoveToProjects = (projects, { renamePairs = [], removedNames = [] }) => {
    const ren = new Map()
    for (const [from, to] of renamePairs) {
      const f = safeText(from)
      const t = safeText(to)
      if (f && t && !sameName(f, t)) ren.set(f.toLowerCase(), t)
    }
    const removed = new Set((removedNames || []).map(n => safeText(n).toLowerCase()).filter(Boolean))

    // If a roster entry is removed but project assignments use a longer variant
    // (e.g. roster: "Aakash", project list: "Aakash Agarwal"), broaden the removal
    // to include prefix matches.
    if (removed.size) {
      const current = new Set()
      const list = Array.isArray(projects) ? projects : []
      for (const p of list) {
        for (const f of PROJECT_ASSIGN_FIELDS) {
          const cur = safeText(p?.[f])
          if (!cur) continue
          current.add(cur.toLowerCase())
        }
      }
      for (const rn of Array.from(removed)) {
        if (!rn || rn.includes(' ')) continue
        if (current.has(rn)) continue
        const prefix = `${rn} `
        const matches = Array.from(current).filter(x => x.startsWith(prefix))
        for (const m of matches) removed.add(m)
      }
    }

    // If a roster entry is renamed but project assignments use a longer variant,
    // broaden the rename to include prefix matches too.
    if (ren.size) {
      const current = new Set()
      const list = Array.isArray(projects) ? projects : []
      for (const p of list) {
        for (const f of PROJECT_ASSIGN_FIELDS) {
          const cur = safeText(p?.[f])
          if (!cur) continue
          current.add(cur.toLowerCase())
        }
      }
      for (const [fromLower, toName] of Array.from(ren.entries())) {
        if (!fromLower || fromLower.includes(' ')) continue
        if (current.has(fromLower)) continue
        const prefix = `${fromLower} `
        const matches = Array.from(current).filter(x => x.startsWith(prefix))
        for (const m of matches) ren.set(m, toName)
      }
    }

    let changed = false
    const next = (Array.isArray(projects) ? projects : []).map(p => {
      let rowChanged = false
      const out = { ...(p || {}) }
      for (const f of PROJECT_ASSIGN_FIELDS) {
        const cur = safeText(out?.[f])
        const key = cur.toLowerCase()
        if (ren.has(key)) {
          out[f] = ren.get(key)
          rowChanged = true
        }
        if (removed.has(key) && safeText(out?.[f])) {
          out[f] = 'Unassigned'
          rowChanged = true
        }
      }
      if (rowChanged) changed = true
      return rowChanged ? out : p
    })

    return { projects: next, changed }
  }

  const migrateCapacityConfigForRosterChanges = (cfg, { renamePairs = [], removedNames = [] }) => {
    const base = (cfg && typeof cfg === 'object') ? cfg : null
    if (!base) return null

    const rename = new Map()
    for (const [from, to] of renamePairs) {
      const f = safeText(from)
      const t = safeText(to)
      if (f && t && !sameName(f, t)) rename.set(f, t)
    }
    const removed = new Set((removedNames || []).map(n => safeText(n)).filter(Boolean))

    let changed = false
    const next = { ...base }

    // allocationsByPerson (keyed by name)
    if (next.allocationsByPerson && typeof next.allocationsByPerson === 'object') {
      const m = { ...(next.allocationsByPerson || {}) }
      for (const [from, to] of rename.entries()) {
        if (m[from] !== undefined) {
          if (m[to] === undefined) m[to] = m[from]
          delete m[from]
          changed = true
        }
      }
      for (const n of removed.values()) {
        if (m[n] !== undefined) {
          delete m[n]
          changed = true
        }
      }
      next.allocationsByPerson = Object.keys(m).length ? m : undefined
    }

    // workingDays.personAdjustmentsByPerson (keyed by name)
    if (next.workingDays && typeof next.workingDays === 'object') {
      const wd = { ...(next.workingDays || {}) }
      const map = { ...(wd.personAdjustmentsByPerson || {}) }
      for (const [from, to] of rename.entries()) {
        if (map[from] !== undefined) {
          if (map[to] === undefined) map[to] = map[from]
          delete map[from]
          changed = true
        }
      }
      for (const n of removed.values()) {
        if (map[n] !== undefined) {
          delete map[n]
          changed = true
        }
      }
      wd.personAdjustmentsByPerson = Object.keys(map).length ? map : undefined
      next.workingDays = Object.keys(wd).length ? wd : undefined
    }

    // assignmentBackfills (fromPerson/toPerson are names)
    if (next.assignmentBackfills && typeof next.assignmentBackfills === 'object') {
      const ab = {}
      for (const [projectId, byRole] of Object.entries(next.assignmentBackfills || {})) {
        const outByRole = {}
        for (const [role, arr] of Object.entries(byRole || {})) {
          const list = (Array.isArray(arr) ? arr : []).map(it => {
            const row = { ...(it || {}) }
            if (rename.has(row.fromPerson)) { row.fromPerson = rename.get(row.fromPerson); changed = true }
            if (rename.has(row.toPerson)) { row.toPerson = rename.get(row.toPerson); changed = true }
            return row
          }).filter(it => {
            const fp = safeText(it?.fromPerson)
            const tp = safeText(it?.toPerson)
            if (removed.has(fp) || removed.has(tp)) { changed = true; return false }
            return true
          })
          if (list.length) outByRole[role] = list
        }
        if (Object.keys(outByRole).length) ab[projectId] = outByRole
      }
      next.assignmentBackfills = Object.keys(ab).length ? ab : undefined
    }

    return changed ? next : base
  }

  const templateWb = useMemo(() => {
    const wb = XLSX.utils.book_new()

    const mandatoryOrder = [
      'id',
      'displayId',
      'rawName',
      'accountName',
      'vibeType',
      'status',
      'startDate',
      'analyticsStartDate',
      'deliveryDate',
      'orbit',
      'networkType',
      'dxLMs',
      'txLMs',
      'totalLMs',
      'assignedCSM',
      'assignedPM',
      'assignedAnalyst1',
      'assignedAnalyst2',
      'analystUtilPct',
    ]

    const orderedFields = mandatoryOrder.filter(f => Object.prototype.hasOwnProperty.call(PROJECT_LIST_COLUMN_MAP || {}, f))

    const plHeaders = orderedFields
      .map(f => (PROJECT_LIST_COLUMN_MAP?.[f]?.[0] || null))
      .filter(Boolean)

    const sampleByField = {
      id: 'EX-123',
      displayId: '1',
      rawName: 'Example Project',
      accountName: 'Example SF Account',
      vibeType: 'Bond',
      status: 'Open',
      startDate: 'Jan-26',
      analyticsStartDate: 'Feb-26',
      deliveryDate: 'Jun-26',
      orbit: 'A',
      networkType: 'Dx',
      dxLMs: 3000,
      txLMs: 2000,
      totalLMs: 5000,
      assignedCSM: 'Example CSM',
      assignedPM: 'Example PM',
      assignedAnalyst1: 'Example Analyst 1',
      assignedAnalyst2: 'Example Analyst 2',
      analystUtilPct: 80,
    }

    const sampleRow = orderedFields.map((field) => {
      const header = PROJECT_LIST_COLUMN_MAP?.[field]?.[0]
      const v = sampleByField[field]
      if (v !== undefined) return v
      // Some fields are mostly “nice to have”; leave empty if we don't have a safe example.
      // But do include the header itself for clarity when auditing templates.
      if (header === 'CS Type (VIBE)') return 'Bond'
      return ''
    })

    const plAoa = [
      plHeaders,
      sampleRow,
    ]
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(plAoa), 'Project List')

    // ── Summary sheet (mandatory columns) ───────────────────────────────
    const plReqHeaders = plHeaders
    const dmReqHeaders = [
      'VIBE Tag',
      'Role',
      'Project Start M0',
      'Project Start M1',
      'Project Mid',
      'Project End M-1',
      'Project End M0',
      'Project End M1',
      'Project End M1+',
      'VIBE (Orbit multiplier)', // Y
      'Orbit tier',              // Z
      'Multiplier',              // AA
    ]

    const summaryAoa = [
      ['SPARK Template — Required inputs'],
      [''],
      ['Required sheets'],
      ['- Project List'],
      ['- Demand Base Matrix'],
      [''],
      ['Project List — mandatory columns (exact header names)'],
      ...plReqHeaders.map(h => [`- ${h}`]),
      [''],
      ['Project List — optional columns (PM phase overrides)'],
      ['- Project Start M0'],
      ['- Project Start M1'],
      ['- Project Mid'],
      ['- Project End M-1'],
      ['- Project End M0'],
      ['- Project End M1'],
      ['- Project End M1+'],
      [''],
      ['Demand Base Matrix — mandatory columns (exact header names)'],
      ...dmReqHeaders.map(h => [`- ${h}`]),
      [''],
      ['Notes'],
      ['- Orbit×VIBE multipliers must be provided in columns Y/Z/AA of Demand Base Matrix.'],
      ['- Project stage columns are NOT required. If you provide them, they act as PM phase-hour overrides; otherwise PM hours are derived from the Demand Base Matrix.'],
      ['- CS&T Cluster is not required for engine insights/calculation, so it is not included in this template.'],
    ]
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryAoa), 'Summary')

    const dmHeaders = [
      'VIBE Tag',
      'Role',
      'Project Start M0',
      'Project Start M1',
      'Project Mid',
      'Project End M-1',
      'Project End M0',
      'Project End M1',
      'Project End M1+',
    ]
    const makeRow = (left) => {
      const row = new Array(27).fill('')
      for (let i = 0; i < left.length; i++) row[i] = left[i]
      return row
    }

    // Phase totals header row (A..I). Orbit multiplier headers appear just above that section.
    const dmAoa = [makeRow(dmHeaders)]

    // Example phase totals (left side) — a few rows
    dmAoa.push(makeRow(['Bond', 'CSM', 10, 12, 18, 8, 6, 4, 2]))

    // PM baseline phase totals (updated defaults)
    dmAoa.push(makeRow(['Bond', 'PM', 10, 10, 10, 50, 28, 8, 8]))
    dmAoa.push(makeRow(['Explore', 'PM', 15, 30, 10, 40, 40, 10, 5]))
    dmAoa.push(makeRow(['Integrate', 'PM', 10, 20, 10, 60, 28, 8, 8]))
    dmAoa.push(makeRow(['Validate', 'PM', 15, 15, 7, 40, 60, 10, 4]))

    dmAoa.push(makeRow(['Bond', 'Analyst 1', 4, 6, 10, 5, 3, 2, 1]))

    // Orbit×VIBE multipliers headers in Y/Z/AA (row 5+ visually, after phase examples)
    const multHeader = makeRow(new Array(9).fill(''))
    multHeader[24] = 'VIBE (Orbit multiplier)'
    multHeader[25] = 'Orbit tier'
    multHeader[26] = 'Multiplier'
    dmAoa.push(multHeader)

    // Orbit×VIBE multipliers in columns Y/Z/AA (index 24/25/26).
    // Provide the full 4×4 grid so CSM calculations have all keys.
    const ORBITS = ['A', 'B', 'C', 'D']
    const VIBES = ['Bond', 'Validate', 'Integrate', 'Explore']
    let multBase = 1.2
    for (const vibe of VIBES) {
      for (const orbit of ORBITS) {
        const row = makeRow(['', '', '', '', '', '', '', '', ''])
        row[24] = vibe
        row[25] = orbit
        row[26] = +(multBase.toFixed(2))
        multBase += 0.05
        dmAoa.push(row)
      }
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(dmAoa), 'Demand Base Matrix')

    return wb
  }, [])

  const downloadTemplate = useCallback(() => {
    try {
      const out = XLSX.write(templateWb, { bookType: 'xlsx', type: 'array' })
      const blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'SPARK_Template.xlsx'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      // If the browser blocks downloads, user can still upload their own file.
      console.error(e)
    }
  }, [templateWb])

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

      {/* Clear plan (enterprise confirmation) */}
      {clearOpen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 520,
          background: 'rgba(0,0,0,0.35)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 24,
        }}
          onMouseDown={(e) => { if (e.target === e.currentTarget) setClearOpen(false) }}
        >
          <div style={{
            background: C.surface,
            borderRadius: 12,
            padding: 22,
            width: 'min(92vw, 560px)',
            boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
            border: `1px solid ${C.border}`,
          }}>
            <div style={{ fontWeight: 800, fontSize: 15, color: C.ink, marginBottom: 6 }}>
              Clear plan
            </div>
            <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.6, marginBottom: 14 }}>
              {hasUploadedWorkbook
                ? <>Choose what to remove from your <strong>uploaded workbook</strong> and your in‑session edits.</>
                : (isBundledDefault
                  ? <>Reset your edits back to the <strong>SPARK default plan</strong>. The default plan is never deleted.</>
                  : <>Choose what to remove from your <strong>saved plan</strong>. The SPARK default plan is never deleted.</>
                )
              }
            </div>

            <div style={{ display: 'grid', gap: 10, marginBottom: 16 }}>
              {(!hasUploadedWorkbook && isBundledDefault) ? (
                <label style={radioRow(true)}>
                  <input type="radio" name="spark_clear_mode" checked readOnly />
                  <div>
                    <div style={{ fontWeight: 850, color: C.ink }}>Clear all changes (Plan + Advanced planning settings)</div>
                    <div style={{ fontSize: 12, color: C.faint, lineHeight: 1.5 }}>
                      Resets roster/projects edits and Advanced planning settings back to the bundled default.
                    </div>
                  </div>
                </label>
              ) : (
                <>
                  {hasUploadedWorkbook && (
                    <label style={radioRow(clearMode === 'remove_workbook')}>
                      <input type="radio" name="spark_clear_mode" checked={clearMode === 'remove_workbook'} onChange={() => setClearMode('remove_workbook')} />
                      <div>
                        <div style={{ fontWeight: 850, color: C.ink }}>Remove the uploaded workbook only</div>
                        <div style={{ fontSize: 12, color: C.faint, lineHeight: 1.5 }}>
                          Removes the uploaded Excel workbook and discards its in‑session edits. SPARK will fall back to the saved/default plan.
                        </div>
                      </div>
                    </label>
                  )}

                  <label style={radioRow(clearMode === 'reset_changes')}>
                    <input type="radio" name="spark_clear_mode" checked={clearMode === 'reset_changes'} onChange={() => setClearMode('reset_changes')} />
                    <div>
                      <div style={{ fontWeight: 850, color: C.ink }}>
                        Remove only user‑applied changes (Plan + Advanced planning settings)
                      </div>
                      <div style={{ fontSize: 12, color: C.faint, lineHeight: 1.5 }}>
                        {hasUploadedWorkbook
                          ? 'Keeps the uploaded workbook, clears your in‑session edits (projects/roster/settings).'
                          : 'Resets project/roster edits and Advanced planning settings back to the uploaded workbook.'
                        }
                      </div>
                    </div>
                  </label>

                  <label style={radioRow(clearMode === 'remove_both')}>
                    <input type="radio" name="spark_clear_mode" checked={clearMode === 'remove_both'} onChange={() => setClearMode('remove_both')} />
                    <div>
                      <div style={{ fontWeight: 850, color: C.ink }}>Remove both workbook and all applied changes</div>
                      <div style={{ fontSize: 12, color: C.faint, lineHeight: 1.5 }}>
                        Resets everything back to the bundled SPARK default plan.
                      </div>
                    </div>
                  </label>
                </>
              )}
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={async () => {
                  setClearOpen(false)
                  // Flow A: no uploaded workbook (default plan)
                  if (!hasUploadedWorkbook && isBundledDefault) {
                    return await onResetToBundledDefaultPlan?.({ note: 'Clear Plan — reset changes to SPARK default plan' })
                  }

                  // Flow B: uploaded workbook active (override)
                  if (hasUploadedWorkbook) {
                    if (clearMode === 'remove_workbook') return await onRemoveUploadedWorkbook?.()
                    if (clearMode === 'reset_changes') return await onClearUploadedPlanEdits?.()
                    if (clearMode === 'remove_both') {
                      await onRemoveUploadedWorkbook?.()
                      return await onClearUploadedPlanEdits?.()
                    }
                    return
                  }

                  // Flow C: saved (non-default) plan active
                  if (clearMode === 'remove_workbook') return await onResetToBundledDefaultPlan?.({ note: 'Clear Plan — removed uploaded plan workbook' })
                  if (clearMode === 'reset_changes') return await onResetBaseToSourceWorkbook?.({ note: 'Clear Plan — reset changes to uploaded workbook' })
                  if (clearMode === 'remove_both') return await onResetToBundledDefaultPlan?.({ note: 'Clear Plan — removed workbook and all changes (back to default)' })
                }}
                style={primaryBtn}
              >
                Confirm
              </button>
              <button onClick={() => setClearOpen(false)} style={ghostBtn}>Cancel</button>
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
                {typeof onGoToOverview === 'function' && (
                  <button
                    onClick={onGoToOverview}
                    style={{ ...ghostBtn, background: 'var(--accent)', color: 'white', borderColor: 'transparent' }}
                  >
                    Go to Overview →
                  </button>
                )}
                {activeIngest && (
                  <button onClick={() => setManageOpen(true)} style={ghostBtn}>
                    Edit projects
                  </button>
                )}
                {activeIngest && (
                  <button onClick={() => setRosterOpen(true)} style={ghostBtn}>
                    Manage roster
                  </button>
                )}
                {hasPlan && typeof onGoToCapacitySetup === 'function' && (
                  <button onClick={onGoToCapacitySetup} style={advancedBtn}>
                    Advanced planning
                  </button>
                )}
                {hasPlan && (
                  <button
                    onClick={() => setClearOpen(true)}
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

      {!!planIssues?.issues?.length && (
        <Card style={{ marginBottom: 16, borderColor: 'rgba(220,38,38,0.25)' }}>
          <CardHeader title="We couldn’t use that Excel file">
            <Pill type="red">Fix required</Pill>
          </CardHeader>
          <CardBody>
            <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.6, marginBottom: 12 }}>
              Your workbook must include <strong>Project List</strong> and <strong>Demand Base Matrix</strong> sheets with the expected columns.
              Download the template, copy your data into it, and re-upload.
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
              <button onClick={downloadTemplate} style={{ ...ghostBtn, background: 'var(--accent)', color: 'white', borderColor: 'transparent' }}>
                Download template
              </button>
              {typeof onDismissPlanIssues === 'function' && (
                <button onClick={onDismissPlanIssues} style={ghostBtn}>
                  Dismiss
                </button>
              )}
            </div>
            <div style={{ fontSize: 12.5, color: C.ink }}>
              <div style={{ fontWeight: 800, marginBottom: 6 }}>Issues found</div>
              <ul style={{ margin: 0, paddingLeft: 18, color: C.muted }}>
                {planIssues.issues.map((it, idx) => (
                  <li key={idx} style={{ marginBottom: 4 }}>
                    {it.message}
                    {it.sheet ? <span style={{ color: C.faint }}> (Sheet: {it.sheet})</span> : null}
                  </li>
                ))}
              </ul>
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

      <Card style={{ marginBottom: 16 }}>
        <CardHeader title="Updating the SPARK default plan" />
        <CardBody>
          <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.7 }}>
            To update <strong>your</strong> plan, either upload a new workbook (and click <strong>Save as plan</strong>) or use <strong>Edit projects</strong> / <strong>Manage roster</strong> on this page.
            <div style={{ marginTop: 8 }}>
              If you need to change the <strong>global bundled default workbook</strong> (what first‑time users see), that’s an admin action — contact the <strong>AiDash PMO Team</strong>.
            </div>
          </div>
        </CardBody>
      </Card>

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
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); downloadTemplate() }}
            style={{
              ...ghostBtn,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              marginBottom: 10,
            }}
            title="Download a workbook with required sheets and headers"
          >
            Download template
          </button>
        )}
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
        projects={projects}
        roster={roster}
        baseLabel={planName}
        onSaveProjects={async ({ projects, editorName, note }) => {
          if (datasetMode === 'base') {
            await onUpdateBaseProjects?.({ projects, editorName, note })
          } else {
            await onUpdateOverrideProjects?.({ projects, editorName, note })
          }
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
          for (const p of (projects || [])) {
            add('CSM', p.assignedCSM)
            add('PM', p.assignedPM)
            add('SE', p.assignedSE)
            add('Analyst 1', p.assignedAnalyst1)
            add('Analyst 2', p.assignedAnalyst2)
          }
          return [...byId.values()].sort((a, b) => (a.role + a.name).localeCompare(b.role + b.name))
        }}
        onSaveRoster={async ({ roster, editorName, note }) => {
          const prevRoster = Array.isArray(activeIngest?.roster) ? activeIngest.roster : []
          const prevById = new Map((prevRoster || []).map((p) => [String(p?.id || ''), p]).filter(([id]) => id))
          const nextById = new Map((roster || []).map((p) => [String(p?.id || ''), p]).filter(([id]) => id))

          const renamePairs = []
          const removedNames = []

          for (const [id, prev] of prevById.entries()) {
            const next = nextById.get(id)
            if (!next) {
              if (safeText(prev?.name)) removedNames.push(prev.name)
              continue
            }
            const pn = safeText(prev?.name)
            const nn = safeText(next?.name)
            if (pn && nn && !sameName(pn, nn)) renamePairs.push([pn, nn])
          }

          const prevProjects = Array.isArray(activeIngest?.projects) ? activeIngest.projects : []
          const { projects: nextProjects, changed: projectsChanged } =
            applyPersonRenameRemoveToProjects(prevProjects, { renamePairs, removedNames })

          if (projectsChanged) {
            const renameNote = renamePairs.length ? `Renamed: ${renamePairs.map(([f, t]) => `${f} → ${t}`).join(', ')}` : ''
            const removeNote = removedNames.length ? `Removed: ${removedNames.join(', ')}` : ''
            const extra = [renameNote, removeNote].filter(Boolean).join(' · ')
            const payload = {
              projects: nextProjects,
              editorName,
              note: extra ? `Roster change — updated project assignments. ${extra}` : 'Roster change — updated project assignments.',
            }
            if (datasetMode === 'base') await onUpdateBaseProjects?.(payload)
            else await onUpdateOverrideProjects?.(payload)
          }

          // Migrate capacity config name-keyed fields so allocations/working-days/backfills remain connected.
          if (capacityConfig && (renamePairs.length || removedNames.length)) {
            const nextCfg = migrateCapacityConfigForRosterChanges(capacityConfig, { renamePairs, removedNames })
            if (nextCfg !== capacityConfig) {
              const renameNote = renamePairs.length ? `Renamed: ${renamePairs.map(([f, t]) => `${f} → ${t}`).join(', ')}` : ''
              const removeNote = removedNames.length ? `Removed: ${removedNames.join(', ')}` : ''
              const extra = [renameNote, removeNote].filter(Boolean).join(' · ')
              await onUpdateCapacityConfig?.({
                capacityConfig: nextCfg,
                note: extra ? `Roster change — migrated capacity settings. ${extra}` : 'Roster change — migrated capacity settings.',
              })
            }
          }

          if (datasetMode === 'base') {
            await onUpdateBaseRoster?.({ roster, editorName, note })
          } else {
            await onUpdateOverrideRoster?.({ roster, editorName, note })
          }
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

const advancedBtn = {
  ...ghostBtn,
  background: 'linear-gradient(90deg, rgba(124,58,237,0.12), rgba(37,99,235,0.10))',
  borderColor: 'rgba(124,58,237,0.35)',
  color: '#312e81',
  fontWeight: 800,
}

function radioRow(active) {
  return {
    display: 'grid',
    gridTemplateColumns: '18px 1fr',
    gap: 10,
    alignItems: 'start',
    padding: 12,
    borderRadius: 10,
    border: `1px solid ${active ? 'rgba(124,58,237,0.35)' : 'var(--border)'}`,
    background: active ? 'rgba(124,58,237,0.06)' : 'white',
    cursor: 'pointer',
  }
}

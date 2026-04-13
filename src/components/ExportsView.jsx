import React, { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { SectionHeader, Card, CardHeader, CardBody, Pill, ActionButton, Mono } from './ui'
import { ingestExcelFile } from '../engine/ingest.js'
import { runCalculations } from '../engine/calculate.js'
import { applyScenario, loadScenarios } from '../engine/scenarioEngine.js'

const CM_HEADERS = [
  'Project Name',
  'Role',
  'People',
  'Account Name',
  'VIBE Tag',
  'Start Date',
  'Delivery Date',
  'Analytics Start Date',
  'LMs',
  'LM Multiplier',
  'Usage%',
  'Month',
  'Case 1',
  'Case 2',
  'Case 3',
  'Case 4',
  'Calculated Utilized Hours',
  'Manual Hour Input',
  'Final Utilized Hour',
  'Orbit',
  'Delivery Date', // NOTE: appears twice in the source workbook (month-level + exact date)
]

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function fmtMonth(d) {
  if (!d || !(d instanceof Date) || isNaN(d.getTime())) return ''
  const mm = MONTH_ABBR[d.getMonth()] || ''
  const yy = String(d.getFullYear()).slice(-2)
  return mm && yy ? `${mm}-${yy}` : ''
}

function fmtExact(d) {
  if (!d || !(d instanceof Date) || isNaN(d.getTime())) return ''
  // deliveryDateExact is stored in UTC by ingest; use UTC getters.
  const m = d.getUTCMonth() + 1
  const day = d.getUTCDate()
  const yy = String(d.getUTCFullYear()).slice(-2)
  return `${m}/${day}/${yy}`
}

function safeFilePart(s) {
  return String(s || '')
    .trim()
    .replace(/[^\w\s.-]/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 80)
}

async function readWorkbookFromFile(file) {
  const buf = await file.arrayBuffer()
  return XLSX.read(buf, { type: 'array', cellDates: true })
}

async function readCapacityModelMeta(file) {
  const wb = await readWorkbookFromFile(file)
  const cm = wb?.Sheets?.['Capacity Model']
  if (!cm) {
    return { hasSheet: false, roles: null, aoa: null }
  }
  const aoa = XLSX.utils.sheet_to_json(cm, { header: 1, raw: false, defval: '' })
  const roles = new Set(
    (aoa || [])
      .slice(1)
      .map(r => String(r?.[1] || '').trim()) // col B = Role
      .filter(Boolean)
  )
  return { hasSheet: true, roles: roles.size ? roles : null, aoa }
}

function downloadWorkbook(wb, filename) {
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  const blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function buildCapacityModelAoA(ingest, calc, { roleFilter = null } = {}) {
  const planningYear = calc?.meta?.planningYear || 2026
  const projects = ingest?.projects || []
  const projById = new Map(projects.map(p => [p.id, p]))

  const assignmentsRaw = Array.isArray(calc?.assignments) ? calc.assignments : []
  const assignments = assignmentsRaw
    .filter(a => !roleFilter || roleFilter.has(a.role))
    .slice()
    .sort((a, b) => {
      const pn = String(a.projectName || '').localeCompare(String(b.projectName || ''))
      if (pn !== 0) return pn
      const rn = String(a.role || '').localeCompare(String(b.role || ''))
      if (rn !== 0) return rn
      return (a.monthIndex || 0) - (b.monthIndex || 0)
    })

  const rows = assignments.map(a => {
    const p = projById.get(a.projectId)
    const month = new Date(planningYear, a.monthIndex || 0, 1)
    const usage = a?.debug?.usagePct
    const usagePct = Number.isFinite(+usage) ? +usage : ''

    return [
      a.projectName || '',
      a.role || '',
      a.person || '',
      a.accountName || p?.accountName || '',
      a.vibeType || p?.vibeType || '',
      fmtMonth(p?.startDate),
      fmtMonth(p?.deliveryDate),
      fmtMonth(p?.analyticsStartDate),
      Number.isFinite(+p?.totalLMs) ? +p.totalLMs : '',
      Number.isFinite(+p?.lmMultiplier) ? +p.lmMultiplier : (Number.isFinite(+a?.lmMultiplier) ? +a.lmMultiplier : ''),
      usagePct,
      fmtMonth(month),
      a.case1 || '',
      a.case2 || '',
      a.case3 || '',
      a.case4 || '',
      Number.isFinite(+a?.calculatedHours) ? Math.round(+a.calculatedHours) : 0,
      '', // Manual Hour Input (engine never sources from Excel)
      Number.isFinite(+a?.finalHours) ? Math.round(+a.finalHours) : 0,
      a.orbit || p?.orbit || '',
      fmtExact(p?.deliveryDateExact || p?.deliveryDate),
    ]
  })

  return [CM_HEADERS, ...rows]
}

// ── Project List export ────────────────────────────────────────────────────
const PL_HEADERS = [
  'Project Name', 'Account Name', 'VIBE Type', 'Status',
  'Start Date', 'Delivery Date', 'Analytics Start Date',
  'Total LMs', 'LM Multiplier', 'Orbit', 'Assigned PM', 'Assigned CSM',
]

function fmtDate(d) {
  if (!d || !(d instanceof Date) || isNaN(d.getTime())) return ''
  const m = String(d.getUTCMonth() + 1).padStart(2,'0')
  const day = String(d.getUTCDate()).padStart(2,'0')
  return `${d.getUTCFullYear()}-${m}-${day}`
}

function buildProjectListAoA(ingest) {
  const projects = ingest?.projects || []
  const rows = projects.map(p => [
    p.name || '',
    p.accountName || '',
    p.vibeType || '',
    p.status || '',
    fmtDate(p.startDate),
    fmtDate(p.deliveryDate),
    fmtDate(p.analyticsStartDate),
    Number.isFinite(+p.totalLMs) ? +p.totalLMs : '',
    Number.isFinite(+p.lmMultiplier) ? +p.lmMultiplier : '',
    p.orbit || '',
    p.assignedPM || '',
    p.assignedCSM || '',
  ])
  return [PL_HEADERS, ...rows]
}

const DM_HEADERS = ['Role', 'VIBE Type', 'Phase', 'Base Hours']

function buildDemandMatrixAoA(ingest) {
  const rows = (ingest?.demandMatrix || []).map(r => [
    r.role || '', r.vibeType || '', r.phase || '',
    Number.isFinite(+r.baseHours) ? +r.baseHours : '',
  ])
  return [DM_HEADERS, ...rows]
}

export default function ExportsView({ data, engineInput, workbookFile }) {
  const hasWorkbook = workbookFile instanceof File
  const hasEngineDataset = !!engineInput

  const [scenarios, setScenarios] = useState(() => loadScenarios())
  const [selectedScenarioId, setSelectedScenarioId] = useState('')

  const [prepLoading, setPrepLoading] = useState(false)
  const [prepError, setPrepError] = useState(null)
  const [baselineIngest, setBaselineIngest] = useState(null)
  const [cmMetaLoading, setCmMetaLoading] = useState(false)
  const [cmMetaError, setCmMetaError] = useState(null)
  // undefined = not loaded, null = loaded but no role filter (sheet missing or empty), Set = loaded roles
  const [cmRoleFilter, setCmRoleFilter] = useState(undefined)

  const fileLabel = useMemo(() => {
    if (engineInput?.kind === 'file' && engineInput.file) return safeFilePart(engineInput.file.name || 'uploaded.xlsx')
    if (engineInput?.kind === 'ingest' && engineInput.ingest) return safeFilePart(engineInput.ingest?.meta?.fileName || 'Base dataset')
    return ''
  }, [engineInput])

  const activeScenario = useMemo(
    () => scenarios.find(s => s.id === selectedScenarioId) || null,
    [scenarios, selectedScenarioId]
  )

  useEffect(() => {
    let alive = true
    setPrepError(null)
    setBaselineIngest(null)
    setCmMetaError(null)
    setCmRoleFilter(undefined)
    if (!engineInput) return

    setPrepLoading(true)
    if (engineInput.kind === 'ingest' && engineInput.ingest) {
      setBaselineIngest(engineInput.ingest)
      setPrepLoading(false)
    } else if (engineInput.kind === 'file' && engineInput.file) {
      ingestExcelFile(engineInput.file)
        .then((ingest) => {
          if (!alive) return
          setBaselineIngest(ingest)
          setPrepLoading(false)
        })
        .catch((e) => {
          if (!alive) return
          setPrepError(e?.message || 'Failed to prepare exports (engine ingest).')
          setPrepLoading(false)
        })
    } else {
      setPrepError('No active dataset available. Choose Base dataset or upload an override.')
      setPrepLoading(false)
    }

    return () => { alive = false }
  }, [engineInput])

  // Background load of Capacity Model role coverage when a workbook is present.
  // This is optional and should never block engine-generated downloads.
  useEffect(() => {
    let alive = true
    if (!hasWorkbook) return () => { alive = false }
    if (cmRoleFilter !== undefined) return () => { alive = false }
    if (cmMetaLoading) return () => { alive = false }

    setCmMetaLoading(true)
    setCmMetaError(null)
    readCapacityModelMeta(workbookFile)
      .then((meta) => {
        if (!alive) return
        setCmRoleFilter(meta.roles || null)
        setCmMetaLoading(false)
      })
      .catch((e) => {
        if (!alive) return
        setCmMetaError(e?.message || 'Failed to read Capacity Model sheet from workbook.')
        setCmRoleFilter(null)
        setCmMetaLoading(false)
      })

    return () => { alive = false }
  }, [hasWorkbook, workbookFile, cmRoleFilter, cmMetaLoading])

  return (
    <div>
      <SectionHeader
        title="Exports"
        subtitle="Export product views for stakeholder review and planning workflows"
      />

      <Card style={{ marginBottom: 16 }}>
        <CardHeader
          title="Export Center"
          tag={hasEngineDataset ? 'Engine dataset connected' : 'No dataset'}
        >
          <Pill type={hasEngineDataset ? 'green' : 'amber'}>{hasEngineDataset ? 'Ready' : 'Select dataset'}</Pill>
        </CardHeader>
        <CardBody>
          <div style={{ color: 'var(--ink-muted)', fontSize: 12.5, lineHeight: 1.6 }}>
            You can export the <strong>Capacity Model</strong> worksheet as either:
            {' '}the <strong>original</strong> sheet from an uploaded Excel file, or an <strong>engine-generated</strong> sheet (baseline or scenario).
            All engine-generated exports are computed using the SPARK Engine (no Excel formulas).
          </div>
          {fileLabel && (
            <div style={{ marginTop: 10, fontSize: 12, color: 'var(--ink-muted)' }}>
              Active dataset: <Mono>{fileLabel}</Mono>
            </div>
          )}
          {prepError && (
            <div style={{ marginTop: 10, fontSize: 12, color: 'var(--red)' }}>
              {prepError}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Original-sheet export removed: users already have the workbook.
          Keep workbook parsing only for optional role-coverage alignment. */}

      <Card style={{ marginBottom: 16 }}>
        <CardHeader title="Capacity Model (SPARK Engine export)" tag="Generated sheet">
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <ActionButton
              title={!hasEngineDataset ? 'Select Base dataset or upload an override' : prepLoading ? 'Preparing…' : 'Generate baseline Capacity Model from SPARK Engine'}
              onClick={() => {
                if (!hasEngineDataset || !baselineIngest || prepLoading || cmMetaLoading) return
                try {
                  setPrepError(null)
                  // Avoid async/await here: browser download must stay within a user gesture.
                  const rf = hasWorkbook ? (cmRoleFilter === undefined ? null : cmRoleFilter) : null
                  const planningYear = baselineIngest?.meta?.planningYear || data?.calc?.meta?.planningYear || 2026
                  const calc = runCalculations(
                    baselineIngest.projects,
                    baselineIngest.demandMatrix,
                    baselineIngest.orbitMultipliers,
                    planningYear,
                    { roster: baselineIngest?.roster || [] }
                  )
                  const aoa = buildCapacityModelAoA(baselineIngest, calc, { roleFilter: rf })
                  const ws = XLSX.utils.aoa_to_sheet(aoa)
                  const wbOut = XLSX.utils.book_new()
                  XLSX.utils.book_append_sheet(wbOut, ws, 'Capacity Model')
                  downloadWorkbook(wbOut, `Capacity Model (Engine Baseline) - ${fileLabel || 'uploaded'}.xlsx`)
                } catch (e) {
                  setPrepError(e?.message || 'Failed to export baseline (engine).')
                }
              }}
            >
              Export baseline (engine)
            </ActionButton>

            <ActionButton
              title={!hasEngineDataset ? 'Select Base dataset or upload an override' : !activeScenario ? 'Pick a scenario' : 'Generate Capacity Model for scenario from SPARK Engine'}
              onClick={() => {
                if (!hasEngineDataset || !baselineIngest || !activeScenario || prepLoading || cmMetaLoading) return
                try {
                  setPrepError(null)
                  const rf = hasWorkbook ? (cmRoleFilter === undefined ? null : cmRoleFilter) : null
                  const planningYear = baselineIngest?.meta?.planningYear || data?.calc?.meta?.planningYear || 2026
                  const modified = applyScenario(baselineIngest, activeScenario, { planningYear })
                  const calc = runCalculations(
                    modified.projects,
                    modified.demandMatrix,
                    modified.orbitMultipliers,
                    planningYear,
                    {
                      roster: baselineIngest?.roster || [],
                      capacityConfig: modified.scenarioCapacityConfig || null,
                    }
                  )
                  const aoa = buildCapacityModelAoA({ ...baselineIngest, projects: modified.projects }, calc, { roleFilter: rf })
                  const ws = XLSX.utils.aoa_to_sheet(aoa)
                  const wbOut = XLSX.utils.book_new()
                  XLSX.utils.book_append_sheet(wbOut, ws, 'Capacity Model')
                  const scName = safeFilePart(activeScenario.name || activeScenario.id)
                  downloadWorkbook(wbOut, `Capacity Model (Engine Scenario - ${scName}) - ${fileLabel || 'uploaded'}.xlsx`)
                } catch (e) {
                  setPrepError(e?.message || 'Failed to export scenario (engine).')
                }
              }}
            >
              Export selected scenario (engine)
            </ActionButton>
          </div>
        </CardHeader>
        <CardBody>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10 }}>
            <div style={{ fontSize: 12.5, color: 'var(--ink-muted)', lineHeight: 1.6 }}>
              Generates a fresh <Mono>Capacity Model</Mono> sheet from SPARK Engine outputs (Calculated/Final utilized hours are engine-computed).
              {(cmRoleFilter && cmRoleFilter.size) ? <> Role coverage is aligned to the uploaded workbook’s Capacity Model roles.</> : null}
            </div>

            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <label style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
                Scenario:
              </label>
              <select
                value={selectedScenarioId}
                onChange={(e) => setSelectedScenarioId(e.target.value)}
                style={{
                  padding: '8px 10px',
                  borderRadius: 10,
                  border: '1px solid var(--border)',
                  background: 'var(--surface-0)',
                  fontSize: 12.5,
                  minWidth: 280,
                }}
              >
                <option value="">Select a saved scenario…</option>
                {scenarios.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name || '(unnamed)'} ({s.status})
                  </option>
                ))}
              </select>

              <ActionButton
                title="Reload saved scenarios"
                onClick={() => setScenarios(loadScenarios())}
              >
                Refresh scenarios
              </ActionButton>
            </div>

            {prepLoading && (
              <div style={{ fontSize: 12.5, color: 'var(--ink-muted)' }}>
                Preparing workbook + engine ingest…
              </div>
            )}
            {cmMetaLoading && (
              <div style={{ fontSize: 12.5, color: 'var(--ink-muted)' }}>
                Reading Capacity Model metadata…
              </div>
            )}
            {cmMetaError && (
              <div style={{ fontSize: 12.5, color: 'var(--red)' }}>
                {cmMetaError}
              </div>
            )}
          </div>
        </CardBody>
      </Card>

      {/* ── Project List + Demand Matrix (round-trip export) ────────────── */}
      <Card style={{ marginBottom: 16 }}>
        <CardHeader title="Project List &amp; Demand Matrix" tag="Plan download">
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <ActionButton
              title={!hasEngineDataset ? 'Load a plan first' : prepLoading ? 'Preparing…' : 'Download Project List as Excel (for offline editing)'}
              onClick={async () => {
                if (!hasEngineDataset || !baselineIngest || prepLoading) return
                const aoa = buildProjectListAoA(baselineIngest)
                const ws  = XLSX.utils.aoa_to_sheet(aoa)
                const wb  = XLSX.utils.book_new()
                XLSX.utils.book_append_sheet(wb, ws, 'Project List')
                downloadWorkbook(wb, `SPARK_Project List - ${fileLabel || 'current'}.xlsx`)
              }}
            >
              Export Project List
            </ActionButton>
            <ActionButton
              title={!hasEngineDataset ? 'Load a plan first' : 'Download Demand Base Matrix as Excel'}
              onClick={async () => {
                if (!hasEngineDataset || !baselineIngest || prepLoading) return
                const aoa = buildDemandMatrixAoA(baselineIngest)
                const ws  = XLSX.utils.aoa_to_sheet(aoa)
                const wb  = XLSX.utils.book_new()
                XLSX.utils.book_append_sheet(wb, ws, 'Demand Base Matrix')
                downloadWorkbook(wb, `SPARK_Demand Base Matrix - ${fileLabel || 'current'}.xlsx`)
              }}
            >
              Export Demand Matrix
            </ActionButton>
          </div>
        </CardHeader>
        <CardBody>
          <div style={{ fontSize: 12.5, color: 'var(--ink-muted)', lineHeight: 1.65 }}>
            Download the current plan's <Mono>Project List</Mono> or <Mono>Demand Base Matrix</Mono> as Excel files.
            Edit them offline, then re-upload to SPARK to refresh the plan — this is the recommended round-trip for bulk project changes.
          </div>
          {!hasEngineDataset && (
            <div style={{ marginTop: 10, fontSize: 12, color: 'var(--ink-muted)' }}>
              Load a plan (or upload a file) to enable plan downloads.
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  )
}


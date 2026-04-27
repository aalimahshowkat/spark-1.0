import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Card, CardHeader, CardBody, ActionButton, Pill, SectionHeader, Mono } from './ui'
import { useEngineInsightsData } from './useEngineInsightsData'
import NumericField from './NumericField'
import CapacityAssumptionsModal from './CapacityAssumptionsModal'
import { computePersonWorkingDaysByMonth } from '../engine/workingDays.js'
import { LM_BUCKET_MULTIPLIERS, VIBE_TYPES, ORBIT_VIBE_MULTIPLIERS } from '../engine/schema.js'

const MODELED_ROLES = ['CSM', 'PM', 'Analyst 1']
const DEFAULT_HALF_TIME_NAME = 'Aalimah Showkat'
const UNALLOCATED_KEY = 'Unallocated'
const WD_KINDS = [
  { id: 'pto',          label: 'PTO (remove days)' },
  { id: 'non_project',  label: 'Non-project work (remove days)' },
  { id: 'weekend_work', label: 'Weekend work (add days)' },
]

function uid(prefix = 'wd') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

function isoToLabel(iso) {
  const s = safeText(iso)
  if (!s) return ''
  return s
}

function isoFromUtcDate(d) {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function monthStartIso(year, monthIndex) {
  const y = Number(year)
  const mi = Number(monthIndex)
  if (!Number.isFinite(y) || !Number.isFinite(mi)) return ''
  return isoFromUtcDate(new Date(Date.UTC(y, mi, 1)))
}

function monthEndIso(year, monthIndex) {
  const y = Number(year)
  const mi = Number(monthIndex)
  if (!Number.isFinite(y) || !Number.isFinite(mi)) return ''
  return isoFromUtcDate(new Date(Date.UTC(y, mi + 1, 0)))
}

function normWorkingDaysConfig(capacityConfig) {
  const wd = capacityConfig?.workingDays
  if (!wd || typeof wd !== 'object') return { orgHolidays: [], roleCalendarsByRole: {}, personAdjustmentsByPerson: {} }
  return {
    orgHolidays: Array.isArray(wd.orgHolidays) ? wd.orgHolidays : [],
    roleCalendarsByRole: (wd.roleCalendarsByRole && typeof wd.roleCalendarsByRole === 'object') ? wd.roleCalendarsByRole : {},
    personAdjustmentsByPerson: (wd.personAdjustmentsByPerson && typeof wd.personAdjustmentsByPerson === 'object') ? wd.personAdjustmentsByPerson : {},
  }
}

function buildNextCapacityConfigWithWorkingDays(prev, wdNext) {
  const next = { ...(prev || {}) }
  const compact = (wd) => {
    const out = {
      orgHolidays: Array.isArray(wd?.orgHolidays) ? wd.orgHolidays.filter(Boolean) : [],
      roleCalendarsByRole: {},
      personAdjustmentsByPerson: {},
    }
    const rc = wd?.roleCalendarsByRole || {}
    if (rc && typeof rc === 'object') {
      for (const [k, v] of Object.entries(rc)) {
        const hol = Array.isArray(v?.holidays) ? v.holidays.filter(Boolean) : []
        if (hol.length) out.roleCalendarsByRole[k] = { ...(v || {}), holidays: hol }
      }
    }
    const pc = wd?.personAdjustmentsByPerson || {}
    if (pc && typeof pc === 'object') {
      for (const [name, arr] of Object.entries(pc)) {
        const list = Array.isArray(arr) ? arr.filter(Boolean) : []
        if (list.length) out.personAdjustmentsByPerson[name] = list
      }
    }
    return out
  }

  const wdClean = compact(wdNext || {})
  const has =
    (wdClean?.orgHolidays?.length || 0) > 0 ||
    Object.keys(wdClean?.roleCalendarsByRole || {}).length > 0 ||
    Object.keys(wdClean?.personAdjustmentsByPerson || {}).length > 0
  if (!has) {
    delete next.workingDays
    return Object.keys(next).length ? next : null
  }
  next.workingDays = wdClean
  return next
}

function normAssignmentBackfills(capacityConfig) {
  const raw = capacityConfig?.assignmentBackfills
  if (!raw || typeof raw !== 'object') return {}
  const out = {}
  for (const [projectId, byRole] of Object.entries(raw || {})) {
    if (!projectId || !byRole || typeof byRole !== 'object') continue
    const nextByRole = {}
    for (const [role, arr] of Object.entries(byRole || {})) {
      const list = Array.isArray(arr) ? arr.filter(Boolean) : []
      if (list.length) nextByRole[role] = list
    }
    if (Object.keys(nextByRole).length) out[projectId] = nextByRole
  }
  return out
}

function buildNextCapacityConfigWithBackfills(prev, backfillsNext) {
  const next = { ...(prev || {}) }
  const cleaned = (() => {
    const out = {}
    for (const [projectId, byRole] of Object.entries(backfillsNext || {})) {
      if (!projectId || !byRole || typeof byRole !== 'object') continue
      const nextByRole = {}
      for (const [role, arr] of Object.entries(byRole || {})) {
        const list = Array.isArray(arr) ? arr.filter(Boolean) : []
        if (list.length) nextByRole[role] = list
      }
      if (Object.keys(nextByRole).length) out[projectId] = nextByRole
    }
    return out
  })()

  if (!cleaned || Object.keys(cleaned).length === 0) {
    delete next.assignmentBackfills
    return Object.keys(next).length ? next : null
  }
  next.assignmentBackfills = cleaned
  return next
}

function safeText(s) {
  return String(s || '').trim()
}

function isDefaultHalfTime(name) {
  const n = safeText(name).toLowerCase()
  return n === DEFAULT_HALF_TIME_NAME.toLowerCase()
}

function ExpandableCard({ title, tag, defaultOpen = true, accentBorder, children }) {
  const [open, setOpen] = useState(!!defaultOpen)
  return (
    <Card style={accentBorder ? { borderColor: accentBorder } : null}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          padding: '13px 18px',
          borderBottom: open ? '1px solid var(--border)' : 'none',
          background: 'linear-gradient(90deg, rgba(124,58,237,0.10), rgba(37,99,235,0.06))',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          userSelect: 'none',
          gap: 10,
          flexWrap: 'wrap',
        }}
        title={open ? 'Collapse' : 'Expand'}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <span style={{ fontFamily: 'var(--font-sans)', fontWeight: 750, fontSize: 13.5, color: 'var(--ink)', letterSpacing: '-0.01em' }}>
            {title}
          </span>
          {tag ? (
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              padding: '2px 7px',
              borderRadius: 4,
              background: 'rgba(255,255,255,0.75)',
              color: '#312e81',
              fontWeight: 600,
              border: '1px solid var(--border)',
              whiteSpace: 'nowrap',
            }}>
              {tag}
            </span>
          ) : null}
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-muted)' }}>
          {open ? '▾' : '▸'}
        </div>
      </div>
      {open ? <CardBody>{children}</CardBody> : null}
    </Card>
  )
}

function usePersistedBool(key, defaultValue) {
  const [v, setV] = useState(() => {
    try {
      const raw = localStorage.getItem(key)
      if (raw === null) return !!defaultValue
      return raw === '1'
    } catch {
      return !!defaultValue
    }
  })
  useEffect(() => {
    try { localStorage.setItem(key, v ? '1' : '0') } catch { /* ignore */ }
  }, [key, v])
  return [v, setV]
}

function PmTaskMultipliersEditor({ baselineTasks = [], value, onChange }) {
  const PM_PHASES = useMemo(() => ([
    'Project Start M0',
    'Project Start M1',
    'Project Mid',
    'Project End M-1',
    'Project End M0',
    'Project End M1',
    'Project End M1+',
  ]), [])

  const pmRows = useMemo(() => {
    return (Array.isArray(baselineTasks) ? baselineTasks : [])
      .filter(r => String(r?.role || '').trim().toUpperCase() === 'PM')
      .map(r => ({
        stage: String(r?.stage || '').trim(),       // customer journey stage
        taskStage: String(r?.taskStage || '').trim(),
        phaseHours: r?.phaseHours || {},
      }))
      .filter(r => r.stage && r.taskStage)
  }, [baselineTasks])

  const stages = useMemo(() => {
    const set = new Set(pmRows.map(r => r.stage))
    return ['All', ...Array.from(set).sort((a, b) => a.localeCompare(b))]
  }, [pmRows])

  const [stageFilter, setStageFilter] = useState('All')
  const [taskFilter, setTaskFilter] = useState('All')

  const taskStages = useMemo(() => {
    const filtered = stageFilter === 'All' ? pmRows : pmRows.filter(r => r.stage === stageFilter)
    const set = new Set(filtered.map(r => r.taskStage))
    return ['All', ...Array.from(set).sort((a, b) => a.localeCompare(b))]
  }, [pmRows, stageFilter])

  useEffect(() => {
    if (!taskStages.includes(taskFilter)) setTaskFilter('All')
  }, [taskStages]) // eslint-disable-line react-hooks/exhaustive-deps

  const overridesByKey = (value && typeof value === 'object' ? value?.overridesByKey : null) || {}
  const normKey = (stage, taskStage) => `${String(stage || '').trim()}__${String(taskStage || '').trim()}`

  const effectiveRows = useMemo(() => {
    const filtered = pmRows.filter(r => (
      (stageFilter === 'All' || r.stage === stageFilter) &&
      (taskFilter === 'All' || r.taskStage === taskFilter)
    ))
    return filtered
      .slice()
      .sort((a, b) => (a.stage !== b.stage ? a.stage.localeCompare(b.stage) : a.taskStage.localeCompare(b.taskStage)))
  }, [pmRows, stageFilter, taskFilter])

  const setOverride = (stage, taskStage, phase, nextVal) => {
    const key = normKey(stage, taskStage)
    const next = { ...(overridesByKey || {}) }
    const row = { ...(next[key] || {}) }
    if (nextVal === null) delete row[phase]
    else row[phase] = nextVal
    if (Object.keys(row).length) next[key] = row
    else delete next[key]
    onChange?.(Object.keys(next).length ? { overridesByKey: next } : null)
  }

  if (!pmRows.length) {
    return (
      <div style={{ fontSize: 12.5, color: 'var(--ink-faint)', lineHeight: 1.6 }}>
        This workbook doesn’t include the task-level “Customer Journey Stage / Stage / Role” section in <strong>Demand Base Matrix</strong>.
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end', marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--ink-muted)', marginBottom: 6 }}>
            Customer journey stage
          </div>
          <select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)} style={{ width: 260, padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)' }}>
            {stages.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--ink-muted)', marginBottom: 6 }}>
            Stage
          </div>
          <select value={taskFilter} onChange={(e) => setTaskFilter(e.target.value)} style={{ width: 420, maxWidth: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)' }}>
            {taskStages.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        {!!Object.keys(overridesByKey || {}).length && (
          <button onClick={() => onChange?.(null)} style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid rgba(248,113,113,0.35)', background: 'transparent', color: 'var(--red)', fontWeight: 900, cursor: 'pointer', marginLeft: 'auto' }}>
            Reset PM multipliers
          </button>
        )}
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead style={{ background: 'var(--surface-1)' }}>
            <tr>
              {['Customer journey', 'Stage', 'Role', ...PM_PHASES].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 10.5, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--ink-muted)', whiteSpace: 'nowrap' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {effectiveRows.map((r, i) => {
              const key = normKey(r.stage, r.taskStage)
              const ov = overridesByKey?.[key] || null
              return (
                <tr key={key} style={{ background: i % 2 ? 'var(--surface-1)' : 'white', borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '10px 12px', fontWeight: 900, color: 'var(--ink)', whiteSpace: 'nowrap' }}>{r.stage}</td>
                  <td style={{ padding: '10px 12px', color: 'var(--ink-muted)', minWidth: 260 }}>{r.taskStage}</td>
                  <td style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', color: 'var(--ink-faint)' }}>PM</td>
                  {PM_PHASES.map(ph => {
                    const base = Number(r.phaseHours?.[ph] || 0)
                    const has = ov && ov[ph] !== undefined && ov[ph] !== null
                    const eff = has ? Number(ov[ph]) : base
                    const changed = has && Number.isFinite(eff) && eff !== base
                    return (
                      <td key={ph} style={{ padding: '8px 12px' }}>
                        <input
                          type="number"
                          value={Number.isFinite(eff) ? eff : ''}
                          onChange={(e) => {
                            const raw = e.target.value
                            if (raw === '') return setOverride(r.stage, r.taskStage, ph, null)
                            const n = Number(raw)
                            if (!Number.isFinite(n)) return
                            setOverride(r.stage, r.taskStage, ph, n)
                          }}
                          style={{
                            width: 120,
                            padding: '10px 12px',
                            borderRadius: 10,
                            border: `1px solid ${changed ? 'rgba(167,139,250,0.55)' : 'var(--border)'}`,
                            fontFamily: 'var(--font-mono)',
                            background: changed ? 'rgba(167,139,250,0.08)' : 'white',
                          }}
                        />
                        {changed ? (
                          <div style={{ marginTop: 4, fontSize: 10.5, color: 'var(--ink-faint)' }}>
                            baseline {base}
                          </div>
                        ) : null}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function clampPct(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return undefined
  return Math.max(0, Math.min(100, Math.round(n * 10) / 10))
}

function normAllocations(capacityConfig) {
  const raw = capacityConfig?.allocationsByPerson || {}
  const out = {}
  for (const [name, rec] of Object.entries(raw || {})) {
    const key = safeText(name)
    if (!key) continue
    const roles = {}
    const other = {}
    for (const [r, pct] of Object.entries(rec?.roles || {})) {
      const p = clampPct(pct)
      if (p === undefined) continue
      roles[r] = p
    }
    for (const [b, pct] of Object.entries(rec?.other || {})) {
      const bn = safeText(b)
      if (!bn || bn === UNALLOCATED_KEY) continue
      const p = clampPct(pct)
      if (p === undefined) continue
      other[bn] = p
    }
    out[key] = { roles, other }
  }
  return out
}

function buildNextCapacityConfig(prev, nextAllocationsByPerson) {
  const cleaned = nextAllocationsByPerson && Object.keys(nextAllocationsByPerson).length
    ? nextAllocationsByPerson
    : null
  if (!cleaned) {
    // remove allocations from config if empty
    const copy = { ...(prev || {}) }
    delete copy.allocationsByPerson
    return Object.keys(copy).length ? copy : null
  }
  return { ...(prev || {}), allocationsByPerson: cleaned }
}

function uniquePeopleFromRoster(roster) {
  const map = new Map()
  for (const p of Array.isArray(roster) ? roster : []) {
    const name = safeText(p?.name)
    if (!name) continue
    const fte = Number(p?.fte)
    const cur = map.get(name)
    const nextFte = Number.isFinite(fte) ? fte : 1
    // If duplicates exist, take max to avoid double-counting.
    if (!cur) map.set(name, { name, fte: nextFte })
    else map.set(name, { ...cur, fte: Math.max(Number(cur.fte) || 0, nextFte) })
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
}

function buildRosterRoleMap(roster) {
  const map = new Map() // name -> baseRole
  for (const p of Array.isArray(roster) ? roster : []) {
    const name = safeText(p?.name)
    if (!name) continue
    const roleRaw = safeText(p?.role)
    const baseRole = roleRaw === 'Analyst' ? 'Analyst 1' : roleRaw
    if (!baseRole) continue
    if (!map.has(name)) map.set(name, baseRole)
  }
  return map
}

function sumObj(o) {
  let s = 0
  for (const v of Object.values(o || {})) s += Number(v) || 0
  return s
}

function listPctPairs(obj) {
  const pairs = []
  for (const [k, v] of Object.entries(obj || {})) {
    const name = safeText(k)
    const n = Number(v)
    if (!name) continue
    if (!Number.isFinite(n) || n <= 0) continue
    pairs.push([name, n])
  }
  return pairs
}

function AllocationModal({ isOpen, onClose, person, existing, onSave }) {
  const [roles, setRoles] = useState(() => ({ ...(existing?.roles || {}) }))
  const [other, setOther] = useState(() => {
    const o = { ...(existing?.other || {}) }
    delete o[UNALLOCATED_KEY]
    return o
  })
  const [newBucket, setNewBucket] = useState('')
  const [error, setError] = useState(null)

  // Re-init when person changes
  React.useEffect(() => {
    if (!isOpen) return
    setRoles({ ...(existing?.roles || {}) })
    const o = { ...(existing?.other || {}) }
    delete o[UNALLOCATED_KEY]
    setOther(o)
    setNewBucket('')
    setError(null)
  }, [isOpen, existing, person?.name])

  if (!isOpen || !person) return null

  const roleSum = sumObj(roles)
  const otherSum = sumObj(other)
  const baseSum = roleSum + otherSum
  const remaining = Math.max(0, +(100 - baseSum).toFixed(1))

  const save = () => {
    const cleanedRoles = {}
    for (const r of MODELED_ROLES) {
      const v = clampPct(roles?.[r])
      if (v === undefined || v === 0) continue
      cleanedRoles[r] = v
    }

    const cleanedOther = {}
    for (const [b, pct] of Object.entries(other || {})) {
      const bn = safeText(b)
      const v = clampPct(pct)
      if (!bn || bn === UNALLOCATED_KEY || v === undefined) continue
      // Persist 0 values too, so "Add bucket" survives closing the modal.
      cleanedOther[bn] = v
    }

    const sum = sumObj(cleanedRoles) + sumObj(cleanedOther)
    if (sum > 100.0001) {
      setError('Total allocations exceed 100%. Reduce one of the percentages.')
      return
    }

    onSave?.({ roles: cleanedRoles, other: cleanedOther })
    onClose?.()
  }

  const addBucket = () => {
    const b = safeText(newBucket)
    if (!b) return
    if (other[b] !== undefined) return
    setOther(prev => ({ ...(prev || {}), [b]: 0 }))
    setNewBucket('')
  }

  return createPortal((
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.35)',
        zIndex: 1400,
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        overflow: 'auto',
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.() }}
    >
      <div style={{
        width: 'min(820px, 96vw)',
        maxHeight: '86vh',
        overflow: 'hidden',
        background: 'white',
        borderRadius: 14,
        border: '1px solid var(--border)',
        boxShadow: '0 20px 60px rgba(15, 23, 42, 0.25)',
        display: 'flex',
        flexDirection: 'column',
      }}>
        <div style={{
          padding: '14px 16px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}>
          <div>
            <div style={{ fontWeight: 900, fontSize: 14.5, letterSpacing: '-0.01em' }}>
              Allocations · {person.name}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
              Split this person’s time across roles and other buckets (PMO, specialist work, etc). Total must equal 100%.
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <Pill type={remaining === 0 ? 'green' : 'amber'}>
              Total: {(baseSum).toFixed(1)}% · Remaining: {remaining.toFixed(1)}%
            </Pill>
            <ActionButton onClick={onClose}>Close</ActionButton>
          </div>
        </div>

        <div style={{ padding: 16, overflow: 'auto' }}>
          {error ? (
            <div style={{ marginBottom: 12, background: 'var(--red-light)', border: '1px solid #fecaca', borderRadius: 10, padding: '10px 12px', fontSize: 12.5, color: '#991b1b' }}>
              {error}
            </div>
          ) : null}

          <ExpandableCard title="Allocated Capacity (CS&T + Other Responsibilities)" tag="Must total 100%" defaultOpen accentBorder="rgba(124,58,237,0.30)">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 220px', gap: 10, alignItems: 'center', marginBottom: 14 }}>
              {MODELED_ROLES.map(r => (
                <React.Fragment key={r}>
                  <div style={{ fontWeight: 800, color: 'var(--ink)' }}>{r}</div>
                  <NumericField
                    kind="float"
                    value={roles?.[r] ?? 0}
                    onCommit={(v) => setRoles(prev => ({ ...(prev || {}), [r]: v ?? 0 }))}
                    placeholder="0"
                    min={0}
                    max={100}
                    step={0.5}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      borderRadius: 10,
                      border: '1px solid var(--border)',
                      background: 'var(--surface-0)',
                      fontSize: 12.5,
                    }}
                  />
                </React.Fragment>
              ))}
            </div>

            <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '0.4px', textTransform: 'uppercase', color: 'var(--ink-muted)', marginBottom: 8 }}>
              Other responsibilities
            </div>
              <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                <input
                  value={newBucket}
                  onChange={(e) => setNewBucket(e.target.value)}
                  placeholder="Add bucket (e.g., PMO, Specialist)"
                  style={{
                    flex: 1,
                    minWidth: 240,
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: '1px solid var(--border)',
                    background: 'var(--surface-0)',
                    fontSize: 12.5,
                  }}
                />
                <ActionButton onClick={addBucket} disabled={!safeText(newBucket)}>
                  Add bucket
                </ActionButton>
              </div>

              {Object.keys(other || {}).length === 0 ? (
                <div style={{ fontSize: 12.5, color: 'var(--ink-muted)' }}>
                  No buckets yet.
                  <div style={{ marginTop: 6, fontSize: 12, color: 'var(--ink-faint)' }}>
                    Current role split: {listPctPairs(roles).map(([k, v]) => `${k} (${v}%)`).join(' · ') || '—'}
                  </div>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 220px 90px', gap: 10, alignItems: 'center' }}>
                  {Object.keys(other).filter(k => k !== UNALLOCATED_KEY).sort((a, b) => a.localeCompare(b)).map(b => (
                    <React.Fragment key={b}>
                      <input
                        value={b}
                        disabled
                        style={{
                          width: '100%',
                          padding: '10px 12px',
                          borderRadius: 10,
                          border: '1px solid var(--border)',
                          background: 'var(--surface-1)',
                          fontSize: 12.5,
                          color: 'var(--ink-muted)',
                        }}
                      />
                      <NumericField
                        kind="float"
                        value={other?.[b] ?? 0}
                        onCommit={(v) => setOther(prev => ({ ...(prev || {}), [b]: v ?? 0 }))}
                        placeholder="0"
                        min={0}
                        max={100}
                        step={0.5}
                        style={{
                          width: '100%',
                          padding: '10px 12px',
                          borderRadius: 10,
                          border: '1px solid var(--border)',
                          background: 'var(--surface-0)',
                          fontSize: 12.5,
                        }}
                      />
                      <button
                        onClick={() => setOther(prev => {
                          const copy = { ...(prev || {}) }
                          delete copy[b]
                          return copy
                        })}
                        style={{
                          padding: '10px 10px',
                          borderRadius: 10,
                          border: '1px solid rgba(248,113,113,0.35)',
                          background: 'transparent',
                          color: 'var(--red)',
                          cursor: 'pointer',
                          fontWeight: 900,
                          fontSize: 12,
                        }}
                        title="Remove bucket"
                      >
                        Remove
                      </button>
                    </React.Fragment>
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
                <button
                  onClick={onClose}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: '1px solid var(--border)',
                    background: 'transparent',
                    cursor: 'pointer',
                    fontWeight: 800,
                    fontSize: 12.5,
                    color: 'var(--ink-muted)',
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={save}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: 'none',
                    background: 'var(--accent)',
                    cursor: 'pointer',
                    fontWeight: 900,
                    fontSize: 12.5,
                    color: 'white',
                  }}
                >
                  Save allocations
                </button>
              </div>
          </ExpandableCard>

          <ExpandableCard title="Unallocated Capacity Utilization" tag={`Remaining ${remaining.toFixed(1)}%`} defaultOpen={remaining > 0}>
            <div style={{ fontSize: 12.5, color: 'var(--ink-muted)', lineHeight: 1.7 }}>
              Any remaining % means the person is <strong>not available</strong> for modeled CS&T roles. This reduces their effective capacity and changes utilisation/recommendations.
            </div>
            <div style={{ marginTop: 10, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <Pill type={remaining === 0 ? 'green' : 'amber'}>
                Remaining: {remaining.toFixed(1)}%
              </Pill>
              <span style={{ fontSize: 12, color: 'var(--ink-faint)' }}>
                Tip: split remaining into PMO/Specialist buckets if you want it explicitly tracked.
              </span>
            </div>
          </ExpandableCard>
        </div>
      </div>
    </div>
  ), document.body)
}

function WorkingDaysModal({
  isOpen,
  onClose,
  personName,
  personBaseRole,
  planningYear = 2026,
  baseBusinessDaysByMonth,
  workingDaysConfig,
  onSaveWorkingDaysConfig,
}) {
  const [draftConfig, setDraftConfig] = useState(workingDaysConfig)
  const [kind, setKind] = useState(WD_KINDS[0]?.id || 'pto')
  const [name, setName] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [formError, setFormError] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    setDraftConfig(workingDaysConfig)
    setFormError(null)
    setSaving(false)
  }, [isOpen, workingDaysConfig, personName])

  const personAdjustments = draftConfig?.personAdjustmentsByPerson?.[personName] || []

  const summary = useMemo(() => {
    return computePersonWorkingDaysByMonth({
      year: planningYear,
      baseBusinessDaysByMonth,
      personName,
      personBaseRole,
      workingDays: draftConfig,
    })
  }, [planningYear, baseBusinessDaysByMonth, personName, personBaseRole, draftConfig])

  React.useEffect(() => {
    if (!isOpen) return
    setKind(WD_KINDS[0]?.id || 'pto')
    setName('')
    setStartDate('')
    setEndDate('')
    setFormError(null)
  }, [isOpen])

  if (!isOpen) return null

  const nm = safeText(name)
  const sd = safeText(startDate)
  const ed = safeText(endDate)
  const defaultName =
    (WD_KINDS.find(k => k.id === kind)?.label || '')
      .replace(/\s*\(.*?\)\s*/g, '')
      .trim() || 'Working days adjustment'

  const add = async () => {
    const nmFinal = nm || defaultName
    const sdFinal = sd
    const edFinal = ed || sd // allow single-day entries by defaulting end = start

    if (!sdFinal) {
      setFormError('Please choose a Start date.')
      return
    }
    if (!edFinal) {
      setFormError('Please choose an End date.')
      return
    }
    if (edFinal < sdFinal) {
      setFormError('End date must be on/after Start date.')
      return
    }
    const base = (draftConfig || workingDaysConfig || { orgHolidays: [], roleCalendarsByRole: {}, personAdjustmentsByPerson: {} })
    const next = { ...base }
    const map = { ...(next.personAdjustmentsByPerson || {}) }
    const prev = Array.isArray(map[personName]) ? map[personName] : []
    map[personName] = [...prev, { id: uid('p'), kind, name: nmFinal, startDate: sdFinal, endDate: edFinal }]
    next.personAdjustmentsByPerson = map
    setDraftConfig(next)
    setSaving(true)
    setFormError(null)
    try {
      await onSaveWorkingDaysConfig?.(next)
      setName('')
      setStartDate('')
      setEndDate('')
    } catch (e) {
      setFormError(e?.message || 'Could not save working days. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id) => {
    const base = (draftConfig || workingDaysConfig || { orgHolidays: [], roleCalendarsByRole: {}, personAdjustmentsByPerson: {} })
    const next = { ...base }
    const map = { ...(next.personAdjustmentsByPerson || {}) }
    const prev = Array.isArray(map[personName]) ? map[personName] : []
    map[personName] = prev.filter(x => x?.id !== id)
    if (map[personName].length === 0) delete map[personName]
    next.personAdjustmentsByPerson = map
    setDraftConfig(next)
    setSaving(true)
    setFormError(null)
    try {
      await onSaveWorkingDaysConfig?.(next)
    } catch (e) {
      setFormError(e?.message || 'Could not save working days. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return createPortal((
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.35)',
        zIndex: 1400,
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        overflow: 'auto',
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.() }}
    >
      <div style={{
        width: 'min(920px, 96vw)',
        maxHeight: '86vh',
        overflow: 'hidden',
        background: 'white',
        borderRadius: 14,
        border: '1px solid var(--border)',
        boxShadow: '0 20px 60px rgba(15, 23, 42, 0.25)',
        display: 'flex',
        flexDirection: 'column',
      }}>
        <div style={{
          padding: '14px 16px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}>
          <div>
            <div style={{ fontWeight: 900, fontSize: 14.5, letterSpacing: '-0.01em' }}>
              Working days · {personName}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
              Add/remove days using date ranges (PTO, holidays, weekend work). Applies across all allocated roles.
            </div>
          </div>
          <ActionButton onClick={onClose}>Close</ActionButton>
        </div>

        <div style={{ padding: 16, overflow: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Card>
              <CardHeader title="Add adjustment" tag={String(planningYear)} />
              <CardBody>
                {formError ? (
                  <div style={{ marginBottom: 10, background: 'var(--red-light)', border: '1px solid rgba(248,113,113,0.35)', borderRadius: 10, padding: '10px 12px', color: '#7a2e1e', fontSize: 12.5, fontWeight: 750 }}>
                    {formError}
                  </div>
                ) : null}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, alignItems: 'end' }}>
                  <div>
                    <div style={{ fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--ink-muted)', marginBottom: 6 }}>
                      Type
                    </div>
                    <select value={kind} onChange={(e) => { setKind(e.target.value); setFormError(null) }} style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)' }}>
                      {WD_KINDS.map(k => <option key={k.id} value={k.id}>{k.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <div style={{ fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--ink-muted)', marginBottom: 6 }}>
                      Name
                    </div>
                    <input value={name} onChange={(e) => { setName(e.target.value); setFormError(null) }} placeholder="e.g., PTO, Diwali, PMO work" style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)' }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--ink-muted)', marginBottom: 6 }}>
                      Start date
                    </div>
                    <input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); setFormError(null) }} style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)' }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--ink-muted)', marginBottom: 6 }}>
                      End date
                    </div>
                    <input type="date" value={endDate} onChange={(e) => { setEndDate(e.target.value); setFormError(null) }} style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)' }} />
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
                  <button
                    onClick={add}
                    disabled={saving}
                    style={{
                      padding: '10px 12px',
                      borderRadius: 10,
                      border: 'none',
                      background: 'var(--accent)',
                      color: 'white',
                      fontWeight: 900,
                      cursor: saving ? 'not-allowed' : 'pointer',
                      opacity: saving ? 0.65 : 1,
                    }}
                  >
                    {saving ? 'Saving…' : 'Add'}
                  </button>
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Impact summary" tag="Net change vs default" />
              <CardBody>
                <div style={{ fontSize: 12.5, color: 'var(--ink-muted)', marginBottom: 10 }}>
                  Base role: <strong>{personBaseRole || '—'}</strong>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8, fontSize: 12 }}>
                  {['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map((m, i) => (
                    <div key={m} style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface-0)' }}>
                      <div style={{ fontSize: 10.5, fontWeight: 900, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{m}</div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 900, color: (summary.deltaByMonth?.[i] || 0) < 0 ? 'var(--red)' : (summary.deltaByMonth?.[i] || 0) > 0 ? 'var(--green)' : 'var(--ink-muted)' }}>
                        {(summary.deltaByMonth?.[i] || 0) > 0 ? '+' : ''}{summary.deltaByMonth?.[i] || 0}d
                      </div>
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>
          </div>

          <div style={{ marginTop: 14 }}>
            <Card>
              <CardHeader title="Existing adjustments" tag={`${personAdjustments.length}`} />
              <CardBody>
                {personAdjustments.length === 0 ? (
                  <div style={{ fontSize: 12.5, color: 'var(--ink-muted)' }}>No adjustments yet.</div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                      <thead style={{ background: 'var(--surface-1)' }}>
                        <tr>
                          {['Type', 'Name', 'Range', ''].map(h => (
                            <th key={h} style={{ textAlign:'left', padding:'10px 12px', borderBottom:'1px solid var(--border)', fontSize: 10.5, fontWeight: 900, textTransform:'uppercase', letterSpacing:'0.6px', color:'var(--ink-muted)' }}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {personAdjustments.map((x, i) => (
                          <tr key={x.id || i} style={{ background: i % 2 ? 'var(--surface-1)' : 'white', borderBottom: '1px solid var(--border)' }}>
                            <td style={{ padding: '10px 12px', color: 'var(--ink-muted)' }}>{x.kind}</td>
                            <td style={{ padding: '10px 12px', fontWeight: 800, color: 'var(--ink)' }}>{x.name}</td>
                            <td style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', color: 'var(--ink-muted)' }}>
                              {isoToLabel(x.startDate)} → {isoToLabel(x.endDate)}
                            </td>
                            <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                              <button onClick={() => remove(x.id)} style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid rgba(248,113,113,0.35)', background: 'transparent', color: 'var(--red)', fontWeight: 900, cursor: 'pointer' }}>
                                Remove
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardBody>
            </Card>
          </div>
        </div>
      </div>
    </div>
  ), document.body)
}

export default function CapacitySetupView({
  engineInput,
  capacityConfig,
  datasetMode,
  planName,
  onBack,
  onUpdateCapacityConfig, // ({ capacityConfig })
}) {
  const { data: engineData, loading, error } = useEngineInsightsData(engineInput, true)
  const baselineDemandTasks = engineInput?.ingest?.demandTasks || engineInput?.demandTasks || null
  const baselineOrbit = engineInput?.ingest?.orbitMultipliers || engineInput?.orbitMultipliers || {}

  const roster = engineData?.roster || []
  const people = useMemo(() => uniquePeopleFromRoster(roster), [roster])
  const rosterRoleByName = useMemo(() => buildRosterRoleMap(roster), [roster])
  const savedAllocationsByPerson = useMemo(() => normAllocations(capacityConfig), [capacityConfig])
  const workingDaysConfig = useMemo(() => normWorkingDaysConfig(capacityConfig), [capacityConfig])
  const assignmentBackfills = useMemo(() => normAssignmentBackfills(capacityConfig), [capacityConfig])
  const planningYear = engineInput?.ingest?.meta?.planningYear || engineInput?.meta?.planningYear || 2026
  const MONTHS = useMemo(() => (['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']), [])

  const defaultAllocationFor = useMemo(() => {
    return (name) => {
      const baseRole = rosterRoleByName.get(name) || null
      if (!baseRole || !MODELED_ROLES.includes(baseRole)) return null
      if (isDefaultHalfTime(name)) return { roles: { [baseRole]: 50 }, other: { PMO: 50 } }
      // Default behaviour: if the user hasn't configured allocations, assume 100% to their roster role.
      return { roles: { [baseRole]: 100 }, other: {} }
    }
  }, [rosterRoleByName])

  const allocationsByPerson = useMemo(() => {
    const out = { ...savedAllocationsByPerson }
    // If org default applies but there is no saved record, surface it in the UI.
    for (const p of people) {
      if (out[p.name]) continue
      const d = defaultAllocationFor(p.name)
      if (d) out[p.name] = d
    }
    return out
  }, [savedAllocationsByPerson, defaultAllocationFor, people])

  const rosterOptionsByRole = useMemo(() => {
    const out = { CSM: [], PM: [], 'Analyst 1': [] }
    for (const p of Array.isArray(roster) ? roster : []) {
      const name = safeText(p?.name)
      if (!name) continue
      const roleRaw = safeText(p?.role)
      const baseRole = roleRaw === 'Analyst' ? 'Analyst 1' : roleRaw
      if (!baseRole) continue
      if (!out[baseRole]) out[baseRole] = []
      if (!out[baseRole].includes(name)) out[baseRole].push(name)
    }
    for (const k of Object.keys(out)) out[k].sort((a, b) => a.localeCompare(b))
    return out
  }, [roster])

  const [peopleQ, setPeopleQ] = useState('')
  const [activePerson, setActivePerson] = useState(null)
  const [assumptionsOpen, setAssumptionsOpen] = useState(false)
  const [activeWorkingDaysPerson, setActiveWorkingDaysPerson] = useState(null)
  const [backfillDrafts, setBackfillDrafts] = useState({}) // key -> { toPerson, startDate, endDate, fromMode }

  const [orgHolName, setOrgHolName] = useState('')
  const [orgHolStart, setOrgHolStart] = useState('')
  const [orgHolEnd, setOrgHolEnd] = useState('')
  const [roleHolRole, setRoleHolRole] = useState(MODELED_ROLES[0] || 'CSM')
  const [roleHolName, setRoleHolName] = useState('')
  const [roleHolStart, setRoleHolStart] = useState('')
  const [roleHolEnd, setRoleHolEnd] = useState('')

  const savedLmBuckets = useMemo(() => {
    const t = capacityConfig?.lmBucketMultipliers
    return Array.isArray(t) && t.length ? t : null
  }, [capacityConfig])
  const orbitOverrides = useMemo(() => {
    const o = capacityConfig?.orbitVibeMultipliers
    return (o && typeof o === 'object') ? o : {}
  }, [capacityConfig])
  const pmTaskOverrides = useMemo(() => {
    const p = capacityConfig?.pmTaskMultipliers
    return (p && typeof p === 'object') ? p : null
  }, [capacityConfig])

  const setCapacityField = useCallback(async (patch) => {
    const next = { ...(capacityConfig || {}) }
    for (const [k, v] of Object.entries(patch || {})) {
      if (v === undefined) delete next[k]
      else next[k] = v
    }
    const cleaned = Object.keys(next).length ? next : null
    await onUpdateCapacityConfig?.({ capacityConfig: cleaned })
  }, [capacityConfig, onUpdateCapacityConfig])

  const saveWorkingDaysConfig = useCallback(async (wdNext) => {
    const nextCfg = buildNextCapacityConfigWithWorkingDays(capacityConfig, wdNext)
    await onUpdateCapacityConfig?.({ capacityConfig: nextCfg })
  }, [capacityConfig, onUpdateCapacityConfig])

  const availabilityUnallocated = useMemo(() => {
    const rows = Array.isArray(engineData?.assignments) ? engineData.assignments : []
    const map = new Map()
    for (const r of rows) {
      if (!r || !r.isUnstaffed) continue
      if (String(r.unstaffedReason || '') !== 'availability') continue
      const h = Number(r.finalHours)
      if (!Number.isFinite(h) || h <= 0) continue
      const projectId = safeText(r.projectId)
      const role = safeText(r.role)
      const mi = Number(r.monthIndex)
      const sourcePerson = safeText(r.sourcePerson)
      if (!projectId || !role || !Number.isFinite(mi) || mi < 0 || mi > 11) continue
      const key = `${projectId}__${role}__${mi}__${sourcePerson}`
      const prev = map.get(key)
      if (!prev) {
        map.set(key, {
          key,
          projectId,
          projectName: safeText(r.projectName) || projectId,
          role,
          monthIndex: mi,
          hours: h,
          sourcePerson: sourcePerson || '—',
          sourceKind: safeText(r.sourceKind) || 'availability',
        })
      } else {
        prev.hours += h
      }
    }
    return [...map.values()].sort((a, b) => (b.hours || 0) - (a.hours || 0))
  }, [engineData?.assignments])

  const saveBackfillEntry = useCallback(async ({ projectId, role, fromPerson, toPerson, startDate, endDate, note }) => {
    const pid = safeText(projectId)
    const rl = safeText(role)
    const fp = safeText(fromPerson)
    const tp = safeText(toPerson)
    const sd = safeText(startDate)
    const ed = safeText(endDate) || sd
    if (!pid || !rl || !fp || !tp || !sd) return

    const next = { ...assignmentBackfills }
    const byRole = { ...(next[pid] || {}) }
    const list = Array.isArray(byRole[rl]) ? byRole[rl] : []
    byRole[rl] = [...list, { id: uid('bf'), fromPerson: fp, toPerson: tp, startDate: sd, endDate: ed, note: safeText(note) || undefined }]
    next[pid] = byRole

    const nextCfg = buildNextCapacityConfigWithBackfills(capacityConfig, next)
    await onUpdateCapacityConfig?.({ capacityConfig: nextCfg })
  }, [assignmentBackfills, capacityConfig, onUpdateCapacityConfig])

  const removeBackfillEntry = useCallback(async ({ projectId, role, id }) => {
    const pid = safeText(projectId)
    const rl = safeText(role)
    const bid = safeText(id)
    if (!pid || !rl || !bid) return
    const next = { ...assignmentBackfills }
    const byRole = { ...(next[pid] || {}) }
    const list = Array.isArray(byRole[rl]) ? byRole[rl] : []
    const nextList = list.filter(x => safeText(x?.id) !== bid)
    if (nextList.length) byRole[rl] = nextList
    else delete byRole[rl]
    if (Object.keys(byRole).length) next[pid] = byRole
    else delete next[pid]
    const nextCfg = buildNextCapacityConfigWithBackfills(capacityConfig, next)
    await onUpdateCapacityConfig?.({ capacityConfig: nextCfg })
  }, [assignmentBackfills, capacityConfig, onUpdateCapacityConfig])

  const backfillRows = useMemo(() => {
    const out = []
    for (const [projectId, byRole] of Object.entries(assignmentBackfills || {})) {
      for (const [role, arr] of Object.entries(byRole || {})) {
        for (const it of (Array.isArray(arr) ? arr : [])) {
          if (!it) continue
          out.push({ projectId, role, ...it })
        }
      }
    }
    return out.sort((a, b) => {
      if ((a.projectId || '') !== (b.projectId || '')) return (a.projectId || '').localeCompare(b.projectId || '')
      if ((a.role || '') !== (b.role || '')) return (a.role || '').localeCompare(b.role || '')
      return String(a.startDate || '').localeCompare(String(b.startDate || ''))
    })
  }, [assignmentBackfills])

  const suggestCandidates = useCallback((role, monthIndex, topN = 5) => {
    const mi = Number(monthIndex)
    if (!Number.isFinite(mi) || mi < 0 || mi > 11) return []
    const insightsRole =
      role === 'Analyst 1' || role === 'Analyst 2' ? 'Analyst' :
      role === 'CSM' ? 'CSM' :
      role === 'PM' ? 'PM' :
      null
    if (!insightsRole) return []
    const list = engineData?.people?.[insightsRole] || []
    const ranked = (Array.isArray(list) ? list : [])
      .map(p => {
        const cap = Number(p?.capacityMonthly?.[mi] || 0)
        const dem = Number(p?.monthly?.[mi] || 0)
        return { name: safeText(p?.name), slack: cap - dem }
      })
      .filter(x => x.name && Number.isFinite(x.slack))
      .sort((a, b) => (b.slack || 0) - (a.slack || 0))
      .slice(0, topN)
    return ranked
  }, [engineData?.people])

  const filtered = useMemo(() => {
    const t = safeText(peopleQ).toLowerCase()
    if (!t) return people
    return people.filter(p => p.name.toLowerCase().includes(t))
  }, [people, peopleQ])

  const availabilityUnallocTotal = useMemo(
    () => availabilityUnallocated.reduce((s, x) => s + (Number(x?.hours) || 0), 0),
    [availabilityUnallocated]
  )

  const [openWd, setOpenWd] = usePersistedBool('spark_ap_open_wd', false)
  const [openWh, setOpenWh] = usePersistedBool('spark_ap_open_wh', false)
  const [openPeople, setOpenPeople] = usePersistedBool('spark_ap_open_people', true)
  const [openDrivers, setOpenDrivers] = usePersistedBool('spark_ap_open_drivers', true)
  const [openAlloc, setOpenAlloc] = usePersistedBool('spark_ap_open_alloc', true)
  const [openBackfill, setOpenBackfill] = usePersistedBool('spark_ap_open_backfill', availabilityUnallocated.length > 0)
  const [allocInline, setAllocInline] = usePersistedBool('spark_ap_alloc_inline', false)
  const [backfillInline, setBackfillInline] = usePersistedBool('spark_ap_backfill_inline', false)
  const [pmModalOpen, setPmModalOpen] = useState(false)
  const [pmInline, setPmInline] = usePersistedBool('spark_ap_pm_inline', false)

  const [peopleModalOpen, setPeopleModalOpen] = useState(false)
  const [peopleModalFocus, setPeopleModalFocus] = useState('alloc') // 'alloc' | 'backfill'
  const [peopleInline, setPeopleInline] = usePersistedBool('spark_ap_people_inline', true)

  const peopleModalBodyRef = useRef(null)
  const peopleModalBackfillRef = useRef(null)

  useEffect(() => {
    if (!peopleModalOpen) return
    const body = peopleModalBodyRef.current
    if (!body) return

    const scroll = () => {
      try {
        if (peopleModalFocus === 'backfill') {
          const el = peopleModalBackfillRef.current
          if (!el) return
          const top = el.offsetTop
          body.scrollTo({ top: Math.max(0, top - 8), behavior: 'smooth' })
        } else {
          body.scrollTo({ top: 0, behavior: 'smooth' })
        }
      } catch { /* ignore */ }
    }

    requestAnimationFrame(scroll)
  }, [peopleModalOpen, peopleModalFocus])

  const [isTwoCol, setIsTwoCol] = useState(() => {
    try { return window.innerWidth >= 1080 } catch { return true }
  })
  useEffect(() => {
    const onResize = () => setIsTwoCol(window.innerWidth >= 1080)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const baseRoleByName = useMemo(() => {
    const m = new Map()
    for (const p of Array.isArray(roster) ? roster : []) {
      const n = safeText(p?.name)
      if (!n) continue
      const rr = safeText(p?.role)
      const base = rr === 'Analyst' ? 'Analyst 1' : rr
      if (!m.has(n) && base) m.set(n, base)
    }
    return m
  }, [roster])

  const utilByName = useMemo(() => {
    const out = new Map()
    const peopleByRole = engineData?.people || {}
    const all = [
      ...(peopleByRole?.CSM || []).map(p => ({ ...p, _role: 'CSM' })),
      ...(peopleByRole?.PM || []).map(p => ({ ...p, _role: 'PM' })),
      ...(peopleByRole?.Analyst || []).map(p => ({ ...p, _role: 'Analyst 1' })),
    ]
    for (const p of all) {
      const n = safeText(p?.name)
      if (!n) continue
      const base = baseRoleByName.get(n)
      if (!base) continue
      if (base !== p._role) continue
      const cap = Number(p?.capacityAnnual || 0)
      const dem = Number(p?.total || 0)
      const pct = cap > 0 ? (dem / cap) * 100 : 0
      out.set(n, Number.isFinite(pct) ? pct : 0)
    }
    return out
  }, [engineData?.people, baseRoleByName])

  return (
    <div style={{ animation:'fadeUp 0.22s ease both' }}>
      <SectionHeader
        title="Capacity control center"
      />

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <button
          onClick={onBack}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 7,
            padding: '7px 12px',
            borderRadius: 10,
            border: '1px solid rgba(124,58,237,0.35)',
            background: 'linear-gradient(90deg, rgba(124,58,237,0.16), rgba(37,99,235,0.12))',
            color: '#312e81',
            fontFamily: 'var(--font-sans)',
            fontSize: 12.5,
            fontWeight: 850,
            cursor: 'pointer',
            boxShadow: 'var(--shadow-sm)',
          }}
          title="Back to Plan"
        >
          ← Back to Plan
        </button>
        <Pill type={datasetMode === 'base' ? 'green' : 'amber'}>
          {datasetMode === 'base' ? 'Saved plan' : 'Uploaded session'}
        </Pill>
        <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
          <Mono>{planName || 'Current plan'}</Mono>
        </span>
      </div>

      {loading && (
        <div style={{ padding:'14px 0', color:'var(--ink-muted)' }}>Computing engine insights…</div>
      )}
      {error && (
        <div style={{ padding:'14px 0', color:'var(--red)' }}>{error}</div>
      )}

      {/* Section 1: Working Model (full width) */}
      <Card style={{ borderRadius: 16, boxShadow: 'var(--shadow-sm)' }}>
        <CardHeader title="Working Model" tag="Capacity model" />
        <CardBody>
          <div style={{ fontSize: 12.5, color: 'var(--ink-muted)', lineHeight: 1.7, marginBottom: 12 }}>
            Define working days, calendars, and role-based hours that shape your team’s available capacity.
          </div>

          <details open={openWd} onToggle={(e) => setOpenWd(e.currentTarget.open)} style={{ border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden', marginBottom: 12 }}>
            <summary style={{ listStyle: 'none', cursor: 'pointer', padding: '12px 14px', background: 'var(--surface-1)', display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
              <div style={{ fontWeight: 900, color: 'var(--ink)' }}>Working Days &amp; Calendars</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-muted)' }}>{openWd ? '▾' : '▸'}</div>
            </summary>
            <div style={{ padding: 14 }}>
              <div style={{ fontSize: 12.5, color: 'var(--ink-muted)', lineHeight: 1.7 }}>
                Add org holidays, role calendars, or person-level adjustments (PTO / non-project work / weekend work). These change monthly capacity immediately.
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: isTwoCol ? '1fr 1fr' : '1fr', gap: 14, marginTop: 14 }}>
                <Card>
                  <CardHeader title="Org-level holidays" tag="Applies to everyone" />
                  <CardBody>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, alignItems: 'end' }}>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <div style={{ fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--ink-muted)', marginBottom: 6 }}>Name</div>
                    <input value={orgHolName} onChange={(e) => setOrgHolName(e.target.value)} placeholder="e.g., Company shutdown" style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)' }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--ink-muted)', marginBottom: 6 }}>Start date</div>
                    <input type="date" value={orgHolStart} onChange={(e) => setOrgHolStart(e.target.value)} style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)' }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--ink-muted)', marginBottom: 6 }}>End date</div>
                    <input type="date" value={orgHolEnd} onChange={(e) => setOrgHolEnd(e.target.value)} style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)' }} />
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
                  <button
                    onClick={() => {
                      const nm = safeText(orgHolName); const sd = safeText(orgHolStart); const ed = safeText(orgHolEnd)
                      if (!nm || !sd || !ed) return
                      const next = { ...workingDaysConfig }
                      next.orgHolidays = [...(next.orgHolidays || []), { id: uid('org'), name: nm, startDate: sd, endDate: ed }]
                      saveWorkingDaysConfig(next)
                      setOrgHolName(''); setOrgHolStart(''); setOrgHolEnd('')
                    }}
                    style={{ padding: '10px 12px', borderRadius: 10, border: 'none', background: 'var(--accent)', color: 'white', fontWeight: 900, cursor: 'pointer' }}
                  >
                    Add holiday
                  </button>
                </div>

                <div style={{ marginTop: 12 }}>
                  {workingDaysConfig.orgHolidays.length === 0 ? (
                    <div style={{ fontSize: 12.5, color: 'var(--ink-muted)' }}>No org holidays yet.</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {workingDaysConfig.orgHolidays.map(h => (
                        <div key={h.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px' }}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 900, fontSize: 12.5, color: 'var(--ink)' }}>{h.name}</div>
                            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--ink-muted)' }}>{isoToLabel(h.startDate)} → {isoToLabel(h.endDate)}</div>
                          </div>
                          <button
                            onClick={() => {
                              const next = { ...workingDaysConfig, orgHolidays: (workingDaysConfig.orgHolidays || []).filter(x => x?.id !== h.id) }
                              saveWorkingDaysConfig(next)
                            }}
                            style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid rgba(248,113,113,0.35)', background: 'transparent', color: 'var(--red)', fontWeight: 900, cursor: 'pointer' }}
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Role calendars" tag="e.g., US vs India" />
              <CardBody>
                <div style={{ fontSize: 12.5, color: 'var(--ink-muted)', lineHeight: 1.7, marginBottom: 10 }}>
                  Holidays added here apply to everyone in that modeled role (based on roster role).
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, alignItems: 'end' }}>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <div style={{ fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--ink-muted)', marginBottom: 6 }}>Role</div>
                    <select value={roleHolRole} onChange={(e) => setRoleHolRole(e.target.value)} style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)' }}>
                      {MODELED_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <div style={{ fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--ink-muted)', marginBottom: 6 }}>Name</div>
                    <input value={roleHolName} onChange={(e) => setRoleHolName(e.target.value)} placeholder="e.g., India public holiday" style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)' }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--ink-muted)', marginBottom: 6 }}>Start date</div>
                    <input type="date" value={roleHolStart} onChange={(e) => setRoleHolStart(e.target.value)} style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)' }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--ink-muted)', marginBottom: 6 }}>End date</div>
                    <input type="date" value={roleHolEnd} onChange={(e) => setRoleHolEnd(e.target.value)} style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)' }} />
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
                  <button
                    onClick={() => {
                      const nm = safeText(roleHolName); const sd = safeText(roleHolStart); const ed = safeText(roleHolEnd)
                      if (!nm || !sd || !ed) return
                      const next = { ...workingDaysConfig }
                      const rc = { ...(next.roleCalendarsByRole || {}) }
                      const prev = rc[roleHolRole] || {}
                      const hol = Array.isArray(prev.holidays) ? prev.holidays : []
                      rc[roleHolRole] = { ...prev, holidays: [...hol, { id: uid('role'), name: nm, startDate: sd, endDate: ed }] }
                      next.roleCalendarsByRole = rc
                      saveWorkingDaysConfig(next)
                      setRoleHolName(''); setRoleHolStart(''); setRoleHolEnd('')
                    }}
                    style={{ padding: '10px 12px', borderRadius: 10, border: 'none', background: 'var(--accent)', color: 'white', fontWeight: 900, cursor: 'pointer' }}
                  >
                    Add holiday
                  </button>
                </div>

                <div style={{ marginTop: 12 }}>
                  {MODELED_ROLES.map(r => {
                    const hol = workingDaysConfig.roleCalendarsByRole?.[r]?.holidays || []
                    return (
                      <div key={r} style={{ marginBottom: 10 }}>
                        <div style={{ fontSize: 11.5, fontWeight: 900, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>
                          {r} ({hol.length})
                        </div>
                        {hol.length === 0 ? (
                          <div style={{ fontSize: 12.5, color: 'var(--ink-faint)' }}>—</div>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {hol.map(h => (
                              <div key={h.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px' }}>
                                <div style={{ minWidth: 0 }}>
                                  <div style={{ fontWeight: 900, fontSize: 12.5, color: 'var(--ink)' }}>{h.name}</div>
                                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--ink-muted)' }}>{isoToLabel(h.startDate)} → {isoToLabel(h.endDate)}</div>
                                </div>
                                <button
                                  onClick={() => {
                                    const next = { ...workingDaysConfig }
                                    const rc = { ...(next.roleCalendarsByRole || {}) }
                                    const prev = rc[r] || {}
                                    const list = Array.isArray(prev.holidays) ? prev.holidays : []
                                    const nextList = list.filter(x => x?.id !== h.id)
                                    if (nextList.length) rc[r] = { ...prev, holidays: nextList }
                                    else delete rc[r]
                                    next.roleCalendarsByRole = rc
                                    saveWorkingDaysConfig(next)
                                  }}
                                  style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid rgba(248,113,113,0.35)', background: 'transparent', color: 'var(--red)', fontWeight: 900, cursor: 'pointer' }}
                                >
                                  Remove
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </CardBody>
            </Card>
              </div>
            </div>
          </details>

          <details open={openWh} onToggle={(e) => setOpenWh(e.currentTarget.open)} style={{ border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
            <summary style={{ listStyle: 'none', cursor: 'pointer', padding: '12px 14px', background: 'var(--surface-1)', display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
              <div style={{ fontWeight: 900, color: 'var(--ink)' }}>Working Hours (by Role)</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-muted)' }}>{openWh ? '▾' : '▸'}</div>
            </summary>
            <div style={{ padding: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: -4, marginBottom: 10 }}>
                <ActionButton onClick={() => setAssumptionsOpen(true)}>Edit</ActionButton>
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--ink-muted)', lineHeight: 1.7, marginBottom: 10 }}>
                Default is <strong>10</strong> hours per business day (unless overridden per role).
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize: 12.5 }}>
                  <thead style={{ background: 'var(--surface-1)' }}>
                    <tr>
                      {['Role', 'Hours per business day'].map(h => (
                        <th key={h} style={{ textAlign:'left', padding:'10px 12px', borderBottom:'1px solid var(--border)', fontSize: 10.5, fontWeight: 900, textTransform:'uppercase', letterSpacing:'0.6px', color:'var(--ink-muted)' }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {MODELED_ROLES.map((r, i) => {
                      const v = capacityConfig?.hrsPerPersonDayByRole?.[r]
                      const n = Number(v)
                      const shown = Number.isFinite(n) ? n : 10
                      const isDefault = !Number.isFinite(n)
                      return (
                        <tr key={r} style={{ background: i % 2 ? 'var(--surface-1)' : 'white' }}>
                          <td style={{ padding:'10px 12px', borderBottom:'1px solid var(--border)', fontWeight: 800, color:'var(--ink)' }}>
                            {r}
                          </td>
                          <td style={{ padding:'10px 12px', borderBottom:'1px solid var(--border)', color:'var(--ink-muted)' }}>
                            <span style={{ fontFamily: 'var(--font-mono)' }}>{shown}</span>
                            {isDefault ? <span style={{ marginLeft: 8, color: 'var(--ink-faint)' }}>(default)</span> : null}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </details>
        </CardBody>
      </Card>

      {/* Sections 2 + 3: 2-column responsive grid */}
      <div style={{ display: 'grid', gridTemplateColumns: isTwoCol ? 'minmax(0, 1fr) minmax(0, 1fr)' : '1fr', gap: 14, marginTop: 14 }}>
        {/* Left: People Allocation & Backfill */}
        <Card style={{ borderRadius: 16, boxShadow: 'var(--shadow-sm)' }}>
          <div
            style={{
              padding: '13px 18px',
              borderBottom: openPeople ? '1px solid var(--border)' : 'none',
              background: 'linear-gradient(90deg, rgba(124,58,237,0.10), rgba(37,99,235,0.06))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              userSelect: 'none',
              gap: 10,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <button
                onClick={() => setOpenPeople(o => !o)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  background: 'transparent',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  color: 'var(--ink)',
                }}
                title={openPeople ? 'Collapse' : 'Expand'}
              >
                <span style={{ fontFamily: 'var(--font-sans)', fontWeight: 750, fontSize: 13.5, letterSpacing: '-0.01em' }}>
                  People Allocation &amp; Backfill
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-muted)' }}>
                  {openPeople ? '▾' : '▸'}
                </span>
              </button>
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                padding: '2px 7px',
                borderRadius: 4,
                background: 'rgba(255,255,255,0.75)',
                color: '#312e81',
                fontWeight: 600,
                border: '1px solid var(--border)',
                whiteSpace: 'nowrap',
              }}>
                {people.length} people · {availabilityUnallocated.length ? `${Math.round(availabilityUnallocTotal).toLocaleString()}h gaps` : 'No gaps'}
              </span>
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-muted)' }}>
              {openPeople ? 'Expanded' : 'Collapsed'}
            </div>
          </div>
          {openPeople ? (
            <div style={{ height: 560, overflow: 'auto', scrollBehavior: 'smooth' }}>
              <div style={{ position: 'sticky', top: 0, zIndex: 3, background: 'white', borderBottom: '1px solid var(--border)', padding: 12 }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <input
                    value={peopleQ}
                    onChange={(e) => setPeopleQ(e.target.value)}
                    placeholder="Search people…"
                    style={{
                      flex: 1,
                      minWidth: 220,
                      padding: '10px 12px',
                      borderRadius: 10,
                      border: '1px solid var(--border)',
                      background: 'var(--surface-0)',
                      fontSize: 12.5,
                    }}
                  />
                  <Pill type="blue">{filtered.length} shown</Pill>
                  <Pill type={availabilityUnallocated.length ? 'amber' : 'green'}>
                    {availabilityUnallocated.length ? 'Gaps to cover' : 'No gaps'}
                  </Pill>
                </div>
              </div>

              <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <details open={openAlloc} onToggle={(e) => setOpenAlloc(e.currentTarget.open)} style={{ border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
                  <summary style={{ listStyle: 'none', cursor: 'pointer', padding: '12px 14px', background: 'var(--surface-1)', display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                    <div style={{ fontWeight: 900, color: 'var(--ink)' }}>
                      People allocations
                      <span style={{ marginLeft: 8, fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-faint)' }}>
                        ({filtered.length} shown)
                      </span>
                    </div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-muted)' }}>{openAlloc ? '▾' : '▸'}</div>
                  </summary>
                  <div style={{ padding: 14 }}>
                    <div style={{
                      padding: 12,
                      borderRadius: 14,
                      border: '1px solid rgba(124,58,237,0.22)',
                      background: 'rgba(124,58,237,0.06)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 10,
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      marginBottom: 12,
                    }}>
                      <div style={{ fontWeight: 900, color: 'var(--ink)' }}>Open form</div>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                        <ActionButton onClick={() => { setPeopleModalFocus('alloc'); setPeopleModalOpen(true) }}>Open full screen</ActionButton>
                        <button
                          onClick={() => setAllocInline(v => !v)}
                          style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid var(--border)', background: 'white', color: 'var(--ink-muted)', fontWeight: 850, cursor: 'pointer' }}
                          title="Show/hide inline editor"
                        >
                          {allocInline ? 'Hide inline' : 'Edit inline'}
                        </button>
                      </div>
                    </div>

                    {allocInline ? (
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width:'100%', borderCollapse:'collapse', fontSize: 12.5 }}>
                          <thead style={{ background: 'var(--surface-1)' }}>
                            <tr>
                              {['Person', 'FTE', 'Utilisation', 'CS&T role allocation', 'Other responsibilities', 'Unallocated', ''].map(h => (
                                <th key={h} style={{ textAlign:'left', padding:'10px 12px', borderBottom:'1px solid var(--border)', fontSize: 10.5, fontWeight: 900, textTransform:'uppercase', letterSpacing:'0.6px', color:'var(--ink-muted)' }}>
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {filtered.map((p, i) => {
                              const rec = allocationsByPerson[p.name] || null
                              const rolePairs = listPctPairs(rec?.roles || {})
                              const otherPairs = listPctPairs(rec?.other || {})
                              const rolesSum = rolePairs.reduce((s, [, v]) => s + (v || 0), 0)
                              const otherSum = otherPairs.reduce((s, [, v]) => s + (v || 0), 0)
                              const total = rolesSum + otherSum
                              const unallocated = Math.max(0, +(100 - total).toFixed(1))
                              const badge = Math.abs(total - 100) < 0.01 ? 'green' : 'amber'
                              const util = utilByName.get(p.name) ?? 0
                              const utilPill = util >= 110 ? 'red' : util >= 90 ? 'amber' : util > 0 ? 'green' : 'blue'
                              return (
                                <tr key={p.name} style={{ background: i % 2 ? 'var(--surface-1)' : 'white', borderBottom:'1px solid var(--border)' }}>
                                  <td style={{ padding:'10px 12px', fontWeight: 800, color:'var(--ink)' }}>{p.name}</td>
                                  <td style={{ padding:'10px 12px', fontFamily:'var(--font-mono)', color:'var(--ink-muted)' }}>{Number(p.fte || 0).toFixed(2)}</td>
                                  <td style={{ padding:'10px 12px' }}>
                                    <Pill type={utilPill}>{Math.round(util)}%</Pill>
                                  </td>
                                  <td style={{ padding:'10px 12px', color:'var(--ink-muted)' }}>
                                    {rolePairs.length ? rolePairs.map(([k, v]) => `${k} ${v}%`).join(' · ') : '—'}
                                  </td>
                                  <td style={{ padding:'10px 12px', color:'var(--ink-muted)' }}>
                                    {otherPairs.length ? otherPairs.map(([k, v]) => `${k} ${v}%`).slice(0, 3).join(' · ') + (otherPairs.length > 3 ? '…' : '') : (
                                      rolePairs.length ? <span style={{ color: 'var(--ink-faint)' }}>{rolePairs.map(([k, v]) => `${k} (${v}%)`).join(' · ')}</span> : '—'
                                    )}
                                  </td>
                                  <td style={{ padding:'10px 12px', color:'var(--ink-muted)' }}>
                                    {unallocated.toFixed(1)}%
                                  </td>
                                  <td style={{ padding:'10px 12px', textAlign:'right' }}>
                                    <div style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                                      <Pill type={badge}>{total.toFixed(0)}%</Pill>
                                      <ActionButton onClick={() => setActiveWorkingDaysPerson(p)}>Working days</ActionButton>
                                      <ActionButton onClick={() => setActivePerson(p)}>Edit</ActionButton>
                                    </div>
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div style={{ fontSize: 12.5, color: 'var(--ink-muted)', lineHeight: 1.7 }}>
                        Use <strong>Open full screen</strong> to edit allocations cleanly (recommended). Inline editing is available if needed.
                      </div>
                    )}
                  </div>
                </details>

                <details open={openBackfill} onToggle={(e) => setOpenBackfill(e.currentTarget.open)} style={{ border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
                  <summary style={{ listStyle: 'none', cursor: 'pointer', padding: '12px 14px', background: 'var(--surface-1)', display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                    <div style={{ fontWeight: 900, color: 'var(--ink)' }}>
                      Coverage &amp; backfills
                      <span style={{ marginLeft: 8, fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-faint)' }}>
                        ({availabilityUnallocated.length ? `${availabilityUnallocated.length} gaps` : 'no gaps'})
                      </span>
                    </div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-muted)' }}>{openBackfill ? '▾' : '▸'}</div>
                  </summary>
                  <div style={{ padding: 14 }}>
                    <div style={{
                      padding: 12,
                      borderRadius: 14,
                      border: '1px solid rgba(124,58,237,0.22)',
                      background: 'rgba(124,58,237,0.06)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 10,
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      marginBottom: 12,
                    }}>
                      <div style={{ fontWeight: 900, color: 'var(--ink)' }}>Open form</div>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                        <ActionButton onClick={() => { setPeopleModalFocus('backfill'); setOpenBackfill(true); setPeopleModalOpen(true) }}>Open full screen</ActionButton>
                        <button
                          onClick={() => setBackfillInline(v => !v)}
                          style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid var(--border)', background: 'white', color: 'var(--ink-muted)', fontWeight: 850, cursor: 'pointer' }}
                          title="Show/hide inline editor"
                        >
                          {backfillInline ? 'Hide inline' : 'Edit inline'}
                        </button>
                      </div>
                    </div>

                    {!backfillInline ? (
                      <div style={{ fontSize: 12.5, color: 'var(--ink-muted)', lineHeight: 1.7 }}>
                        Use <strong>Open full screen</strong> to apply backfills (recommended). Inline editing is available if needed.
                      </div>
                    ) : (
                      <>
                        <div style={{ fontSize: 12.5, color: 'var(--ink-muted)', lineHeight: 1.7 }}>
                          When a person is unavailable (PTO / non-project work), SPARK moves the affected share of their assigned work to <strong>Unassigned</strong>.
                          Reassign it to someone with slack (or override).
                        </div>

                  {availabilityUnallocated.length === 0 ? (
                    <div style={{ marginTop: 10, fontSize: 12.5, color: 'var(--ink-faint)' }}>
                      No unallocated gaps due to PTO/non-project work detected.
                    </div>
                  ) : (
                    <div style={{ marginTop: 12, overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                        <thead style={{ background: 'var(--surface-1)' }}>
                          <tr>
                            {['Month', 'Project', 'Role', 'Unavailable', 'Hours', 'Backfill'].map(h => (
                              <th key={h} style={{ textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 10.5, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--ink-muted)' }}>
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {availabilityUnallocated.slice(0, 12).map((g, i) => {
                            const draft = backfillDrafts?.[g.key] || {}
                            const roleKey = (g.role === 'Analyst 1' || g.role === 'Analyst 2') ? 'Analyst 1' : g.role
                            const opts = rosterOptionsByRole?.[roleKey] || []
                            const sdDefault = monthStartIso(planningYear, g.monthIndex)
                            const edDefault = monthEndIso(planningYear, g.monthIndex)
                            const fromMode = draft.fromMode || 'unassigned'
                            const fromPerson = fromMode === 'source' ? g.sourcePerson : 'Unassigned'
                            const suggestions = suggestCandidates(g.role, g.monthIndex, 5)
                            const suggTop = suggestions.find(s => safeText(s?.name) && safeText(s?.name) !== safeText(g.sourcePerson))?.name || ''
                            const toPerson =
                              draft.toPerson ||
                              suggTop ||
                              (opts.find(n => safeText(n) && safeText(n) !== safeText(g.sourcePerson)) || '') ||
                              ''
                            const startDate = draft.startDate || sdDefault
                            const endDate = draft.endDate || edDefault
                            const badTo = safeText(toPerson) && safeText(toPerson) === safeText(g.sourcePerson)

                            return (
                              <tr key={g.key} style={{ background: i % 2 ? 'var(--surface-1)' : 'white', borderBottom: '1px solid var(--border)' }}>
                                <td style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', color: 'var(--ink-muted)' }}>{MONTHS[g.monthIndex] || g.monthIndex + 1}</td>
                                <td style={{ padding: '10px 12px', fontWeight: 800, color: 'var(--ink)' }}>{g.projectName}</td>
                                <td style={{ padding: '10px 12px', color: 'var(--ink-muted)' }}>{g.role}</td>
                                <td style={{ padding: '10px 12px', color: 'var(--ink-muted)' }}>
                                  <div style={{ fontWeight: 800, color: 'var(--ink)' }}>{g.sourcePerson}</div>
                                  <div style={{ fontSize: 11.5, color: 'var(--ink-faint)' }}>{g.sourceKind}</div>
                                </td>
                                <td style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', fontWeight: 900, color: 'var(--red)' }}>{Math.round(g.hours).toLocaleString()}h</td>
                                <td style={{ padding: '10px 12px', minWidth: 420 }}>
                                  <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 1fr', gap: 8, alignItems: 'end' }}>
                                    <div>
                                      <div style={{ fontSize: 10.5, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--ink-muted)', marginBottom: 6 }}>From</div>
                                      <select
                                        value={fromMode}
                                        onChange={(e) => setBackfillDrafts(prev => ({ ...(prev || {}), [g.key]: { ...(prev?.[g.key] || {}), fromMode: e.target.value } }))}
                                        style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)' }}
                                      >
                                        <option value="unassigned">Unassigned</option>
                                        <option value="source">{g.sourcePerson}</option>
                                      </select>
                                    </div>
                                    <div>
                                      <div style={{ fontSize: 10.5, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--ink-muted)', marginBottom: 6 }}>To</div>
                                      <select
                                        value={toPerson}
                                        onChange={(e) => setBackfillDrafts(prev => ({ ...(prev || {}), [g.key]: { ...(prev?.[g.key] || {}), toPerson: e.target.value } }))}
                                        style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)' }}
                                      >
                                        <option value="">— select —</option>
                                        {opts.map(n => <option key={n} value={n}>{n}</option>)}
                                      </select>
                                    </div>
                                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                                      <button
                                        onClick={async () => {
                                          if (!toPerson) return
                                          if (safeText(toPerson) === safeText(g.sourcePerson)) return
                                          await saveBackfillEntry({
                                            projectId: g.projectId,
                                            role: g.role,
                                            fromPerson,
                                            toPerson,
                                            startDate,
                                            endDate,
                                            note: `Backfill for ${g.sourcePerson} (${MONTHS[g.monthIndex] || g.monthIndex + 1})`,
                                          })
                                          setBackfillDrafts(prev => {
                                            const copy = { ...(prev || {}) }
                                            delete copy[g.key]
                                            return copy
                                          })
                                        }}
                                        style={{
                                          padding: '10px 12px',
                                          borderRadius: 10,
                                          border: 'none',
                                          background: badTo ? 'rgba(148,163,184,1)' : 'var(--accent)',
                                          color: 'white',
                                          fontWeight: 900,
                                          cursor: badTo ? 'not-allowed' : 'pointer',
                                          opacity: badTo ? 0.7 : 1,
                                        }}
                                        title={badTo ? 'Pick someone other than the unavailable person' : 'Apply'}
                                      >
                                        Apply
                                      </button>
                                    </div>
                                  </div>

                                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
                                    <div>
                                      <div style={{ fontSize: 10.5, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--ink-muted)', marginBottom: 6 }}>Start</div>
                                      <input type="date" value={startDate} onChange={(e) => setBackfillDrafts(prev => ({ ...(prev || {}), [g.key]: { ...(prev?.[g.key] || {}), startDate: e.target.value } }))} style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)' }} />
                                    </div>
                                    <div>
                                      <div style={{ fontSize: 10.5, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--ink-muted)', marginBottom: 6 }}>End</div>
                                      <input type="date" value={endDate} onChange={(e) => setBackfillDrafts(prev => ({ ...(prev || {}), [g.key]: { ...(prev?.[g.key] || {}), endDate: e.target.value } }))} style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)' }} />
                                    </div>
                                  </div>

                                  {suggestions.length ? (
                                    <div style={{ marginTop: 10, fontSize: 12, color: 'var(--ink-muted)' }}>
                                      Suggested coverage (highest slack in {MONTHS[g.monthIndex]}):{' '}
                                      <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--ink)' }}>
                                        {suggestions.map(s => `${s.name} (${Math.round(s.slack)}h)`).join(' · ')}
                                      </span>
                                    </div>
                                  ) : null}
                                  {badTo ? (
                                    <div style={{ marginTop: 8, fontSize: 12, color: 'var(--red)' }}>
                                      Pick someone other than <strong>{g.sourcePerson}</strong> (they’re the one unavailable).
                                    </div>
                                  ) : null}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                      {availabilityUnallocated.length > 12 ? (
                        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--ink-faint)' }}>
                          Showing top 12 gaps by hours. Total gaps: {availabilityUnallocated.length}.
                        </div>
                      ) : null}
                    </div>
                  )}

                  <div style={{ marginTop: 14 }}>
                    <Card>
                      <CardHeader title="Existing backfills" tag={`${backfillRows.length}`} />
                      <CardBody>
                        {backfillRows.length === 0 ? (
                          <div style={{ fontSize: 12.5, color: 'var(--ink-muted)' }}>
                            No backfills applied yet.
                          </div>
                        ) : (
                          <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                              <thead style={{ background: 'var(--surface-1)' }}>
                                <tr>
                                  {['Project', 'Role', 'From', 'To', 'Range', 'Note', ''].map(h => (
                                    <th key={h} style={{ textAlign:'left', padding:'10px 12px', borderBottom:'1px solid var(--border)', fontSize: 10.5, fontWeight: 900, textTransform:'uppercase', letterSpacing:'0.6px', color:'var(--ink-muted)' }}>
                                      {h}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {backfillRows.map((r, i) => (
                                  <tr key={r.id || i} style={{ background: i % 2 ? 'var(--surface-1)' : 'white', borderBottom:'1px solid var(--border)' }}>
                                    <td style={{ padding:'10px 12px', fontWeight: 800, color:'var(--ink)' }}>{r.projectId}</td>
                                    <td style={{ padding:'10px 12px', color:'var(--ink-muted)' }}>{r.role}</td>
                                    <td style={{ padding:'10px 12px', color:'var(--ink-muted)' }}>{r.fromPerson}</td>
                                    <td style={{ padding:'10px 12px', color:'var(--ink-muted)' }}>{r.toPerson}</td>
                                    <td style={{ padding:'10px 12px', fontFamily:'var(--font-mono)', color:'var(--ink-muted)' }}>{isoToLabel(r.startDate)} → {isoToLabel(r.endDate)}</td>
                                    <td style={{ padding:'10px 12px', color:'var(--ink-faint)' }}>{r.note || '—'}</td>
                                    <td style={{ padding:'10px 12px', textAlign:'right' }}>
                                      <button
                                        onClick={() => removeBackfillEntry({ projectId: r.projectId, role: r.role, id: r.id })}
                                        style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid rgba(248,113,113,0.35)', background: 'transparent', color: 'var(--red)', fontWeight: 900, cursor: 'pointer' }}
                                      >
                                        Remove
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </CardBody>
                    </Card>
                  </div>
                      </>
                    )}
                  </div>
                </details>
              </div>
            </div>
          ) : null}
        </Card>

        {/* Right: Demand Drivers */}
        <Card style={{ borderRadius: 16, boxShadow: 'var(--shadow-sm)' }}>
          <div
            onClick={() => setOpenDrivers(o => !o)}
            style={{
              padding: '13px 18px',
              borderBottom: openDrivers ? '1px solid var(--border)' : 'none',
              background: 'linear-gradient(90deg, rgba(124,58,237,0.10), rgba(37,99,235,0.06))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              cursor: 'pointer',
              userSelect: 'none',
              gap: 10,
              flexWrap: 'wrap',
            }}
            title={openDrivers ? 'Collapse' : 'Expand'}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <span style={{ fontFamily: 'var(--font-sans)', fontWeight: 750, fontSize: 13.5, color: 'var(--ink)', letterSpacing: '-0.01em' }}>
                Demand Drivers
              </span>
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                padding: '2px 7px',
                borderRadius: 4,
                background: 'rgba(255,255,255,0.75)',
                color: '#312e81',
                fontWeight: 600,
                border: '1px solid var(--border)',
                whiteSpace: 'nowrap',
              }}>
                Impacts demand
              </span>
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-muted)' }}>
              {openDrivers ? '▾' : '▸'}
            </div>
          </div>
          {openDrivers ? (
            <div style={{ height: 560, overflow: 'auto', padding: 12 }}>
              <details style={{ border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden', marginBottom: 12 }}>
                <summary style={{ listStyle: 'none', cursor: 'pointer', padding: '12px 14px', background: 'var(--surface-1)', display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                  <div style={{ fontWeight: 900, color: 'var(--ink)' }}>LM Multipliers</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-muted)' }}>▾</div>
                </summary>
                <div style={{ padding: 14 }}>
                  <div style={{ fontSize: 12.5, color: 'var(--ink-muted)', lineHeight: 1.7, marginBottom: 10 }}>
                    Adjust how <strong>Total LMs</strong> map to <strong>LM multipliers</strong>. (Affects bucket-derived projects only.)
                  </div>
                  {/* Keep existing LM bucket table UI */}
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead style={{ background: 'var(--surface-1)' }}>
                        <tr>
                          {['LMs ≤', 'Baseline', 'Plan override'].map(h => (
                            <th key={h} style={{ textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 10.5, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--ink-muted)' }}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {LM_BUCKET_MULTIPLIERS.map((tier, i) => {
                          const eff = savedLmBuckets?.[i]?.multiplier ?? tier.multiplier
                          const isChanged = eff !== tier.multiplier
                          return (
                            <tr key={tier.maxLMs} style={{ background: i % 2 ? 'var(--surface-1)' : 'white', borderBottom: '1px solid var(--border)' }}>
                              <td style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', color: 'var(--ink)' }}>{tier.maxLMs.toLocaleString()}</td>
                              <td style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', color: 'var(--ink-muted)' }}>{tier.multiplier.toFixed(2)}×</td>
                              <td style={{ padding: '8px 12px' }}>
                                <NumericField
                                  kind="float"
                                  value={eff}
                                  placeholder={tier.multiplier.toFixed(2)}
                                  style={{
                                    width: 120,
                                    padding: '10px 12px',
                                    borderRadius: 10,
                                    border: `1px solid ${isChanged ? 'rgba(167,139,250,0.55)' : 'var(--border)'}`,
                                    fontFamily: 'var(--font-mono)',
                                    background: isChanged ? 'rgba(167,139,250,0.08)' : 'white',
                                  }}
                                  onCommit={(v) => {
                                    const targetVal = (v === undefined || v === null) ? tier.multiplier : v
                                    const next = LM_BUCKET_MULTIPLIERS.map((t, idx) => ({
                                      ...t,
                                      multiplier: idx === i ? targetVal : (savedLmBuckets?.[idx]?.multiplier ?? t.multiplier),
                                    }))
                                    const matchesBaseline = next.every((t, idx) => t.multiplier === LM_BUCKET_MULTIPLIERS[idx].multiplier)
                                    setCapacityField({ lmBucketMultipliers: matchesBaseline ? undefined : next })
                                  }}
                                />
                                <span style={{ marginLeft: 8, fontSize: 11.5, color: isChanged ? 'var(--accent)' : 'var(--ink-faint)' }}>
                                  {isChanged ? 'overridden' : 'baseline'}
                                </span>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  {Array.isArray(savedLmBuckets) && (
                    <button
                      onClick={() => setCapacityField({ lmBucketMultipliers: undefined })}
                      style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid rgba(248,113,113,0.35)', background: 'transparent', color: 'var(--red)', fontWeight: 900, cursor: 'pointer', marginTop: 10 }}
                    >
                      Reset LM bucket table
                    </button>
                  )}
                </div>
              </details>

              <details style={{ border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden', marginBottom: 12 }}>
                <summary style={{ listStyle: 'none', cursor: 'pointer', padding: '12px 14px', background: 'var(--surface-1)', display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                  <div style={{ fontWeight: 900, color: 'var(--ink)' }}>Orbit × VIBE (CSM)</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-muted)' }}>▾</div>
                </summary>
                <div style={{ padding: 14 }}>
                  <div style={{ fontSize: 12.5, color: 'var(--ink-muted)', lineHeight: 1.7, marginBottom: 10 }}>
                    Overrides the <strong>CSM</strong> orbit multiplier lookup used in final utilized hours.
                  </div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead style={{ background: 'var(--surface-1)' }}>
                        <tr>
                          <th style={{ textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 10.5, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--ink-muted)' }}>
                            VIBE \ Orbit
                          </th>
                          {['A', 'B', 'C', 'D'].map(o => (
                            <th key={o} style={{ textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 10.5, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--ink-muted)' }}>
                              {o}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {VIBE_TYPES.map((vibe, rIdx) => (
                          <tr key={vibe} style={{ background: rIdx % 2 ? 'var(--surface-1)' : 'white', borderBottom: '1px solid var(--border)' }}>
                            <td style={{ padding: '10px 12px', fontWeight: 900, color: 'var(--ink)' }}>{vibe}</td>
                            {['A', 'B', 'C', 'D'].map(o => {
                              const k = `${vibe}__${o}`
                              const baseVal = (baselineOrbit?.[k] ?? ORBIT_VIBE_MULTIPLIERS[`${o}_${vibe}`] ?? 0)
                              const has = orbitOverrides?.[k] !== undefined && orbitOverrides?.[k] !== null
                              return (
                                <td key={k} style={{ padding: '8px 12px' }}>
                                  <NumericField
                                    kind="float"
                                    value={has ? orbitOverrides?.[k] : undefined}
                                    placeholder={String(baseVal || 0)}
                                    style={{
                                      width: 110,
                                      padding: '10px 12px',
                                      borderRadius: 10,
                                      border: `1px solid ${has ? 'rgba(167,139,250,0.55)' : 'var(--border)'}`,
                                      fontFamily: 'var(--font-mono)',
                                      background: has ? 'rgba(167,139,250,0.08)' : 'white',
                                    }}
                                    onCommit={(val) => {
                                      const next = { ...(orbitOverrides || {}) }
                                      if (val === undefined || val === null || val === '') delete next[k]
                                      else next[k] = val
                                      setCapacityField({ orbitVibeMultipliers: Object.keys(next).length ? next : undefined })
                                    }}
                                  />
                                  {has ? (
                                    <div style={{ marginTop: 4, fontSize: 10.5, color: 'var(--ink-faint)' }}>
                                      baseline {String(baseVal || 0)}
                                    </div>
                                  ) : null}
                                </td>
                              )
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {capacityConfig?.orbitVibeMultipliers && (
                    <button
                      onClick={() => setCapacityField({ orbitVibeMultipliers: undefined })}
                      style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid rgba(248,113,113,0.35)', background: 'transparent', color: 'var(--red)', fontWeight: 900, cursor: 'pointer', marginTop: 10 }}
                    >
                      Reset Orbit × VIBE overrides
                    </button>
                  )}
                </div>
              </details>

              <details style={{ border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
                <summary style={{ listStyle: 'none', cursor: 'pointer', padding: '12px 14px', background: 'var(--surface-1)', display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                  <div style={{ fontWeight: 900, color: 'var(--ink)' }}>PM Multipliers</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-muted)' }}>▾</div>
                </summary>
                <div style={{ padding: 14 }}>
                  <div style={{
                    padding: 14,
                    borderRadius: 14,
                    border: '1px solid rgba(124,58,237,0.22)',
                    background: 'rgba(124,58,237,0.06)',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
                      <div style={{ fontWeight: 900, color: 'var(--ink)' }}>Primary form</div>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                        <ActionButton onClick={() => setPmModalOpen(true)}>Open full screen</ActionButton>
                        <button
                          onClick={() => setPmInline(v => !v)}
                          style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid var(--border)', background: 'white', color: 'var(--ink-muted)', fontWeight: 850, cursor: 'pointer' }}
                          title="Show/hide inline editor"
                        >
                          {pmInline ? 'Hide inline' : 'Edit inline'}
                        </button>
                      </div>
                    </div>
                    {pmInline ? (
                      <PmTaskMultipliersEditor
                        baselineTasks={baselineDemandTasks || []}
                        value={pmTaskOverrides}
                        onChange={(next) => setCapacityField({ pmTaskMultipliers: next || undefined })}
                      />
                    ) : (
                      <div style={{ fontSize: 12.5, color: 'var(--ink-muted)', lineHeight: 1.7 }}>
                        Use <strong>Open full screen</strong> for editing. Inline editing is available, but the full-screen view is best for scanning the full table.
                      </div>
                    )}
                  </div>
                </div>
              </details>
            </div>
          ) : null}
        </Card>
      </div>

      {pmModalOpen ? createPortal((
        <div
          role="dialog"
          aria-modal="true"
          style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.35)', zIndex: 1200, display: 'grid', placeItems: 'center', padding: 24, overflow: 'auto' }}
          onMouseDown={(e) => { if (e.target === e.currentTarget) setPmModalOpen(false) }}
        >
          <div style={{ width: 'min(1200px, 98vw)', maxHeight: '90vh', overflow: 'hidden', background: 'white', borderRadius: 16, border: '1px solid var(--border)', boxShadow: '0 20px 60px rgba(15, 23, 42, 0.25)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontWeight: 900, fontSize: 14.5, letterSpacing: '-0.01em' }}>PM multipliers</div>
                <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>Plan-wide demand driver (edits persist)</div>
              </div>
              <ActionButton onClick={() => setPmModalOpen(false)}>Close</ActionButton>
            </div>
            <div style={{ padding: 16, overflow: 'auto' }}>
              <PmTaskMultipliersEditor
                baselineTasks={baselineDemandTasks || []}
                value={pmTaskOverrides}
                onChange={(next) => setCapacityField({ pmTaskMultipliers: next || undefined })}
              />
            </div>
          </div>
        </div>
      ), document.body) : null}

      {peopleModalOpen ? createPortal((
        <div
          role="dialog"
          aria-modal="true"
          style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.35)', zIndex: 1200, display: 'grid', placeItems: 'center', padding: 24, overflow: 'auto' }}
          onMouseDown={(e) => { if (e.target === e.currentTarget) setPeopleModalOpen(false) }}
        >
          <div style={{ width: 'min(1400px, 98vw)', maxHeight: '92vh', overflow: 'hidden', background: 'white', borderRadius: 16, border: '1px solid var(--border)', boxShadow: '0 20px 60px rgba(15, 23, 42, 0.25)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontWeight: 900, fontSize: 14.5, letterSpacing: '-0.01em' }}>People allocation &amp; backfill</div>
                <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>Plan-wide controls · allocations, gaps, and backfills</div>
              </div>
              <ActionButton onClick={() => setPeopleModalOpen(false)}>Close</ActionButton>
            </div>
            <div ref={peopleModalBodyRef} style={{ padding: 16, overflow: 'auto' }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
                <input
                  value={peopleQ}
                  onChange={(e) => setPeopleQ(e.target.value)}
                  placeholder="Search people…"
                  style={{
                    flex: 1,
                    minWidth: 260,
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: '1px solid var(--border)',
                    background: 'var(--surface-0)',
                    fontSize: 12.5,
                  }}
                />
                <Pill type="blue">{filtered.length} shown</Pill>
                <Pill type={availabilityUnallocated.length ? 'amber' : 'green'}>
                  {availabilityUnallocated.length ? 'Gaps to cover' : 'No gaps'}
                </Pill>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize: 12.5 }}>
                  <thead style={{ background: 'var(--surface-1)' }}>
                    <tr>
                      {['Person', 'FTE', 'Utilisation', 'CS&T role allocation', 'Other responsibilities', 'Unallocated', ''].map(h => (
                        <th key={h} style={{ textAlign:'left', padding:'10px 12px', borderBottom:'1px solid var(--border)', fontSize: 10.5, fontWeight: 900, textTransform:'uppercase', letterSpacing:'0.6px', color:'var(--ink-muted)' }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((p, i) => {
                      const rec = allocationsByPerson[p.name] || null
                      const rolePairs = listPctPairs(rec?.roles || {})
                      const otherPairs = listPctPairs(rec?.other || {})
                      const rolesSum = rolePairs.reduce((s, [, v]) => s + (v || 0), 0)
                      const otherSum = otherPairs.reduce((s, [, v]) => s + (v || 0), 0)
                      const total = rolesSum + otherSum
                      const unallocated = Math.max(0, +(100 - total).toFixed(1))
                      const badge = Math.abs(total - 100) < 0.01 ? 'green' : 'amber'
                      const util = utilByName.get(p.name) ?? 0
                      const utilPill = util >= 110 ? 'red' : util >= 90 ? 'amber' : util > 0 ? 'green' : 'blue'
                      return (
                        <tr key={p.name} style={{ background: i % 2 ? 'var(--surface-1)' : 'white', borderBottom:'1px solid var(--border)' }}>
                          <td style={{ padding:'10px 12px', fontWeight: 800, color:'var(--ink)' }}>{p.name}</td>
                          <td style={{ padding:'10px 12px', fontFamily:'var(--font-mono)', color:'var(--ink-muted)' }}>{Number(p.fte || 0).toFixed(2)}</td>
                          <td style={{ padding:'10px 12px' }}>
                            <Pill type={utilPill}>{Math.round(util)}%</Pill>
                          </td>
                          <td style={{ padding:'10px 12px', color:'var(--ink-muted)' }}>
                            {rolePairs.length ? rolePairs.map(([k, v]) => `${k} ${v}%`).join(' · ') : '—'}
                          </td>
                          <td style={{ padding:'10px 12px', color:'var(--ink-muted)' }}>
                            {otherPairs.length ? otherPairs.map(([k, v]) => `${k} ${v}%`).slice(0, 3).join(' · ') + (otherPairs.length > 3 ? '…' : '') : (
                              rolePairs.length ? <span style={{ color: 'var(--ink-faint)' }}>{rolePairs.map(([k, v]) => `${k} (${v}%)`).join(' · ')}</span> : '—'
                            )}
                          </td>
                          <td style={{ padding:'10px 12px', color:'var(--ink-muted)' }}>
                            {unallocated.toFixed(1)}%
                          </td>
                          <td style={{ padding:'10px 12px', textAlign:'right' }}>
                            <div style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                              <Pill type={badge}>{total.toFixed(0)}%</Pill>
                              <ActionButton onClick={() => setActiveWorkingDaysPerson(p)}>Working days</ActionButton>
                              <ActionButton onClick={() => setActivePerson(p)}>Edit</ActionButton>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <div ref={peopleModalBackfillRef} style={{ marginTop: 16 }}>
                <details open={openBackfill} onToggle={(e) => setOpenBackfill(e.currentTarget.open)} style={{ border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
                  <summary style={{ listStyle: 'none', cursor: 'pointer', padding: '12px 14px', background: 'var(--surface-1)', display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                    <div style={{ fontWeight: 900, color: 'var(--ink)' }}>Backfill suggestions</div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-muted)' }}>{openBackfill ? '▾' : '▸'}</div>
                  </summary>
                  <div style={{ padding: 14 }}>
                    {/* reuse the same backfill block already rendered inline (kept here for full screen) */}
                    {/* This is intentionally duplicated for UX; logic remains identical */}
                    {availabilityUnallocated.length === 0 ? (
                      <div style={{ fontSize: 12.5, color: 'var(--ink-faint)' }}>No unallocated gaps due to PTO/non-project work detected.</div>
                    ) : (
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                          <thead style={{ background: 'var(--surface-1)' }}>
                            <tr>
                              {['Month', 'Project', 'Role', 'Unavailable', 'Hours', 'Backfill'].map(h => (
                                <th key={h} style={{ textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 10.5, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--ink-muted)' }}>
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {availabilityUnallocated.slice(0, 25).map((g, i) => {
                              const draft = backfillDrafts?.[g.key] || {}
                              const roleKey = (g.role === 'Analyst 1' || g.role === 'Analyst 2') ? 'Analyst 1' : g.role
                              const opts = rosterOptionsByRole?.[roleKey] || []
                              const sdDefault = monthStartIso(planningYear, g.monthIndex)
                              const edDefault = monthEndIso(planningYear, g.monthIndex)
                              const fromMode = draft.fromMode || 'unassigned'
                              const fromPerson = fromMode === 'source' ? g.sourcePerson : 'Unassigned'
                              const suggestions = suggestCandidates(g.role, g.monthIndex, 5)
                              const suggTop = suggestions.find(s => safeText(s?.name) && safeText(s?.name) !== safeText(g.sourcePerson))?.name || ''
                              const toPerson =
                                draft.toPerson ||
                                suggTop ||
                                (opts.find(n => safeText(n) && safeText(n) !== safeText(g.sourcePerson)) || '') ||
                                ''
                              const startDate = draft.startDate || sdDefault
                              const endDate = draft.endDate || edDefault
                              const badTo = safeText(toPerson) && safeText(toPerson) === safeText(g.sourcePerson)

                              return (
                                <tr key={g.key} style={{ background: i % 2 ? 'var(--surface-1)' : 'white', borderBottom: '1px solid var(--border)' }}>
                                  <td style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', color: 'var(--ink-muted)' }}>{MONTHS[g.monthIndex] || g.monthIndex + 1}</td>
                                  <td style={{ padding: '10px 12px', fontWeight: 800, color: 'var(--ink)' }}>{g.projectName}</td>
                                  <td style={{ padding: '10px 12px', color: 'var(--ink-muted)' }}>{g.role}</td>
                                  <td style={{ padding: '10px 12px', color: 'var(--ink-muted)' }}>
                                    <div style={{ fontWeight: 800, color: 'var(--ink)' }}>{g.sourcePerson}</div>
                                    <div style={{ fontSize: 11.5, color: 'var(--ink-faint)' }}>{g.sourceKind}</div>
                                  </td>
                                  <td style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', fontWeight: 900, color: 'var(--red)' }}>{Math.round(g.hours).toLocaleString()}h</td>
                                  <td style={{ padding: '10px 12px', minWidth: 420 }}>
                                    <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 1fr', gap: 8, alignItems: 'end' }}>
                                      <div>
                                        <div style={{ fontSize: 10.5, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--ink-muted)', marginBottom: 6 }}>From</div>
                                        <select
                                          value={fromMode}
                                          onChange={(e) => setBackfillDrafts(prev => ({ ...(prev || {}), [g.key]: { ...(prev?.[g.key] || {}), fromMode: e.target.value } }))}
                                          style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)' }}
                                        >
                                          <option value="unassigned">Unassigned</option>
                                          <option value="source">{g.sourcePerson}</option>
                                        </select>
                                      </div>
                                      <div>
                                        <div style={{ fontSize: 10.5, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--ink-muted)', marginBottom: 6 }}>To</div>
                                        <select
                                          value={toPerson}
                                          onChange={(e) => setBackfillDrafts(prev => ({ ...(prev || {}), [g.key]: { ...(prev?.[g.key] || {}), toPerson: e.target.value } }))}
                                          style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)' }}
                                        >
                                          <option value="">— select —</option>
                                          {opts.map(n => <option key={n} value={n}>{n}</option>)}
                                        </select>
                                      </div>
                                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                                        <button
                                          onClick={async () => {
                                            if (!toPerson) return
                                            if (safeText(toPerson) === safeText(g.sourcePerson)) return
                                            await saveBackfillEntry({
                                              projectId: g.projectId,
                                              role: g.role,
                                              fromPerson,
                                              toPerson,
                                              startDate,
                                              endDate,
                                              note: `Backfill for ${g.sourcePerson} (${MONTHS[g.monthIndex] || g.monthIndex + 1})`,
                                            })
                                            setBackfillDrafts(prev => {
                                              const copy = { ...(prev || {}) }
                                              delete copy[g.key]
                                              return copy
                                            })
                                          }}
                                          style={{
                                            padding: '10px 12px',
                                            borderRadius: 10,
                                            border: 'none',
                                            background: badTo ? 'rgba(148,163,184,1)' : 'var(--accent)',
                                            color: 'white',
                                            fontWeight: 900,
                                            cursor: badTo ? 'not-allowed' : 'pointer',
                                            opacity: badTo ? 0.7 : 1,
                                          }}
                                          title={badTo ? 'Pick someone other than the unavailable person' : 'Apply'}
                                        >
                                          Apply
                                        </button>
                                      </div>
                                    </div>

                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
                                      <div>
                                        <div style={{ fontSize: 10.5, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--ink-muted)', marginBottom: 6 }}>Start</div>
                                        <input type="date" value={startDate} onChange={(e) => setBackfillDrafts(prev => ({ ...(prev || {}), [g.key]: { ...(prev?.[g.key] || {}), startDate: e.target.value } }))} style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)' }} />
                                      </div>
                                      <div>
                                        <div style={{ fontSize: 10.5, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--ink-muted)', marginBottom: 6 }}>End</div>
                                        <input type="date" value={endDate} onChange={(e) => setBackfillDrafts(prev => ({ ...(prev || {}), [g.key]: { ...(prev?.[g.key] || {}), endDate: e.target.value } }))} style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)' }} />
                                      </div>
                                    </div>

                                    {suggestions.length ? (
                                      <div style={{ marginTop: 10, fontSize: 12, color: 'var(--ink-muted)' }}>
                                        Suggested coverage (highest slack in {MONTHS[g.monthIndex]}):{' '}
                                        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--ink)' }}>
                                          {suggestions.map(s => `${s.name} (${Math.round(s.slack)}h)`).join(' · ')}
                                        </span>
                                      </div>
                                    ) : null}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </details>
              </div>
            </div>
          </div>
        </div>
      ), document.body) : null}

      <AllocationModal
        isOpen={!!activePerson}
        onClose={() => setActivePerson(null)}
        person={activePerson}
        existing={activePerson ? (savedAllocationsByPerson[activePerson.name] || defaultAllocationFor(activePerson.name) || null) : null}
        onSave={async (rec) => {
          const nextAlloc = { ...savedAllocationsByPerson, [activePerson.name]: rec }
          const nextConfig = buildNextCapacityConfig(capacityConfig, nextAlloc)
          await onUpdateCapacityConfig?.({ capacityConfig: nextConfig })
        }}
      />

      <CapacityAssumptionsModal
        isOpen={assumptionsOpen}
        onClose={() => setAssumptionsOpen(false)}
        capacityConfig={capacityConfig}
        planLabel={planName}
        persistHint={datasetMode === 'override' ? 'Session change — use “Save as plan” to persist' : null}
        onSave={async ({ capacityConfig: next }) => {
          await onUpdateCapacityConfig?.({ capacityConfig: next })
        }}
      />

      <WorkingDaysModal
        isOpen={!!activeWorkingDaysPerson}
        onClose={() => setActiveWorkingDaysPerson(null)}
        personName={activeWorkingDaysPerson?.name || ''}
        personBaseRole={activeWorkingDaysPerson ? rosterRoleByName.get(activeWorkingDaysPerson.name) : ''}
        planningYear={planningYear}
        baseBusinessDaysByMonth={engineData?.CAPACITY?.CSM?.businessDaysByMonth || null}
        workingDaysConfig={workingDaysConfig}
        onSaveWorkingDaysConfig={async (wdNext) => {
          const nextCfg = buildNextCapacityConfigWithWorkingDays(capacityConfig, wdNext)
          await onUpdateCapacityConfig?.({ capacityConfig: nextCfg })
        }}
      />
    </div>
  )
}

function GridRow({ children }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 14 }}>{children}</div>
}


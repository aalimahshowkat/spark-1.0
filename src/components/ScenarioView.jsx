/**
 * ScenarioView.jsx — Scenario Planning UI
 *
 * Three-panel layout:
 *   LEFT   — Scenario list + actions (always visible)
 *   CENTER — Active panel: edit form | compare view | empty prompt
 *   (no right panel — comparison lives inline in center)
 *
 * Panels:
 *   'list'    — scenario list, no active selection
 *   'edit'    — create / edit overrides (3 tabs: Projects / Resources / Assumptions)
 *   'compare' — baseline vs scenario delta view
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bar } from 'react-chartjs-2'
import { useScenario } from './useScenario.js'
import { buildScenarioCapacityConfig, computeCapacityScenario, getScenarioSummary, ALL_ROLES } from '../engine/scenarioEngine.js'
import { MONTHS, FTE_COUNT, ATTRITION_FACTOR, HRS_PER_PERSON_MONTH, PRIMARY_ROLES, VIBE_TYPES, LM_BUCKET_MULTIPLIERS, ORBIT_VIBE_MULTIPLIERS } from '../engine/schema.js'
import { runCalculations } from '../engine/calculate.js'
import { Card, CardHeader, CardBody, Tag, Pill, AlertBar, KpiStrip, KpiCard } from './ui.jsx'
import { CHART_COLORS } from '../lib/chartSetup.js'
import NumericField from './NumericField.jsx'

// ─── Palette shortcuts ─────────────────────────────────────────────────────
const C = {
  accent:  'var(--accent)',
  surface: 'var(--surface-0)',
  surface1:'var(--surface-1)',
  border:  'var(--border)',
  ink:     'var(--ink)',
  muted:   'var(--ink-muted)',
  faint:   'var(--ink-faint)',
  green:   'var(--green)',
  amber:   'var(--amber)',
  red:     'var(--red)',
  sidebar: 'var(--sidebar-bg)',
}

const PMO_WARN_NAME = 'Aalimah Showkat'

function fmtUpdatedAt(value) {
  try {
    const d = new Date(value)
    if (!Number.isFinite(d.getTime())) return ''
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  } catch {
    return ''
  }
}

export default function ScenarioView({ uploadedFile, baselineCalc, baselineData }) {
  const sc = useScenario(uploadedFile, baselineCalc)
  const { scenarios, panel, setPanel, editDraft, activeScenario } = sc

  const hasFile = !!uploadedFile
  const planningYear = baselineCalc?.meta?.planningYear || 2026

  return (
    <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', minHeight: 600 }}>

      {/* ── LEFT: Scenario list ──────────────────────────────────────── */}
      <ScenarioList sc={sc} hasFile={hasFile} />

      {/* ── CENTER: Panel content ────────────────────────────────────── */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {!hasFile && <NoFilePrompt />}
        {hasFile && panel === 'list' && !activeScenario && <StartPrompt onNew={(opts) => sc.newScenario(opts)} />}
        {hasFile && panel === 'list' && activeScenario  && <ComparePanel sc={sc} baselineCalc={baselineCalc} />}
        {hasFile && panel === 'edit' && editDraft        && <EditPanel sc={sc} baselineIngest={sc.baselineIngest} baselineCalc={baselineCalc} planningYear={planningYear} />}
        {hasFile && panel === 'compare' && activeScenario && <ComparePanel sc={sc} baselineCalc={baselineCalc} />}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// SCENARIO LIST (left column)
// ─────────────────────────────────────────────────────────────────────────

function ScenarioList({ sc, hasFile }) {
  const { scenarios, activeScenarioId, newScenario, selectScenario, editScenario, removeScenario, cloneScenario } = sc

  return (
    <div style={{ width: 256, flexShrink: 0 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13.5, color: C.ink }}>Scenarios</div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>{scenarios.length} saved</div>
        </div>
        <button
          onClick={() => newScenario({ name: '' })}
          disabled={!hasFile}
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '6px 12px', borderRadius: 6,
            background: hasFile ? C.accent : 'var(--surface-1)',
            color: hasFile ? 'white' : C.muted,
            border: 'none', fontSize: 12, fontWeight: 600,
            cursor: hasFile ? 'pointer' : 'not-allowed',
            fontFamily: 'var(--font-sans)',
          }}
        >
          <span style={{ fontSize: 16, lineHeight: 1 }}>+</span> New
        </button>
      </div>

      {/* List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {scenarios.length === 0 && (
          <div style={{ padding: '20px 0', textAlign: 'center', fontSize: 12, color: C.muted }}>
            No scenarios yet
          </div>
        )}
        {scenarios.map(s => {
          const summary = getScenarioSummary(s)
          const isActive = s.id === activeScenarioId
          const updatedLabel = fmtUpdatedAt(s.updatedAt)
          return (
            <div
              key={s.id}
              onClick={() => hasFile && selectScenario(s.id)}
              style={{
                padding: '10px 12px',
                borderRadius: 8,
                border: `1.5px solid ${isActive ? C.accent : C.border}`,
                background: isActive ? 'var(--accent-light)' : C.surface,
                cursor: hasFile ? 'pointer' : 'not-allowed',
                transition: 'border-color 0.12s',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 6 }}>
                <div style={{ fontWeight: 600, fontSize: 12.5, color: isActive ? 'var(--accent-hover, #7c3aed)' : C.ink, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.name || 'Untitled scenario'}
                </div>
                <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                  <IconBtn title="Edit" onClick={e => { e.stopPropagation(); editScenario(s.id) }}>✎</IconBtn>
                  <IconBtn title="Duplicate" onClick={e => { e.stopPropagation(); cloneScenario(s.id) }}>⎘</IconBtn>
                  <IconBtn title="Delete" color={C.red} onClick={e => { e.stopPropagation(); removeScenario(s.id) }}>✕</IconBtn>
                </div>
              </div>
              {summary.totalChanges > 0 && (
                <div style={{ display: 'flex', gap: 5, marginTop: 6, flexWrap: 'wrap' }}>
                  {summary.modified > 0 && <SmallBadge color={C.accent}>{summary.modified} project{summary.modified !== 1 ? 's' : ''}</SmallBadge>}
                  {summary.excluded > 0 && <SmallBadge color={C.red}>{summary.excluded} excluded</SmallBadge>}
                  {summary.added > 0 && <SmallBadge color={'#7c3aed'}>{summary.added} added</SmallBadge>}
                  {summary.fteChanges > 0 && <SmallBadge color={C.green}>{summary.fteChanges} FTE</SmallBadge>}
                  {summary.attritionChanges > 0 && <SmallBadge color={'#7c3aed'}>{summary.attritionChanges} attrition</SmallBadge>}
                  {summary.assumptionChanges > 0 && <SmallBadge color={C.amber}>{summary.assumptionChanges} assumption{summary.assumptionChanges !== 1 ? 's' : ''}</SmallBadge>}
                </div>
              )}
              {summary.totalChanges === 0 && (
                <div style={{ fontSize: 11, color: C.faint, marginTop: 4 }}>No overrides yet</div>
              )}
              {updatedLabel && (
                <div style={{ fontSize: 10, color: C.faint, marginTop: 5 }}>
                  {updatedLabel}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// EDIT PANEL — 3-tab form
// ─────────────────────────────────────────────────────────────────────────

const EDIT_TABS = [
  { id: 'projects',    label: 'Projects' },
  { id: 'resources',   label: 'Role Overrides (Global)' },
  { id: 'attrition',   label: 'Attrition Overrides' },
  { id: 'assumptions', label: 'Assumptions' },
]

function EditPanel({ sc, baselineIngest, baselineCalc, planningYear = 2026 }) {
  const [tab, setTab] = useState('projects')
  const { editDraft, saveEditDraft, discardEditDraft,
          patchDraftProject, removeDraftProject,
          patchDraftResource, patchDraftAssumptions, patchDraftAttrition, editSummary,
          setEditDraft } = sc

  const projects = baselineIngest?.projects || []
  const nameIsValid = !!(editDraft?.name && String(editDraft.name).trim().length > 0)

  const addScenarioProject = useCallback((project) => {
    if (!project) return
    setEditDraft(prev => {
      if (!prev) return prev
      const existing = Array.isArray(prev.addedProjects) ? prev.addedProjects : []
      return { ...prev, addedProjects: [...existing, project] }
    })
  }, [setEditDraft])

  const removeScenarioProject = useCallback((projectId) => {
    if (!projectId) return
    setEditDraft(prev => {
      if (!prev) return prev
      const existing = Array.isArray(prev.addedProjects) ? prev.addedProjects : []
      const nextAdded = existing.filter(p => p?.id !== projectId)
      const { [projectId]: _, ...rest } = (prev.projectOverrides || {})
      return { ...prev, addedProjects: nextAdded, projectOverrides: rest }
    })
  }, [setEditDraft])

  return (
    <div>
      {/* Edit header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ width: '100%' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 12, alignItems: 'end' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 10.5, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 6 }}>
                Scenario name <span style={{ color: C.red }}>*</span>
              </div>
              <input
                value={editDraft.name || ''}
                onChange={e => sc.setEditDraft(prev => ({ ...prev, name: e.target.value }))}
                placeholder="Give this scenario a clear name"
                style={{
                  ...inputStyle(),
                  fontSize: 13.5,
                  fontWeight: 650,
                  borderColor: nameIsValid ? C.border : 'rgba(220,38,38,0.55)',
                  boxShadow: nameIsValid ? 'none' : '0 0 0 3px rgba(220,38,38,0.10)',
                }}
              />
              {!nameIsValid && (
                <div style={{ fontSize: 11.5, color: C.red, marginTop: 7 }}>
                  Name is required before you can save and compare.
                </div>
              )}
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 10.5, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 6 }}>
                Description (optional)
              </div>
              <input
                value={editDraft.description || ''}
                onChange={e => sc.setEditDraft(prev => ({ ...prev, description: e.target.value }))}
                placeholder="What decision does this test?"
                style={inputStyle()}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Change summary pills */}
      {editSummary && editSummary.totalChanges > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 11, color: C.muted, alignSelf: 'center' }}>Active overrides:</div>
          {editSummary.modified > 0    && <Pill type="blue">{editSummary.modified} project{editSummary.modified !== 1 ? 's' : ''} modified</Pill>}
          {editSummary.excluded > 0    && <Pill type="red">{editSummary.excluded} excluded</Pill>}
          {editSummary.added > 0       && <Pill type="purple">{editSummary.added} project{editSummary.added !== 1 ? 's' : ''} added</Pill>}
          {editSummary.fteChanges > 0  && <Pill type="green">{editSummary.fteChanges} FTE override{editSummary.fteChanges !== 1 ? 's' : ''}</Pill>}
          {editSummary.attritionChanges > 0 && <Pill type="purple">{editSummary.attritionChanges} attrition</Pill>}
          {editSummary.assumptionChanges > 0 && <Pill type="amber">{editSummary.assumptionChanges} assumption{editSummary.assumptionChanges !== 1 ? 's' : ''}</Pill>}
        </div>
      )}

      {/* Tab bar */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${C.border}`, marginBottom: 18 }}>
        {EDIT_TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '9px 16px', fontSize: 13, fontWeight: tab === t.id ? 600 : 450,
            color: tab === t.id ? C.accent : C.muted,
            borderBottom: `2px solid ${tab === t.id ? C.accent : 'transparent'}`,
            background: 'none', border: 'none', borderBottomWidth: 2, borderBottomStyle: 'solid',
            borderBottomColor: tab === t.id ? C.accent : 'transparent',
            cursor: 'pointer', fontFamily: 'var(--font-sans)', transition: 'all 0.12s',
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'projects'    && (
        <ProjectOverridesTab
          projects={projects}
          addedProjects={editDraft.addedProjects || []}
          overrides={editDraft.projectOverrides}
          onPatch={patchDraftProject}
          onRemove={removeDraftProject}
          onAddProject={addScenarioProject}
          onRemoveAddedProject={removeScenarioProject}
          baselineIngest={baselineIngest}
          baselineCalc={baselineCalc}
          planningYear={planningYear}
          roster={baselineIngest?.roster || []}
        />
      )}
      {tab === 'resources'   && (
        <ResourceOverridesTab
          overrides={editDraft.resourceOverrides}
          onPatch={patchDraftResource}
          baselineIngest={baselineIngest}
          planningYear={planningYear}
        />
      )}
      {tab === 'attrition'   && (
        <AttritionOverridesTab
          globalAttrition={editDraft.assumptionOverrides?.attritionFactor}
          perRole={editDraft.attritionOverrides || {}}
          onPatchGlobal={(v) => patchDraftAssumptions({ attritionFactor: v })}
          onPatchRole={(role, v) => patchDraftAttrition(role, v)}
        />
      )}
      {tab === 'assumptions' && (
        <AssumptionOverridesTab
          overrides={editDraft.assumptionOverrides}
          onPatch={patchDraftAssumptions}
          baselineIngest={baselineIngest}
          planningYear={planningYear}
        />
      )}

      {/* Action bar */}
      <div style={{ display: 'flex', gap: 10, marginTop: 20, paddingTop: 16, borderTop: `1px solid ${C.border}` }}>
        <button
          onClick={() => nameIsValid && saveEditDraft()}
          disabled={!nameIsValid}
          style={{
            ...btnStyle('primary'),
            opacity: nameIsValid ? 1 : 0.55,
            cursor: nameIsValid ? 'pointer' : 'not-allowed',
          }}
          title={!nameIsValid ? 'Scenario name is required' : 'Save scenario and compare'}
        >
          Save &amp; Compare →
        </button>
        <button onClick={discardEditDraft} style={btnStyle('ghost')}>
          Discard
        </button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// PROJECT OVERRIDES TAB
// ─────────────────────────────────────────────────────────────────────────

function ProjectOverridesTab({
  projects,
  addedProjects = [],
  overrides,
  onPatch,
  onRemove,
  onAddProject,
  onRemoveAddedProject,
  baselineIngest,
  baselineCalc,
  planningYear = 2026,
  roster = [],
}) {
  const [search, setSearch] = useState('')
  const [showOverridesOnly, setShowOverridesOnly] = useState(false)
  const scrollRef = useRef(null)
  const [openById, setOpenById] = useState({})
  const prevShowOverridesOnlyRef = useRef(false)
  const [showAddModal, setShowAddModal] = useState(false)

  const addedSafe = Array.isArray(addedProjects) ? addedProjects : []
  const addedIdSet = useMemo(() => new Set(addedSafe.map(p => p?.id).filter(Boolean)), [addedSafe])

  const allProjects = useMemo(() => {
    const added = addedSafe.map(p => ({ ...p, __scenarioOnly: true }))
    return [...added, ...(Array.isArray(projects) ? projects : [])]
  }, [projects, addedSafe])

  const rosterByRole = useMemo(() => {
    const norm = (s) => String(s || '').trim()
    const add = (map, role, name) => {
      const r = norm(role); const n = norm(name)
      if (!r || !n) return
      if (!map[r]) map[r] = new Set()
      map[r].add(n)
    }
    const map = {}
    for (const p of Array.isArray(roster) ? roster : []) {
      const role = norm(p?.role); const name = norm(p?.name)
      if (!role || !name) continue
      add(map, role === 'Analyst' ? 'Analyst 1' : role, name)
    }
    for (const pr of Array.isArray(allProjects) ? allProjects : []) {
      add(map, 'CSM', pr?.assignedCSM)
      add(map, 'PM', pr?.assignedPM)
      add(map, 'Analyst 1', pr?.assignedAnalyst1)
      add(map, 'Analyst 2', pr?.assignedAnalyst2)
    }
    const a1 = map['Analyst 1'] || new Set()
    const a2 = map['Analyst 2'] || new Set()
    const analystUnion = new Set([...a1, ...a2])
    if (analystUnion.size) { map['Analyst 1'] = analystUnion; map['Analyst 2'] = analystUnion }
    const out = {}
    for (const [role, set] of Object.entries(map)) {
      out[role] = [...set].sort((a, b) => a.localeCompare(b))
    }
    return out
  }, [roster, allProjects])

  const filtered = useMemo(() => {
    return allProjects.filter(p => {
      if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false
      if (showOverridesOnly && !overrides[p.id] && !p.__scenarioOnly) return false
      return true
    })
  }, [allProjects, search, showOverridesOnly, overrides])

  const overrideCount = Object.keys(overrides).length
  const overriddenIds = useMemo(() => Object.keys(overrides || {}), [overrides])

  // Toggle "show modified only":
  //   1 modified project  → auto-expand it
  //   2+ modified         → show collapsed list, expand per click
  useEffect(() => {
    const was = prevShowOverridesOnlyRef.current
    prevShowOverridesOnlyRef.current = showOverridesOnly
    if (was || !showOverridesOnly) return
    if (!overriddenIds || overriddenIds.length <= 1) {
      const onlyId = overriddenIds?.[0]
      if (onlyId) setOpenById(prev => ({ ...prev, [onlyId]: true }))
      return
    }
    setOpenById({})
  }, [showOverridesOnly, overriddenIds])

  // Stable callbacks so ProjectOverrideRow (memo'd) doesn't re-render on every
  // editDraft change. This is the core fix for "everything re-renders on every keystroke".
  const handleToggle = useCallback((id) => {
    setOpenById(prev => ({ ...prev, [id]: !prev[id] }))
  }, [])

  const handlePatch = useCallback((id, patch) => {
    setOpenById(prev => ({ ...prev, [id]: true }))
    onPatch(id, patch)
  }, [onPatch])

  const handleClear = useCallback((id) => {
    onRemove(id)
  }, [onRemove])

  return (
    <div>
      {showAddModal && (
        <AddScenarioProjectModal
          planningYear={planningYear}
          rosterByRole={rosterByRole}
          baselineIngest={baselineIngest}
          baselineCalc={baselineCalc}
          onClose={() => setShowAddModal(false)}
          onAdd={(proj) => { onAddProject?.(proj); setShowAddModal(false) }}
        />
      )}
      <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 14, lineHeight: 1.6 }}>
        Override individual project parameters — dates, LMs, VIBE type, or exclude projects entirely.
        Changes are additive: only what you set is modified.
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, alignItems: 'center' }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search projects\u2026"
          style={inputStyle({ width: 220 })}
        />
        <button
          onClick={() => setShowAddModal(true)}
          style={{ ...btnStyle('ghost'), padding: '6px 10px', fontSize: 12 }}
          title="Add a scenario-only project (does not affect baseline plan)"
        >
          + Add project
        </button>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.muted, cursor: 'pointer' }}>
          <input type="checkbox" checked={showOverridesOnly} onChange={e => setShowOverridesOnly(e.target.checked)} />
          Show modified only
        </label>
        {showOverridesOnly && (
          <div style={{ fontSize: 11, color: C.faint }}>
            Tip: uncheck to edit multiple projects.
          </div>
        )}
        {import.meta?.env?.DEV && (
          <div style={{ fontSize: 10.5, color: '#059669', fontWeight: 700 }}>
            \u2713 UI v3
          </div>
        )}
        {overrideCount > 0 && (
          <div style={{ marginLeft: 'auto', fontSize: 11, color: C.accent, fontWeight: 600 }}>
            {overrideCount} project{overrideCount !== 1 ? 's' : ''} overridden
          </div>
        )}
        {overrideCount === 0 && addedSafe.length > 0 && (
          <div style={{ marginLeft: 'auto', fontSize: 11, color: '#7c3aed', fontWeight: 700 }}>
            {addedSafe.length} scenario project{addedSafe.length !== 1 ? 's' : ''} added
          </div>
        )}
      </div>

      <div
        ref={scrollRef}
        data-spark-scroll="project-overrides"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          maxHeight: 460,
          overflowY: 'auto',
          paddingRight: 2,
          // Prevent scroll chaining to the page when you hit the top/bottom.
          overscrollBehavior: 'contain',
        }}
      >
        {filtered.map(p => (
          <ProjectOverrideRow
            key={p.id}
            project={p}
            override={overrides[p.id] || null}
            open={!!openById[p.id]}
            onToggle={handleToggle}
            onPatch={handlePatch}
            onClear={handleClear}
            rosterByRole={rosterByRole}
            isScenarioOnly={!!p.__scenarioOnly}
            onRemoveScenarioProject={onRemoveAddedProject}
          />
        ))}
        {filtered.length === 0 && (
          <div style={{ padding: '30px 0', textAlign: 'center', fontSize: 12, color: C.muted }}>
            No projects match
          </div>
        )}
      </div>
    </div>
  )
}

function AddScenarioProjectModal({ planningYear = 2026, rosterByRole = {}, baselineIngest, baselineCalc, onClose, onAdd }) {
  const [name, setName] = useState('')
  const [vibeType, setVibeType] = useState(VIBE_TYPES?.[0] || 'Bond')
  const [startMonth, setStartMonth] = useState(0)
  const [deliveryMonth, setDeliveryMonth] = useState(1)
  const [orbit, setOrbit] = useState('A')
  const [totalLMs, setTotalLMs] = useState(0)
  const [analystUtilPct, setAnalystUtilPct] = useState(70)
  const [assignedCSM, setAssignedCSM] = useState('')
  const [assignedPM, setAssignedPM] = useState('')
  const [assignedAnalyst1, setAssignedAnalyst1] = useState('')
  const [assignedAnalyst2, setAssignedAnalyst2] = useState('')
  const [pmoAck, setPmoAck] = useState({ CSM: false, PM: false, A1: false, A2: false })
  const [pmoWarn, setPmoWarn] = useState({ CSM: false, PM: false, A1: false, A2: false })
  const [recNote, setRecNote] = useState('')
  const [recBusy, setRecBusy] = useState(false)
  const [recDetails, setRecDetails] = useState(null) // { CSM:[{name,overflow,util}], PM:..., A1:..., A2:... }
  const [lastPick, setLastPick] = useState({ CSM: '', PM: '', A1: '', A2: '' })

  const deriveLm = useCallback((lm) => {
    const x = Number(lm)
    if (!Number.isFinite(x) || x <= 0) return 1
    const tiers = Array.isArray(LM_BUCKET_MULTIPLIERS) && LM_BUCKET_MULTIPLIERS.length > 0 ? LM_BUCKET_MULTIPLIERS : []
    for (const bucket of tiers) {
      if (x <= bucket.maxLMs) return bucket.multiplier
    }
    return tiers.length ? tiers[tiers.length - 1].multiplier : 1
  }, [])

  const canSave = String(name || '').trim().length > 0

  const normName = useCallback((s) => String(s || '').trim(), [])
  const maybeWarnPmo = useCallback((key, nameValue) => {
    const n = normName(nameValue)
    if (n !== PMO_WARN_NAME) return
    setPmoWarn(prev => (prev?.[key] ? prev : { ...prev, [key]: true }))
  }, [normName])

  const suggestStaffing = useCallback(async () => {
    setRecBusy(true)
    setRecNote('')
    setRecDetails(null)
    try {
      const ingest = baselineIngest
      const baseCalc = baselineCalc
      if (!ingest || !baseCalc) {
        setRecNote('Recommendations unavailable (baseline not loaded yet).')
        return
      }

      const sIdx = Math.max(0, Math.min(11, Number(startMonth)))
      const dIdx = Math.max(sIdx, Math.min(11, Number(deliveryMonth)))
      const startDate = new Date(planningYear, sIdx, 1)
      const deliveryDate = new Date(planningYear, dIdx, 1)
      const deliveryDateExact = new Date(Date.UTC(planningYear, dIdx, 15))

      const lm = Number(totalLMs)
      const pct = Number(analystUtilPct)

      // Compute incremental hours for this project only using the engine.
      const tmpProj = {
        id: 'tmp_reco',
        name: String(name || '').trim() || 'New scenario project',
        vibeType,
        orbit: String(orbit || 'A').trim().toUpperCase(),
        totalLMs: Number.isFinite(lm) ? lm : 0,
        lmMultiplier: deriveLm(lm),
        analystUtilPct: Number.isFinite(pct) ? pct : 70,
        startDate,
        deliveryDate,
        analyticsStartDate: startDate,
        startMonthIndex: sIdx,
        deliveryMonthIndex: dIdx,
        deliveryDateExact,
        status: 'In Progress',
        // Ensure analyst split behaves like “both staffed”
        assignedCSM: 'temp',
        assignedPM: 'temp',
        assignedAnalyst1: 'temp',
        assignedAnalyst2: 'temp',
      }

      const calcOne = runCalculations(
        [tmpProj],
        ingest.demandMatrix,
        ingest.orbitMultipliers || {},
        planningYear,
        { roster: ingest.roster || [] }
      )

      const byRole = { CSM: new Array(12).fill(0), PM: new Array(12).fill(0), 'Analyst 1': new Array(12).fill(0), 'Analyst 2': new Array(12).fill(0) }
      for (const row of (calcOne?.assignments || [])) {
        if (!byRole[row.role]) continue
        const mi = Number.isFinite(+row.monthIndex) ? +row.monthIndex : 0
        byRole[row.role][mi] += Number(row.finalHours || 0)
      }

      const baseConfig = buildScenarioCapacityConfig({ roster: ingest.roster || [], planningYear })
      const baseCap = computeCapacityScenario(baseConfig)
      const capSeries = (role) => {
        const key = role === 'Analyst 2' ? 'Analyst 1' : role === 'Analyst 1' ? 'Analyst 1' : role
        return baseCap?.[key]?.hrsPerPersonMonthByMonth || new Array(12).fill(HRS_PER_PERSON_MONTH)
      }

      const personMonthlyByRole = (() => {
        const out = { CSM: new Map(), PM: new Map(), 'Analyst 1': new Map(), 'Analyst 2': new Map() }
        const rows = baseCalc?.demandByPerson || {}
        for (const v of Object.values(rows)) {
          const role = v?.role
          if (!out[role]) continue
          const n = String(v?.name || '').trim()
          if (!n) continue
          out[role].set(n, Array.isArray(v?.monthly) ? v.monthly : new Array(12).fill(0))
        }
        return out
      })()

      const scoreCandidate = (role, personName) => {
        const baseArr = personMonthlyByRole[role]?.get(personName) || new Array(12).fill(0)
        const addArr = byRole[role] || new Array(12).fill(0)
        const capArr = capSeries(role)
        let overflow = 0
        let utilNum = 0
        let utilDen = 0
        for (let i = 0; i < 12; i++) {
          if ((addArr[i] || 0) <= 0) continue
          const newLoad = (baseArr[i] || 0) + (addArr[i] || 0)
          const cap = capArr[i] || HRS_PER_PERSON_MONTH
          overflow += Math.max(0, newLoad - cap)
          utilNum += newLoad
          utilDen += cap
        }
        const util = utilDen ? (utilNum / utilDen) : 0
        const totalAdd = addArr.reduce((s, v) => s + (v || 0), 0)
        return { overflow, util, totalAdd }
      }

      const rankCandidates = (role, candidates) => {
        const rows = (candidates || [])
          .map(n => ({ name: n, ...scoreCandidate(role, n) }))
          .sort((a, b) =>
            a.overflow - b.overflow ||
            a.util - b.util ||
            a.name.localeCompare(b.name)
          )
        return rows
      }

      const balancedPick = (ranked, roleKey) => {
        const best = ranked?.[0]
        if (!best) return ''
        const bestOverflow = best.overflow || 0
        const bestUtil = best.util || 0
        // “Very close” = same overflow (within 0.5h) AND within +5 utilization points.
        const close = (ranked || []).filter(r =>
          (r.overflow || 0) <= bestOverflow + 0.5 &&
          (r.util || 0) <= bestUtil + 0.05
        )
        const prev = lastPick?.[roleKey] || ''
        const pick = (close.find(r => r.name !== prev) || close[0] || best).name
        return pick || ''
      }

      const rankedCSM = rankCandidates('CSM', rosterByRole?.CSM || [])
      const rankedPM  = rankCandidates('PM', rosterByRole?.PM || [])
      const analysts = rosterByRole?.['Analyst 1'] || []
      const rankedA1 = rankCandidates('Analyst 1', analysts)
      const recA1 = balancedPick(rankedA1, 'A1')
      const rankedA2 = rankCandidates('Analyst 2', analysts.filter(n => n !== recA1))

      const recCsm = balancedPick(rankedCSM, 'CSM')
      const recPm  = balancedPick(rankedPM, 'PM')
      const recA2  = balancedPick(rankedA2, 'A2')

      if (recCsm) setAssignedCSM(recCsm)
      if (recPm) setAssignedPM(recPm)
      if (recA1) setAssignedAnalyst1(recA1)
      if (recA2) setAssignedAnalyst2(recA2)

      // If a recommendation selects Aalimah, warn inline (do not block).
      if (!pmoAck?.CSM) maybeWarnPmo('CSM', recCsm)
      if (!pmoAck?.PM)  maybeWarnPmo('PM', recPm)
      if (!pmoAck?.A1)  maybeWarnPmo('A1', recA1)
      if (!pmoAck?.A2)  maybeWarnPmo('A2', recA2)

      setLastPick({ CSM: recCsm, PM: recPm, A1: recA1, A2: recA2 })

      setRecDetails({
        CSM: rankedCSM.slice(0, 3),
        PM: rankedPM.slice(0, 3),
        A1: rankedA1.slice(0, 3),
        A2: rankedA2.slice(0, 3),
      })

      setRecNote('Suggested staffing based on lowest projected overload during the project months.')
    } finally {
      setRecBusy(false)
    }
  }, [baselineIngest, baselineCalc, startMonth, deliveryMonth, planningYear, name, vibeType, orbit, totalLMs, analystUtilPct, deriveLm, rosterByRole, maybeWarnPmo, pmoAck])

  const handleAdd = () => {
    if (!canSave) return
    const sIdx = Math.max(0, Math.min(11, Number(startMonth)))
    const dIdx = Math.max(sIdx, Math.min(11, Number(deliveryMonth)))
    const startDate = new Date(planningYear, sIdx, 1)
    const deliveryDate = new Date(planningYear, dIdx, 1)
    const deliveryDateExact = new Date(Date.UTC(planningYear, dIdx, 15))
    const id = `scproj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const lm = Number(totalLMs)
    const pct = Number(analystUtilPct)
    const proj = {
      id,
      name: String(name).trim(),
      vibeType,
      orbit: String(orbit || 'A').trim().toUpperCase(),
      totalLMs: Number.isFinite(lm) ? lm : 0,
      lmMultiplier: deriveLm(lm),
      analystUtilPct: Number.isFinite(pct) ? pct : 70,
      startDate,
      deliveryDate,
      // Analyst timelines rely on analyticsStartDate; default to startDate.
      analyticsStartDate: startDate,
      startMonthIndex: sIdx,
      deliveryMonthIndex: dIdx,
      deliveryDateExact,
      status: 'In Progress',
      assignedCSM: assignedCSM || 'Unassigned',
      assignedPM: assignedPM || 'Unassigned',
      assignedAnalyst1: assignedAnalyst1 || 'Unassigned',
      assignedAnalyst2: assignedAnalyst2 || 'Unassigned',
      // Mark as scenario-only (UI convenience; engine ignores unknown fields).
      __scenarioOnly: true,
    }
    onAdd?.(proj)
  }

  const overlay = {
    position: 'fixed',
    inset: 0,
    background: 'rgba(15,23,42,0.40)',
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  }

  return (
    <div style={overlay} onMouseDown={onClose}>
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: 620,
          maxWidth: '100%',
          maxHeight: '85vh',
          overflow: 'auto',
          background: 'white',
          borderRadius: 10,
          border: `1px solid ${C.border}`,
          boxShadow: '0 20px 60px rgba(15,23,42,0.30)',
        }}
      >
        <div style={{ padding: '14px 16px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 13 }}>Add scenario project</div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
              This project exists only inside this scenario — the baseline dataset is unchanged.
            </div>
          </div>
          <button onClick={onClose} style={btnStyle('ghost')}>✕</button>
        </div>

        <div style={{ padding: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 12 }}>
            <FieldGroup label="Project name *">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. New customer rollout" style={inputStyle()} />
              {!canSave && <div style={{ fontSize: 11, color: C.red, marginTop: 6 }}>Name is required.</div>}
            </FieldGroup>
            <FieldGroup label="VIBE type">
              <select value={vibeType} onChange={(e) => setVibeType(e.target.value)} style={inputStyle()}>
                {VIBE_TYPES.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </FieldGroup>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 0.8fr', gap: 12, marginTop: 12 }}>
            <FieldGroup label="Start month">
              <select value={startMonth} onChange={(e) => setStartMonth(Number(e.target.value))} style={inputStyle()}>
                {MONTHS.map((m, i) => <option key={m} value={i}>{m} {planningYear}</option>)}
              </select>
            </FieldGroup>
            <FieldGroup label="Delivery month">
              <select value={deliveryMonth} onChange={(e) => setDeliveryMonth(Number(e.target.value))} style={inputStyle()}>
                {MONTHS.map((m, i) => <option key={m} value={i}>{m} {planningYear}</option>)}
              </select>
            </FieldGroup>
            <FieldGroup label="Orbit">
              <select value={orbit} onChange={(e) => setOrbit(e.target.value)} style={inputStyle()}>
                {['A', 'B', 'C', 'D'].map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </FieldGroup>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
            <FieldGroup label="Total LMs">
              <NumericField value={totalLMs} onCommit={(v) => setTotalLMs(v ?? 0)} placeholder="0" />
              <div style={{ fontSize: 10.5, color: C.faint, marginTop: 4 }}>
                LM multiplier auto-derived from bucket table.
              </div>
            </FieldGroup>
            <FieldGroup label="Analyst 1 load (%)">
              <NumericField value={analystUtilPct} onCommit={(v) => setAnalystUtilPct(v ?? 70)} placeholder="70" />
              <div style={{ fontSize: 10.5, color: C.faint, marginTop: 4 }}>
                Remaining load applies to Analyst 2.
              </div>
            </FieldGroup>
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={suggestStaffing}
              disabled={recBusy}
              style={{ ...btnStyle('ghost'), padding: '7px 10px', fontSize: 12.5 }}
              title="Suggest staffing based on who has the most slack in the project months"
            >
              {recBusy ? 'Suggesting…' : 'Suggest staffing'}
            </button>
            {recNote && (
              <div style={{ fontSize: 11.5, color: recNote.includes('unavailable') ? C.red : C.faint }}>
                {recNote}
              </div>
            )}
          </div>
          {recDetails && (
            <div style={{ marginTop: 8, fontSize: 11.5, color: C.faint, lineHeight: 1.55 }}>
              <div><strong style={{ color: C.muted }}>Top picks</strong> (overflow, util in project months):</div>
              <div><strong>CSM:</strong> {recDetails.CSM.map(x => `${x.name} (${Math.round(x.overflow)}h, ${(x.util * 100).toFixed(0)}%)`).join(' · ') || '—'}</div>
              <div><strong>PM:</strong> {recDetails.PM.map(x => `${x.name} (${Math.round(x.overflow)}h, ${(x.util * 100).toFixed(0)}%)`).join(' · ') || '—'}</div>
              <div><strong>Analyst 1:</strong> {recDetails.A1.map(x => `${x.name} (${Math.round(x.overflow)}h, ${(x.util * 100).toFixed(0)}%)`).join(' · ') || '—'}</div>
              <div><strong>Analyst 2:</strong> {recDetails.A2.map(x => `${x.name} (${Math.round(x.overflow)}h, ${(x.util * 100).toFixed(0)}%)`).join(' · ') || '—'}</div>
            </div>
          )}

          <div style={{ marginTop: 14, fontSize: 12, fontWeight: 700, color: C.muted }}>Assignments (optional)</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 10 }}>
            <FieldGroup label="CSM">
              <input
                list="sc_add_csm"
                value={assignedCSM}
                onChange={(e) => {
                  const v = e.target.value
                  setAssignedCSM(v)
                  if (!pmoAck?.CSM) maybeWarnPmo('CSM', v)
                }}
                placeholder="Pick or type"
                style={inputStyle()}
              />
              {pmoWarn?.CSM && normName(assignedCSM) === PMO_WARN_NAME && (
                <InlineWarn
                  text="Utilization in PMO as well. Bandwidth may be split across departments. Continue?"
                  onProceed={() => { setPmoAck(prev => ({ ...prev, CSM: true })); setPmoWarn(prev => ({ ...prev, CSM: false })) }}
                  onChooseElse={() => { setAssignedCSM(''); setPmoWarn(prev => ({ ...prev, CSM: false })) }}
                />
              )}
              <datalist id="sc_add_csm">{(rosterByRole?.CSM || []).map(n => <option key={n} value={n} />)}</datalist>
            </FieldGroup>
            <FieldGroup label="PM">
              <input
                list="sc_add_pm"
                value={assignedPM}
                onChange={(e) => {
                  const v = e.target.value
                  setAssignedPM(v)
                  if (!pmoAck?.PM) maybeWarnPmo('PM', v)
                }}
                placeholder="Pick or type"
                style={inputStyle()}
              />
              {pmoWarn?.PM && normName(assignedPM) === PMO_WARN_NAME && (
                <InlineWarn
                  text="Utilization in PMO as well. Bandwidth may be split across departments. Continue?"
                  onProceed={() => { setPmoAck(prev => ({ ...prev, PM: true })); setPmoWarn(prev => ({ ...prev, PM: false })) }}
                  onChooseElse={() => { setAssignedPM(''); setPmoWarn(prev => ({ ...prev, PM: false })) }}
                />
              )}
              <datalist id="sc_add_pm">{(rosterByRole?.PM || []).map(n => <option key={n} value={n} />)}</datalist>
            </FieldGroup>
            <FieldGroup label="Analyst 1">
              <input
                list="sc_add_a1"
                value={assignedAnalyst1}
                onChange={(e) => {
                  const v = e.target.value
                  setAssignedAnalyst1(v)
                  if (!pmoAck?.A1) maybeWarnPmo('A1', v)
                }}
                placeholder="Pick or type"
                style={inputStyle()}
              />
              {pmoWarn?.A1 && normName(assignedAnalyst1) === PMO_WARN_NAME && (
                <InlineWarn
                  text="Utilization in PMO as well. Bandwidth may be split across departments. Continue?"
                  onProceed={() => { setPmoAck(prev => ({ ...prev, A1: true })); setPmoWarn(prev => ({ ...prev, A1: false })) }}
                  onChooseElse={() => { setAssignedAnalyst1(''); setPmoWarn(prev => ({ ...prev, A1: false })) }}
                />
              )}
              <datalist id="sc_add_a1">{(rosterByRole?.['Analyst 1'] || []).map(n => <option key={n} value={n} />)}</datalist>
            </FieldGroup>
            <FieldGroup label="Analyst 2">
              <input
                list="sc_add_a2"
                value={assignedAnalyst2}
                onChange={(e) => {
                  const v = e.target.value
                  setAssignedAnalyst2(v)
                  if (!pmoAck?.A2) maybeWarnPmo('A2', v)
                }}
                placeholder="Pick or type"
                style={inputStyle()}
              />
              {pmoWarn?.A2 && normName(assignedAnalyst2) === PMO_WARN_NAME && (
                <InlineWarn
                  text="Utilization in PMO as well. Bandwidth may be split across departments. Continue?"
                  onProceed={() => { setPmoAck(prev => ({ ...prev, A2: true })); setPmoWarn(prev => ({ ...prev, A2: false })) }}
                  onChooseElse={() => { setAssignedAnalyst2(''); setPmoWarn(prev => ({ ...prev, A2: false })) }}
                />
              )}
              <datalist id="sc_add_a2">{(rosterByRole?.['Analyst 2'] || rosterByRole?.['Analyst 1'] || []).map(n => <option key={n} value={n} />)}</datalist>
            </FieldGroup>
          </div>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18, paddingTop: 14, borderTop: `1px solid ${C.border}` }}>
            <button onClick={onClose} style={btnStyle('ghost')}>Cancel</button>
            <button onClick={handleAdd} disabled={!canSave} style={{ ...btnStyle('primary'), opacity: canSave ? 1 : 0.55 }}>
              Add project
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// React.memo is essential here.
// Without it, every patchDraftProject call (each keystroke in any input) rebuilds
// the entire editDraft object, which re-renders EditPanel, which re-renders ALL rows,
// which resets local state (draft text, focus) in every RosterAssignmentField.
// That cascade was the "freeze" — inputs would lose their value mid-typing.
const ProjectOverrideRow = React.memo(function ProjectOverrideRow({
  project, override, open, onToggle, onPatch, onClear, rosterByRole,
  isScenarioOnly = false,
  onRemoveScenarioProject,
}) {
  const hasOverride = !!override && Object.keys(override).filter(k => override[k] !== undefined && override[k] !== false).length > 0
  const isExcluded = override?.exclude === true

  const VIBE_COLOR = { Bond: '#2563eb', Validate: '#059669', Integrate: '#dc2626', Explore: '#d97706' }

  // Per-row stable callbacks so inner memo'd fields don't re-render unnecessarily.
  const handleToggleThis = useCallback(() => onToggle(project.id), [onToggle, project.id])
  const handlePatchThis  = useCallback((patch) => onPatch(project.id, patch), [onPatch, project.id])
  const handleClearThis  = useCallback(() => onClear(project.id), [onClear, project.id])

  return (
    <div style={{
      border: `1px solid ${hasOverride ? C.accent : C.border}`,
      borderRadius: 8,
      background: isExcluded ? 'var(--red-light)' : (hasOverride ? 'var(--accent-light)' : C.surface),
      // Keep corners clean when collapsed, but allow expanded content
      // (e.g. browser pickers / suggestion UI) to overflow if needed.
      overflow: open ? 'visible' : 'hidden',
    }}>
      {/* Row header */}
      <div
        onClick={handleToggleThis}
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', cursor: 'pointer' }}
      >
        <span style={{ fontSize: 10, color: C.faint, width: 12, textAlign: 'center' }}>{open ? '\u25be' : '\u25b8'}</span>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: VIBE_COLOR[project.vibeType] || '#888', flexShrink: 0 }} />
        <span style={{ flex: 1, fontSize: 12.5, fontWeight: hasOverride ? 600 : 400, color: isExcluded ? C.red : C.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: isExcluded ? 'line-through' : 'none' }}>
          {project.name}
        </span>
        <span style={{ fontSize: 10.5, color: C.muted, flexShrink: 0 }}>{project.vibeType}</span>
        {hasOverride && !isExcluded && <SmallBadge color={C.accent}>Modified</SmallBadge>}
        {isExcluded && <SmallBadge color={C.red}>Excluded</SmallBadge>}
        {isScenarioOnly && <SmallBadge color={'#7c3aed'}>Scenario</SmallBadge>}
        {isScenarioOnly && (
          <button
            title="Remove this scenario-only project"
            onClick={(e) => { e.stopPropagation(); onRemoveScenarioProject?.(project.id) }}
            style={{
              marginLeft: 6,
              background: 'var(--red-light)',
              border: '1px solid #fecaca',
              color: '#991b1b',
              borderRadius: 6,
              padding: '2px 8px',
              fontSize: 11.5,
              fontWeight: 700,
              cursor: 'pointer',
              fontFamily: 'var(--font-sans)',
              lineHeight: 1.4,
            }}
          >
            Remove
          </button>
        )}
        {hasOverride && (
          <button
            title="Clear all overrides"
            onClick={(e) => { e.stopPropagation(); handleClearThis() }}
            style={{
              marginLeft: 6, background: 'var(--red-light)', border: '1px solid #fecaca',
              color: '#991b1b', borderRadius: 6, padding: '2px 8px', fontSize: 11.5,
              fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-sans)', lineHeight: 1.4,
            }}
          >
            Clear
          </button>
        )}
      </div>

      {/* Override form — only rendered when row is expanded */}
      {open && (
        <div style={{ padding: '0 12px 12px', borderTop: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 10 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={!!override?.exclude}
              onChange={e => handlePatchThis({ exclude: e.target.checked })}
            />
            <span style={{ fontWeight: 500 }}>Exclude from scenario</span>
          </label>

          {!isExcluded && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <FieldGroup label="Start date shift (days)">
                <NumericField
                  kind="int"
                  value={override?.startDateShiftDays}
                  onCommit={(v) => handlePatchThis({ startDateShiftDays: v })}
                  placeholder="e.g. +30 or -14"
                  style={inputStyle()}
                />
              </FieldGroup>
              <FieldGroup label="Delivery date shift (days)">
                <NumericField
                  kind="int"
                  value={override?.deliveryShiftDays}
                  onCommit={(v) => handlePatchThis({ deliveryShiftDays: v })}
                  placeholder="e.g. +30 or -14"
                  style={inputStyle()}
                />
              </FieldGroup>

              <FieldGroup label={`Total LMs (baseline: ${(project.totalLMs || 0).toLocaleString()})`}>
                <NumericField
                  kind="int"
                  value={override?.totalLMs}
                  onCommit={(v) => handlePatchThis({ totalLMs: v })}
                  placeholder="Override LM count"
                  style={inputStyle()}
                />
              </FieldGroup>

              <FieldGroup label={`LM multiplier (baseline: ${project.lmMultiplier ?? '\u2014'})`}>
                <NumericField
                  kind="float"
                  value={override?.lmMultiplier}
                  onCommit={(v) => handlePatchThis({ lmMultiplier: v })}
                  placeholder="Override multiplier"
                  style={inputStyle()}
                />
              </FieldGroup>

              <FieldGroup label="VIBE type">
                <DatalistEnumField
                  id={`spark_enum_vibe_${project.id}`}
                  value={override?.vibeType ?? ''}
                  placeholder={`\u2014 keep ${project.vibeType} \u2014`}
                  options={VIBE_TYPES}
                  onCommit={(v) => handlePatchThis({ vibeType: v })}
                />
              </FieldGroup>

              <FieldGroup label="Orbit tier">
                <DatalistEnumField
                  id={`spark_enum_orbit_${project.id}`}
                  value={override?.orbit ?? ''}
                  placeholder={`\u2014 keep ${project.orbit || '?'} \u2014`}
                  options={['A', 'B', 'C', 'D']}
                  onCommit={(v) => handlePatchThis({ orbit: v })}
                />
              </FieldGroup>
            </div>
          )}

          {!isExcluded && (
            <div style={{ marginTop: 6 }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: C.muted, marginBottom: 8 }}>
                Role Overrides (Assignments)
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <FieldGroup label={`CSM (baseline: ${project.assignedCSM || 'Unassigned'})`}>
                  <RosterAssignmentField role="CSM" projectId={project.id}
                    baselineName={project.assignedCSM || ''} overrideValue={override?.assignedCSM}
                    options={rosterByRole?.CSM || []} onChange={(v) => handlePatchThis({ assignedCSM: v })} />
                </FieldGroup>
                <FieldGroup label={`PM (baseline: ${project.assignedPM || 'Unassigned'})`}>
                  <RosterAssignmentField role="PM" projectId={project.id}
                    baselineName={project.assignedPM || ''} overrideValue={override?.assignedPM}
                    options={rosterByRole?.PM || []} onChange={(v) => handlePatchThis({ assignedPM: v })} />
                </FieldGroup>
                <FieldGroup label={`Analyst 1 (baseline: ${project.assignedAnalyst1 || 'Unassigned'})`}>
                  <RosterAssignmentField role="Analyst 1" projectId={project.id}
                    baselineName={project.assignedAnalyst1 || ''} overrideValue={override?.assignedAnalyst1}
                    options={rosterByRole?.['Analyst 1'] || []} onChange={(v) => handlePatchThis({ assignedAnalyst1: v })} />
                </FieldGroup>
                <FieldGroup label={`Analyst 2 (baseline: ${project.assignedAnalyst2 || 'Unassigned'})`}>
                  <RosterAssignmentField role="Analyst 2" projectId={project.id}
                    baselineName={project.assignedAnalyst2 || ''} overrideValue={override?.assignedAnalyst2}
                    options={rosterByRole?.['Analyst 2'] || []} onChange={(v) => handlePatchThis({ assignedAnalyst2: v })} />
                </FieldGroup>
                <FieldGroup label={`Analyst 1 load % (baseline: ${Number.isFinite(+project.analystUtilPct) ? project.analystUtilPct : '\u2014'})`}>
                  <NumericField
                    kind="float"
                    min={0}
                    max={100}
                    value={override?.analystUtilPct}
                    onCommit={(v) => handlePatchThis({ analystUtilPct: v })}
                    placeholder="0–100"
                    style={inputStyle()}
                  />
                </FieldGroup>
              </div>
              <div style={{ fontSize: 11, color: C.faint, marginTop: 8, lineHeight: 1.5 }}>
                These overrides affect <strong>People Utilization</strong> and <strong>Unstaffed demand</strong> views. They do not change total demand hours.
              </div>
            </div>
          )}

          {hasOverride && (
            <button onClick={handleClearThis} style={{ alignSelf: 'flex-start', ...btnStyle('danger-sm') }}>
              Clear overrides
            </button>
          )}
        </div>
      )}
    </div>
  )
})



// ─────────────────────────────────────────────────────────────────────────
// RESOURCE OVERRIDES TAB
// ─────────────────────────────────────────────────────────────────────────

function ResourceOverridesTab({ overrides, onPatch, baselineIngest, planningYear = 2026 }) {
  // Analyst is a single override role in the Scenario layer.
  // Internally, capacity is driven by `Analyst 1` headcount.
  const roles = ['CSM', 'PM', 'Analyst']
  const baselineCfg = useMemo(
    () => buildScenarioCapacityConfig({ roster: baselineIngest?.roster || [], planningYear }),
    [baselineIngest, planningYear]
  )
  const avgHrsPerPersonMo = useMemo(() => {
    const arr = baselineCfg?.hrsPerPersonMonthByMonth
    if (!Array.isArray(arr) || arr.length !== 12) return HRS_PER_PERSON_MONTH
    return arr.reduce((a, b) => a + (b || 0), 0) / 12
  }, [baselineCfg])

  return (
    <div>
      <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 14, lineHeight: 1.6 }}>
        Override FTE headcount per role. Changes affect effective capacity across the year
        and shift the breach thresholds visible in the Compare view.
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {roles.map(role => {
          const internalRole = role === 'Analyst' ? 'Analyst 1' : role
          const baseline = baselineCfg?.fteCount?.[internalRole] ?? 0
          const override = overrides[internalRole]?.fteOverride
          const hasOverride = override !== undefined && override !== null
          const effective = hasOverride ? override : baseline

          return (
            <div key={role} style={{
              display: 'flex', alignItems: 'center', gap: 14,
              padding: '12px 16px', borderRadius: 8,
              border: `1px solid ${hasOverride ? C.accent : C.border}`,
              background: hasOverride ? 'var(--accent-light)' : C.surface,
            }}>
              <div style={{ width: 80, fontWeight: 600, fontSize: 13, color: C.ink }}>{role}</div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 11.5, color: C.muted }}>Baseline:</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: C.ink }}>{baseline} FTE</span>
                  <span style={{ fontSize: 11, color: C.faint }}>= {(baseline * avgHrsPerPersonMo).toLocaleString()} hrs/mo (avg)</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
                  <span style={{ fontSize: 11.5, color: C.muted }}>Scenario FTE:</span>
                  <NumericField
                    kind="int"
                    min={0}
                    value={override}
                    onCommit={(v) => onPatch(internalRole, { fteOverride: v })}
                    placeholder={String(baseline)}
                    style={{ ...inputStyle(), width: 70 }}
                  />
                  {hasOverride && (
                    <>
                      <span style={{ fontSize: 11, color: override > baseline ? C.green : C.red, fontWeight: 600 }}>
                        {override > baseline ? '+' : ''}{override - baseline} FTE
                      </span>
                      <span style={{ fontSize: 11, color: C.faint }}>
                        = {(effective * avgHrsPerPersonMo).toLocaleString()} hrs/mo (avg)
                      </span>
                      <button onClick={() => onPatch(internalRole, { fteOverride: undefined })} style={btnStyle('danger-sm')}>
                        Clear
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// ASSUMPTION OVERRIDES TAB
// ─────────────────────────────────────────────────────────────────────────

function AssumptionOverridesTab({ overrides, onPatch, baselineIngest, planningYear = 2026 }) {
  const baselineCfg = useMemo(
    () => buildScenarioCapacityConfig({ roster: baselineIngest?.roster || [], planningYear }),
    [baselineIngest, planningYear]
  )
  const baselineAvgHrsPerPersonMo = useMemo(() => {
    const arr = baselineCfg?.hrsPerPersonMonthByMonth
    if (!Array.isArray(arr) || arr.length !== 12) return HRS_PER_PERSON_MONTH
    return arr.reduce((a, b) => a + (b || 0), 0) / 12
  }, [baselineCfg])
  const baselineRange = useMemo(() => {
    const arr = baselineCfg?.hrsPerPersonMonthByMonth
    if (!Array.isArray(arr) || arr.length !== 12) return { min: HRS_PER_PERSON_MONTH, max: HRS_PER_PERSON_MONTH }
    const vals = arr.map(v => (Number.isFinite(+v) ? +v : 0))
    return { min: Math.min(...vals), max: Math.max(...vals) }
  }, [baselineCfg])
  const hrsSliderStep = 8
  const hrsSliderMin = 80
  const hrsSliderMax = useMemo(() => {
    // Always allow adjusting above calendar baseline.
    const baseMax = Number.isFinite(+baselineRange.max) ? +baselineRange.max : HRS_PER_PERSON_MONTH
    const padded = baseMax + 48
    const snapped = Math.ceil(padded / hrsSliderStep) * hrsSliderStep
    return Math.max(300, snapped)
  }, [baselineRange])
  const avgBusinessDaysPerMonth = useMemo(() => {
    // Baseline is business-days × 10 hrs/day, so avgBusinessDays ≈ baselineAvg / 10.
    const v = Number(baselineAvgHrsPerPersonMo) / 10
    return Number.isFinite(v) && v > 0 ? v : 0
  }, [baselineAvgHrsPerPersonMo])

  const fields = [
    {
      key: 'hrsPerPersonDay',
      label: 'Working hours per person per business day',
      desc: 'Baseline is calendar-aware (business-days × 10 hrs/day). This override models up to 12 hrs/day while preserving the calendar.',
      baseline: 10,
      step: 0.5, min: 6, max: 12,
      format: v => `${v}h/day`,
    },
  ]

  // ── Assumption tables (scenario-only) ───────────────────────────────
  const lmBucketsEffective = useMemo(() => {
    if (Array.isArray(overrides?.lmBucketMultipliers) && overrides.lmBucketMultipliers.length > 0) {
      return overrides.lmBucketMultipliers
    }
    return LM_BUCKET_MULTIPLIERS
  }, [overrides])

  const orbitBaseline = baselineIngest?.orbitMultipliers || {}
  const orbitOverrides = overrides?.orbitVibeMultipliers || {}
  const getOrbitBaselineVal = (vibe, orbit) => {
    const key = `${vibe}__${orbit}`
    if (orbitBaseline[key] !== undefined && orbitBaseline[key] !== null) return orbitBaseline[key]
    // Fallback to schema table (keyed `${orbit}_${vibe}`)
    const k2 = `${orbit}_${vibe}`
    return ORBIT_VIBE_MULTIPLIERS[k2] ?? 0
  }
  const getOrbitEffectiveVal = (vibe, orbit) => {
    const key = `${vibe}__${orbit}`
    const ov = orbitOverrides[key]
    if (ov !== undefined && ov !== null && ov !== '') return parseFloat(ov)
    return getOrbitBaselineVal(vibe, orbit)
  }

  return (
    <div>
      <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 14, lineHeight: 1.6 }}>
        Tune the planning constants that underpin all capacity calculations.
        These affect the entire team, not individual projects.
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {fields.map(f => {
          const hasOverride = overrides?.hrsPerPersonDay !== undefined && overrides?.hrsPerPersonDay !== null
          const displayVal = hasOverride
            ? Number(overrides.hrsPerPersonDay)
            : (overrides?.hrsPerPersonMonth !== undefined && overrides?.hrsPerPersonMonth !== null && avgBusinessDaysPerMonth)
              ? (Number(overrides.hrsPerPersonMonth) / avgBusinessDaysPerMonth)
              : f.baseline

          return (
            <div key={f.key} style={{
              padding: '14px 16px', borderRadius: 8,
              border: `1px solid ${hasOverride ? C.accent : C.border}`,
              background: hasOverride ? 'var(--accent-light)' : C.surface,
            }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: C.ink, marginBottom: 3 }}>{f.label}</div>
              <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 10, lineHeight: 1.5 }}>{f.desc}</div>
              <div style={{ fontSize: 11.5, color: C.faint, marginBottom: 10, lineHeight: 1.5 }}>
                Baseline: <strong>10.0h/day</strong>. (Calendar-aware business days.) Max: <strong>12.0h/day</strong>.
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <input
                  type="range"
                  min={f.min} max={f.max} step={f.step}
                  value={displayVal}
                  onChange={e => onPatch({ hrsPerPersonDay: parseFloat(e.target.value), hrsPerPersonMonth: undefined })}
                  style={{ flex: 1, accentColor: 'var(--accent)' }}
                />
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600, width: 48, color: hasOverride ? C.accent : C.ink }}>
                  {f.format(displayVal)}
                </span>
                {hasOverride && (
                  <span style={{ fontSize: 11, color: C.muted }}>
                    baseline: {f.format(f.baseline)}
                  </span>
                )}
              </div>
              {hasOverride && (
                <button onClick={() => onPatch({ hrsPerPersonDay: undefined, hrsPerPersonMonth: undefined })} style={{ ...btnStyle('danger-sm'), marginTop: 8 }}>
                  Reset to baseline
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* Per-role working hours overrides */}
      <Card style={{ marginTop: 14 }}>
        <CardHeader title="Working hours per person per business day (by role)">
          <Tag>Capacity only</Tag>
        </CardHeader>
        <CardBody>
          <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.6, marginBottom: 12 }}>
            Optional. Set role-specific hours/day. These <strong>override</strong> the global hours/day setting above for that role.
          </div>
          {(['CSM', 'PM', 'Analyst 1']).map(roleKey => {
            const byRole = overrides?.hrsPerPersonDayByRole || {}
            const current = byRole?.[roleKey]
            const has = current !== undefined && current !== null && current !== ''

            const apply = (nextVal) => {
              const obj = { ...(overrides?.hrsPerPersonDayByRole || {}) }
              if (nextVal === undefined || nextVal === null || nextVal === '') {
                delete obj[roleKey]
              } else {
                obj[roleKey] = nextVal
              }
              onPatch({ hrsPerPersonDayByRole: obj })
            }

            return (
              <div key={roleKey} style={{
                padding: '12px 14px',
                borderRadius: 8,
                border: `1px solid ${has ? C.accent : C.border}`,
                background: has ? 'var(--accent-light)' : C.surface,
                marginBottom: 10,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 90, fontWeight: 700, fontSize: 12.5, color: C.ink }}>{roleKey}</div>
                  <NumericField
                    kind="float"
                    min={6}
                    max={12}
                    value={has ? Number(current) : undefined}
                    placeholder="10.0"
                    style={{ ...inputStyle(), width: 90 }}
                    onCommit={(v) => apply(v === undefined ? '' : v)}
                  />
                  {has && (
                    <button onClick={() => apply(undefined)} style={btnStyle('danger-sm')}>
                      Clear
                    </button>
                  )}
                </div>
                <div style={{ fontSize: 11, color: C.faint, marginTop: 6 }}>
                  Baseline: 10.0h/day. Calendar-aware business days are preserved.
                </div>
              </div>
            )
          })}
        </CardBody>
      </Card>

      {/* LM Bucket multipliers */}
      <Card style={{ marginTop: 14 }}>
        <CardHeader title="LM Bucket multipliers (scenario-only)">
          <Tag>Impacts demand hours</Tag>
        </CardHeader>
        <CardBody>
          <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.6, marginBottom: 12 }}>
            Adjust how <strong>Total LMs</strong> map to <strong>LM multipliers</strong>. This affects projects whose LM multiplier appears to be bucket-derived (explicit file multipliers are preserved).
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: 'var(--surface-1)' }}>
                  {['LMs ≤', 'Baseline', 'Scenario'].map(h => (
                    <th key={h} style={{ padding: '9px 12px', textAlign: 'left', fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px', color: C.muted, borderBottom: `1px solid ${C.border}` }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {LM_BUCKET_MULTIPLIERS.map((tier, i) => {
                  const eff = lmBucketsEffective?.[i]?.multiplier ?? tier.multiplier
                  const isChanged = eff !== tier.multiplier
                  return (
                    <tr key={tier.maxLMs} style={{ background: i % 2 ? 'var(--surface-1)' : C.surface, borderBottom: `1px solid ${C.border}` }}>
                      <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)' }}>{tier.maxLMs.toLocaleString()}</td>
                      <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', color: C.muted }}>{tier.multiplier.toFixed(2)}×</td>
                      <td style={{ padding: '8px 12px' }}>
                        <NumericField
                          kind="float"
                          value={eff}
                          placeholder={tier.multiplier.toFixed(2)}
                          style={{
                            ...inputStyle({ width: 110 }),
                            fontFamily: 'var(--font-mono)',
                            borderColor: isChanged ? 'rgba(167,139,250,0.55)' : C.border,
                          }}
                          onCommit={(v) => {
                            const targetVal = (v === undefined || v === null) ? tier.multiplier : v
                            const next = LM_BUCKET_MULTIPLIERS.map((t, idx) => ({
                              ...t,
                              multiplier: idx === i ? targetVal : (lmBucketsEffective?.[idx]?.multiplier ?? t.multiplier),
                            }))
                            const matchesBaseline = next.every((t, idx) => t.multiplier === LM_BUCKET_MULTIPLIERS[idx].multiplier)
                            onPatch({ lmBucketMultipliers: matchesBaseline ? undefined : next })
                          }}
                        />
                        <span style={{ marginLeft: 6, fontSize: 11.5, color: isChanged ? C.accent : C.faint }}>
                          {isChanged ? 'overridden' : 'baseline'}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {Array.isArray(overrides?.lmBucketMultipliers) && (
            <button
              onClick={() => onPatch({ lmBucketMultipliers: undefined })}
              style={{ ...btnStyle('danger-sm'), marginTop: 10 }}
            >
              Reset LM bucket table
            </button>
          )}
        </CardBody>
      </Card>

      {/* Orbit × VIBE final multipliers */}
      <Card style={{ marginTop: 14 }}>
        <CardHeader title="Orbit × VIBE final multipliers (CSM only)">
          <Tag>Scenario-only</Tag>
        </CardHeader>
        <CardBody>
          <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.6, marginBottom: 12 }}>
            Overrides the <strong>CSM</strong> orbit multiplier lookup used in final utilized hours. Baseline values come from the uploaded workbook’s Demand Matrix (when available).
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: 'var(--surface-1)' }}>
                  <th style={{ padding: '9px 12px', textAlign: 'left', fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px', color: C.muted, borderBottom: `1px solid ${C.border}` }}>
                    VIBE \ Orbit
                  </th>
                  {['A','B','C','D'].map(o => (
                    <th key={o} style={{ padding: '9px 12px', textAlign: 'left', fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px', color: C.muted, borderBottom: `1px solid ${C.border}` }}>
                      {o}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {VIBE_TYPES.map((v, rIdx) => (
                  <tr key={v} style={{ background: rIdx % 2 ? 'var(--surface-1)' : C.surface, borderBottom: `1px solid ${C.border}` }}>
                    <td style={{ padding: '8px 12px', fontWeight: 650, color: C.ink }}>{v}</td>
                    {['A','B','C','D'].map(o => {
                      const k = `${v}__${o}`
                      const baseVal = getOrbitBaselineVal(v, o)
                      const has = orbitOverrides[k] !== undefined && orbitOverrides[k] !== null
                      const eff = getOrbitEffectiveVal(v, o)
                      return (
                        <td key={k} style={{ padding: '8px 12px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <NumericField
                              kind="float"
                              value={has ? orbitOverrides[k] : undefined}
                              placeholder={String(baseVal || 0)}
                              style={{
                                ...inputStyle({ width: 92 }),
                                fontFamily: 'var(--font-mono)',
                                borderColor: has ? 'rgba(167,139,250,0.55)' : C.border,
                              }}
                              onCommit={(v) => {
                                const next = { ...(orbitOverrides || {}) }
                                if (v === undefined || v === null) delete next[k]
                                else next[k] = v
                                onPatch({ orbitVibeMultipliers: Object.keys(next).length ? next : undefined })
                              }}
                              title={`Baseline ${baseVal}× · Effective ${eff}×`}
                            />
                            <span style={{ fontSize: 11, color: has ? C.accent : C.faint }}>
                              {has ? 'override' : 'base'}
                            </span>
                          </div>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {overrides?.orbitVibeMultipliers && (
            <button
              onClick={() => onPatch({ orbitVibeMultipliers: undefined })}
              style={{ ...btnStyle('danger-sm'), marginTop: 10 }}
            >
              Reset Orbit × VIBE overrides
            </button>
          )}
        </CardBody>
      </Card>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// ATTRITION OVERRIDES TAB (capacity-only)
// ─────────────────────────────────────────────────────────────────────────

function AttritionOverridesTab({ globalAttrition, perRole, onPatchGlobal, onPatchRole }) {
  // Analyst is a single override role in the Scenario layer; stored under `Analyst 1`.
  const roles = ['CSM', 'PM', 'Analyst']
  const global = (globalAttrition !== undefined && globalAttrition !== null) ? globalAttrition : ATTRITION_FACTOR

  return (
    <div>
      <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 14, lineHeight: 1.6 }}>
        Attrition is a capacity-only lever. Set a global availability baseline, then override specific roles where needed.
      </div>

      <Card style={{ marginBottom: 14 }}>
        <CardHeader title="Global attrition baseline" tag="Capacity">
          <Tag>{`${(global * 100).toFixed(0)}%`}</Tag>
        </CardHeader>
        <CardBody>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <input
              type="range"
              min={0.5}
              max={1.0}
              step={0.01}
              value={global}
              onChange={e => onPatchGlobal(parseFloat(e.target.value))}
              style={{ flex: 1, accentColor: 'var(--accent)' }}
            />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: C.accent, width: 58 }}>
              {(global * 100).toFixed(0)}%
            </span>
            {(globalAttrition !== undefined && globalAttrition !== null) && (
              <button onClick={() => onPatchGlobal(undefined)} style={btnStyle('danger-sm')}>
                Reset
              </button>
            )}
          </div>
          <div style={{ fontSize: 11.5, color: C.faint, marginTop: 8 }}>
            Baseline is {(ATTRITION_FACTOR * 100).toFixed(0)}%. This value is used unless a role override is set below.
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Role-level attrition overrides" tag="By Role" />
        <CardBody>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {roles.map(role => {
              const internalRole = role === 'Analyst' ? 'Analyst 1' : role
              const override = perRole?.[internalRole]
              const has = override !== undefined && override !== null
              const effective = has ? override : global
              return (
                <div key={role} style={{
                  padding: '12px 14px',
                  borderRadius: 10,
                  border: `1px solid ${has ? 'rgba(167,139,250,0.55)' : C.border}`,
                  background: has ? 'var(--accent-light)' : C.surface,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                    <div style={{ width: 90, fontWeight: 700, fontSize: 13, color: C.ink }}>{role}</div>
                    <div style={{ fontSize: 11.5, color: C.muted }}>
                      Effective:{' '}
                      <strong style={{ color: has ? C.accent : C.ink }}>
                        {(effective * 100).toFixed(0)}%
                      </strong>
                      {!has && <span style={{ color: C.faint }}> (global)</span>}
                    </div>
                    {has && (
                      <button onClick={() => onPatchRole(internalRole, undefined)} style={{ marginLeft: 'auto', ...btnStyle('danger-sm') }}>
                        Clear
                      </button>
                    )}
                  </div>
                  <input
                    type="range"
                    min={0.5}
                    max={1.0}
                    step={0.01}
                    value={effective}
                    onChange={e => onPatchRole(internalRole, parseFloat(e.target.value))}
                    style={{ width: '100%', accentColor: 'var(--accent)' }}
                  />
                </div>
              )
            })}
          </div>
        </CardBody>
      </Card>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// COMPARE PANEL
// ─────────────────────────────────────────────────────────────────────────

function ComparePanel({ sc, baselineCalc }) {
  const { activeScenario, scenarioCalc, scenarioCap, calcLoading, calcError, diff, activeSummary, editScenario } = sc
  // Scenarios always show Analyst demand as A1 + A2 total (consistent with Overview).
  // Capacity remains tied to Analyst 1 (Analyst 2 is incremental demand pressure).
  const includeAnalyst2 = true

  // Hooks must remain unconditional — compute baseline capacity config up front
  const planningYear = baselineCalc?.meta?.planningYear || 2026
  const baselineConfig = useMemo(
    () => buildScenarioCapacityConfig({ roster: sc?.baselineIngest?.roster || [], planningYear }),
    [sc?.baselineIngest, planningYear]
  )
  const baselineCap = useMemo(
    () => computeCapacityScenario(baselineConfig),
    [baselineConfig]
  )

  // Hooks must remain unconditional — keep this above any early returns.
  const impact = useMemo(() => {
    if (!baselineCalc || !scenarioCalc || !baselineCap || !scenarioCap) return null

    const sum = (arr) => (arr || []).reduce((a, b) => a + (b || 0), 0)
    const roles = ['CSM', 'PM', 'Analyst']
    const capKey = (role) => (role === 'Analyst' ? 'Analyst 1' : role)

    const demandSeries = (calc, role) => {
      if (role !== 'Analyst') return calc?.demandByRole?.[role] || new Array(12).fill(0)
      const base = calc?.analystModel?.demandBase || calc?.demandByRole?.['Analyst 1'] || new Array(12).fill(0)
      const inc = calc?.analystModel?.demandIncremental || calc?.demandByRole?.['Analyst 2'] || new Array(12).fill(0)
      const tot = calc?.analystModel?.demandTotal || base.map((v, i) => (v || 0) + (inc[i] || 0))
      return includeAnalyst2 ? tot : base
    }

    const effCapSeries = (cap, role) => {
      const key = capKey(role)
      return cap?.[key]?.effectiveMonthlyByMonth || new Array(12).fill(cap?.[key]?.effectiveMonthly || 0)
    }

    const hrsPerPersonSeries = (cap, role) => {
      const key = capKey(role)
      return cap?.[key]?.hrsPerPersonMonthByMonth || new Array(12).fill(HRS_PER_PERSON_MONTH)
    }

    const monthsOverSeries = (dem, capArr) => (dem || []).filter((d, i) => (d || 0) > (capArr?.[i] || 0)).length

    const breachDetails = (role) => {
      const bDem = demandSeries(baselineCalc, role)
      const sDem = demandSeries(scenarioCalc, role)
      const bCapArr = effCapSeries(baselineCap, role)
      const sCapArr = effCapSeries(scenarioCap, role)

      const bBreach = bDem.map((v, i) => (v || 0) > (bCapArr[i] || 0))
      const sBreach = sDem.map((v, i) => (v || 0) > (sCapArr[i] || 0))

      const resolvedIdx = MONTHS.map((_, i) => (bBreach[i] && !sBreach[i]) ? i : -1).filter(i => i !== -1)
      const introducedIdx = MONTHS.map((_, i) => (!bBreach[i] && sBreach[i]) ? i : -1).filter(i => i !== -1)

      const bCount = monthsOverSeries(bDem, bCapArr)
      const sCount = monthsOverSeries(sDem, sCapArr)

      return {
        role,
        bCount,
        sCount,
        deltaCount: sCount - bCount,
        resolvedIdx,
        introducedIdx,
        resolvedMonths: resolvedIdx.map(i => MONTHS[i]).join(', '),
        introducedMonths: introducedIdx.map(i => MONTHS[i]).join(', '),
        annualDemandDelta: sum(sDem) - sum(bDem),
        annualCapDelta: sum(sCapArr) - sum(bCapArr),
      }
    }

    const roleSummaries = roles.map(breachDetails)

    const formatH = (n) => {
      const v = Math.round(n || 0)
      if (!v) return '—'
      return `${v > 0 ? '+' : ''}${v.toLocaleString()}h`
    }

    const formatMonthsDelta = (d) => d === 0 ? '—' : `${d > 0 ? '+' : ''}${d}`

    // ── Project drivers: top annual hour deltas from assignments ─────────
    const normalizeRole = (r) => (r === 'Analyst 1' || r === 'Analyst 2') ? 'Analyst' : r
    const isPrimary = (r) => r === 'CSM' || r === 'PM' || r === 'Analyst'

    const aggProjects = (calc) => {
      const out = new Map()
      const rows = Array.isArray(calc?.assignments) ? calc.assignments : []
      for (const row of rows) {
        const role = normalizeRole(row?.role)
        if (!isPrimary(role)) continue
        const k = row?.projectId || row?.projectName
        if (!k) continue
        const name = String(row?.projectName || '').trim() || '(unnamed)'
        const hrs = Number.isFinite(+row?.finalHours) ? +row.finalHours : 0
        if (!hrs) continue
        if (!out.has(k)) out.set(k, { key: k, name, total: 0, byRole: { CSM: 0, PM: 0, Analyst: 0 } })
        const rec = out.get(k)
        rec.total += hrs
        rec.byRole[role] += hrs
      }
      return out
    }

    const bProj = aggProjects(baselineCalc)
    const sProj = aggProjects(scenarioCalc)
    const projKeys = new Set([...bProj.keys(), ...sProj.keys()])

    const projectDeltas = [...projKeys].map(k => {
      const b = bProj.get(k) || { key: k, name: sProj.get(k)?.name || '(unnamed)', total: 0, byRole: { CSM: 0, PM: 0, Analyst: 0 } }
      const s = sProj.get(k) || { key: k, name: b.name, total: 0, byRole: { CSM: 0, PM: 0, Analyst: 0 } }
      const delta = s.total - b.total
      const byRoleDelta = {
        CSM: (s.byRole.CSM || 0) - (b.byRole.CSM || 0),
        PM: (s.byRole.PM || 0) - (b.byRole.PM || 0),
        Analyst: (s.byRole.Analyst || 0) - (b.byRole.Analyst || 0),
      }
      return {
        key: k,
        name: s.name || b.name || '(unnamed)',
        baselineTotal: b.total,
        scenarioTotal: s.total,
        delta,
        byRoleDelta,
      }
    })
      .filter(p => Math.abs(p.delta) >= 1)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))

    const topProjectDrivers = projectDeltas.slice(0, 6)

    // ── People: largest increases in “over capacity” month(s) ────────────
    const aggPeople = (calc) => {
      const out = new Map() // key `${role}__${name}` with Analyst combined
      const rows = calc?.demandByPerson || {}
      for (const v of Object.values(rows)) {
        const role = normalizeRole(v?.role)
        if (!isPrimary(role)) continue
        const name = String(v?.name || '').trim()
        if (!name) continue
        const k = `${role}__${name}`
        if (!out.has(k)) out.set(k, { role, name, monthly: new Array(12).fill(0) })
        const rec = out.get(k)
        const m = Array.isArray(v?.monthly) ? v.monthly : []
        for (let i = 0; i < 12; i++) rec.monthly[i] += (m[i] || 0)
      }
      return out
    }

    const bPeople = aggPeople(baselineCalc)
    const sPeople = aggPeople(scenarioCalc)
    const peopleKeys = new Set([...bPeople.keys(), ...sPeople.keys()])

    const overloadDeltas = []
    for (const k of peopleKeys) {
      const b = bPeople.get(k) || sPeople.get(k)
      const s = sPeople.get(k) || bPeople.get(k)
      if (!b || !s) continue

      const role = s.role || b.role
      const name = s.name || b.name
      const hrsCapB = hrsPerPersonSeries(baselineCap, role)
      const hrsCapS = hrsPerPersonSeries(scenarioCap, role)

      for (let i = 0; i < 12; i++) {
        const bOver = (b.monthly[i] || 0) - (hrsCapB[i] || HRS_PER_PERSON_MONTH)
        const sOver = (s.monthly[i] || 0) - (hrsCapS[i] || HRS_PER_PERSON_MONTH)
        const delta = sOver - bOver
        if (sOver <= 0) continue
        if (delta <= 0.5) continue
        overloadDeltas.push({
          key: `${k}__${i}`,
          role,
          name,
          monthIndex: i,
          over: sOver,
          overDelta: delta,
          hours: s.monthly[i] || 0,
          cap: hrsCapS[i] || HRS_PER_PERSON_MONTH,
          isNew: bOver <= 0,
        })
      }
    }

    overloadDeltas.sort((a, b) => (b.isNew - a.isNew) || (b.overDelta - a.overDelta))
    const topOverloads = overloadDeltas.slice(0, 6)

    // ── Unstaffed hours delta (all roles as-is) ──────────────────────────
    const bUn = baselineCalc?.unstaffedHours || {}
    const sUn = scenarioCalc?.unstaffedHours || {}
    const unstaffedDelta = roles.map(role => {
      const key = role === 'Analyst' ? 'Analyst 1' : role
      const bArr = bUn[key] || new Array(12).fill(0)
      const sArr = sUn[key] || new Array(12).fill(0)
      return { role, delta: sum(sArr) - sum(bArr) }
    })

    return {
      roleSummaries,
      topProjectDrivers,
      topOverloads,
      unstaffedDelta,
      formatH,
      formatMonthsDelta,
    }
  }, [baselineCalc, scenarioCalc, baselineCap, scenarioCap, includeAnalyst2])

  if (calcLoading) return <LoadingState msg="Running scenario calculation…" />
  if (calcError)   return <ErrorState msg={calcError} />
  if (!scenarioCalc) return (
    <div style={{ padding: '40px 0', textAlign: 'center', color: C.muted, fontSize: 13 }}>
      Waiting for scenario to calculate…
    </div>
  )
  if (!baselineCalc) return (
    <div style={{ padding: '40px 0', textAlign: 'center', color: C.muted, fontSize: 13 }}>
      <div style={{ marginBottom: 8 }}>Loading baseline engine calculation…</div>
      <div style={{ width: 16, height: 16, border: '2px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.7s linear infinite', margin: '0 auto' }} />
    </div>
  )

  const analystAnnual = (calc, which) => {
    const model = calc?.analystModel
    if (model?.annualDemand?.[which] !== undefined && model?.annualDemand?.[which] !== null) return model.annualDemand[which]
    const base = calc?.demandByRole?.['Analyst 1'] || new Array(12).fill(0)
    const inc = calc?.demandByRole?.['Analyst 2'] || new Array(12).fill(0)
    const total = base.map((v, i) => v + (inc[i] || 0))
    const pick = which === 'total' ? total : which === 'incremental' ? inc : base
    return pick.reduce((a, b) => a + (b || 0), 0)
  }

  const analystMonthsOver = (calc, cap, which) => {
    const effArr = cap?.['Analyst 1']?.effectiveMonthlyByMonth || new Array(12).fill(cap?.['Analyst 1']?.effectiveMonthly || 0)
    const model = calc?.analystModel
    if (model?.monthsOverEffective?.[which] !== undefined && model?.monthsOverEffective?.[which] !== null) return model.monthsOverEffective[which]
    const base = calc?.demandByRole?.['Analyst 1'] || new Array(12).fill(0)
    const inc = calc?.demandByRole?.['Analyst 2'] || new Array(12).fill(0)
    const total = base.map((v, i) => v + (inc[i] || 0))
    const pick = which === 'total' ? total : base
    return pick.filter((d, i) => d > (effArr[i] || 0)).length
  }

  return (
    <div>
      {/* Scenario header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 17, color: C.ink }}>{activeScenario.name || 'Untitled scenario'}</div>
          {activeScenario.description && (
            <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>{activeScenario.description}</div>
          )}
        </div>
        <button onClick={() => editScenario(activeScenario.id)} style={btnStyle('ghost')}>
          ✎ Edit overrides
        </button>
      </div>

      {/* Change pills */}
      {activeSummary && activeSummary.totalChanges > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 11, color: C.muted, alignSelf: 'center' }}>Overrides active:</div>
          {activeSummary.modified > 0    && <Pill type="blue">{activeSummary.modified} project{activeSummary.modified !== 1 ? 's' : ''}</Pill>}
          {activeSummary.excluded > 0    && <Pill type="red">{activeSummary.excluded} excluded</Pill>}
          {activeSummary.added > 0       && <Pill type="purple">{activeSummary.added} added</Pill>}
          {activeSummary.fteChanges > 0  && <Pill type="green">{activeSummary.fteChanges} FTE changed</Pill>}
          {activeSummary.attritionChanges > 0 && <Pill type="purple">{activeSummary.attritionChanges} attrition</Pill>}
          {activeSummary.assumptionChanges > 0 && <Pill type="amber">{activeSummary.assumptionChanges} assumption{activeSummary.assumptionChanges !== 1 ? 's' : ''}</Pill>}
        </div>
      )}

      {/* Impact summary (delta-first) */}
      {impact && (
        <Card style={{ marginBottom: 16 }}>
          <CardHeader title="Impact summary">
            <Tag>Δ vs baseline</Tag>
          </CardHeader>
          <CardBody>
            <div style={{ display: 'grid', gridTemplateColumns: '1.05fr 0.95fr', gap: 14, alignItems: 'start' }}>
              <div>
                <div style={{ fontSize: 10.5, fontWeight: 900, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.muted, marginBottom: 10 }}>
                  Capacity + risk changes
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', rowGap: 10, columnGap: 10 }}>
                  {impact.roleSummaries.map(r => {
                    const color =
                      r.deltaCount < 0 ? 'var(--green)' :
                      r.deltaCount > 0 ? 'var(--red)' :
                      C.faint
                    return (
                      <React.Fragment key={r.role}>
                        <div style={{ fontWeight: 800, fontSize: 12, color: C.ink }}>{r.role}</div>
                        <div style={{ fontSize: 12.5, lineHeight: 1.55 }}>
                          <div>
                            <strong style={{ color }}>{r.bCount} → {r.sCount}</strong>{' '}
                            months over effective cap{' '}
                            <span style={{ color, fontWeight: 800 }}>
                              ({impact.formatMonthsDelta(r.deltaCount)})
                            </span>
                          </div>
                          <div style={{ color: C.muted }}>
                            Annual demand Δ <strong style={{ color: r.annualDemandDelta < 0 ? 'var(--green)' : r.annualDemandDelta > 0 ? 'var(--red)' : C.faint }}>
                              {impact.formatH(r.annualDemandDelta)}
                            </strong>
                            {' · '}
                            Annual effective capacity Δ <strong style={{ color: r.annualCapDelta > 0 ? 'var(--green)' : r.annualCapDelta < 0 ? 'var(--red)' : C.faint }}>
                              {impact.formatH(r.annualCapDelta)}
                            </strong>
                          </div>
                          {(r.resolvedIdx.length > 0 || r.introducedIdx.length > 0) && (
                            <div style={{ color: C.faint, fontSize: 11.5, marginTop: 2 }}>
                              {r.resolvedIdx.length > 0 && (
                                <span><strong style={{ color: 'var(--green)' }}>Resolved:</strong> {r.resolvedMonths}</span>
                              )}
                              {r.resolvedIdx.length > 0 && r.introducedIdx.length > 0 && <span> · </span>}
                              {r.introducedIdx.length > 0 && (
                                <span><strong style={{ color: 'var(--amber)' }}>Introduced:</strong> {r.introducedMonths}</span>
                              )}
                            </div>
                          )}
                        </div>
                      </React.Fragment>
                    )
                  })}
                </div>
              </div>

              <div>
                <div style={{ fontSize: 10.5, fontWeight: 900, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.muted, marginBottom: 10 }}>
                  Likely drivers
                </div>

                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: C.ink, marginBottom: 6 }}>
                    Projects with biggest annual demand Δ
                  </div>
                  {impact.topProjectDrivers.length ? (
                    impact.topProjectDrivers.map(p => {
                      const d = p.delta || 0
                      const tone = d < 0 ? 'var(--green)' : d > 0 ? 'var(--red)' : C.faint
                      const roleBits = ['CSM', 'PM', 'Analyst']
                        .map(r => ({ r, v: p.byRoleDelta?.[r] || 0 }))
                        .filter(x => Math.abs(x.v) >= 1)
                        .sort((a, b) => Math.abs(b.v) - Math.abs(a.v))
                        .slice(0, 2)
                        .map(x => `${x.r} ${impact.formatH(x.v)}`)
                        .join(', ')
                      const note = (p.baselineTotal > 0 && p.scenarioTotal === 0) ? 'Excluded' : roleBits
                      return (
                        <div key={p.key} style={{ fontSize: 12.5, color: C.muted, marginBottom: 4 }}>
                          <strong style={{ color: C.ink }}>{p.name}</strong>{' '}
                          <span style={{ color: tone, fontWeight: 850 }}>
                            {impact.formatH(d)}
                          </span>
                          {note ? <span style={{ color: C.faint }}> · {note}</span> : null}
                        </div>
                      )
                    })
                  ) : (
                    <div style={{ fontSize: 12.5, color: C.faint }}>
                      No material project-level demand changes detected.
                    </div>
                  )}
                </div>

                <div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: C.ink, marginBottom: 6 }}>
                    People operating above per-person capacity (largest increases)
                  </div>
                  {impact.topOverloads.length ? (
                    impact.topOverloads.map(r => (
                      <div key={r.key} style={{ fontSize: 12.5, color: C.muted, marginBottom: 4 }}>
                        <strong style={{ color: C.ink }}>{r.name}</strong>{' '}
                        <span style={{ color: C.faint }}>({r.role})</span>{' '}
                        — <strong>{MONTHS[r.monthIndex]}</strong>{' '}
                        <span style={{ color: 'var(--red)', fontWeight: 850 }}>
                          +{Math.round(r.over).toLocaleString()}h over
                        </span>
                        <span style={{ color: C.faint }}>
                          {' '}({Math.round(r.hours).toLocaleString()}h vs {Math.round(r.cap).toLocaleString()}h cap){r.isNew ? ' · new' : ''}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div style={{ fontSize: 12.5, color: C.faint }}>
                      No increased over-capacity person-months detected.
                    </div>
                  )}
                </div>

                {!!impact.unstaffedDelta?.length && (
                  <div style={{ marginTop: 12, fontSize: 11.5, color: C.faint, lineHeight: 1.55 }}>
                    <strong>Unassigned hours Δ:</strong>{' '}
                    {impact.unstaffedDelta
                      .filter(r => Math.abs(r.delta) >= 1)
                      .map(r => `${r.role} ${impact.formatH(r.delta)}`)
                      .join(' · ') || '—'}
                  </div>
                )}
              </div>
            </div>
          </CardBody>
        </Card>
      )}

      {/* KPI cards (required) */}
      {(() => {
        const demandSeries = (calc, role) => {
          if (role !== 'Analyst') return calc?.demandByRole?.[role] || new Array(12).fill(0)
          const base = calc?.analystModel?.demandBase || calc?.demandByRole?.['Analyst 1'] || new Array(12).fill(0)
          const inc = calc?.analystModel?.demandIncremental || calc?.demandByRole?.['Analyst 2'] || new Array(12).fill(0)
          const tot = calc?.analystModel?.demandTotal || base.map((v, i) => (v || 0) + (inc[i] || 0))
          return tot
        }
        const effCapSeries = (cap, role) => {
          const key = role === 'Analyst' ? 'Analyst 1' : role
          return cap?.[key]?.effectiveMonthlyByMonth || new Array(12).fill(cap?.[key]?.effectiveMonthly || 0)
        }
        const sum = (arr) => (arr || []).reduce((a, b) => a + (b || 0), 0)
        const monthsOverSeries = (dem, cap) => (dem || []).filter((d, i) => (d || 0) > (cap?.[i] || 0)).length
        const utilPct = (dem, cap) => {
          const denom = sum(cap)
          if (!denom) return '—'
          return `${((sum(dem) / denom) * 100).toFixed(0)}%`
        }
        const peakMonth = (arr) => {
          const safe = Array.isArray(arr) && arr.length ? arr : new Array(12).fill(0)
          const maxVal = Math.max(...safe.map(v => v || 0))
          const maxIdx = safe.findIndex(v => (v || 0) === maxVal)
          return MONTHS[maxIdx < 0 ? 0 : maxIdx] || '—'
        }

        const roles = ['CSM', 'PM', 'Analyst']
        return (
          <KpiStrip cols={3}>
            {roles.map(role => {
              const bDem = demandSeries(baselineCalc, role)
              const sDem = demandSeries(scenarioCalc, role)
              const bCap = effCapSeries(baselineCap, role)
              const sCap = effCapSeries(scenarioCap, role)

              const bMonths = monthsOverSeries(bDem, bCap)
              const sMonths = monthsOverSeries(sDem, sCap)
              const deltaMonths = sMonths - bMonths

              const badge = `${sMonths} months over` + (deltaMonths === 0 ? '' : ` (${deltaMonths > 0 ? '+' : ''}${deltaMonths})`)
              const sub = `${Math.round(sum(sDem)).toLocaleString()}h/yr · Peak: ${peakMonth(sDem)}`
              const accent = role === 'CSM' ? 'red' : role === 'PM' ? 'amber' : 'amber'

              return (
                <KpiCard
                  key={role}
                  label={role === 'Analyst' ? 'Analyst Utilization (A1+A2)' : `${role} Utilization`}
                  value={utilPct(sDem, sCap)}
                  sub={sub}
                  badge={badge}
                  badgeType={sMonths > 0 ? 'red' : 'green'}
                  accent={accent}
                />
              )
            })}
          </KpiStrip>
        )
      })()}

      {/* Analyst incremental demand pressure (required) */}
      {scenarioCalc?.analystModel && (
        <Card style={{ marginBottom: 16 }}>
          <CardHeader title="Analyst incremental demand pressure">
            <Tag>Analyst 1 capacity · Analyst 2 incremental demand</Tag>
          </CardHeader>
          <CardBody>
            {(() => {
              const base = scenarioCalc.analystModel?.demandBase || new Array(12).fill(0)
              const inc = scenarioCalc.analystModel?.demandIncremental || new Array(12).fill(0)
              const tot = scenarioCalc.analystModel?.demandTotal || base.map((v, i) => v + (inc[i] || 0))
              const effArr = scenarioCap?.['Analyst 1']?.effectiveMonthlyByMonth || new Array(12).fill(scenarioCap?.['Analyst 1']?.effectiveMonthly || 0)
              const hrsArr = scenarioCap?.['Analyst 1']?.hrsPerPersonMonthByMonth || new Array(12).fill(HRS_PER_PERSON_MONTH)

              const peakTot = Math.max(...tot)
              const peakIdx = tot.indexOf(peakTot)
              const effAtPeak = effArr[peakIdx] || 0
              const extraHrs = Math.max(0, peakTot - effAtPeak)
              const denom = hrsArr[peakIdx] || 0
              const extraFte = denom ? (extraHrs / denom) : 0

              const ann = (arr) => arr.reduce((a, b) => a + (b || 0), 0)
              const annBase = ann(base)
              const annInc = ann(inc)
              const annTot = ann(tot)

              return (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 }}>
                  <div style={miniKpi()}>
                    <div style={miniLabel()}>Base demand (A1)</div>
                    <div style={miniVal()}>{Math.round(annBase).toLocaleString()}h/yr</div>
                  </div>
                  <div style={miniKpi()}>
                    <div style={miniLabel()}>Incremental demand (A2)</div>
                    <div style={miniVal()}>{Math.round(annInc).toLocaleString()}h/yr</div>
                  </div>
                  <div style={miniKpi()}>
                    <div style={miniLabel()}>Total demand (A1+A2)</div>
                    <div style={miniVal()}>{Math.round(annTot).toLocaleString()}h/yr</div>
                  </div>
                  <div style={miniKpi()}>
                    <div style={miniLabel()}>Peak month extra FTE needed</div>
                    <div style={miniVal()}>
                      {extraHrs === 0 ? '—' : `+${extraFte.toFixed(1)} FTE`}
                    </div>
                    <div style={{ fontSize: 11, color: C.faint, marginTop: 4 }}>
                      Peak: {MONTHS[peakIdx] || '—'} · {Math.round(peakTot).toLocaleString()}h vs {Math.round(effAtPeak).toLocaleString()}h eff cap/mo
                    </div>
                  </div>
                </div>
              )
            })()}
            <div style={{ fontSize: 11.5, color: C.faint, marginTop: 10, lineHeight: 1.55 }}>
              This models whether current <strong>Analyst 1</strong> capacity can absorb incremental <strong>Analyst 2</strong> demand. Add Analyst FTE overrides to increase capacity.
            </div>
          </CardBody>
        </Card>
      )}

      <ScenarioCapacityDemandChart
        baseline={baselineCalc}
        scenario={scenarioCalc}
        baselineCap={baselineCap}
        scenarioCap={scenarioCap}
        includeAnalyst2={includeAnalyst2}
      />

      {/* Monthly demand delta chart — inline bar chart per role */}
      <Card style={{ marginBottom: 16 }}>
        <CardHeader title="Monthly Demand: Baseline vs Scenario">
          <Tag>All primary roles</Tag>
        </CardHeader>
        <CardBody style={{ overflowX: 'auto' }}>
          <MonthlyDeltaTable
            baseline={baselineCalc}
            scenario={scenarioCalc}
            baselineCap={baselineCap}
            scenarioCap={scenarioCap}
            diff={diff}
            includeAnalyst2={includeAnalyst2}
          />
        </CardBody>
      </Card>

      {/* Role-level capacity table */}
      <Card>
        <CardHeader title="Capacity Configuration: Baseline vs Scenario">
          <Tag>FTE & effective hours</Tag>
        </CardHeader>
        <CardBody style={{ padding: 0 }}>
          <CapacityCompareTable baselineCap={baselineCap} scenarioCap={scenarioCap} baselineCalc={baselineCalc} scenarioCalc={scenarioCalc} />
        </CardBody>
      </Card>
    </div>
  )
}

function CapacityRiskImpact({ baseline, scenario, baselineCap, scenarioCap, includeAnalyst2 }) {
  const roles = ['CSM', 'PM', 'Analyst']

  const summarizeRole = (role) => {
    const isAnalyst = role === 'Analyst'

    const bBase = isAnalyst
      ? (baseline?.analystModel?.demandBase || baseline?.demandByRole?.['Analyst 1'] || new Array(12).fill(0))
      : null
    const bInc = isAnalyst
      ? (baseline?.analystModel?.demandIncremental || baseline?.demandByRole?.['Analyst 2'] || new Array(12).fill(0))
      : null
    const bTot = isAnalyst
      ? (baseline?.analystModel?.demandTotal || (bBase || new Array(12).fill(0)).map((v, i) => v + ((bInc || [])[i] || 0)))
      : null

    const sBase = isAnalyst
      ? (scenario?.analystModel?.demandBase || scenario?.demandByRole?.['Analyst 1'] || new Array(12).fill(0))
      : null
    const sInc = isAnalyst
      ? (scenario?.analystModel?.demandIncremental || scenario?.demandByRole?.['Analyst 2'] || new Array(12).fill(0))
      : null
    const sTot = isAnalyst
      ? (scenario?.analystModel?.demandTotal || (sBase || new Array(12).fill(0)).map((v, i) => v + ((sInc || [])[i] || 0)))
      : null

    const bArr = isAnalyst
      ? (includeAnalyst2 ? bTot : bBase)
      : (baseline?.demandByRole?.[role] || new Array(12).fill(0))
    const sArr = isAnalyst
      ? (includeAnalyst2 ? sTot : sBase)
      : (scenario?.demandByRole?.[role] || new Array(12).fill(0))

    const capKey = isAnalyst ? 'Analyst 1' : role
    const bEffArr = baselineCap?.[capKey]?.effectiveMonthlyByMonth || new Array(12).fill(baselineCap?.[capKey]?.effectiveMonthly || 0)
    const sEffArr = scenarioCap?.[capKey]?.effectiveMonthlyByMonth || new Array(12).fill(scenarioCap?.[capKey]?.effectiveMonthly || (bEffArr[0] || 0))

    const bBreach = bArr.map((v, i) => v > (bEffArr[i] || 0))
    const sBreach = sArr.map((v, i) => v > (sEffArr[i] || 0))

    const resolvedIdx = MONTHS.map((_, i) => (bBreach[i] && !sBreach[i]) ? i : -1).filter(i => i !== -1)
    const introducedIdx = MONTHS.map((_, i) => (!bBreach[i] && sBreach[i]) ? i : -1).filter(i => i !== -1)

    const pick = (idxs, n = 3) => idxs.slice(0, n).map(i => MONTHS[i]).join(', ')

    const bCount = bBreach.filter(Boolean).length
    const sCount = sBreach.filter(Boolean).length

    const ann = (arr) => arr.reduce((a, b) => a + (b || 0), 0)
    const demandDeltaAnn = ann(sArr) - ann(bArr)
    const effCapDelta = (scenarioCap?.[capKey]?.effectiveMonthly || 0) - (baselineCap?.[capKey]?.effectiveMonthly || 0)

    return {
      role,
      bCount,
      sCount,
      deltaCount: sCount - bCount,
      resolved: resolvedIdx.length,
      introduced: introducedIdx.length,
      resolvedMonths: resolvedIdx.length ? pick(resolvedIdx) : '',
      introducedMonths: introducedIdx.length ? pick(introducedIdx) : '',
      demandDeltaAnn,
      effCapDelta,
    }
  }

  const summaries = roles.map(summarizeRole)
  const totalResolved = summaries.reduce((s, r) => s + r.resolved, 0)
  const totalIntroduced = summaries.reduce((s, r) => s + r.introduced, 0)

  // Pick “headline” role: largest absolute change in breach months (then demand delta)
  const headline = [...summaries].sort((a, b) =>
    Math.abs(b.deltaCount) - Math.abs(a.deltaCount) ||
    Math.abs(b.demandDeltaAnn) - Math.abs(a.demandDeltaAnn)
  )[0]

  const headlineText = headline
    ? `${headline.role}: ${headline.bCount} → ${headline.sCount} months over effective cap` +
      (headline.deltaCount === 0 ? '' : ` (${headline.deltaCount > 0 ? '+' : ''}${headline.deltaCount})`)
    : ''

  const tone = totalIntroduced > totalResolved ? 'amber' : 'blue'

  return (
    <div style={{ marginBottom: 14 }}>
      <AlertBar type={tone}>
        <strong>Capacity risk impact:</strong>{' '}
        {headlineText || 'Baseline vs scenario breach changes by role.'}
        {' '}
        {totalResolved > 0 && <><strong style={{ color: 'var(--green)' }}>{totalResolved}</strong> breach-month{totalResolved !== 1 ? 's' : ''} resolved</>}
        {totalResolved > 0 && totalIntroduced > 0 && <> · </>}
        {totalIntroduced > 0 && <><strong style={{ color: 'var(--amber)' }}>{totalIntroduced}</strong> introduced</>}
        {totalResolved === 0 && totalIntroduced === 0 && <>No breach-month changes.</>}
      </AlertBar>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {summaries.map(r => {
          const color =
            r.deltaCount < 0 ? 'var(--green)' :
            r.deltaCount > 0 ? 'var(--red)' :
            C.faint
          return (
            <div
              key={r.role}
              style={{
                background: C.surface,
                border: `1px solid ${C.border}`,
                borderRadius: 10,
                padding: '12px 14px',
                boxShadow: 'var(--shadow-sm)',
                borderLeft: `3px solid ${color === C.faint ? 'var(--border)' : color}`,
              }}
            >
              <div style={{ fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.7px', color: C.muted, marginBottom: 6 }}>
                {r.role}
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontFamily: 'var(--font-serif)', fontSize: 18, color: C.ink }}>
                  {r.sCount}
                </span>
                <span style={{ fontSize: 11.5, color: C.muted }}>
                  mo over cap
                  <span style={{ marginLeft: 6, fontWeight: 800, color }}>
                    {r.deltaCount === 0 ? '—' : `${r.deltaCount > 0 ? '+' : ''}${r.deltaCount}`}
                  </span>
                </span>
              </div>

              <div style={{ fontSize: 11.5, color: C.muted, marginTop: 6, lineHeight: 1.45 }}>
                Eff. cap Δ:{' '}
                <strong style={{ color: r.effCapDelta < 0 ? 'var(--red)' : r.effCapDelta > 0 ? 'var(--green)' : C.faint }}>
                  {r.effCapDelta === 0 ? '—' : `${r.effCapDelta > 0 ? '+' : ''}${Math.round(r.effCapDelta).toLocaleString()}h/mo`}
                </strong>
                <br />
                Demand Δ:{' '}
                <strong style={{ color: r.demandDeltaAnn < 0 ? 'var(--green)' : r.demandDeltaAnn > 0 ? 'var(--red)' : C.faint }}>
                  {r.demandDeltaAnn === 0 ? '—' : `${r.demandDeltaAnn > 0 ? '+' : ''}${Math.round(r.demandDeltaAnn).toLocaleString()}h/yr`}
                </strong>
              </div>

              {(r.resolvedMonths || r.introducedMonths) && (
                <div style={{ fontSize: 10.5, color: C.faint, marginTop: 8, lineHeight: 1.45 }}>
                  {r.resolvedMonths && (
                    <div>
                      Resolved: <strong style={{ color: 'var(--green)' }}>{r.resolvedMonths}</strong>
                    </div>
                  )}
                  {r.introducedMonths && (
                    <div>
                      Introduced: <strong style={{ color: 'var(--amber)' }}>{r.introducedMonths}</strong>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ScenarioCapacityDemandChart({ baseline, scenario, baselineCap, scenarioCap, includeAnalyst2 }) {
  const [role, setRole] = useState('CSM')
  const chartRef = useRef(null)

  const isAnalyst = role === 'Analyst'

  const bA1 = isAnalyst ? (baseline?.analystModel?.demandBase || baseline?.demandByRole?.['Analyst 1'] || new Array(12).fill(0)) : null
  const bA2 = isAnalyst ? (baseline?.analystModel?.demandIncremental || baseline?.demandByRole?.['Analyst 2'] || new Array(12).fill(0)) : null
  const bTot = isAnalyst ? (baseline?.analystModel?.demandTotal || (bA1 || new Array(12).fill(0)).map((v, i) => v + ((bA2 || [])[i] || 0))) : null

  const sA1 = isAnalyst ? (scenario?.analystModel?.demandBase || scenario?.demandByRole?.['Analyst 1'] || new Array(12).fill(0)) : null
  const sA2 = isAnalyst ? (scenario?.analystModel?.demandIncremental || scenario?.demandByRole?.['Analyst 2'] || new Array(12).fill(0)) : null
  const sTot = isAnalyst ? (scenario?.analystModel?.demandTotal || (sA1 || new Array(12).fill(0)).map((v, i) => v + ((sA2 || [])[i] || 0))) : null

  const bArr = isAnalyst
    ? (includeAnalyst2 ? bTot : bA1)
    : (baseline?.demandByRole?.[role] || new Array(12).fill(0))
  const sArr = isAnalyst
    ? (includeAnalyst2 ? sTot : sA1)
    : (scenario?.demandByRole?.[role] || new Array(12).fill(0))

  const capKey = isAnalyst ? 'Analyst 1' : role
  const bEffCapArr = baselineCap?.[capKey]?.effectiveMonthlyByMonth || new Array(12).fill(baselineCap?.[capKey]?.effectiveMonthly || 0)
  const sEffCapArr = scenarioCap?.[capKey]?.effectiveMonthlyByMonth || new Array(12).fill(scenarioCap?.[capKey]?.effectiveMonthly || (bEffCapArr[0] || 0))

  const baseColor =
    CHART_COLORS[role] ||
    (String(role).toLowerCase().includes('analyst') ? CHART_COLORS.Analyst : null) ||
    '#2563eb'

  const annual = (arr) => (arr || []).reduce((a, b) => a + (b || 0), 0)
  const deltaAnnual = annual(sArr) - annual(bArr)

  const chartData = {
    labels: MONTHS,
    datasets: [
      ...(isAnalyst && includeAnalyst2 ? [
        {
          label: 'Baseline Analyst 1 (base)',
          data: (bA1 || []).map(v => Math.round(v)),
          backgroundColor: 'rgba(148,163,184,0.50)',
          borderRadius: 3,
          type: 'bar',
          stack: 'baseline',
        },
        {
          label: 'Baseline Analyst 2 (incremental)',
          data: (bA2 || []).map(v => Math.round(v)),
          backgroundColor: 'rgba(148,163,184,0.25)',
          borderRadius: 3,
          type: 'bar',
          stack: 'baseline',
        },
        {
          label: 'Scenario Analyst 1 (base)',
          data: (sA1 || []).map(v => Math.round(v)),
          backgroundColor: baseColor + 'cc',
          borderRadius: 3,
          type: 'bar',
          stack: 'scenario',
        },
        {
          label: 'Scenario Analyst 2 (incremental)',
          data: (sA2 || []).map(v => Math.round(v)),
          backgroundColor: 'rgba(196, 123, 26, 0.65)',
          borderRadius: 3,
          type: 'bar',
          stack: 'scenario',
        },
      ] : isAnalyst ? [
        {
          label: 'Baseline demand (Analyst 1)',
          data: (bA1 || []).map(v => Math.round(v)),
          backgroundColor: 'rgba(148,163,184,0.55)',
          borderRadius: 3,
          type: 'bar',
        },
        {
          label: 'Scenario demand (Analyst 1)',
          data: (sA1 || []).map(v => Math.round(v)),
          backgroundColor: baseColor + 'cc',
          borderRadius: 3,
          type: 'bar',
        },
      ] : [
        {
          label: 'Baseline demand',
          data: bArr.map(v => Math.round(v)),
          backgroundColor: 'rgba(148,163,184,0.55)',
          borderRadius: 3,
          type: 'bar',
        },
        {
          label: 'Scenario demand',
          data: sArr.map(v => Math.round(v)),
          backgroundColor: baseColor + 'cc',
          borderRadius: 3,
          type: 'bar',
        },
      ]),
      {
        label: 'Baseline eff. cap',
        data: bEffCapArr.map(v => Math.round(v || 0)),
        type: 'line',
        borderColor: 'rgba(148,163,184,0.95)',
        borderDash: [6, 3],
        borderWidth: 2,
        pointRadius: 0,
        fill: false,
      },
      {
        label: 'Scenario eff. cap',
        data: sEffCapArr.map(v => Math.round(v || 0)),
        type: 'line',
        borderColor: '#c84b31',
        borderDash: [4, 4],
        borderWidth: 2,
        pointRadius: 0,
        fill: false,
      },
    ],
  }

  return (
    <Card style={{ marginBottom: 16 }}>
      <CardHeader title="Capacity vs Demand (Full Year)">
        <Tag>{role}</Tag>
      </CardHeader>
      <CardBody>
        <CapacityRiskImpact
          baseline={baseline}
          scenario={scenario}
          baselineCap={baselineCap}
          scenarioCap={scenarioCap}
          includeAnalyst2={includeAnalyst2}
        />

        <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          {['CSM', 'PM', 'Analyst'].map(r => (
            <button
              key={r}
              onClick={() => setRole(r)}
              style={{
                padding: '5px 12px',
                borderRadius: 99,
                fontSize: 12,
                fontWeight: role === r ? 650 : 500,
                border: `1.5px solid ${role === r ? C.accent : C.border}`,
                background: role === r ? 'var(--accent-light)' : C.surface,
                color: role === r ? C.accent : C.muted,
                cursor: 'pointer',
                fontFamily: 'var(--font-sans)',
              }}
            >
              {r}
            </button>
          ))}
          <div style={{ marginLeft: 'auto', fontSize: 11.5, color: C.muted }}>
            Annual Δ:{' '}
            <strong style={{ color: deltaAnnual < 0 ? 'var(--green)' : deltaAnnual > 0 ? 'var(--red)' : C.faint }}>
              {deltaAnnual === 0 ? '—' : `${deltaAnnual > 0 ? '+' : ''}${Math.round(deltaAnnual).toLocaleString()}h`}
            </strong>
          </div>
        </div>

        <div style={{ position: 'relative', height: 260 }}>
          <Bar
            ref={chartRef}
            data={chartData}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: {
                  position: 'bottom',
                  labels: { usePointStyle: true, boxWidth: 8, font: { size: 11 } },
                },
              },
              scales: {
                x: { grid: { display: false }, stacked: isAnalyst && includeAnalyst2 },
                y: { grid: { color: '#f0ede6' }, ticks: { callback: v => v.toLocaleString() }, stacked: isAnalyst && includeAnalyst2 },
              },
            }}
          />
        </div>

        <div style={{ fontSize: 11.5, color: C.faint, marginTop: 10, lineHeight: 1.55 }}>
          {isAnalyst
            ? 'Analyst 1 (base) + Analyst 2 (incremental) demand is stacked; capacity line remains Analyst 1 baseline only.'
            : 'Baseline bars vs scenario bars. Dashed lines show effective capacity baselines (scenario line reflects FTE/attrition overrides).'
          }
        </div>
      </CardBody>
    </Card>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// MONTHLY DELTA TABLE
// ─────────────────────────────────────────────────────────────────────────

function MonthlyDeltaTable({ baseline, scenario, baselineCap, scenarioCap, diff, includeAnalyst2 }) {
  const [role, setRole] = useState('CSM')
  const isAnalyst = role === 'Analyst'

  const bA1 = isAnalyst ? (baseline?.analystModel?.demandBase || baseline?.demandByRole?.['Analyst 1'] || new Array(12).fill(0)) : null
  const bA2 = isAnalyst ? (baseline?.analystModel?.demandIncremental || baseline?.demandByRole?.['Analyst 2'] || new Array(12).fill(0)) : null
  const bTot = isAnalyst ? (baseline?.analystModel?.demandTotal || (bA1 || new Array(12).fill(0)).map((v, i) => v + ((bA2 || [])[i] || 0))) : null

  const sA1 = isAnalyst ? (scenario?.analystModel?.demandBase || scenario?.demandByRole?.['Analyst 1'] || new Array(12).fill(0)) : null
  const sA2 = isAnalyst ? (scenario?.analystModel?.demandIncremental || scenario?.demandByRole?.['Analyst 2'] || new Array(12).fill(0)) : null
  const sTot = isAnalyst ? (scenario?.analystModel?.demandTotal || (sA1 || new Array(12).fill(0)).map((v, i) => v + ((sA2 || [])[i] || 0))) : null

  const bArr = isAnalyst ? (includeAnalyst2 ? bTot : bA1) : (baseline?.demandByRole?.[role] || new Array(12).fill(0))
  const sArr = isAnalyst ? (includeAnalyst2 ? sTot : sA1) : (scenario?.demandByRole?.[role]  || new Array(12).fill(0))

  const capKey = isAnalyst ? 'Analyst 1' : role
  const bEffArr = baselineCap?.[capKey]?.effectiveMonthlyByMonth || new Array(12).fill(baselineCap?.[capKey]?.effectiveMonthly || 0)
  const sEffArr = scenarioCap?.[capKey]?.effectiveMonthlyByMonth || new Array(12).fill(scenarioCap?.[capKey]?.effectiveMonthly || (bEffArr[0] || 0))

  return (
    <div>
      {/* Role selector */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {['CSM', 'PM', 'Analyst'].map(r => (
          <button key={r} onClick={() => setRole(r)} style={{
            padding: '5px 12px', borderRadius: 99, fontSize: 12, fontWeight: role === r ? 600 : 400,
            border: `1.5px solid ${role === r ? C.accent : C.border}`,
            background: role === r ? 'var(--accent-light)' : C.surface,
            color: role === r ? C.accent : C.muted,
            cursor: 'pointer', fontFamily: 'var(--font-sans)',
          }}>{r}</button>
        ))}
      </div>

      {/* Month table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
          <thead>
            <tr style={{ background: 'var(--surface-1)' }}>
              <th style={thSt}>Month</th>
              {MONTHS.map(m => <th key={m} style={{ ...thSt, textAlign: 'right' }}>{m}</th>)}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ ...tdSt, fontWeight: 600, color: C.muted }}>Baseline</td>
              {bArr.map((v, i) => (
                <td key={i} style={{ ...tdSt, textAlign: 'right', color: v > (bEffArr[i] || 0) ? 'var(--red)' : C.ink }}>
                  {Math.round(v).toLocaleString()}
                </td>
              ))}
            </tr>
            <tr style={{ background: 'var(--accent-light)' }}>
              <td style={{ ...tdSt, fontWeight: 600, color: C.accent }}>Scenario</td>
              {sArr.map((v, i) => (
                <td key={i} style={{ ...tdSt, textAlign: 'right', fontWeight: 600, color: v > (sEffArr[i] || 0) ? 'var(--red)' : C.ink }}>
                  {Math.round(v).toLocaleString()}
                </td>
              ))}
            </tr>
            <tr style={{ borderTop: `2px solid ${C.border}` }}>
              <td style={{ ...tdSt, fontWeight: 600 }}>Δ</td>
              {MONTHS.map((_, i) => {
                const d = sArr[i] - bArr[i]
                return (
                  <td key={i} style={{ ...tdSt, textAlign: 'right', fontWeight: 700, fontSize: 11,
                    color: d < 0 ? 'var(--green)' : d > 0 ? 'var(--red)' : C.faint,
                  }}>
                    {d === 0 ? '—' : `${d > 0 ? '+' : ''}${Math.round(d).toLocaleString()}`}
                  </td>
                )
              })}
            </tr>
            <tr>
              <td style={{ ...tdSt, color: C.muted, fontSize: 10.5 }}>Eff. cap (baseline)</td>
              {MONTHS.map((_, i) => (
                <td key={i} style={{ ...tdSt, textAlign: 'right', color: C.faint, fontSize: 10.5 }}>
                  {Math.round(bEffArr[i] || 0).toLocaleString()}
                </td>
              ))}
            </tr>
            <tr>
              <td style={{ ...tdSt, color: C.muted, fontSize: 10.5 }}>Eff. cap (scenario)</td>
              {MONTHS.map((_, i) => (
                <td key={i} style={{ ...tdSt, textAlign: 'right', color: C.faint, fontSize: 10.5 }}>
                  {Math.round(sEffArr[i] || 0).toLocaleString()}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// CAPACITY COMPARE TABLE
// ─────────────────────────────────────────────────────────────────────────

function CapacityCompareTable({ baselineCap, scenarioCap, baselineCalc, scenarioCalc }) {
  const roles = ['CSM', 'PM', 'Analyst']
  const sum = (arr) => (arr || []).reduce((a, b) => a + (b || 0), 0)
  const annualDemand = (calc, role) => {
    if (!calc) return 0
    if (role !== 'Analyst') return sum(calc?.demandByRole?.[role] || [])
    const a1 = calc?.analystModel?.demandBase || calc?.demandByRole?.['Analyst 1'] || new Array(12).fill(0)
    const a2 = calc?.analystModel?.demandIncremental || calc?.demandByRole?.['Analyst 2'] || new Array(12).fill(0)
    return sum(a1) + sum(a2)
  }
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      <thead>
        <tr style={{ background: 'var(--surface-1)' }}>
          {[
            'Role',
            'Baseline FTE', 'Scenario FTE', 'Δ FTE',
            'Baseline Eff. Cap/mo', 'Scenario Eff. Cap/mo', 'Δ Cap/mo',
            'Baseline Demand/yr', 'Scenario Demand/yr', 'Δ Demand/yr',
          ].map(h => (
            <th key={h} style={thSt}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {roles.map((role, i) => {
          const capKey = role === 'Analyst' ? 'Analyst 1' : role
          const bCap = baselineCap?.[capKey] || {}
          const sCap = scenarioCap?.[capKey] || {}
          const fteDelta = (sCap.fte || 0) - (bCap.fte || 0)
          const capDelta = Math.round((sCap.effectiveMonthly || 0) - (bCap.effectiveMonthly || 0))
          const bDem = Math.round(annualDemand(baselineCalc, role) || 0)
          const sDem = Math.round(annualDemand(scenarioCalc, role) || 0)
          const demDelta = sDem - bDem
          return (
            <tr key={role} style={{ background: i % 2 ? 'var(--surface-1)' : C.surface, borderBottom: `1px solid ${C.border}` }}>
              <td style={{ ...tdSt, fontWeight: 600 }}>{role}</td>
              <td style={{ ...tdSt, fontFamily: 'var(--font-mono)' }}>{bCap.fte ?? '—'}</td>
              <td style={{ ...tdSt, fontFamily: 'var(--font-mono)', color: fteDelta !== 0 ? (fteDelta > 0 ? 'var(--green)' : 'var(--red)') : C.ink, fontWeight: fteDelta !== 0 ? 600 : 400 }}>{sCap.fte ?? '—'}</td>
              <td style={{ ...tdSt, fontFamily: 'var(--font-mono)', fontWeight: 700, color: fteDelta < 0 ? 'var(--red)' : fteDelta > 0 ? 'var(--green)' : C.faint }}>
                {fteDelta === 0 ? '—' : `${fteDelta > 0 ? '+' : ''}${fteDelta}`}
              </td>
              <td style={{ ...tdSt, fontFamily: 'var(--font-mono)' }}>{Math.round(bCap.effectiveMonthly || 0).toLocaleString()}</td>
              <td style={{ ...tdSt, fontFamily: 'var(--font-mono)' }}>{Math.round(sCap.effectiveMonthly || 0).toLocaleString()}</td>
              <td style={{ ...tdSt, fontFamily: 'var(--font-mono)', fontWeight: 700, color: capDelta < 0 ? 'var(--red)' : capDelta > 0 ? 'var(--green)' : C.faint }}>
                {capDelta === 0 ? '—' : `${capDelta > 0 ? '+' : ''}${capDelta.toLocaleString()}`}
              </td>
              <td style={{ ...tdSt, fontFamily: 'var(--font-mono)' }}>{bDem.toLocaleString()}</td>
              <td style={{ ...tdSt, fontFamily: 'var(--font-mono)' }}>{sDem.toLocaleString()}</td>
              <td style={{ ...tdSt, fontFamily: 'var(--font-mono)', fontWeight: 700, color: demDelta < 0 ? 'var(--green)' : demDelta > 0 ? 'var(--red)' : C.faint }}>
                {demDelta === 0 ? '—' : `${demDelta > 0 ? '+' : ''}${demDelta.toLocaleString()}`}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// UTILITY COMPONENTS
// ─────────────────────────────────────────────────────────────────────────

function EditableScenarioName({ value, onChange }) {
  const [editing, setEditing] = useState(false)
  const [local, setLocal] = useState(value)

  if (!editing) return null // name shown in EditPanel header instead

  return (
    <input
      autoFocus
      value={local}
      onChange={e => setLocal(e.target.value)}
      onBlur={() => { onChange(local); setEditing(false) }}
      onKeyDown={e => e.key === 'Enter' && (onChange(local), setEditing(false))}
      style={{ ...inputStyle(), fontSize: 14, fontWeight: 600 }}
    />
  )
}

function EditableDescription({ value, onChange }) {
  const [editing, setEditing] = useState(false)
  if (!editing) return (
    <div onClick={() => setEditing(true)} style={{ fontSize: 11.5, color: value ? C.muted : C.faint, marginTop: 3, cursor: 'text' }}>
      {value || 'Add description…'}
    </div>
  )
  return (
    <input
      autoFocus
      value={value || ''}
      onChange={e => onChange(e.target.value)}
      onBlur={() => setEditing(false)}
      placeholder="Brief description of this scenario"
      style={{ ...inputStyle(), fontSize: 11.5, marginTop: 3 }}
    />
  )
}

function FieldGroup({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: C.muted, marginBottom: 4 }}>
        {label}
      </div>
      {children}
    </div>
  )
}

function InlineWarn({ text, onProceed, onChooseElse }) {
  return (
    <div style={{
      marginTop: 6,
      padding: '6px 10px',
      background: 'var(--amber-light, #fefce8)',
      border: '1px solid #fde68a',
      borderRadius: 6,
      display: 'flex',
      gap: 8,
      alignItems: 'center',
      flexWrap: 'wrap',
      fontSize: 11.5,
      color: C.muted,
    }}>
      <span style={{ flex: 1 }}>
        <strong>{PMO_WARN_NAME}</strong> — {text}
      </span>
      <button onClick={onProceed} style={btnStyle('primary')}>Proceed</button>
      <button onClick={onChooseElse} style={btnStyle('danger-sm')}>Choose someone else</button>
    </div>
  )
}

function DatalistEnumField({ id, value, placeholder, options, onCommit }) {
  const listId = id
  const [draft, setDraft] = useState(value || '')

  useEffect(() => {
    setDraft(value || '')
  }, [value])

  const commit = () => {
    const s = String(draft || '').trim()
    if (!s) {
      onCommit?.(undefined)
      return
    }
    if (options.includes(s)) {
      onCommit?.(s)
      return
    }
    setDraft('')
    onCommit?.(undefined)
  }

  return (
    <div>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          }
          if (e.key === 'Escape') {
            setDraft(value || '')
          }
        }}
        placeholder={placeholder}
        list={listId}
        style={inputStyle()}
      />
      <datalist id={listId}>
        {options.map(o => <option key={o} value={o} />)}
      </datalist>
    </div>
  )
}

function RosterAssignmentField({ role, projectId, baselineName, overrideValue, options, onChange }) {
  // listId must be globally unique per (project, role) pair.
  // The old code used only `role` — so all CSM fields across all rows shared one datalist,
  // causing wrong autocomplete suggestions and browser render conflicts.
  const listId = useMemo(() => {
    const safeRole = String(role || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40)
    const safeProj = String(projectId || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40)
    return `spark_roster_${safeProj}_${safeRole}`
  }, [role, projectId])

  const baselineNorm = useMemo(() => String(baselineName || '').trim(), [baselineName])

  const initial = useMemo(() => {
    if (overrideValue === undefined) return baselineNorm || ''
    if (overrideValue === null) return ''
    return String(overrideValue || '')
  }, [overrideValue, baselineNorm])

  const [draft, setDraft] = useState(initial)
  const [needsConfirm, setNeedsConfirm] = useState(false)
  const [needsPmoWarn, setNeedsPmoWarn] = useState(false)
  // onMouseDown on a button fires BEFORE onBlur on the input.
  // Without this flag, blur calls commit() first, which may trigger a re-render
  // that repositions the DOM — causing the button click to land on nothing and freeze.
  const suppressBlurRef = useRef(false)

  useEffect(() => {
    setDraft(initial)
    setNeedsConfirm(false)
    setNeedsPmoWarn(false)
  }, [initial])

  const norm = (s) => String(s || '').trim()
  const isKnown = useMemo(() => {
    const s = norm(draft)
    if (!s) return true
    return Array.isArray(options) ? options.includes(s) : false
  }, [draft, options])

  const commit = useCallback(({ forceNew = false, forcePmo = false } = {}) => {
    const s = norm(draft)
    // Treat “same as baseline” as no override.
    if (s === baselineNorm && overrideValue === undefined) { setNeedsConfirm(false); return }
    if (s === baselineNorm && overrideValue !== undefined) { onChange?.(undefined); setNeedsConfirm(false); return }
    if (!s) { onChange?.(null); setNeedsConfirm(false); return }
    if (!forcePmo && s === 'Aalimah Showkat') { setNeedsPmoWarn(true); return }
    if (isKnown || forceNew) { onChange?.(s); setNeedsConfirm(false); return }
    setNeedsConfirm(true)
  }, [draft, isKnown, onChange, baselineNorm, overrideValue])

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          value={draft}
          onChange={(e) => {
            const v = e.target.value
            setDraft(v)
            setNeedsConfirm(false)
            if (String(v || '').trim() === PMO_WARN_NAME) setNeedsPmoWarn(true)
          }}
          onFocus={(e) => {
            // Make it easy to overwrite the auto-filled baseline value.
            try { e.target.select() } catch {}
          }}
          onBlur={() => {
            if (suppressBlurRef.current) { suppressBlurRef.current = false; return }
            commit()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit() }
            if (e.key === 'Escape') { setDraft(initial); setNeedsConfirm(false) }
          }}
          placeholder="Type or pick from roster"
          list={listId}
          style={inputStyle({ flex: 1, minWidth: 80 })}
        />
        <button
          onMouseDown={() => { suppressBlurRef.current = true }}
          onClick={() => { onChange?.(undefined); setDraft(baselineNorm || ''); setNeedsConfirm(false) }}
          style={{ ...btnStyle('ghost'), fontSize: 11, padding: '4px 8px' }}
          title="Revert to baseline value (no override)"
        >
          Baseline
        </button>
        <button
          onMouseDown={() => { suppressBlurRef.current = true }}
          onClick={() => { onChange?.(null); setDraft(''); setNeedsConfirm(false) }}
          style={{ ...btnStyle('ghost'), fontSize: 11, padding: '4px 8px' }}
          title="Set explicitly unassigned"
        >
          Unassign
        </button>
      </div>

      <datalist id={listId}>
        {(Array.isArray(options) ? options : []).map(n => (
          <option key={n} value={n} />
        ))}
      </datalist>

      {needsConfirm && (
        <div style={{
          marginTop: 6, padding: '6px 10px',
          background: 'var(--amber-light, #fefce8)', border: '1px solid #fde68a',
          borderRadius: 6, display: 'flex', gap: 8, alignItems: 'center',
          flexWrap: 'wrap', fontSize: 11.5, color: C.muted,
        }}>
          <span style={{ flex: 1 }}>
            “{norm(draft)}” isn’t in the roster for {role}. Add as new?
          </span>
          <button
            onMouseDown={() => { suppressBlurRef.current = true }}
            onClick={() => commit({ forceNew: true })}
            style={btnStyle('primary')}
          >
            Use new
          </button>
          <button
            onMouseDown={() => { suppressBlurRef.current = true }}
            onClick={() => { setDraft(''); setNeedsConfirm(false) }}
            style={btnStyle('danger-sm')}
          >
            Cancel
          </button>
        </div>
      )}

      {needsPmoWarn && (
        <div style={{
          marginTop: 6, padding: '6px 10px',
          background: 'var(--amber-light, #fefce8)', border: '1px solid #fde68a',
          borderRadius: 6, display: 'flex', gap: 8, alignItems: 'center',
          flexWrap: 'wrap', fontSize: 11.5, color: C.muted,
        }}>
          <span style={{ flex: 1 }}>
            <strong>Aalimah Showkat</strong> supports PMO as well. Bandwidth may be split across departments. Continue?
          </span>
          <button
            onMouseDown={() => { suppressBlurRef.current = true }}
            onClick={() => { setNeedsPmoWarn(false); commit({ forcePmo: true }) }}
            style={btnStyle('primary')}
          >
            Proceed
          </button>
          <button
            onMouseDown={() => { suppressBlurRef.current = true }}
            onClick={() => { setNeedsPmoWarn(false); setDraft('') }}
            style={btnStyle('danger-sm')}
          >
            Choose someone else
          </button>
        </div>
      )}

      <div style={{ fontSize: 10.5, color: C.faint, marginTop: 4, lineHeight: 1.4 }}>
        Baseline: {baselineName || 'Unassigned'}
      </div>
    </div>
  )
}


function SmallBadge({ color, children }) {
  return (
    <span style={{
      fontSize: 9.5, fontWeight: 600, padding: '1px 6px', borderRadius: 99,
      background: color + '18', color, border: `1px solid ${color}33`,
    }}>
      {children}
    </span>
  )
}

function IconBtn({ children, onClick, title, color }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: 'none', background: 'transparent', cursor: 'pointer',
        fontSize: 12, color: color || C.faint, borderRadius: 4,
        transition: 'background 0.1s',
      }}
      onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      {children}
    </button>
  )
}

function SmallInlineBtn({ children, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        marginTop: 6,
        background: 'var(--surface-1)',
        border: `1px solid ${C.border}`,
        borderRadius: 6,
        padding: '3px 8px',
        fontSize: 11,
        fontWeight: 650,
        color: C.muted,
        cursor: 'pointer',
        fontFamily: 'var(--font-sans)',
      }}
    >
      {children}
    </button>
  )
}

function NoFilePrompt() {
  return (
    <div style={{ padding: '60px 40px', textAlign: 'center', color: C.muted }}>
      <div style={{ fontSize: 36, marginBottom: 12 }}>📂</div>
      <div style={{ fontFamily: 'var(--font-serif)', fontSize: 20, color: C.ink, marginBottom: 8 }}>Upload a file to begin</div>
      <div style={{ fontSize: 13 }}>Scenario planning requires an uploaded Excel capacity model as the baseline.</div>
    </div>
  )
}

function StartPrompt({ onNew }) {
  return (
    <div style={{ padding: '60px 40px', textAlign: 'center', color: C.muted }}>
      <div style={{ fontSize: 36, marginBottom: 12 }}>⚡</div>
      <div style={{ fontFamily: 'var(--font-serif)', fontSize: 20, color: C.ink, marginBottom: 8 }}>Create your first scenario</div>
      <div style={{ fontSize: 13, marginBottom: 24 }}>Model a what-if — shift timelines, adjust FTE, change assumptions. Compare against your baseline without touching the source file.</div>
      <button onClick={() => onNew({ name: '' })} style={btnStyle('primary')}>+ Create Scenario</button>
    </div>
  )
}

function LoadingState({ msg }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '24px 0', color: C.muted }}>
      <div style={{ width: 16, height: 16, border: '2px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
      <span style={{ fontSize: 13 }}>{msg}</span>
    </div>
  )
}

function ErrorState({ msg }) {
  return (
    <div style={{ background: 'var(--red-light)', border: '1px solid #fecaca', borderRadius: 8, padding: '12px 16px', color: '#991b1b', fontSize: 13 }}>
      <strong>Calculation error:</strong> {msg}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// STYLE HELPERS
// ─────────────────────────────────────────────────────────────────────────

function inputStyle(extra = {}) {
  return {
    padding: '6px 10px', border: `1px solid ${C.border}`, borderRadius: 6,
    fontSize: 12.5, fontFamily: 'var(--font-sans)', background: C.surface,
    color: C.ink, outline: 'none', width: '100%', ...extra,
  }
}

function btnStyle(variant) {
  const base = { border: 'none', borderRadius: 6, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-sans)', padding: '7px 14px' }
  if (variant === 'primary')    return { ...base, background: 'var(--accent)', color: 'white' }
  if (variant === 'ghost')      return { ...base, background: 'var(--surface-1)', color: C.ink, border: `1px solid ${C.border}` }
  if (variant === 'danger-sm')  return { ...base, background: 'var(--red-light)', color: 'var(--red)', fontSize: 11, padding: '3px 9px' }
  return base
}

const thSt = {
  padding: '9px 12px', textAlign: 'left',
  fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px',
  color: C.muted, borderBottom: `1px solid ${C.border}`,
  background: 'var(--surface-1)', whiteSpace: 'nowrap',
}

const tdSt = {
  padding: '8px 12px', fontSize: 12,
  color: C.ink, borderBottom: `1px solid ${C.border}`,
}

function miniKpi() {
  return {
    background: 'var(--surface-1)',
    border: `1px solid ${C.border}`,
    borderRadius: 10,
    padding: '12px 14px',
    boxShadow: 'var(--shadow-sm)',
  }
}

function miniLabel() {
  return {
    fontSize: 10.5,
    fontWeight: 800,
    textTransform: 'uppercase',
    letterSpacing: '0.7px',
    color: C.muted,
    marginBottom: 6,
  }
}

function miniVal() {
  return {
    fontFamily: 'var(--font-serif)',
    fontSize: 16,
    color: C.ink,
    fontWeight: 700,
  }
}

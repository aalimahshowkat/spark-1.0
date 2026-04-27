/**
 * scenarioEngine.js — Scenario Planning Engine
 *
 * A scenario is a named, non-destructive "what-if" layer applied on top of
 * the baseline ingest result. It never mutates original projects or schema —
 * it produces a modified copy that flows into runCalculations() unchanged.
 *
 * ─── Architecture ─────────────────────────────────────────────────────────
 *
 *   Baseline (from ingest.js)
 *     └─ projects[]        ← deepClone
 *     └─ demandMatrix[]    ← pass-through (untouched)
 *     └─ orbitMultipliers  ← merged with assumption overrides
 *
 *   ScenarioDraft
 *     ├─ projectOverrides   { [projectId]: ProjectOverridePatch }
 *     ├─ resourceOverrides  { [role]: ResourceOverridePatch }     (global role overrides)
 *     ├─ attritionOverrides { [role]: number }                    (capacity-only)
 *     └─ assumptionOverrides AssumptionPatch                      (global)
 *
 *   applyScenario(baseline, draft) → { projects[], orbitMultipliers, capacity }
 *     └─ passed directly into runCalculations()
 *
 * ─── Override types ───────────────────────────────────────────────────────
 *
 *   ProjectOverridePatch:
 *     startDateShiftDays   number  — shift start date ±N days
 *     deliveryShiftDays    number  — shift delivery date ±N days
 *     totalLMs             number  — override LM count
 *     lmMultiplier         number  — override multiplier directly
 *     vibeType             string  — change VIBE type
 *     orbit                string  — change orbit tier (A/B/C/D)
 *     status               string  — override status
 *     assignedCSM          string  — override assigned CSM name
 *     assignedPM           string  — override assigned PM name
 *     assignedSE           string  — override assigned SE name
 *     assignedAnalyst1     string  — override assigned Analyst 1 name
 *     assignedAnalyst2     string  — override assigned Analyst 2 name
 *     analystUtilPct       number  — override analyst split (% to Analyst 1, rest to Analyst 2)
 *     exclude              bool    — remove project from scenario
 *
 *   ResourceOverridePatch:
 *     fteOverride          number  — override FTE headcount for this role
 *
 *   AssumptionPatch:
 *     attritionFactor      number  — e.g. 0.75 instead of 0.80
 *     hrsPerPersonMonth    number  — e.g. 152 instead of 160
 *     lmBucketMultipliers  Array<{maxLMs:number, multiplier:number}> — override LM bucket table (scenario-only)
 *     orbitVibeMultipliers { [key: `${vibe}__${orbit}`]: number }    — override CSM VIBE×Orbit table (scenario-only)
 *
 * ─── Persistence ──────────────────────────────────────────────────────────
 *
 *   Scenarios are persisted to localStorage as JSON under the key
 *   SCENARIO_STORE_KEY. Each scenario carries a full ScenarioDraft plus
 *   metadata (id, name, createdAt, updatedAt, description).
 *
 *   The baseline ingest is NOT stored — it is always re-derived from the
 *   live uploaded file. Scenarios are portable across sessions as long as
 *   the same file is re-uploaded.
 */

import {
  FTE_COUNT,
  ATTRITION_FACTOR,
  HRS_PER_PERSON_MONTH,
  LM_BUCKET_MULTIPLIERS,
  VIBE_PHASE_HOURS,
} from './schema.js'
import { computeRosterWorkingDaysByMonth } from './workingDays.js'

// ─────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────

export const SCENARIO_STORE_KEY = 'spark_scenarios_v1'
export const MAX_SCENARIOS = 10

export const SCENARIO_STATUS = {
  DRAFT:    'draft',
  ACTIVE:   'active',
  ARCHIVED: 'archived',
}

export const ALL_ROLES = ['CSM', 'PM', 'Analyst 1', 'Analyst 2', 'SE']

// ─────────────────────────────────────────────────────────────────────────
// SCENARIO FACTORY
// ─────────────────────────────────────────────────────────────────────────

/**
 * Create a new blank scenario draft.
 */
export function createScenario({ name = '', description = '' } = {}) {
  return {
    id:          `sc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name,
    description,
    status:      SCENARIO_STATUS.DRAFT,
    createdAt:   new Date().toISOString(),
    updatedAt:   new Date().toISOString(),
    // Override layers — all optional, additive
    projectOverrides:   {},   // { [projectId]: ProjectOverridePatch }
    // Scenario-only projects added/removed within the scenario builder.
    // These do NOT affect the baseline dataset.
    addedProjects:      [],
    resourceOverrides:  {},   // { [role]: { fteOverride } }
    attritionOverrides: {},   // { [role]: attritionFactor }
    assumptionOverrides: {},  // { attritionFactor?, hrsPerPersonMonth? }
  }
}

/**
 * Stamp updatedAt on a draft (used before save).
 */
export function touchScenario(scenario) {
  return { ...scenario, updatedAt: new Date().toISOString() }
}

// ─────────────────────────────────────────────────────────────────────────
// APPLY SCENARIO → MODIFIED INPUT FOR runCalculations()
// ─────────────────────────────────────────────────────────────────────────

/**
 * Apply a scenario to a baseline ingest result.
 *
 * Returns a modified payload suitable to pass directly to runCalculations().
 *
 * @param {Object} baseline     — result from ingestExcelFile()
 * @param {Object} scenario     — ScenarioDraft
 * @returns {{ projects, demandMatrix, orbitMultipliers, capacity }}
 */
export function applyScenario(baseline, scenario, opts = {}) {
  if (!baseline || !scenario) return null

  const {
    projectOverrides = {},
    addedProjects = [],
    resourceOverrides = {},
    assumptionOverrides = {},
    attritionOverrides = {},
  } = scenario
  const planningYear = opts?.planningYear || 2026
  const baselineCapacityConfig = opts?.baselineCapacityConfig || null

  // Scenario-level assumption tables (optional)
  const lmBucketTable = Array.isArray(assumptionOverrides?.lmBucketMultipliers) && assumptionOverrides.lmBucketMultipliers.length > 0
    ? assumptionOverrides.lmBucketMultipliers
    : LM_BUCKET_MULTIPLIERS
  const orbitVibeTable = assumptionOverrides?.orbitVibeMultipliers || {}

  // ── 1. Projects ──────────────────────────────────────────────────────
  let modifiedProjects = baseline.projects
    .filter(p => !projectOverrides[p.id]?.exclude)
    .map(p => applyProjectOverride(p, projectOverrides[p.id], { lmBucketTable }))

  // If LM bucket multipliers were overridden, re-derive multipliers ONLY for projects
  // that appear to have used the default bucket derivation (keeps explicit file multipliers intact).
  if (lmBucketTable !== LM_BUCKET_MULTIPLIERS) {
    modifiedProjects = modifiedProjects.map(p => {
      const patch = projectOverrides[p.id]
      if (patch?.lmMultiplier !== undefined && patch?.lmMultiplier !== null) return p

      const baselineDerived = deriveLmMultiplier(p.totalLMs, LM_BUCKET_MULTIPLIERS)
      const looksDerived = Number.isFinite(+p.lmMultiplier) && +p.lmMultiplier === baselineDerived
      if (!looksDerived) return p

      return { ...p, lmMultiplier: deriveLmMultiplier(p.totalLMs, lmBucketTable) }
    })
  }

  // ── 1b. Scenario-only added projects ──────────────────────────────────
  // These projects exist only inside the scenario; they should be appended
  // to the modified project list after applying any per-project overrides.
  const added = (Array.isArray(addedProjects) ? addedProjects : [])
    .filter(p => p && !projectOverrides[p.id]?.exclude)
    .map(p => applyProjectOverride({ ...p }, projectOverrides[p.id], { lmBucketTable }))

  // PM calculations use ProjectList "phaseHours" for PM. Baseline ingest provides this,
  // but scenario-added projects may not. Populate from Demand Matrix (or schema fallback).
  const dmIndex = buildMatrixIndex(baseline.demandMatrix || [])
  const ensurePmPhaseHours = (proj) => {
    if (!proj) return proj
    const existing = proj.phaseHours || {}
    if (Object.keys(existing).length > 0) return proj
    const vibe = proj.vibeType
    const ph = dmIndex[`${vibe}__PM`] || (VIBE_PHASE_HOURS[vibe] || {})['PM'] || null
    if (!ph) return proj
    return {
      ...proj,
      phaseHours: {
        'Project Start M0': parseFloat(ph['Project Start M0']) || 0,
        'Project Start M1': parseFloat(ph['Project Start M1']) || 0,
        'Project Mid':      parseFloat(ph['Project Mid'])      || 0,
        'Project End M-1':  parseFloat(ph['Project End M-1'])  || 0,
        'Project End M0':   parseFloat(ph['Project End M0'])   || 0,
        'Project End M1':   parseFloat(ph['Project End M1'])   || 0,
        'Project End M1+':  parseFloat(ph['Project End M1+'])  || 0,
      }
    }
  }

  modifiedProjects = [
    ...modifiedProjects,
    ...added.map(ensurePmPhaseHours),
  ]

  // ── 1c. Scenario-only PM multipliers (task table → aggregated PM phaseHours) ───
  // If provided, this overrides the PM base-hours override path (project.phaseHours)
  // for ALL projects in the scenario based on their VIBE tag (customer journey stage).
  const pmTaskTable = assumptionOverrides?.pmTaskMultipliers || null
  if (pmTaskTable && typeof pmTaskTable === 'object' && baseline?.demandTasks?.length) {
    const baseRows = baseline.demandTasks.filter(r => String(r?.role || '').trim().toUpperCase() === 'PM')
    const overrides = pmTaskTable?.overridesByKey || {}
    const normKey = (stage, taskStage) => `${String(stage || '').trim()}__${String(taskStage || '').trim()}`

    // Build effective rows: baseline task rows with per-cell overrides applied.
    const effective = baseRows.map(r => {
      const stage = String(r?.stage || '').trim()
      const taskStage = String(r?.taskStage || '').trim()
      const key = normKey(stage, taskStage)
      const ov = overrides?.[key]
      if (!ov || typeof ov !== 'object') return r
      const ph = { ...(r.phaseHours || {}) }
      for (const k of ['Project Start M0','Project Start M1','Project Mid','Project End M-1','Project End M0','Project End M1','Project End M1+']) {
        if (ov[k] !== undefined && ov[k] !== null && Number.isFinite(+ov[k])) ph[k] = +ov[k]
      }
      return { ...r, phaseHours: ph }
    })

    // Aggregate into VIBE-level PM phaseHours by customer journey stage.
    const totalsByStage = new Map()
    for (const r of effective) {
      const stage = String(r?.stage || '').trim()
      if (!stage) continue
      if (!totalsByStage.has(stage)) {
        totalsByStage.set(stage, {
          'Project Start M0': 0,
          'Project Start M1': 0,
          'Project Mid': 0,
          'Project End M-1': 0,
          'Project End M0': 0,
          'Project End M1': 0,
          'Project End M1+': 0,
        })
      }
      const tgt = totalsByStage.get(stage)
      const ph = r.phaseHours || {}
      for (const k of Object.keys(tgt)) tgt[k] += (parseFloat(ph[k]) || 0)
    }

    const stageForProject = (p) => String(p?.vibeType || '').trim()
    modifiedProjects = modifiedProjects.map(p => {
      const st = stageForProject(p)
      const ph = totalsByStage.get(st)
      if (!ph) return p
      return { ...p, phaseHours: { ...ph } }
    })
  }

  // ── 2. Demand matrix — passed through unchanged ────────────────────
  const demandMatrix = baseline.demandMatrix

  // ── 3. Orbit multipliers — passed through (project orbit changes
  //       are baked into modified project records above) ──────────────
  const orbitMultipliers = {
    ...(baseline.orbitMultipliers || {}),
    ...(orbitVibeTable || {}),
  }

  // ── 4. Effective capacity override ───────────────────────────────────
  // Build a modified capacity config that overrides FTE counts and
  // assumption constants. Passed to runCalculations via extra arg.
  const scenarioCapacityConfig = buildScenarioCapacityConfig({
    roster: baseline?.roster || [],
    planningYear,
    resourceOverrides,
    assumptionOverrides,
    attritionOverrides,
    baselineCapacityConfig,
  })

  return {
    projects:          modifiedProjects,
    demandMatrix,
    orbitMultipliers,
    scenarioCapacityConfig,   // consumers pass this to computeCapacityScenario()
    assumptionOverrides,
    attritionOverrides,
  }
}

// Build an O(1) lookup index from the demand matrix (vibe+role → phaseHours object)
function buildMatrixIndex(demandMatrix) {
  const index = {}
  for (const row of Array.isArray(demandMatrix) ? demandMatrix : []) {
    if (!row?.vibeType || !row?.role || !row?.phaseHours) continue
    index[`${row.vibeType}__${row.role}`] = row.phaseHours
  }
  return index
}

/**
 * Apply a single project override patch to a project record.
 * Returns a NEW object — the original is not mutated.
 */
function applyProjectOverride(project, patch, { lmBucketTable } = {}) {
  if (!patch) return project

  const updated = { ...project }

  // Date shifts
  if (patch.startDateShiftDays !== undefined && patch.startDateShiftDays !== null && project.startDate) {
    const d = new Date(project.startDate)
    d.setDate(d.getDate() + patch.startDateShiftDays)
    updated.startDate = d
    updated.startMonthIndex = d.getMonth()
  }
  if (patch.deliveryShiftDays !== undefined && patch.deliveryShiftDays !== null && project.deliveryDate) {
    const d = new Date(project.deliveryDate)
    d.setDate(d.getDate() + patch.deliveryShiftDays)
    updated.deliveryDate = d
    updated.deliveryMonthIndex = d.getMonth()
    if (project.deliveryDateExact) {
      const de = new Date(project.deliveryDateExact)
      de.setDate(de.getDate() + patch.deliveryShiftDays)
      updated.deliveryDateExact = de
    }
  }

  // LM / multiplier
  if (patch.totalLMs !== undefined && patch.totalLMs !== null) {
    updated.totalLMs = patch.totalLMs
    // Re-derive lmMultiplier from new LM count unless explicitly set
    if (patch.lmMultiplier === undefined) {
      updated.lmMultiplier = deriveLmMultiplier(patch.totalLMs, lmBucketTable || LM_BUCKET_MULTIPLIERS)
    }
  }
  if (patch.lmMultiplier !== undefined && patch.lmMultiplier !== null) {
    updated.lmMultiplier = patch.lmMultiplier
  }

  // Classification
  if (patch.vibeType) updated.vibeType = patch.vibeType
  if (patch.orbit)    updated.orbit    = patch.orbit
  if (patch.status)   updated.status   = patch.status

  // Role assignments (impacts demandByPerson + unstaffed hours; not demand totals)
  if (patch.assignedCSM !== undefined)      updated.assignedCSM      = patch.assignedCSM
  if (patch.assignedPM !== undefined)       updated.assignedPM       = patch.assignedPM
  if (patch.assignedSE !== undefined)       updated.assignedSE       = patch.assignedSE
  if (patch.assignedAnalyst1 !== undefined) updated.assignedAnalyst1 = patch.assignedAnalyst1
  if (patch.assignedAnalyst2 !== undefined) updated.assignedAnalyst2 = patch.assignedAnalyst2
  if (patch.analystUtilPct !== undefined && patch.analystUtilPct !== null) {
    updated.analystUtilPct = patch.analystUtilPct
  }

  return updated
}

export function buildScenarioCapacityConfig({
  roster = [],
  planningYear = 2026,
  resourceOverrides = {},
  assumptionOverrides = {},
  attritionOverrides = {},
  baselineCapacityConfig = null,
} = {}) {
  const fteCount = getFteCountFromRoster(roster)
  for (const [role, patch] of Object.entries(resourceOverrides || {})) {
    if (patch?.fteOverride === undefined || patch?.fteOverride === null) continue
    const key = role === 'Analyst' ? 'Analyst 1' : role
    fteCount[key] = patch.fteOverride
  }

  const businessDaysByMonth = getBusinessDaysByMonth(planningYear)
  const BASELINE_HRS_PER_PERSON_DAY = baselineCapacityConfig?.hrsPerPersonDay ?? 10
  const globalHrsPerPersonDay =
    (assumptionOverrides?.hrsPerPersonDay !== undefined && assumptionOverrides?.hrsPerPersonDay !== null)
      ? Number(assumptionOverrides.hrsPerPersonDay)
      : BASELINE_HRS_PER_PERSON_DAY
  const hrsPerPersonDay = (Number.isFinite(globalHrsPerPersonDay) && globalHrsPerPersonDay >= 0)
    ? globalHrsPerPersonDay
    : BASELINE_HRS_PER_PERSON_DAY

  const baselineHrsPerPersonMonthByMonth =
    baselineCapacityConfig?.hrsPerPersonMonthByMonth ||
    businessDaysByMonth.map(d => d * BASELINE_HRS_PER_PERSON_DAY)

  // Legacy/global override: constant hours per month across the year.
  // New/global override: hours per business day (calendar-aware by month).
  const hasGlobalMonthOverride =
    assumptionOverrides?.hrsPerPersonMonth !== undefined &&
    assumptionOverrides?.hrsPerPersonMonth !== null
  const hasGlobalDayOverride =
    assumptionOverrides?.hrsPerPersonDay !== undefined &&
    assumptionOverrides?.hrsPerPersonDay !== null

  const hrsPerPersonMonthByMonth = hasGlobalDayOverride
    ? businessDaysByMonth.map(d => d * hrsPerPersonDay)
    : hasGlobalMonthOverride
      ? new Array(12).fill(Number(assumptionOverrides.hrsPerPersonMonth))
      : baselineHrsPerPersonMonthByMonth

  // Per-role overrides (preferred): hours/day by role (calendar-aware by month).
  // Back-compat: constant hours/month by role.
  const hrsPerPersonMonthByMonthByRole = {}

  const hrsDayByRoleRaw = assumptionOverrides?.hrsPerPersonDayByRole || {}
  if (hrsDayByRoleRaw && typeof hrsDayByRoleRaw === 'object') {
    for (const [role, value] of Object.entries(hrsDayByRoleRaw)) {
      const num = Number(value)
      if (!Number.isFinite(num) || num < 0) continue
      const key = role === 'Analyst' ? 'Analyst 1' : role
      hrsPerPersonMonthByMonthByRole[key] = businessDaysByMonth.map(d => d * num)
    }
  } else {
    const hrsMonthByRoleRaw = assumptionOverrides?.hrsPerPersonMonthByRole || {}
    if (hrsMonthByRoleRaw && typeof hrsMonthByRoleRaw === 'object') {
      for (const [role, value] of Object.entries(hrsMonthByRoleRaw)) {
        const num = Number(value)
        if (!Number.isFinite(num) || num <= 0) continue
        const key = role === 'Analyst' ? 'Analyst 1' : role
        hrsPerPersonMonthByMonthByRole[key] = new Array(12).fill(num)
      }
    }
  }

  // Baseline plan per-role hours/day (if provided) fill in defaults when scenario doesn't override.
  if (Object.keys(hrsPerPersonMonthByMonthByRole).length === 0) {
    const baseByRole = baselineCapacityConfig?.hrsPerPersonDayByRole
    if (baseByRole && typeof baseByRole === 'object') {
      for (const [role, value] of Object.entries(baseByRole)) {
        const num = Number(value)
        if (!Number.isFinite(num) || num < 0) continue
        const key = role === 'Analyst' ? 'Analyst 1' : role
        hrsPerPersonMonthByMonthByRole[key] = businessDaysByMonth.map(d => d * num)
      }
    }
  }

  const attritionGlobal = assumptionOverrides?.attritionFactor ?? ATTRITION_FACTOR
  const attritionByRole = { ...(attritionOverrides || {}) }
  if (attritionByRole.Analyst !== undefined && attritionByRole['Analyst 1'] === undefined) {
    attritionByRole['Analyst 1'] = attritionByRole.Analyst
    delete attritionByRole.Analyst
  }

  const mergeWorkingDays = (base, delta) => {
    const b = (base && typeof base === 'object') ? base : {}
    const d = (delta && typeof delta === 'object') ? delta : {}
    const out = {
      orgHolidays: Array.isArray(b.orgHolidays) ? [...b.orgHolidays] : [],
      roleCalendarsByRole: (b.roleCalendarsByRole && typeof b.roleCalendarsByRole === 'object') ? { ...b.roleCalendarsByRole } : {},
      personAdjustmentsByPerson: (b.personAdjustmentsByPerson && typeof b.personAdjustmentsByPerson === 'object') ? { ...b.personAdjustmentsByPerson } : {},
    }
    if (Array.isArray(d.orgHolidays) && d.orgHolidays.length) out.orgHolidays.push(...d.orgHolidays)
    if (d.roleCalendarsByRole && typeof d.roleCalendarsByRole === 'object') {
      for (const [k, v] of Object.entries(d.roleCalendarsByRole)) {
        const prev = out.roleCalendarsByRole[k] || {}
        const holPrev = Array.isArray(prev.holidays) ? prev.holidays : []
        const holNext = Array.isArray(v?.holidays) ? v.holidays : []
        out.roleCalendarsByRole[k] = { ...prev, ...v, holidays: [...holPrev, ...holNext] }
      }
    }
    if (d.personAdjustmentsByPerson && typeof d.personAdjustmentsByPerson === 'object') {
      for (const [name, arr] of Object.entries(d.personAdjustmentsByPerson)) {
        const prev = Array.isArray(out.personAdjustmentsByPerson[name]) ? out.personAdjustmentsByPerson[name] : []
        const next = Array.isArray(arr) ? arr : []
        out.personAdjustmentsByPerson[name] = [...prev, ...next]
      }
    }
    const has =
      out.orgHolidays.length ||
      Object.keys(out.roleCalendarsByRole).length ||
      Object.keys(out.personAdjustmentsByPerson).length
    return has ? out : null
  }

  const mergeAssignmentBackfills = (base, delta) => {
    const b = (base && typeof base === 'object') ? base : {}
    const d = (delta && typeof delta === 'object') ? delta : {}
    const out = {}

    const addFrom = (src) => {
      for (const [projectId, byRole] of Object.entries(src || {})) {
        if (!byRole || typeof byRole !== 'object') continue
        if (!out[projectId]) out[projectId] = {}
        for (const [role, arr] of Object.entries(byRole || {})) {
          const prev = Array.isArray(out[projectId][role]) ? out[projectId][role] : []
          const next = Array.isArray(arr) ? arr.filter(Boolean) : []
          if (next.length) out[projectId][role] = [...prev, ...next]
        }
        // clean empty
        if (Object.keys(out[projectId]).length === 0) delete out[projectId]
      }
    }

    addFrom(b)
    addFrom(d)

    return Object.keys(out).length ? out : null
  }

  return {
    planningYear,
    roster,
    fteCount,
    attritionGlobal,
    attritionByRole,
    hrsPerPersonDay,
    businessDaysByMonth,
    hrsPerPersonMonthByMonth,
    hrsPerPersonMonthByMonthByRole: Object.keys(hrsPerPersonMonthByMonthByRole).length ? hrsPerPersonMonthByMonthByRole : null,
    allocationsByPerson: baselineCapacityConfig?.allocationsByPerson || null,
    workingDays: mergeWorkingDays(baselineCapacityConfig?.workingDays || null, assumptionOverrides?.workingDaysDelta || null),
    assignmentBackfills: mergeAssignmentBackfills(baselineCapacityConfig?.assignmentBackfills || null, assumptionOverrides?.assignmentBackfillsDelta || null),
  }
}

/**
 * Compute capacity metrics using a scenario-specific config.
 * Mirrors computeCapacity() in calculate.js but honours overrides.
 */
export function computeCapacityScenario(scenarioCapacityConfig) {
  const {
    fteCount: targetFteCount,
    attritionGlobal,
    attritionByRole,
    hrsPerPersonDay,
    businessDaysByMonth,
    hrsPerPersonMonthByMonth,
    hrsPerPersonMonthByMonthByRole,
    roster,
    allocationsByPerson,
    workingDays,
  } = scenarioCapacityConfig
  const result = {}

  // Calendar-aware per-person working days.
  const rosterDays = computeRosterWorkingDaysByMonth({
    year: scenarioCapacityConfig?.planningYear || 2026,
    baseBusinessDaysByMonth: businessDaysByMonth,
    roster,
    workingDays: workingDays || null,
  })

  const baseRosterTotals = getFteCountFromRoster(roster)
  const factorByRole = {}
  for (const [role, v] of Object.entries(targetFteCount || {})) {
    const base = Number(baseRosterTotals?.[role] || 0)
    const target = Number(v || 0)
    factorByRole[role] = base > 0 ? (target / base) : 1
  }

  // Effective FTE can be derived from per-person allocations.
  let effectiveFteCount = { ...(targetFteCount || {}) }
  const DEFAULT_HALF_TIME_NAME = 'Aalimah Showkat'
  const isDefaultHalfTime = (name) => String(name || '').trim().toLowerCase() === DEFAULT_HALF_TIME_NAME.toLowerCase()
  const hasDefaultHalfTime = Array.isArray(roster) && roster.some(p => isDefaultHalfTime(p?.name))
  const hasAlloc = !!(allocationsByPerson && typeof allocationsByPerson === 'object' && Object.keys(allocationsByPerson).length > 0)

  if (Array.isArray(roster) && roster.length > 0 && (hasAlloc || hasDefaultHalfTime)) {
    const rosterTotals = baseRosterTotals
    const personMap = new Map() // name -> { fte, baseRole }
    for (const p of roster) {
      const name = String(p?.name || '').trim()
      if (!name) continue
      const role = String(p?.role || '').trim()
      const fte = Number(p?.fte)
      if (!Number.isFinite(fte) || fte <= 0) continue
      const baseRole = role === 'Analyst' ? 'Analyst 1' : role
      const prev = personMap.get(name)
      if (!prev) personMap.set(name, { fte, baseRole })
      else personMap.set(name, { fte: Math.max(prev.fte || 0, fte), baseRole: prev.baseRole || baseRole })
    }

    const derived = { CSM: 0, PM: 0, 'Analyst 1': 0 }
    const pctFor = (name, role, baseRole) => {
      const rec = allocationsByPerson?.[name]
      if (rec && typeof rec === 'object') {
        const v = rec?.roles?.[role]
        const n = Number(v)
        return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0
      }
      if (isDefaultHalfTime(name)) return baseRole === role ? 50 : 0
      // default to 100% in roster role
      return baseRole === role ? 100 : 0
    }

    for (const [name, info] of personMap.entries()) {
      const f = Number(info?.fte) || 0
      const baseRole = info?.baseRole
      if (f <= 0) continue
      derived.CSM += f * (pctFor(name, 'CSM', baseRole) / 100)
      derived.PM += f * (pctFor(name, 'PM', baseRole) / 100)
      derived['Analyst 1'] += f * (pctFor(name, 'Analyst 1', baseRole) / 100)
    }

    // Apply scenario headcount overrides as proportional scaling vs roster totals.
    for (const role of ['CSM', 'PM', 'Analyst 1']) {
      const factor = Number(factorByRole?.[role])
      if (Number.isFinite(factor) && factor !== 1) derived[role] = derived[role] * factor
    }

    effectiveFteCount = { ...effectiveFteCount, ...derived }
  }

  // Build per-person roster map (for capacity sum).
  const rosterPeople = new Map()
  for (const p of Array.isArray(roster) ? roster : []) {
    const name = String(p?.name || '').trim()
    if (!name) continue
    const roleRaw = String(p?.role || '').trim()
    const baseRole = roleRaw === 'Analyst' ? 'Analyst 1' : roleRaw
    const fte = Number(p?.fte)
    if (!Number.isFinite(fte) || fte <= 0) continue
    const prev = rosterPeople.get(name)
    if (!prev) rosterPeople.set(name, { fte, baseRole })
    else rosterPeople.set(name, { fte: Math.max(prev.fte || 0, fte), baseRole: prev.baseRole || baseRole })
  }

  const allocPctTo = (name, role, baseRole) => {
    const rec = allocationsByPerson?.[name]
    if (rec && typeof rec === 'object') {
      const v = rec?.roles?.[role]
      const n = Number(v)
      return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0
    }
    if (isDefaultHalfTime(name)) return baseRole === role ? 50 : 0
    return baseRole === role ? 100 : 0
  }

  for (const role of Object.keys(effectiveFteCount)) {
    // Analyst 2 does NOT add capacity. Its demand is incremental pressure.
    const fte = role === 'Analyst 2' ? 0 : (effectiveFteCount[role] || 0)
    const attrition = (attritionByRole && attritionByRole[role] !== undefined && attritionByRole[role] !== null)
      ? attritionByRole[role]
      : attritionGlobal

    const monthArrBase =
      (hrsPerPersonMonthByMonthByRole && hrsPerPersonMonthByMonthByRole[role]) ||
      hrsPerPersonMonthByMonth ||
      new Array(12).fill(HRS_PER_PERSON_MONTH)

    const rawMonthlyByMonth = new Array(12).fill(0)
    if (role !== 'Analyst 2') {
      const factor = Number(factorByRole?.[role])
      const roleFactor = Number.isFinite(factor) ? factor : 1
      if (rosterPeople.size === 0) {
        // Back-compat: if roster isn't present, fall back to role-level FTE math.
        for (let i = 0; i < 12; i++) rawMonthlyByMonth[i] = (Number(monthArrBase?.[i]) || 0) * fte
      } else {
        for (const [name, info] of rosterPeople.entries()) {
          const personFte = Number(info?.fte) || 0
          if (personFte <= 0) continue
          const baseRole = info?.baseRole

          let pct = 0
          if (role === 'CSM' || role === 'PM' || role === 'Analyst 1') {
            pct = allocPctTo(name, role, baseRole)
          } else {
            pct = baseRole === role ? 100 : 0
          }
          if (pct <= 0) continue

          const personDays = rosterDays?.[name]?.daysByMonth || businessDaysByMonth
          for (let i = 0; i < 12; i++) {
            const baseDays = businessDaysByMonth?.[i] || 0
            const days = Number(personDays?.[i] || 0)
            if (!baseDays || !days) continue
            const perFteHours = (Number(monthArrBase?.[i]) || 0) * (days / baseDays)
            rawMonthlyByMonth[i] += perFteHours * personFte * (pct / 100) * roleFactor
          }
        }
      }
    }

    const hrsPerPersonMonthByMonthEffective =
      fte > 0
        ? rawMonthlyByMonth.map(v => (v || 0) / fte)
        : monthArrBase

    const effectiveMonthlyByMonth = rawMonthlyByMonth.map(v => v * attrition)
    const rawAnn = rawMonthlyByMonth.reduce((a, b) => a + (b || 0), 0)
    const effAnn = effectiveMonthlyByMonth.reduce((a, b) => a + (b || 0), 0)

    result[role] = {
      fte,
      rawMonthly: rawAnn / 12,
      effectiveMonthly: effAnn / 12,
      rawMonthlyByMonth,
      effectiveMonthlyByMonth,
      rawAnnual: rawAnn,
      effectiveAnnual: effAnn,
      attritionFactor: attrition,
      hrsPerPersonDay: hrsPerPersonDay ?? 10,
      businessDaysByMonth: businessDaysByMonth || null,
      hrsPerPersonMonth: hrsPerPersonMonthByMonthEffective.reduce((a, b) => a + (b || 0), 0) / 12,
      hrsPerPersonMonthByMonth: hrsPerPersonMonthByMonthEffective,
    }
  }

  return result
}

function getFteCountFromRoster(roster) {
  const out = { ...FTE_COUNT }
  // If roster is present, it becomes the source of truth.
  if (Array.isArray(roster) && roster.length > 0) {
    for (const k of Object.keys(out)) out[k] = 0
    for (const p of roster) {
      const role = String(p?.role || '').trim()
      const fte = Number(p?.fte)
      if (!role) continue
      if (!Number.isFinite(fte) || fte <= 0) continue
      const key = role === 'Analyst' ? 'Analyst 1' : role
      if (out[key] === undefined) out[key] = 0
      out[key] += fte
    }
  }
  return out
}

function getBusinessDaysByMonth(year) {
  const out = new Array(12).fill(0)
  for (let month = 0; month < 12; month++) {
    let d = new Date(Date.UTC(year, month, 1))
    while (d.getUTCMonth() === month) {
      const day = d.getUTCDay() // 0=Sun..6=Sat
      if (day >= 1 && day <= 5) out[month]++
      d = new Date(Date.UTC(year, month, d.getUTCDate() + 1))
    }
  }
  return out
}

/**
 * Derive lmMultiplier from totalLMs using the schema bucket table.
 * Mirrors ingest.js behaviour so overrides produce consistent numbers.
 */
function deriveLmMultiplier(totalLMs, bucketTable = LM_BUCKET_MULTIPLIERS) {
  if (!totalLMs || totalLMs <= 0) return 1
  const tiers = Array.isArray(bucketTable) && bucketTable.length > 0 ? bucketTable : LM_BUCKET_MULTIPLIERS
  for (const bucket of tiers) {
    if (totalLMs <= bucket.maxLMs) return bucket.multiplier
  }
  return tiers[tiers.length - 1].multiplier
}

// ─────────────────────────────────────────────────────────────────────────
// DIFF / SUMMARY — what changed vs baseline
// ─────────────────────────────────────────────────────────────────────────

/**
 * Summarise how many overrides are active in a scenario draft.
 */
export function getScenarioSummary(scenario) {
  const projOverrides = Object.values(scenario.projectOverrides || {})
  const excluded = projOverrides.filter(p => p.exclude).length
  const modified = projOverrides.filter(p => !p.exclude).length
  const added = Array.isArray(scenario.addedProjects) ? scenario.addedProjects.length : 0

  const resOverrides   = Object.values(scenario.resourceOverrides || {})
  const fteChanges     = resOverrides.filter(r => r.fteOverride !== undefined).length

  const attrOverrides = scenario.attritionOverrides || {}
  const attritionChanges = Object.values(attrOverrides).filter(v => v !== undefined && v !== null).length

  const assumptions    = scenario.assumptionOverrides || {}
  const assumptionChanges = Object.values(assumptions).filter(v => v !== undefined && v !== null).length

  const totalChanges = excluded + modified + added + fteChanges + attritionChanges + assumptionChanges

  return { excluded, modified, added, fteChanges, attritionChanges, assumptionChanges, totalChanges }
}

/**
 * Compare two runCalculations() results and return deltas for every role × month.
 * Used to render the comparison view.
 *
 * @param {Object} base    — CalculationResult (baseline)
 * @param {Object} scen    — CalculationResult (scenario)
 * @returns {{ demandDelta, annualDelta, monthsOverDelta }}
 */
export function diffResults(base, scen) {
  if (!base || !scen) return null

  const demandDelta = {}
  for (const role of Object.keys(base.demandByRole || {})) {
    const bArr = base.demandByRole[role] || new Array(12).fill(0)
    const sArr = scen.demandByRole[role] || new Array(12).fill(0)
    demandDelta[role] = bArr.map((bVal, i) => sArr[i] - bVal)
  }

  const annualDelta = {}
  for (const role of Object.keys(base.annualDemand || {})) {
    annualDelta[role] = (scen.annualDemand[role] || 0) - (base.annualDemand[role] || 0)
  }

  const monthsOverDelta = {}
  for (const role of Object.keys(base.monthsOverEffective || {})) {
    monthsOverDelta[role] = (scen.monthsOverEffective[role] || 0) - (base.monthsOverEffective[role] || 0)
  }

  return { demandDelta, annualDelta, monthsOverDelta }
}

// ─────────────────────────────────────────────────────────────────────────
// PERSISTENCE — localStorage
// ─────────────────────────────────────────────────────────────────────────

export function loadScenarios() {
  try {
    const raw = localStorage.getItem(SCENARIO_STORE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveScenarios(scenarios) {
  try {
    localStorage.setItem(SCENARIO_STORE_KEY, JSON.stringify(scenarios))
    return true
  } catch {
    return false
  }
}

export function upsertScenario(scenarios, scenario) {
  const touched = touchScenario(scenario)
  const idx = scenarios.findIndex(s => s.id === touched.id)
  if (idx === -1) {
    // Enforce MAX_SCENARIOS limit: drop oldest if needed
    const trimmed = scenarios.length >= MAX_SCENARIOS
      ? scenarios.slice(1)
      : scenarios
    return [...trimmed, touched]
  }
  const next = [...scenarios]
  next[idx] = touched
  return next
}

export function deleteScenario(scenarios, id) {
  return scenarios.filter(s => s.id !== id)
}

export function duplicateScenario(scenario) {
  return {
    ...scenario,
    id:         `sc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name:       `${scenario.name} (copy)`,
    createdAt:  new Date().toISOString(),
    updatedAt:  new Date().toISOString(),
    status:     SCENARIO_STATUS.DRAFT,
  }
}

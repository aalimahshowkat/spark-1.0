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
} from './schema.js'

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
    resourceOverrides = {},
    assumptionOverrides = {},
    attritionOverrides = {},
  } = scenario
  const planningYear = opts?.planningYear || 2026

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
} = {}) {
  const fteCount = getFteCountFromRoster(roster)
  for (const [role, patch] of Object.entries(resourceOverrides || {})) {
    if (patch?.fteOverride === undefined || patch?.fteOverride === null) continue
    const key = role === 'Analyst' ? 'Analyst 1' : role
    fteCount[key] = patch.fteOverride
  }

  const businessDaysByMonth = getBusinessDaysByMonth(planningYear)
  const hrsPerPersonDay = 10
  const hasHrsOverride =
    assumptionOverrides?.hrsPerPersonMonth !== undefined &&
    assumptionOverrides?.hrsPerPersonMonth !== null
  const hrsPerPersonMonthByMonth = hasHrsOverride
    ? new Array(12).fill(assumptionOverrides.hrsPerPersonMonth)
    : businessDaysByMonth.map(d => d * hrsPerPersonDay)

  const attritionGlobal = assumptionOverrides?.attritionFactor ?? ATTRITION_FACTOR
  const attritionByRole = { ...(attritionOverrides || {}) }
  if (attritionByRole.Analyst !== undefined && attritionByRole['Analyst 1'] === undefined) {
    attritionByRole['Analyst 1'] = attritionByRole.Analyst
    delete attritionByRole.Analyst
  }

  return {
    planningYear,
    fteCount,
    attritionGlobal,
    attritionByRole,
    hrsPerPersonDay,
    businessDaysByMonth,
    hrsPerPersonMonthByMonth,
  }
}

/**
 * Compute capacity metrics using a scenario-specific config.
 * Mirrors computeCapacity() in calculate.js but honours overrides.
 */
export function computeCapacityScenario(scenarioCapacityConfig) {
  const {
    fteCount,
    attritionGlobal,
    attritionByRole,
    hrsPerPersonDay,
    businessDaysByMonth,
    hrsPerPersonMonthByMonth,
  } = scenarioCapacityConfig
  const result = {}

  for (const role of Object.keys(fteCount)) {
    // Analyst 2 does NOT add capacity. Its demand is incremental pressure.
    const fte = role === 'Analyst 2' ? 0 : (fteCount[role] || 0)
    const attrition = (attritionByRole && attritionByRole[role] !== undefined && attritionByRole[role] !== null)
      ? attritionByRole[role]
      : attritionGlobal

    const monthArr = hrsPerPersonMonthByMonth || new Array(12).fill(HRS_PER_PERSON_MONTH)
    const rawMonthlyByMonth = monthArr.map(h => h * fte)
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
      hrsPerPersonMonth: monthArr.reduce((a, b) => a + (b || 0), 0) / 12,
      hrsPerPersonMonthByMonth: monthArr,
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

  const resOverrides   = Object.values(scenario.resourceOverrides || {})
  const fteChanges     = resOverrides.filter(r => r.fteOverride !== undefined).length

  const attrOverrides = scenario.attritionOverrides || {}
  const attritionChanges = Object.values(attrOverrides).filter(v => v !== undefined && v !== null).length

  const assumptions    = scenario.assumptionOverrides || {}
  const assumptionChanges = Object.values(assumptions).filter(v => v !== undefined && v !== null).length

  const totalChanges = excluded + modified + fteChanges + attritionChanges + assumptionChanges

  return { excluded, modified, fteChanges, attritionChanges, assumptionChanges, totalChanges }
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

/**
 * calculate.js — Logic Layer: Demand Lookup, Hour Aggregation, Capacity, Effort Equivalent
 *
 * This file implements all 5 components of the Logic Layer:
 *
 *   1. Phase Assignment Engine  → phaseEngine.js (imported)
 *   2. Demand Lookup            → lookupBaseHours()
 *   3. Monthly Hour Aggregation → aggregateByRole(), aggregateByPerson()
 *   4. Capacity Calculation     → computeCapacity()
 *   5. Effort Equivalent        → computeEffortEquivalent()
 *
 * ─── EXCEL FORMULA FULLY DECODED ───────────────────────────────────────
 *
 * Calculated Utilized Hours (col R):
 *
 *   For PM:
 *     IF phase = "End M-1" AND vibeType ≠ "Validate":
 *       hours = LOOKUP(phaseCase2, DemandMatrix[PM,vibeType]) / COUNT(EndM-1 months) * lmMultiplier
 *     ELSE:
 *       hours = LOOKUP(phaseCase2, DemandMatrix[PM,vibeType]) * lmMultiplier
 *
 *   For Analyst 1/2:
 *     IF phase3 = "End M-1" AND vibeType ≠ "Validate":
 *       hours = LOOKUP(phaseCase3, DemandMatrix[Analyst,vibeType]) / COUNT(EndM-1 months) * orbitMultiplier * lmMultiplier
 *     ELSE:
 *       hours = LOOKUP(phaseCase3, DemandMatrix[Analyst,vibeType]) * orbitMultiplier * lmMultiplier
 *
 *   For CSM:
 *     hours = LOOKUP(phaseCase2, DemandMatrix[CSM,vibeType]) * lmMultiplier
 *     (lmMultiplier for CSM IS the orbit×LM combined multiplier)
 *
 *   For SE:
 *     IF phase = "End M-1" AND vibeType ≠ "Validate":
 *       hours = LOOKUP(phaseCase2, DemandMatrix[SE,vibeType]) / COUNT(EndM-1 months) * orbitMultiplier * lmMultiplier
 *     ELSE:
 *       hours = LOOKUP(phaseCase2, DemandMatrix[SE,vibeType]) * orbitMultiplier * lmMultiplier
 *
 * Final Utilized Hour (col T):
 *   = ROUND(IF(manualOverride > 0, manualOverride, calculatedHours), 0)
 *   (for CSM: applies an additional CSM orbit multiplier lookup from Demand Matrix AA col)
 *
 * Final Effort Equivalent (col U):
 *   = IF(role="CSM",    finalHours * effortRate_CSM,
 *     IF(role="PM",     finalHours * effortRate_PM,
 *     IF(role="Analyst 1", finalHours * effortRate_A1,
 *     finalHours)))
 *   effortRate constants are in schema.js EFFORT_RATES
 */

import {
  roleUsesEndMinus1Distribution,
  normalizeRole,
  getPlanningMonths,
  toMonthStart,
  computeAllCaseColumns,
  PHASE_NA,
} from './phaseEngine.js'

import {
  VIBE_PHASE_HOURS,
  FTE_COUNT,
  RAW_CAPACITY,
  EFFECTIVE_CAPACITY,
  HRS_PER_PERSON_MONTH,
  HRS_PER_PERSON_YEAR,
  ATTRITION_FACTOR,
  MONTHS,
  EFFORT_RATES,
  UNSTAFFED_PERSON_NAMES,
  PRIMARY_ROLES,
} from './schema.js'

const PLANNING_YEAR = 2026
const ALL_ROLES = ['CSM', 'PM', 'Analyst 1', 'Analyst 2', 'SE']

// ─────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────

/**
 * Main entry point. Takes ingested projects and demand matrix,
 * returns a full CalculationResult.
 *
 * @param {ProjectRecord[]}   projects     - from ingest.js
 * @param {DemandMatrixRow[]} demandMatrix - from ingest.js
 * @param {Object}            orbitMultipliers - { 'Bond__A': 1.75, ... } from ingest.js
 * @param {number}            planningYear - defaults to 2026
 * @param {Object}            options      - optional capacity inputs
 * @returns {CalculationResult}
 */
export function runCalculations(projects, demandMatrix, orbitMultipliers = {}, planningYear = PLANNING_YEAR, options = {}) {
  const startTime = Date.now()

  // Build a fast lookup index from demand matrix rows
  const matrixIndex = buildMatrixIndex(demandMatrix)

  // Compute all assignments (project × role × month)
  const assignments = []
  for (const project of projects) {
    if (!project.startDate || !project.deliveryDate) continue  // skip DQ-E001 projects
    if (!project.vibeType || !VIBE_PHASE_HOURS[project.vibeType]) continue

    for (const role of ALL_ROLES) {
      const roleAssignments = computeProjectRoleAssignments(
        project, role, matrixIndex, orbitMultipliers, planningYear
      )
      assignments.push(...roleAssignments)
    }
  }

  // ── Aggregate: demand by role × month ──
  const demandByRole = aggregateByRole(assignments)

  // ── Aggregate: demand by person × month ──
  const demandByPerson = aggregateByPerson(assignments)

  // ── Aggregate: demand by VIBE type × month ──
  const demandByVibe = aggregateByVibe(assignments)

  // ── Unstaffed hours (Unassigned / Need to allocate) ──
  const unstaffedHours = extractUnstaffedHours(assignments)

  // ── Capacity calculations ──
  const capacity = computeCapacity({
    planningYear,
    roster: options?.roster || [],
    capacityConfig: options?.capacityConfig || null,
  })

  // ── Effort equivalents ──
  applyEffortEquivalents(assignments)

  // ── Aggregates for dashboard ──
  const annualDemand = computeAnnualDemand(demandByRole)
  const monthsOverEffective = computeMonthsOverEffective(demandByRole, capacity)
  const peakMonths = computePeakMonths(demandByRole)

  // ── Analyst capacity modelling (base capacity = Analyst 1 only) ─────────
  // Treat Analyst 2 as incremental demand that does NOT add capacity.
  const analystDemandBase = demandByRole['Analyst 1'] || new Array(12).fill(0)
  const analystDemandIncremental = demandByRole['Analyst 2'] || new Array(12).fill(0)
  const analystDemandTotal = analystDemandBase.map((v, i) => v + (analystDemandIncremental[i] || 0))

  const analystCapBase = capacity['Analyst 1'] || null
  const analystEffCapMonthly = analystCapBase?.effectiveMonthlyByMonth || new Array(12).fill(0)
  const analystRawCapMonthly = analystCapBase?.rawMonthlyByMonth || new Array(12).fill(0)
  const hrsPerPersonMonthByMonth = analystCapBase?.hrsPerPersonMonthByMonth || new Array(12).fill(HRS_PER_PERSON_MONTH)

  const analystMonthsOverEffective = {
    base: analystDemandBase.filter((d, i) => d > (analystEffCapMonthly[i] || 0)).length,
    total: analystDemandTotal.filter((d, i) => d > (analystEffCapMonthly[i] || 0)).length,
  }

  const analystAnnualDemand = {
    base: analystDemandBase.reduce((a, b) => a + (b || 0), 0),
    incremental: analystDemandIncremental.reduce((a, b) => a + (b || 0), 0),
    total: analystDemandTotal.reduce((a, b) => a + (b || 0), 0),
  }

  const analystFteNeeded = {
    base: analystDemandBase.map((d, i) => {
      const denom = hrsPerPersonMonthByMonth[i] || 0
      return denom ? (d / denom) : 0
    }),
    total: analystDemandTotal.map((d, i) => {
      const denom = hrsPerPersonMonthByMonth[i] || 0
      return denom ? (d / denom) : 0
    }),
  }

  return {
    assignments,
    demandByRole,
    demandByPerson,
    demandByVibe,
    unstaffedHours,
    capacity,
    annualDemand,
    monthsOverEffective,
    peakMonths,
    analystModel: {
      demandBase: analystDemandBase,
      demandIncremental: analystDemandIncremental,
      demandTotal: analystDemandTotal,
      capacityBase: {
        rawMonthlyByMonth: analystRawCapMonthly,
        effectiveMonthlyByMonth: analystEffCapMonthly,
        // Keep the full role capacity object for convenience
        roleCapacity: analystCapBase,
      },
      annualDemand: analystAnnualDemand,
      monthsOverEffective: analystMonthsOverEffective,
      fteNeeded: analystFteNeeded,
    },
    meta: {
      planningYear,
      totalAssignments: assignments.length,
      projectsCalculated: projects.filter(p => p.startDate && p.deliveryDate).length,
      durationMs: Date.now() - startTime,
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// COMPONENT 2 — DEMAND LOOKUP
// ─────────────────────────────────────────────────────────────────────────

/**
 * Build a fast O(1) lookup index from the demand matrix.
 * Key: `${vibeType}__${role}`, Value: { phaseHours object }
 */
function buildMatrixIndex(demandMatrix) {
  const index = {}
  for (const row of demandMatrix) {
    const key = `${row.vibeType}__${row.role}`
    index[key] = row.phaseHours
  }
  return index
}

/**
 * Look up base hours for a given phase.
 * Falls back to schema VIBE_PHASE_HOURS if demand matrix doesn't have the entry.
 */
function lookupBaseHours(matrixIndex, vibeType, role, phase) {
  if (!phase || phase === PHASE_NA) return 0

  const key = `${vibeType}__${role}`
  const phaseHours = matrixIndex[key] || (VIBE_PHASE_HOURS[vibeType] || {})[role]
  if (!phaseHours) return 0

  return parseFloat(phaseHours[phase]) || 0
}

function getUsagePct(project, role) {
  const normRole = normalizeRole(role)
  if (normRole !== 'Analyst 1' && normRole !== 'Analyst 2') return 1

  const a1Unstaffed = isUnstaffedPerson(project.assignedAnalyst1)
  const a2Unstaffed = isUnstaffedPerson(project.assignedAnalyst2)

  // Excel Capacity Model behavior (observed): if both unassigned → Analyst 2 carries 100%
  if (a1Unstaffed && a2Unstaffed) return normRole === 'Analyst 2' ? 1 : 0
  if (a1Unstaffed) return normRole === 'Analyst 1' ? 0 : 1
  if (a2Unstaffed) return normRole === 'Analyst 2' ? 0 : 1

  const load = parseFloat(project.analystUtilPct)
  if (!Number.isFinite(load)) return 1
  const p = Math.max(0, Math.min(100, load)) / 100
  return normRole === 'Analyst 1' ? p : (1 - p)
}

function getProjectPhaseHours(project, phase) {
  if (!phase || phase === PHASE_NA) return 0
  const obj = project?.phaseHours || {}
  return parseFloat(obj[phase]) || 0
}

function getDeliveryDayOfMonth(project) {
  const d = project?.deliveryDateExact
  if (!(d instanceof Date) || isNaN(d.getTime())) return 0
  return d.getUTCDate() || 0
}

function analystEndM0ProrationFactor(phaseCase4, deliveryDay) {
  const day = deliveryDay || 0
  const bucket =
    day <= 3  ? 0 :
    day <= 10 ? 1 :
    day <= 17 ? 2 :
    day <= 24 ? 3 :
    4

  // For End M-1 rows: 1, .75, .5, .25, 0
  const endMinus1 = [1, 0.75, 0.5, 0.25, 0]
  // For End M0 rows: 0, .25, .5, .75, 1
  const endM0     = [0, 0.25, 0.5, 0.75, 1]

  if (phaseCase4 === 'Project End M-1') return endMinus1[bucket]
  if (phaseCase4 === 'Project End M0')  return endM0[bucket]
  return 1
}

function safeNum(n) {
  const x = typeof n === 'number' ? n : parseFloat(n)
  return Number.isFinite(x) ? x : 0
}

// ─────────────────────────────────────────────────────────────────────────
// COMPONENT 3 — MONTHLY HOUR AGGREGATION
// ─────────────────────────────────────────────────────────────────────────

/**
 * Compute all assignment rows for a single project × role combination.
 * Returns one row per month (12 rows, some with 0 hours).
 */
function computeProjectRoleAssignments(project, role, matrixIndex, orbitMultipliers, planningYear) {
  const normRole  = normalizeRole(role)
  const vibeType  = project.vibeType
  const casesByYear = computeAllCaseColumns(project, planningYear)

  const case1EndMinus1Count = casesByYear.case1.filter(p => p === 'Project End M-1').length
  const usagePct = getUsagePct(project, normRole)
  const lmMult = project.lmMultiplier || 1

  // Determine assigned person for this role
  const person = getAssignedPerson(project, normRole)
  const isUnstaffed = isUnstaffedPerson(person)

  const months = getPlanningMonths(planningYear)
  const rows   = []

  for (let mi = 0; mi < 12; mi++) {
    const case1 = casesByYear.case1[mi]
    const case2 = casesByYear.case2[mi]
    const case3 = casesByYear.case3[mi]
    const case4 = casesByYear.case4[mi]

    let driverPhase = PHASE_NA
    let qHours = 0 // "Calculated Utilized Hours" (Excel col Q)
    let debug = {
      driverPhase: PHASE_NA,
      case1, case2, case3, case4,
      vibeType,
      role: normRole,
      usagePct,
      lmMultiplier: lmMult,
      baseHoursSource: null,
      baseHours: 0,
      distributionDenom: 1,
      prorationFactor: 1,
      deliveryDay: 0,
      csmOrbitKey: null,
      csmOrbitMultiplier: null,
    }

    if (normRole === 'PM') {
      if (vibeType !== 'Validate' && case1 === 'Project End M-1') {
        driverPhase = case1
        const base = getProjectPhaseHours(project, case1)
        const denom = Math.max(1, case1EndMinus1Count)
        qHours = (base / denom) * usagePct
        debug = {
          ...debug,
          driverPhase,
          baseHoursSource: 'ProjectList',
          baseHours: safeNum(base),
          distributionDenom: denom,
        }
      } else {
        driverPhase = case2
        const base = getProjectPhaseHours(project, case2)
        qHours = base * usagePct
        debug = {
          ...debug,
          driverPhase,
          baseHoursSource: 'ProjectList',
          baseHours: safeNum(base),
          distributionDenom: 1,
        }
      }
    } else if (normRole === 'Analyst 1' || normRole === 'Analyst 2') {
      driverPhase = case4
      if (vibeType !== 'Validate' && (case4 === 'Project End M-1' || case4 === 'Project End M0')) {
        const baseEndM0 = lookupBaseHours(matrixIndex, vibeType, normRole, 'Project End M0')
        const day = getDeliveryDayOfMonth(project)
        const proration = analystEndM0ProrationFactor(case4, day)
        qHours = baseEndM0 * proration * lmMult * usagePct
        debug = {
          ...debug,
          driverPhase,
          baseHoursSource: 'DemandMatrix',
          baseHours: safeNum(baseEndM0),
          prorationFactor: proration,
          deliveryDay: day,
        }
      } else {
        const base = lookupBaseHours(matrixIndex, vibeType, normRole, case4)
        qHours = base * lmMult * usagePct
        debug = {
          ...debug,
          driverPhase,
          baseHoursSource: 'DemandMatrix',
          baseHours: safeNum(base),
          prorationFactor: 1,
          deliveryDay: getDeliveryDayOfMonth(project),
        }
      }
    } else if (normRole === 'CSM') {
      driverPhase = case2
      const base = lookupBaseHours(matrixIndex, vibeType, normRole, case2)
      // Excel Q for CSM uses Demand Matrix hours directly (LM multiplier is NOT applied here).
      qHours = base * usagePct
      debug = {
        ...debug,
        driverPhase,
        baseHoursSource: 'DemandMatrix',
        baseHours: safeNum(base),
        distributionDenom: 1,
      }
    } else {
      // SE + any other non-CSM role
      const usesDistrib = roleUsesEndMinus1Distribution(normRole, vibeType)
      if (usesDistrib && vibeType !== 'Validate' && case1 === 'Project End M-1') {
        driverPhase = case1
        const base = lookupBaseHours(matrixIndex, vibeType, normRole, case1)
        const denom = Math.max(1, case1EndMinus1Count)
        qHours = (base / denom) * lmMult * usagePct
        debug = {
          ...debug,
          driverPhase,
          baseHoursSource: 'DemandMatrix',
          baseHours: safeNum(base),
          distributionDenom: denom,
        }
      } else {
        driverPhase = case2
        const base = lookupBaseHours(matrixIndex, vibeType, normRole, case2)
        qHours = base * lmMult * usagePct
        debug = {
          ...debug,
          driverPhase,
          baseHoursSource: 'DemandMatrix',
          baseHours: safeNum(base),
          distributionDenom: 1,
        }
      }
    }

    // Final Utilized Hour (Excel col S):
    // - Manual override not supported in engine yet (so always based on Q)
    // - CSM applies an additional orbit multiplier lookup from Demand Base Matrix
    let final = qHours
    if (normRole === 'CSM') {
      const orbitKey = `${vibeType}__${String(project.orbit || '').trim().toUpperCase()}`
      const orbitMult = orbitMultipliers[orbitKey] || 0
      final = orbitMult * qHours
      debug = {
        ...debug,
        csmOrbitKey: orbitKey,
        csmOrbitMultiplier: orbitMult,
      }
    }
    const finalHours = usagePct === 0 ? 0 : Math.round(final)
    debug = { ...debug, driverPhase }

    // Validation/UI use the displayed Excel Q values (0-decimal rounding).
    // Keep `finalHours` based on the unrounded Q math (to match Excel behavior),
    // but expose `calculatedHours` as the rounded display value.
    const qHoursRounded = usagePct === 0 ? 0 : Math.round(qHours)
    debug = { ...debug, qHoursRaw: qHours, qHoursRounded }

    rows.push(makeAssignmentRow(
      project, normRole, person, isUnstaffed, mi,
      // driver phase used for lookup + calculated hours
      driverPhase,
      // expose all case columns for parity/debug UI
      {
        case1, case2, case3, case4,
      },
      debug,
      qHoursRounded,
      finalHours
    ))
  }

  return rows
}

/**
 * Create a single assignment row object.
 */
function makeAssignmentRow(project, role, person, isUnstaffed, monthIndex, phase, caseColumns, debug, calcHours, finalHours) {
  return {
    projectId:        project.id,
    projectName:      project.name,
    accountName:      project.accountName,
    vibeType:         project.vibeType,
    cluster:          project.cluster,
    orbit:            project.orbit,
    role,
    person,
    isUnstaffed,
    monthIndex,
    phase,
    case1: caseColumns?.case1 ?? PHASE_NA,
    case2: caseColumns?.case2 ?? PHASE_NA,
    case3: caseColumns?.case3 ?? PHASE_NA,
    case4: caseColumns?.case4 ?? PHASE_NA,
    debug:          debug || null,
    calculatedHours:  parseFloat(calcHours.toFixed(4)),
    finalHours,
    effortEquivalent: 0,  // computed after, by applyEffortEquivalents()
    lmMultiplier:     project.lmMultiplier,
  }
}

/**
 * Aggregate final hours by role × month.
 * Returns: { CSM: [12 monthly totals], PM: [...], 'Analyst 1': [...], ... }
 */
function aggregateByRole(assignments) {
  const result = {}
  for (const role of ALL_ROLES) {
    result[role] = new Array(12).fill(0)
  }

  for (const row of assignments) {
    if (!result[row.role]) result[row.role] = new Array(12).fill(0)
    result[row.role][row.monthIndex] += row.finalHours
  }

  return result
}

/**
 * Aggregate by person × role × month.
 * Returns: { 'CSM__Chiranjiv Kathuria': { name, role, monthly[12], total } }
 */
function aggregateByPerson(assignments) {
  const result = {}

  for (const row of assignments) {
    if (row.isUnstaffed || !row.person) continue
    if (row.finalHours === 0) continue

    const key = `${row.role}__${row.person}`
    if (!result[key]) {
      result[key] = {
        name:    row.person,
        role:    row.role,
        monthly: new Array(12).fill(0),
        total:   0,
      }
    }

    result[key].monthly[row.monthIndex] += row.finalHours
    result[key].total += row.finalHours
  }

  // Sort each role's people by total hours desc
  return result
}

/**
 * Aggregate by VIBE type × month.
 */
function aggregateByVibe(assignments) {
  const result = {
    Bond:      new Array(12).fill(0),
    Validate:  new Array(12).fill(0),
    Integrate: new Array(12).fill(0),
    Explore:   new Array(12).fill(0),
  }

  for (const row of assignments) {
    if (result[row.vibeType] !== undefined) {
      result[row.vibeType][row.monthIndex] += row.finalHours
    }
  }

  return result
}

/**
 * Extract unstaffed hours (Unassigned / Need to allocate) by role × month.
 */
function extractUnstaffedHours(assignments) {
  const result = {}
  for (const role of ALL_ROLES) {
    result[role] = new Array(12).fill(0)
  }

  for (const row of assignments) {
    if (!row.isUnstaffed) continue
    if (!result[row.role]) result[row.role] = new Array(12).fill(0)
    result[row.role][row.monthIndex] += row.finalHours
  }

  return result
}

// ─────────────────────────────────────────────────────────────────────────
// COMPONENT 4 — CAPACITY CALCULATION
// ─────────────────────────────────────────────────────────────────────────

/**
 * Compute capacity metrics for all roles.
 *
 * For each role:
 *   rawCapacity     = FTE_COUNT × HRS_PER_PERSON_MONTH  (per month)
 *   effectiveCap    = rawCapacity × ATTRITION_FACTOR     (per month)
 *   rawAnnual       = rawCapacity × 12
 *   effectiveAnnual = rawAnnual × ATTRITION_FACTOR
 *   fteNeeded[mo]   = demandByRole[mo] / HRS_PER_PERSON_MONTH
 */
export function computeCapacity({ planningYear = PLANNING_YEAR, roster = [], capacityConfig = null } = {}) {
  const result = {}

  const businessDaysByMonth = capacityConfig?.businessDaysByMonth || getBusinessDaysByMonth(planningYear)
  const hrsPerPersonDay = capacityConfig?.hrsPerPersonDay ?? 10
  const hrsPerPersonMonthByMonth =
    capacityConfig?.hrsPerPersonMonthByMonth ||
    businessDaysByMonth.map(d => d * hrsPerPersonDay)
  const hrsPerPersonMonthByMonthByRole = capacityConfig?.hrsPerPersonMonthByMonthByRole || null

  const fteCount = capacityConfig?.fteCount || getFteCountFromRoster(roster)
  const attritionGlobal = capacityConfig?.attritionGlobal ?? ATTRITION_FACTOR
  const attritionByRole = capacityConfig?.attritionByRole || {}

  for (const role of PRIMARY_ROLES) {
    // Analyst 2 does NOT add capacity. Its demand is incremental pressure.
    const fte = role === 'Analyst 2' ? 0 : (fteCount[role] || 0)
    const monthArr = (hrsPerPersonMonthByMonthByRole && hrsPerPersonMonthByMonthByRole[role]) || hrsPerPersonMonthByMonth
    const rawMonthlyByMonth = monthArr.map(h => h * fte)
    const attrition = (attritionByRole && attritionByRole[role] !== undefined && attritionByRole[role] !== null)
      ? attritionByRole[role]
      : attritionGlobal
    const effectiveMonthlyByMonth = rawMonthlyByMonth.map(v => v * attrition)
    const rawAnn = rawMonthlyByMonth.reduce((a, b) => a + (b || 0), 0)
    const effAnn = effectiveMonthlyByMonth.reduce((a, b) => a + (b || 0), 0)

    result[role] = {
      fte,
      rawMonthly:       rawAnn / 12,
      effectiveMonthly: effAnn / 12,
      rawMonthlyByMonth,
      effectiveMonthlyByMonth,
      rawAnnual:        rawAnn,
      effectiveAnnual:  effAnn,
      attritionFactor:  attrition,
      hrsPerPersonDay,
      businessDaysByMonth,
      hrsPerPersonMonth: (monthArr.reduce((a, b) => a + (b || 0), 0) / 12),
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

      // Allow "Analyst" as shorthand for Analyst 1 capacity.
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
 * Compute annual total demand per role.
 */
function computeAnnualDemand(demandByRole) {
  const result = {}
  for (const [role, monthly] of Object.entries(demandByRole)) {
    result[role] = monthly.reduce((a, b) => a + b, 0)
  }
  return result
}

/**
 * Count how many months each role exceeds effective capacity.
 */
function computeMonthsOverEffective(demandByRole, capacity) {
  const result = {}
  for (const role of PRIMARY_ROLES) {
    // Analyst 2 is modeled as incremental demand, not a capacity-owning role.
    // Avoid reporting "breach months" for Analyst 2 against a zero-capacity baseline.
    if (role === 'Analyst 2') {
      result[role] = 0
      continue
    }
    const effCap = capacity[role]?.effectiveMonthlyByMonth || new Array(12).fill(0)
    result[role] = (demandByRole[role] || []).filter((d, i) => d > (effCap[i] || 0)).length
  }
  return result
}

/**
 * Find peak demand month for each role.
 */
function computePeakMonths(demandByRole) {
  const result = {}
  for (const [role, monthly] of Object.entries(demandByRole)) {
    const maxVal = Math.max(...monthly)
    const maxIdx = monthly.indexOf(maxVal)
    result[role] = { monthIndex: maxIdx, month: MONTHS[maxIdx], hours: maxVal }
  }
  return result
}

// ─────────────────────────────────────────────────────────────────────────
// COMPONENT 5 — EFFORT EQUIVALENT
// ─────────────────────────────────────────────────────────────────────────

/**
 * Apply effort equivalent rates to all assignment rows.
 * Mutates rows in place (adds effortEquivalent field).
 *
 * Excel formula:
 *   IF(role="CSM",    finalHours * EFFORT_RATES.CSM,
 *   IF(role="PM",     finalHours * EFFORT_RATES.PM,
 *   IF(role="Analyst 1", finalHours * EFFORT_RATES.Analyst1,
 *   finalHours)))
 *
 * Effort rates represent how much "equivalent effort" each hour of work
 * translates to — CSM hours are weighted differently than Analyst hours.
 */
function applyEffortEquivalents(assignments) {
  for (const row of assignments) {
    row.effortEquivalent = computeEffortEquivalent(row.finalHours, row.role)
  }
}

export function computeEffortEquivalent(finalHours, role) {
  const normRole = normalizeRole(role)
  const rate = EFFORT_RATES[normRole] || EFFORT_RATES['default'] || 1
  return parseFloat((finalHours * rate).toFixed(4))
}

/**
 * Aggregate effort equivalents by role × month.
 */
export function aggregateEffortByRole(assignments) {
  const result = {}
  for (const role of ALL_ROLES) {
    result[role] = new Array(12).fill(0)
  }
  for (const row of assignments) {
    if (!result[row.role]) result[row.role] = new Array(12).fill(0)
    result[row.role][row.monthIndex] = parseFloat(
      (result[row.role][row.monthIndex] + row.effortEquivalent).toFixed(4)
    )
  }
  return result
}

// ─────────────────────────────────────────────────────────────────────────
// HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────

/**
 * Get the assigned person name for a project × role.
 */
function getAssignedPerson(project, role) {
  const normRole = normalizeRole(role)
  const personMap = {
    'CSM':       project.assignedCSM,
    'PM':        project.assignedPM,
    'SE':        project.assignedSE,
    'Analyst 1': project.assignedAnalyst1,
    'Analyst 2': project.assignedAnalyst2,
  }
  return personMap[normRole] || 'Unassigned'
}

/**
 * Check if a person name represents an unstaffed/placeholder role.
 */
function isUnstaffedPerson(name) {
  if (!name) return true
  const n = String(name).toLowerCase().trim()
  return UNSTAFFED_PERSON_NAMES.some(u => u.toLowerCase() === n) ||
         n === '' || n === 'nan' || n === 'null'
}

/**
 * Format assignments into a people-list suitable for the People view.
 * Returns array sorted by total hours desc, per role.
 */
export function getPeopleList(demandByPerson) {
  const byRole = {}

  for (const [key, data] of Object.entries(demandByPerson)) {
    const { role } = data
    if (!byRole[role]) byRole[role] = []
    byRole[role].push({
      name:    data.name,
      monthly: data.monthly.map(Math.round),
      total:   Math.round(data.total),
    })
  }

  // Sort each role by total hours desc
  for (const role of Object.keys(byRole)) {
    byRole[role].sort((a, b) => b.total - a.total)
  }

  return byRole
}

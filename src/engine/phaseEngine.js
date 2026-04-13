/**
 * phaseEngine.js — Phase Assignment Engine
 *
 * Replicates the Excel "Case 1/2/3/4" phase columns from the Capacity Model sheet.
 *
 * IMPORTANT CONTRACTS (from product spec):
 * - Compute all 4 Case columns first (role-independent), then downstream code selects
 *   the driver phase used for calculated utilized hours.
 * - Case column functions return "NA" (not null) when inactive / not applicable.
 */

export const PHASE_NA = 'NA'

// ─────────────────────────────────────────────────────────────────────────
// CORE MONTH DIFF FUNCTION
// Replicates Excel: (YEAR(M)-YEAR(ref))*12 + (MONTH(M)-MONTH(ref))
// Both inputs should be normalized to 1st of month.
// ─────────────────────────────────────────────────────────────────────────
function monthDiff(currentMonth, refDate) {
  if (!currentMonth || !refDate) return null
  return (
    (currentMonth.getFullYear() - refDate.getFullYear()) * 12 +
    (currentMonth.getMonth()    - refDate.getMonth())
  )
}

// ─────────────────────────────────────────────────────────────────────────
// CORE TIMELINE PHASES (Excel Case formulas differ in ordering)
// ─────────────────────────────────────────────────────────────────────────

// Case 1 / 3 / 4 ordering (End M-1 wins over Start M1 in collisions)
function getTimelinePhase_EndMinus1Wins(currentMonth, refStartDate, deliveryDate) {
  if (!currentMonth || !refStartDate || !deliveryDate) return PHASE_NA

  const fromStart    = monthDiff(currentMonth, refStartDate)
  const fromDelivery = monthDiff(currentMonth, deliveryDate)

  if (fromStart    === 0)  return 'Project Start M0'
  if (fromDelivery === 0)  return 'Project End M0'
  if (fromDelivery === -1) return 'Project End M-1'
  if (fromStart    === 1)  return 'Project Start M1'
  if (fromDelivery === 1)  return 'Project End M1'
  if (fromDelivery  <  0 && fromStart > 0) return 'Project Mid'
  if (fromDelivery  >  1) return 'Project End M1+'

  return PHASE_NA
}

// Case 2 ordering (Start M1 / End M1 win before End M-1 in collisions)
function getTimelinePhase_StartM1Wins(currentMonth, refStartDate, deliveryDate) {
  if (!currentMonth || !refStartDate || !deliveryDate) return PHASE_NA

  const fromStart    = monthDiff(currentMonth, refStartDate)
  const fromDelivery = monthDiff(currentMonth, deliveryDate)

  if (fromStart    === 0)  return 'Project Start M0'
  if (fromDelivery === 0)  return 'Project End M0'
  if (fromStart    === 1)  return 'Project Start M1'
  if (fromDelivery === 1)  return 'Project End M1'
  if (fromDelivery === -1) return 'Project End M-1'
  if (fromDelivery  <  0 && fromStart > 0) return 'Project Mid'
  if (fromDelivery  >  1) return 'Project End M1+'

  return PHASE_NA
}

// ─────────────────────────────────────────────────────────────────────────
// Special override used by Case 1 and Case 3 (matches Excel):
// if delivery >= Aug-2026 and month >= Jun-2026 and month < delivery, force End M-1
// ─────────────────────────────────────────────────────────────────────────
function shouldForceEndMinus1(currentMonth, refStartDate, deliveryDate) {
  const m = toMonthStart(currentMonth)
  const s = toMonthStart(refStartDate)
  const d = toMonthStart(deliveryDate)
  if (!m || !d) return false

  // Replicate Excel's YEAR(date)*12 + MONTH(date) comparisons (MONTH is 1–12).
  const ym = (dt) => dt.getFullYear() * 12 + (dt.getMonth() + 1)

  const ymDelivery = ym(d)
  const ymMonth    = ym(m)

  const AUG_2026 = 2026 * 12 + 7 // ">= Aug 2026" implemented as > (2026*12+7)
  const JUN_2026 = 2026 * 12 + 6

  return (
    ymDelivery > AUG_2026 &&
    ymMonth >= JUN_2026 &&
    ymMonth < ymDelivery &&
    // Excel does not override the project's start month (Start M0 remains Start M0).
    (!s || monthDiff(m, s) !== 0)
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Case 2 — Project Timeline (Standard)
// UI name: "Case 2 - Project Timeline (Standard)"
// Definition: timeline based on Start Date and Delivery Date.
// ─────────────────────────────────────────────────────────────────────────
export function getPhaseCase2(currentMonth, startDate, deliveryDate) {
  return getTimelinePhase_StartM1Wins(currentMonth, startDate, deliveryDate)
}

// ─────────────────────────────────────────────────────────────────────────
// Case 1 — Adjusted Start Timeline
// UI name: "Case 1 - Adjusted Start Timeline"
// Definition: Case 2 with the special override window forcing End M-1.
// ─────────────────────────────────────────────────────────────────────────
export function getPhaseCase1(currentMonth, startDate, deliveryDate) {
  if (shouldForceEndMinus1(currentMonth, startDate, deliveryDate)) return 'Project End M-1'
  return getTimelinePhase_EndMinus1Wins(currentMonth, startDate, deliveryDate)
}

// ─────────────────────────────────────────────────────────────────────────
// Case 4 — Analytics Timeline
// UI name: "Case 4 - Analytics Timeline"
// Definition: timeline based on Analytics Start Date and Delivery Date.
// If Analytics Start Date is missing/invalid, Case 4 is NA (not applicable).
// ─────────────────────────────────────────────────────────────────────────
export function getPhaseCase4(currentMonth, analyticsStartDate, deliveryDate) {
  const a = toMonthStart(analyticsStartDate)
  const d = toMonthStart(deliveryDate)
  const m = toMonthStart(currentMonth)
  if (!m || !a || !d) return PHASE_NA
  return getTimelinePhase_EndMinus1Wins(m, a, d)
}

// ─────────────────────────────────────────────────────────────────────────
// Case 3 — Adjusted Analytics Timeline
// UI name: "Case 3 - Adjusted Analytics Timeline"
// Definition: Case 4 gated + special override:
// - If Case 4 is NA, then Case 3 must also be NA.
// - Otherwise, Case 4 with the special override window forcing End M-1.
// ─────────────────────────────────────────────────────────────────────────
export function getPhaseCase3(currentMonth, analyticsStartDate, deliveryDate) {
  const case4 = getPhaseCase4(currentMonth, analyticsStartDate, deliveryDate)
  if (case4 === PHASE_NA) return PHASE_NA
  if (shouldForceEndMinus1(currentMonth, analyticsStartDate, deliveryDate)) return 'Project End M-1'
  return case4
}

// ─────────────────────────────────────────────────────────────────────────
// Compute all 4 Case columns for a project × month (role-independent)
// ─────────────────────────────────────────────────────────────────────────
export function computeCaseColumnsForMonth(monthDate, project) {
  const m = toMonthStart(monthDate)
  const s = toMonthStart(project?.startDate)
  const d = toMonthStart(project?.deliveryDate)
  const a = toMonthStart(project?.analyticsStartDate)

  return {
    case1: getPhaseCase1(m, s, d),
    case2: getPhaseCase2(m, s, d),
    case4: getPhaseCase4(m, a, d),
    // Case 3 gated by Case 4 (implemented inside getPhaseCase3)
    case3: getPhaseCase3(m, a, d),
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Compute all 4 Case columns for the full planning year (12 months)
// ─────────────────────────────────────────────────────────────────────────
export function computeAllCaseColumns(project, planningYear = 2026) {
  const out = { case1: [], case2: [], case3: [], case4: [] }
  for (let mo = 0; mo < 12; mo++) {
    const monthDate = new Date(planningYear, mo, 1)
    const cc = computeCaseColumnsForMonth(monthDate, project)
    out.case1.push(cc.case1)
    out.case2.push(cc.case2)
    out.case3.push(cc.case3)
    out.case4.push(cc.case4)
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────
// COUNT END M-1 MONTHS — needed for distribution calculation
// For a given project × role × year, how many months have phase = "Project End M-1"?
// Used by calculate.js to distribute End M-1 hours evenly.
// ─────────────────────────────────────────────────────────────────────────
export function countEndMinus1Months(project, role, planningYear = 2026) {
  // Deprecated path: previously counted role-driven phases. Keep for backward compatibility
  // (some UI code still imports this), but new calculation flow counts End M-1 using the
  // selected driver phase after all Case columns are computed.
  const normRole = normalizeRole(role)
  const cc = computeAllCaseColumns(project, planningYear)

  let phases
  if (normRole === 'CSM') phases = cc.case2
  else if (normRole === 'Analyst 1' || normRole === 'Analyst 2') phases = cc.case4
  else phases = cc.case2

  return phases.filter(p => p === 'Project End M-1').length
}

// ─────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────

/**
 * Normalize date to 1st of month (removes day/time noise).
 * Matches Cursor's parseDate() normalizeToMonthStart behaviour.
 */
export function toMonthStart(date) {
  if (!date) return null
  if (!(date instanceof Date) || isNaN(date.getTime())) return null
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

/**
 * Normalize role strings to canonical names.
 */
export function normalizeRole(role) {
  if (!role) return ''
  const s = String(role).trim()
  const map = {
    'analyst 1': 'Analyst 1',
    'analyst 2': 'Analyst 2',
    'analyst':   'Analyst 1',
    'csm':       'CSM',
    'pm':        'PM',
    'se':        'SE',
  }
  return map[s.toLowerCase()] || s
}

/**
 * Check if a role requires End M-1 distribution.
 * From the Excel formula: non-Validate projects distribute End M-1 for PM, SE, Analyst.
 * CSM does NOT distribute — it uses direct lookup.
 */
export function roleUsesEndMinus1Distribution(role, vibeType) {
  const normRole = normalizeRole(role)
  if (normRole === 'CSM') return false                    // CSM: direct lookup always
  if (vibeType === 'Validate') return false               // Validate: direct lookup for all roles
  return ['PM', 'SE', 'Analyst 1', 'Analyst 2'].includes(normRole)
}

/**
 * Get the 12 month dates for a planning year.
 */
export function getPlanningMonths(year = 2026) {
  return Array.from({ length: 12 }, (_, i) => new Date(year, i, 1))
}

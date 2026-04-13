/**
 * validate.js — Validation Engine
 *
 * PURPOSE:
 *   Compare Logic Layer computed values (from runCalculations) against
 *   Excel Capacity Model values (ground truth / source of truth).
 *
 * WHAT THIS IS NOT:
 *   - NOT a pass-through (Excel Calc → round → vs Excel Final)
 *   - NOT comparing Excel against Excel
 *   - NOT feeding Capacity Model data into calculations
 *
 * WHAT THIS IS:
 *   - The Logic Layer runs first (ingest.js → calculate.js → assignments[])
 *   - Each assignment has: projectName, role, monthIndex, finalHours (engine-computed)
 *   - The Capacity Model sheet is read as ground truth: Final Utilized Hour per row
 *   - We match engine assignments to Excel rows by (projectName, role, monthIndex)
 *   - We compare engine.finalHours vs excel.finalUtilizedHour
 *   - Mismatches surface real bugs in the logic layer
 *
 * SEPARATION CONTRACT:
 *   - Capacity Model sheet is read for COMPARISON ONLY
 *   - Engine calculations use only Project List + Demand Matrix (via ingest.js + calculate.js)
 *   - No Capacity Model data flows into runCalculations()
 */

import * as XLSX from 'xlsx'
import { MONTHS } from './schema.js'

// ─────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────

/**
 * Run the true validation pass.
 *
 * @param {File}   file         — raw uploaded Excel file (used to read Capacity Model sheet)
 * @param {Object} calcResult   — output from runCalculations() — the engine's computed assignments
 * @returns {Promise<ValidationResult>}
 */
export async function runValidation(file, calcResult) {
  const startTime = Date.now()

  if (!calcResult || !calcResult.assignments) {
    throw new Error('Logic Layer must run first before validation can compare against it.')
  }

  // Read workbook (browser File) then delegate to workbook-based validator.
  const wb = await readWorkbook(file)
  const result = runValidationFromWorkbook(wb, calcResult)
  result.meta.durationMs = Date.now() - startTime
  result.meta.validatedAt = new Date().toISOString()
  return result
}

/**
 * Workbook-based validation runner (useful for Node scripts/tests).
 * NOTE: still enforces the separation contract: Capacity Model is comparison-only.
 *
 * @param {XLSX.WorkBook} wb
 * @param {Object} calcResult
 * @returns {ValidationResult}
 */
export function runValidationFromWorkbook(wb, calcResult) {
  if (!calcResult || !calcResult.assignments) {
    throw new Error('Logic Layer must run first before validation can compare against it.')
  }

  const cmSheet = wb.Sheets['Capacity Model']
  if (!cmSheet) {
    throw new Error('Sheet "Capacity Model" not found — needed as comparison ground truth.')
  }
  // Use formatted values (raw:false) because the workbook is the source of truth
  // as displayed to users (and matches how our UI presents validation).
  const cmRows = XLSX.utils.sheet_to_json(cmSheet, { defval: null, raw: false })

  const excelIndex = buildExcelIndex(cmRows)
  const engineIndex = buildEngineIndex(calcResult.assignments)
  const comparisons = buildComparisons(excelIndex, engineIndex)

  const summary    = buildSummary(comparisons)
  const byRole     = buildRoleBreakdown(comparisons)
  const byMonth    = buildMonthBreakdown(comparisons)
  const byProject  = buildProjectBreakdown(comparisons)

  return {
    comparisons,
    summary,
    byRole,
    byMonth,
    byProject,
    meta: {
      totalExcelRows:      cmRows.length,
      matchedRows:         comparisons.filter(c => c.matched).length,
      unmatchedExcelRows:  comparisons.filter(c => !c.matched && c.side === 'excel_only').length,
      engineOnlyRows:      Object.keys(engineIndex).filter(k => !excelIndex[k]).length,
      durationMs:          0,
      validatedAt:         '',
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────
// INDEX BUILDERS
// ─────────────────────────────────────────────────────────────────────────

function buildExcelIndex(cmRows) {
  const index = {}
  for (const row of cmRows) {
    const projectName = str(row['Project Name'])
    const role        = str(row['Role'])
    const monthRaw    = row['Month']
    const monthIndex  = getMonthIndex(monthRaw)
    const usagePct    = parseNum(row['Usage%'])

    if (!projectName || !role || monthIndex === -1) continue

    const excelFinal  = parseNum(row['Final Utilized Hour'])
    const excelCalc   = parseNum(row['Calculated Utilized Hours'])
    const orbit       = str(row['Orbit']) || '-'
    const vibeType    = str(row['VIBE Tag'])
    const case1       = str(row['Case 1'])
    const case2       = str(row['Case 2'])
    const case3       = str(row['Case 3'])
    const case4       = str(row['Case 4'])

    const key = makeKey(projectName, role, monthIndex)

    // If there are multiple rows with the same key (duplicate people on same role),
    // accumulate the Excel final hours (matches how engine aggregates by role+month)
    if (!index[key]) {
      index[key] = {
        projectName, role, monthIndex, monthLabel: MONTHS[monthIndex] || '',
        excelFinal: 0, excelCalc: 0, orbit, vibeType, phase: case1,
        case1, case2, case3, case4,
        usagePct, rowCount: 0,
      }
    }
    index[key].excelFinal += excelFinal
    index[key].excelCalc  += excelCalc
    index[key].rowCount++
  }
  return index
}

function buildEngineIndex(assignments) {
  const index = {}
  for (const a of assignments) {
    if (!a.projectName || !a.role) continue
    const key = makeKey(a.projectName, a.role, a.monthIndex)
    if (!index[key]) {
      index[key] = {
        projectName: a.projectName, role: a.role, monthIndex: a.monthIndex,
        monthLabel: MONTHS[a.monthIndex] || '', vibeType: a.vibeType,
        orbit: a.orbit, engineFinal: 0, engineCalc: 0, phase: a.phase,
        case1: a.case1, case2: a.case2, case3: a.case3, case4: a.case4,
        lmMultiplier: a.lmMultiplier,
        engineRowCount: 0,
        debugSamples: [],
      }
    }
    index[key].engineFinal += a.finalHours
    index[key].engineCalc  += a.calculatedHours
    index[key].engineRowCount++
    if (a.debug && index[key].debugSamples.length < 3) {
      index[key].debugSamples.push(a.debug)
    }
  }
  return index
}

function makeKey(projectName, role, monthIndex) {
  return `${normalizeProjectName(projectName)}::${role}::${monthIndex}`
}

// ─────────────────────────────────────────────────────────────────────────
// COMPARISON
// ─────────────────────────────────────────────────────────────────────────

function buildComparisons(excelIndex, engineIndex) {
  const comparisons = []

  // Iterate all Excel rows → find matching engine row
  for (const [key, excel] of Object.entries(excelIndex)) {
    const engine = engineIndex[key]

    if (!engine) {
      // Excel has a row the engine didn't produce at all
      comparisons.push({
        ...excel,
        engineFinal: null,
        engineCalc:  null,
        calcDelta:   null,
        calcDeltaAbs:null,
        calcDeltaPct:null,
        delta:       null,
        deltaAbs:    null,
        deltaPct:    null,
        finalDelta:  null,
        finalDeltaAbs:null,
        finalDeltaPct:null,
        calcIsExactMatch: false,
        finalIsExactMatch:false,
        calcIsWithinTol:  false,
        finalIsWithinTol: false,
        mismatchMetric:   null,
        isExactMatch:  false,
        isWithinTol:   false,
        matched:     false,
        side:        'excel_only',
        category:    excel.excelFinal === 0 ? 'both_zero' : 'engine_missing',
        note:        excel.excelFinal === 0
          ? 'Both zero — row inactive in Excel, engine produced nothing'
          : `Engine produced no assignment for this project/role/month`,
      })
      continue
    }

    // Q parity (Calculated Utilized Hours)
    const calcDelta    = engine.engineCalc - excel.excelCalc
    const calcDeltaAbs = Math.abs(calcDelta)
    const calcDeltaPct = excel.excelCalc !== 0
      ? (calcDelta / excel.excelCalc) * 100
      : (engine.engineCalc !== 0 ? 100 : 0)

    // S parity (Final Utilized Hour)
    const finalDelta    = engine.engineFinal - excel.excelFinal
    const finalDeltaAbs = Math.abs(finalDelta)
    const finalDeltaPct = excel.excelFinal !== 0
      ? (finalDelta / excel.excelFinal) * 100
      : (engine.engineFinal !== 0 ? 100 : 0)

    // Back-compat fields (old validator used only Final)
    const delta    = finalDelta
    const deltaAbs = finalDeltaAbs
    const deltaPct = finalDeltaPct

    const calcIsExactMatch  = calcDelta === 0
    const finalIsExactMatch = finalDelta === 0
    const calcIsWithinTol   = calcDeltaAbs <= 1
    const finalIsWithinTol  = finalDeltaAbs <= 1

    // Combined (end goal: exact match on BOTH Q and S)
    const isExactMatch = calcIsExactMatch && finalIsExactMatch
    const isWithinTol  = calcIsWithinTol && finalIsWithinTol

    const mismatchMetric = calcDeltaAbs > finalDeltaAbs ? 'calc' : 'final'

    let category
    if (excel.excelFinal === 0 && engine.engineFinal === 0) {
      category = 'both_zero'
    } else if (isExactMatch) {
      category = 'exact_match'
    } else if (isWithinTol) {
      category = 'rounding_delta'
    } else if (excel.excelFinal === 0 && engine.engineFinal > 0) {
      category = 'engine_overcounts'   // engine says there are hours, Excel says 0
    } else if (excel.excelFinal > 0 && engine.engineFinal === 0) {
      category = 'engine_undercounts'  // engine says 0 hours, Excel says there are hours
    } else {
      category = 'value_mismatch'
    }

    const note = isExactMatch
      ? `✓ Q and S match exactly`
      : `Q: Eng=${engine.engineCalc}, Excel=${excel.excelCalc}, Δ=${calcDelta > 0 ? '+' : ''}${calcDelta} · ` +
        `S: Eng=${engine.engineFinal}, Excel=${excel.excelFinal}, Δ=${finalDelta > 0 ? '+' : ''}${finalDelta}`

    comparisons.push({
      ...excel,
      engineFinal:   engine.engineFinal,
      engineCalc:    engine.engineCalc,
      phase:         engine.phase || excel.phase,
      case1:         engine.case1 || excel.case1,
      case2:         engine.case2 || excel.case2,
      case3:         engine.case3 || excel.case3,
      case4:         engine.case4 || excel.case4,
      lmMultiplier:  engine.lmMultiplier,
      engineRowCount: engine.engineRowCount,
      debugSamples:  engine.debugSamples,
      calcDelta,
      calcDeltaAbs,
      calcDeltaPct,
      delta,
      deltaAbs,
      deltaPct,
      finalDelta,
      finalDeltaAbs,
      finalDeltaPct,
      calcIsExactMatch,
      finalIsExactMatch,
      calcIsWithinTol,
      finalIsWithinTol,
      mismatchMetric,
      isExactMatch,
      isWithinTol,
      matched:       true,
      side:          'both',
      category,
      note,
    })
  }

  // Also capture engine rows with no matching Excel row (engine produced hours Excel doesn't have)
  for (const [key, engine] of Object.entries(engineIndex)) {
    if (!excelIndex[key] && engine.engineFinal > 0) {
      comparisons.push({
        ...engine,
        excelFinal:  null,
        excelCalc:   null,
        calcDelta:   null,
        calcDeltaAbs:null,
        calcDeltaPct:null,
        delta:       null,
        deltaAbs:    null,
        deltaPct:    null,
        finalDelta:  null,
        finalDeltaAbs:null,
        finalDeltaPct:null,
        calcIsExactMatch: false,
        finalIsExactMatch:false,
        calcIsWithinTol:  false,
        finalIsWithinTol: false,
        mismatchMetric:   null,
        isExactMatch:  false,
        isWithinTol:   false,
        matched:     false,
        side:        'engine_only',
        category:    'engine_only',
        note:        `Engine produced ${engine.engineFinal}h but Excel has no row for this`,
      })
    }
  }

  return comparisons
}

// ─────────────────────────────────────────────────────────────────────────
// AGGREGATION
// ─────────────────────────────────────────────────────────────────────────

function buildSummary(rows) {
  const matched    = rows.filter(r => r.matched)
  const active     = matched.filter(r => r.excelFinal > 0 || r.engineFinal > 0)

  const exactMatches    = active.filter(r => r.isExactMatch).length
  const withinTol       = active.filter(r => r.isWithinTol && !r.isExactMatch).length
  const mismatches      = active.filter(r => !r.isWithinTol).length

  const excelTotal  = matched.reduce((s, r) => s + (r.excelFinal  || 0), 0)
  const engineTotal = matched.reduce((s, r) => s + (r.engineFinal || 0), 0)

  const categoryBreakdown = {}
  rows.forEach(r => { categoryBreakdown[r.category] = (categoryBreakdown[r.category] || 0) + 1 })

  return {
    totalRows:         rows.length,
    matchedRows:       matched.length,
    activeRows:        active.length,
    exactMatches,
    withinTol,
    mismatches,
    exactMatchPct:     pct(exactMatches, active.length),
    withinTolPct:      pct(exactMatches + withinTol, active.length),
    excelTotalHours:   Math.round(excelTotal),
    engineTotalHours:  Math.round(engineTotal),
    aggregateDelta:    Math.round(engineTotal - excelTotal),
    aggregateDeltaPct: excelTotal ? ((Math.abs(engineTotal - excelTotal) / excelTotal) * 100).toFixed(1) : '0.0',
    categoryBreakdown,
    unmatchedExcel:    rows.filter(r => r.side === 'excel_only' && r.excelFinal > 0).length,
    engineOnly:        rows.filter(r => r.side === 'engine_only').length,
  }
}

function buildRoleBreakdown(rows) {
  const roles = {}
  rows.filter(r => r.matched).forEach(r => {
    const role = r.role
    if (!roles[role]) roles[role] = { role, totalRows:0, exactMatches:0, activeRows:0, excelHours:0, engineHours:0 }
    const rr = roles[role]
    rr.totalRows++
    if (r.excelFinal > 0 || r.engineFinal > 0) {
      rr.activeRows++
      rr.excelHours  += r.excelFinal  || 0
      rr.engineHours += r.engineFinal || 0
      if (r.isExactMatch) rr.exactMatches++
    }
  })
  return Object.values(roles).map(r => ({
    ...r,
    matchPct:        pct(r.exactMatches, r.activeRows),
    aggregateDelta:  Math.round(r.engineHours - r.excelHours),
  }))
}

function buildMonthBreakdown(rows) {
  const months = Array.from({ length: 12 }, (_, i) => ({
    monthIndex: i, monthLabel: MONTHS[i],
    excelHours: 0, engineHours: 0, exactMatches: 0, activeRows: 0,
  }))
  rows.filter(r => r.matched).forEach(r => {
    const m = months[r.monthIndex]
    if (!m) return
    if (r.excelFinal > 0 || r.engineFinal > 0) {
      m.activeRows++
      m.excelHours  += r.excelFinal  || 0
      m.engineHours += r.engineFinal || 0
      if (r.isExactMatch) m.exactMatches++
    }
  })
  return months.map(m => ({
    ...m,
    matchPct:       pct(m.exactMatches, m.activeRows),
    aggregateDelta: Math.round(m.engineHours - m.excelHours),
    deltaPct:       m.excelHours ? ((m.engineHours - m.excelHours) / m.excelHours * 100).toFixed(1) : '0.0',
  }))
}

function buildProjectBreakdown(rows) {
  const projects = {}
  rows.filter(r => r.matched).forEach(r => {
    const key = r.projectName || 'Unknown'
    if (!projects[key]) projects[key] = {
      name: key, vibeType: r.vibeType, orbit: r.orbit,
      totalRows: 0, exactMatches: 0, activeRows: 0,
      excelHours: 0, engineHours: 0, maxDeltaAbs: 0, categories: {},
    }
    const p = projects[key]
    p.totalRows++
    if (r.excelFinal > 0 || r.engineFinal > 0) {
      p.activeRows++
      p.excelHours  += r.excelFinal  || 0
      p.engineHours += r.engineFinal || 0
      if (r.isExactMatch) p.exactMatches++
      if (r.deltaAbs != null && r.deltaAbs > p.maxDeltaAbs) p.maxDeltaAbs = r.deltaAbs
    }
    p.categories[r.category] = (p.categories[r.category] || 0) + 1
  })
  return Object.values(projects).map(p => ({
    ...p,
    matchPct:        pct(p.exactMatches, p.activeRows),
    aggregateDelta:  Math.round(p.engineHours - p.excelHours),
  })).sort((a, b) => a.matchPct - b.matchPct)
}

// ─────────────────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────────────────

function readWorkbook(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = e => {
      try { resolve(XLSX.read(e.target.result, { type: 'binary', cellDates: true })) }
      catch (err) { reject(new Error(`Failed to read workbook: ${err.message}`)) }
    }
    reader.onerror = () => reject(new Error('File read error'))
    reader.readAsBinaryString(file)
  })
}

function normalizeProjectName(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/\[.*?\]\s*/g, '').trim()
}

function getMonthIndex(val) {
  if (!val) return -1
  const d = new Date(val)
  return isNaN(d.getTime()) ? -1 : d.getMonth()
}

function parseNum(val) {
  if (val === null || val === undefined || val === '') return 0
  const n = parseFloat(String(val).replace(/,/g, ''))
  return isNaN(n) ? 0 : n
}

function str(val) {
  if (val === null || val === undefined) return ''
  const s = String(val).trim()
  return ['null', 'undefined'].includes(s) ? '' : s
}

function pct(num, den) {
  if (!den) return 0
  return Math.round((num / den) * 1000) / 10  // one decimal place
}

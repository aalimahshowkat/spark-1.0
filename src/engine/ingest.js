/**
 * ingest.js — Data Ingestion Layer
 *
 * Responsibilities:
 *   1. Parse raw Excel rows from Project List → structured ProjectRecord[]
 *   2. Parse raw Excel rows from Demand Base Matrix → DemandMatrixRow[]
 *   3. Apply data quality rules and produce DataQualityReport
 *   4. Return clean, typed records ready for the calculation engine
 *
 * What this file does NOT do:
 *   - Calculate any demand hours (that is engine/calculate.js)
 *   - Read the Capacity Model sheet (we don't depend on it)
 *   - Produce any aggregated metrics
 *
 * All Excel column name mappings are in schema.js — do not hardcode them here.
 */

import * as XLSX from 'xlsx'
import {
  PROJECT_LIST_COLUMN_MAP,
  DEMAND_MATRIX_COLUMN_MAP,
  DATA_QUALITY_RULES,
  VIBE_TYPES,
  UNSTAFFED_PERSON_NAMES,
  SCHEMA_VERSION,
  LM_BUCKET_MULTIPLIERS,
} from './schema.js'

// ─────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────

/**
 * Main entry point. Takes a File object (from file input or drag-drop),
 * returns a fully parsed and quality-checked data payload.
 *
 * @param {File} file
 * @returns {Promise<IngestResult>}
 */
export async function ingestExcelFile(file) {
  const startTime = Date.now()

  const wb = await readWorkbook(file)
  const result = ingestWorkbook(wb, {
    fileName: file?.name || '',
    fileSize: file?.size || 0,
    startTime,
  })
  return result
}

/**
 * Workbook-based ingestion (useful for Node scripts/tests).
 *
 * @param {XLSX.WorkBook} wb
 * @param {Object} metaIn
 * @returns {IngestResult}
 */
export function ingestWorkbook(wb, metaIn = {}) {
  const startTime = metaIn.startTime || Date.now()

  validateRequiredSheets(wb)

  const rawProjects     = readSheet(wb, 'Project List')
  const rawDemandMatrix = readSheet(wb, 'Demand Base Matrix')
  const orbitMultipliers = extractOrbitMultipliers(wb)

  if (!rawProjects || rawProjects.length === 0) {
    throw new IngestError('Sheet "Project List" not found or is empty.')
  }
  if (!rawDemandMatrix || rawDemandMatrix.length === 0) {
    throw new IngestError('Sheet "Demand Base Matrix" not found or is empty.')
  }

  const hasOrbitColumn = projectListHasOrbitColumn(rawProjects)
  const projects       = parseProjects(rawProjects, hasOrbitColumn)
  const demandMatrix   = parseDemandMatrix(rawDemandMatrix)
  const demandTasks    = parseDemandTasks(rawDemandMatrix)
  const quality        = runDataQualityChecks(projects)
  const roster         = seedRosterFromProjects(projects)

  const meta = {
    fileName:       metaIn.fileName || '',
    fileSize:       metaIn.fileSize || 0,
    parsedAt:       new Date().toISOString(),
    durationMs:     Date.now() - startTime,
    schemaVersion:  SCHEMA_VERSION,
    totalProjects:  projects.length,
    matrixRows:     demandMatrix.length,
    sheetsFound:    wb.SheetNames,
  }

  return { projects, demandMatrix, demandTasks, orbitMultipliers, quality, roster, meta }
}

// ─────────────────────────────────────────────────────────────────────────
// WORKBOOK READING
// ─────────────────────────────────────────────────────────────────────────

function readWorkbook(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, {
          type: 'binary',
          cellDates: true,      // parse Excel date serials into JS Date objects
          cellNF: false,        // don't need number format strings
          cellStyles: false,    // don't need styles
        })
        resolve(wb)
      } catch (err) {
        reject(new IngestError(`Failed to read Excel file: ${err.message}`))
      }
    }
    reader.onerror = () => reject(new IngestError('File could not be read.'))
    reader.readAsBinaryString(file)
  })
}

function validateRequiredSheets(wb) {
  const required = ['Project List', 'Demand Base Matrix']
  const found    = wb.SheetNames

  // Accept "Project List" as fallback for "Project List (2)" -- edited (not using project List (2)
  const hasProjectList = found.includes('Project List')
  const hasDemandMatrix = found.includes('Demand Base Matrix')

  const missing = []
  if (!hasProjectList)  missing.push('"Project List"')
  if (!hasDemandMatrix) missing.push('"Demand Base Matrix"')

  if (missing.length > 0) {
    throw new IngestError(
      `Required sheets missing: ${missing.join(', ')}. ` +
      `Found sheets: ${found.join(', ')}`
    )
  }
}

function readSheet(wb, name) {
  const sheet = wb.Sheets[name]
  if (!sheet) return null
  // Use formatted values (raw:false) to avoid timezone-shifted Date objects from SheetJS.
  // parseDate()/parseExactDate() handle strings like "Sep-26" and "9/20/26" reliably.
  return XLSX.utils.sheet_to_json(sheet, { defval: null, raw: false })
}

function seedRosterFromProjects(projects) {
  const list = Array.isArray(projects) ? projects : []
  const add = (out, role, name) => {
    const n = sanitizePerson(name)
    if (!n) return
    if (isUnstaffed(n)) return
    const id = `${role}__${n}`
    if (out.has(id)) return
    out.set(id, { id, name: n, role, fte: 1 })
  }

  const out = new Map()
  for (const p of list) {
    add(out, 'CSM', p.assignedCSM)
    add(out, 'PM', p.assignedPM)
    add(out, 'SE', p.assignedSE)
    add(out, 'Analyst 1', p.assignedAnalyst1)
    add(out, 'Analyst 2', p.assignedAnalyst2)
  }

  return [...out.values()].sort((a, b) => (a.role + a.name).localeCompare(b.role + b.name))
}

// ─────────────────────────────────────────────────────────────────────────
// PROJECT LIST PARSING
// ─────────────────────────────────────────────────────────────────────────

function parseProjects(rows, hasOrbitColumn) {
  return rows
    .map((row, index) => parseProjectRow(row, index, hasOrbitColumn))
    .filter(p => p !== null)               // drop unparseable rows
    .filter(p => p.rawName?.trim())        // drop rows with no project name
}

function parseProjectRow(row, index, hasOrbitColumn) {
  try {
    const get = (field) => resolveColumn(row, PROJECT_LIST_COLUMN_MAP[field])
    const getRaw = (field) => resolveColumnRaw(row, PROJECT_LIST_COLUMN_MAP[field])

    const rawName    = get('rawName') || ''
    const name       = stripBracketPrefix(rawName)
    if (!name) return null

    const id         = get('id') || generateId(name)
    const displayId  = get('displayId') || ''
    const startDate  = parseDate(get('startDate'))
    const delivDate  = parseDate(get('deliveryDate'))
    const analyticsStartDate = parseDate(get('analyticsStartDate'))
    // Excel Analyst proration uses Capacity Model col U (EDD-like exact date).
    // Use Project List EDD when available; fall back to raw delivery fields.
    const deliveryDateExact = (
      parseExactDate(getRaw('edd')) ||
      parseExactDate(getRaw('plannedDueDate')) ||
      parseExactDate(getRaw('deliveryDateRaw')) ||
      parseExactDate(getRaw('deliveryDate'))
    )
    const dxLMs      = parseNum(get('dxLMs'))
    const txLMs      = parseNum(get('txLMs'))
    const totalLMs   = parseNum(get('totalLMs')) || (dxLMs + txLMs)
    const lmMult     = parseNum(get('lmMultiplier'))
    const analystUtilPct = parseNum(get('analystUtilPct'))
    const nonStandardData   = (getRaw('nonStandardData') ?? '').toString().trim()
    const nonStandardMetric = (getRaw('nonStandardMetric') ?? '').toString().trim()
    const ivmsConfiguration = (getRaw('ivmsConfiguration') ?? '').toString().trim()

    const phaseHours = {
      'Project Start M0': parseNum(get('phaseStartM0')),
      'Project Start M1': parseNum(get('phaseStartM1')),
      'Project Mid':      parseNum(get('phaseMid')),
      'Project End M-1':  parseNum(get('phaseEndMinus1')),
      'Project End M0':   parseNum(get('phaseEndM0')),
      'Project End M1':   parseNum(get('phaseEndM1')),
      'Project End M1+':  parseNum(get('phaseEndM1Plus')),
    }

    // Orbit handling (preferred sequence):
    // - Infer ONLY when the Orbit column is absent from Project List
    // - If Orbit column is present, never infer (even if values are blank/invalid)
    // - Invalid values are preserved as-is; downstream sets orbit multiplier = 0
    const orbitRaw = hasOrbitColumn ? getRaw('orbit') : null
    const orbitText = orbitRaw === null || orbitRaw === undefined ? null : String(orbitRaw)
    const orbitTrim = orbitText !== null ? orbitText.trim() : null
    const orbitNorm = orbitTrim ? orbitTrim.toUpperCase() : null

    let orbitSource = 'input'
    let orbit = null
    if (!hasOrbitColumn) {
      // Some workbooks compute Orbit from non-LM complexity inputs (even when Total LMs is 0).
      // We approximate Excel behavior:
      // - If complexity is missing ('-'/'') AND Total LMs is 0 → treat orbit as missing (null)
      // - Else if Total LMs > 0 → infer from LMs
      // - Else (Total LMs == 0 but complexity exists) → infer from complexity levels
      const level = (v) => {
        const s = String(v || '').trim().toLowerCase()
        if (!s || s === '-' || s === 'na' || s === 'n/a') return null
        if (s === '0' || s === 'none') return 0
        if (s === 'low') return 1
        if (s === 'medium' || s === 'med') return 2
        if (s === 'high') return 3
        return null
      }
      const lNsd = level(nonStandardData)
      const lNsm = level(nonStandardMetric)
      const lIvms = level(ivmsConfiguration)
      const hasComplexity = [lNsd, lNsm, lIvms].some(v => v !== null)

      if (totalLMs > 0) {
        orbitSource = 'inferred_column_absent'
        orbit = inferOrbitFromLMs(totalLMs)
      } else if (!hasComplexity) {
        orbitSource = 'missing_value'
        orbit = null
      } else {
        orbitSource = 'inferred_complexity'
        // Map max level to orbit tier (empirically matched to CM WIP workbook)
        const maxLevel = Math.max(lNsd ?? 0, lNsm ?? 0, lIvms ?? 0)
        orbit = maxLevel <= 0 ? 'C' : maxLevel <= 1 ? 'A' : 'B'
      }
    } else if (!orbitTrim) {
      orbitSource = 'missing_value'
      orbit = null
    } else if (!isValidOrbit(orbitNorm)) {
      orbitSource = 'invalid'
      // preserve as-is (trimmed) in schema layer
      orbit = orbitTrim
    } else {
      orbitSource = 'input'
      // preserve as-is (trimmed) in schema layer
      orbit = orbitTrim
    }

    const project = {
      // ── Identity ──
      id,
      displayId,
      rawName,
      name,
      accountName:    get('accountName') || '',

      // ── Classification ──
      vibeType:       normalizeVibeType(get('vibeType')),
      cluster:        normalizeCluster(get('cluster')),
      networkType:    normalizeNetworkType(get('networkType')),
      status:         get('status') || 'Open',

      // ── Dates ──
      startDate,
      deliveryDate:   delivDate,
      analyticsStartDate,         // used for Case 3/4 timelines (if present in Project List)
      deliveryDateExact,          // used for Analyst delivery-day proration
      startMonthIndex:    monthIndex(startDate),
      deliveryMonthIndex: monthIndex(delivDate),

      // ── Scale ──
      dxLMs,
      txLMs,
      totalLMs,
      lmMultiplier:   lmMult || deriveLmMultiplier(totalLMs),
      nonStandardData,
      nonStandardMetric,
      ivmsConfiguration,
      orbit,
      orbitRaw,
      orbitSource,

      // ── People ──
      assignedCSM:      sanitizePerson(get('assignedCSM')),
      assignedPM:       sanitizePerson(get('assignedPM')),
      assignedSE:       sanitizePerson(get('assignedSE')),
      assignedAnalyst1: sanitizePerson(get('assignedAnalyst1')),
      assignedAnalyst2: sanitizePerson(get('assignedAnalyst2')),
      analystUtilPct,

      // ── Phase hour inputs (Project List; used by Excel Q for PM) ──
      phaseHours,

      // ── Modules ──
      modules: {
        cycleTrim:   get('moduleCycleTrim') || null,
        risk:        get('moduleRisk')      || null,
        treeHealth:  get('moduleTreeHealth')|| null,
        workType:    get('moduleWorkType')  || null,
        others:      get('moduleOthers')    || null,
      },

      // ── Quality (populated by runDataQualityChecks) ──
      qualityFlags: [],

      // ── Raw row preserved for debugging ──
      _rawIndex: index,
    }

    return project
  } catch (err) {
    console.warn(`[ingest] Could not parse project row ${index}:`, err.message, row)
    return null
  }
}

/**
 * Extract the (VIBE, Orbit) multiplier table from the Demand Base Matrix sheet.
 * In the workbook, this lives in columns Y (VIBE), Z (Orbit), AA (Multiplier),
 * and is used by Excel Final Utilized Hour for CSM.
 *
 * Returns: { 'Bond__A': 1.75, ... }
 */
function extractOrbitMultipliers(wb) {
  const sheet = wb.Sheets['Demand Base Matrix']
  if (!sheet) return {}

  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null })
  const results = {}

  // 0-based indices for Y/Z/AA
  const COL_VIBE = 24
  const COL_ORBIT = 25
  const COL_MULT = 26

  for (let r = 1; r < grid.length; r++) {
    const row = grid[r] || []
    const vibe = String(row[COL_VIBE] ?? '').trim()
    const orbit = String(row[COL_ORBIT] ?? '').trim().toUpperCase()
    const multRaw = row[COL_MULT]
    if (!vibe || !orbit) continue
    if (!VIBE_TYPES.includes(vibe)) continue
    if (!['A', 'B', 'C', 'D'].includes(orbit)) continue
    const mult = parseNum(multRaw)
    if (!Number.isFinite(mult) || mult === 0) continue
    results[`${vibe}__${orbit}`] = mult
  }

  return results
}

// ─────────────────────────────────────────────────────────────────────────
// DEMAND MATRIX PARSING
// ─────────────────────────────────────────────────────────────────────────

/**
 * The Demand Base Matrix has two logical sections side by side:
 *   - Left side (cols 0–9):  task-level breakdown (stage → task → role → phase hours)
 *   - Right side (cols 13–21): VIBE-level totals (vibe → role → phase hours) ← WE USE THIS
 *
 * IMPORTANT — XLSX.js column naming vs pandas:
 *   Pandas adds ".1" suffixes for duplicate column names (e.g. "Role.1").
 *   XLSX.js sheet_to_json does NOT — it uses last-value-wins for duplicate keys.
 *   The right-side columns (Role, Project Start M0, etc.) simply overwrite the
 *   left-side columns of the same name in each row object.
 *   So row['VIBE Tag'], row['Role'], row['Project Start M0'] etc. already
 *   contain the right-side values. No suffix needed.
 */
function parseDemandMatrix(rows) {
  const results = []

  rows.forEach((row, i) => {
    // The Demand Base Matrix has duplicate column names left vs right sections.
    // In this workbook, SheetJS disambiguates duplicates by suffixing with `_1`
    // (e.g. `Role_1`, `Project Start M0_1`) instead of last-value-wins.
    // We always want the RIGHT-side VIBE-level totals.
    const vibeType = row['VIBE Tag']
    const role     = row['Role_1'] ?? row['Role.1'] ?? row['Role']

    if (!vibeType || !role) return
    if (typeof vibeType !== 'string') return
    if (!VIBE_TYPES.includes(vibeType.trim())) return
    if (!String(role).trim()) return

    const phaseVal = (name) => {
      const k1 = `${name}_1`
      const k2 = `${name}.1`
      return row[k1] ?? row[k2] ?? row[name]
    }

    const phaseHours = {
      'Project Start M0': parseNum(phaseVal('Project Start M0')),
      'Project Start M1': parseNum(phaseVal('Project Start M1')),
      'Project Mid':      parseNum(phaseVal('Project Mid')),
      'Project End M-1':  parseNum(phaseVal('Project End M-1')),
      'Project End M0':   parseNum(phaseVal('Project End M0')),
      'Project End M1':   parseNum(phaseVal('Project End M1')),
      'Project End M1+':  parseNum(phaseVal('Project End M1+')),
    }

    // Skip rows where all phase hours are zero (spacer rows in the sheet)
    const totalHours = Object.values(phaseHours).reduce((s, h) => s + (h || 0), 0)
    if (totalHours === 0) return

    results.push({
      vibeType: vibeType.trim(),
      role:     String(role).trim(),
      phaseHours,
      _rawIndex: i,
    })
  })

  return results
}

/**
 * Parse the LEFT-side task-level section of the Demand Base Matrix.
 * Shape: Customer Journey Stage → Stage → Role → phase hours.
 *
 * Note: This is used for scenario-only overrides of the PM task table ("PM multipliers").
 */
function parseDemandTasks(rows) {
  const results = []
  rows.forEach((row, i) => {
    const cj = row['Customer Journey Stage']
    const stage = row['Stage']
    const role = row['Role']
    if (!cj || !stage || !role) return
    const cjS = String(cj).trim()
    const stS = String(stage).trim()
    const rlS = String(role).trim()
    if (!cjS || !stS || !rlS) return

    const phaseHours = {
      'Project Start M0': parseNum(row['Project Start M0']),
      'Project Start M1': parseNum(row['Project Start M1']),
      'Project Mid':      parseNum(row['Project Mid']),
      'Project End M-1':  parseNum(row['Project End M-1']),
      'Project End M0':   parseNum(row['Project End M0']),
      'Project End M1':   parseNum(row['Project End M1']),
      'Project End M1+':  parseNum(row['Project End M1+']),
    }
    const totalHours = Object.values(phaseHours).reduce((s, h) => s + (h || 0), 0)
    if (totalHours === 0) return

    results.push({
      stage: cjS,          // customer journey stage label (Validate/Bond/...)
      taskStage: stS,      // task-level stage name (e.g., Discovery and App Go-Live)
      role: rlS,
      phaseHours,
      _rawIndex: i,
    })
  })
  return results
}

// ─────────────────────────────────────────────────────────────────────────
// DATA QUALITY CHECKS
// ─────────────────────────────────────────────────────────────────────────

/**
 * Runs all DQ rules against parsed projects.
 * Returns a DataQualityReport with grouped flags.
 *
 * Rules are defined in schema.js — this function only applies them.
 */
function runDataQualityChecks(projects) {
  const flags = []

  projects.forEach(project => {
    const pFlags = checkProject(project)
    project.qualityFlags = pFlags.map(f => f.ruleId)
    flags.push(...pFlags)
  })

  const errors   = flags.filter(f => f.severity === 'error')
  const warnings = flags.filter(f => f.severity === 'warning')
  const info     = flags.filter(f => f.severity === 'info')

  const affectedProjects = new Set(flags.map(f => f.entityId))

  return {
    flags,
    errors,
    warnings,
    info,
    errorCount:          errors.length,
    warningCount:        warnings.length,
    infoCount:           info.length,
    projectsWithIssues:  affectedProjects.size,
    isClean:             errors.length === 0 && warnings.length === 0,
  }
}

function checkProject(p) {
  const flags = []
  const flag = (ruleId, field, value) => {
    const rule = DATA_QUALITY_RULES[ruleId]
    if (!rule) return
    flags.push({
      ruleId,
      severity: rule.severity,
      entity:   'project',
      entityId: p.id,
      entityName: p.name,
      field,
      message:  rule.message.replace('{value}', String(value ?? '')),
      value,
      impact:   rule.impact,
    })
  }

  // ── Errors ──────────────────────────────────────────────────────────
  if (!p.deliveryDate || isNaN(p.deliveryDate?.getTime())) {
    flag('DQ-E001', 'deliveryDate', p.deliveryDate)
  }

  if (p.vibeType && !VIBE_TYPES.includes(p.vibeType)) {
    flag('DQ-E002', 'vibeType', p.vibeType)
  }

  if (p.startDate && p.deliveryDate &&
      !isNaN(p.startDate.getTime()) && !isNaN(p.deliveryDate.getTime()) &&
      p.startDate > p.deliveryDate) {
    flag('DQ-E003', 'startDate', `${fmtDate(p.startDate)} > ${fmtDate(p.deliveryDate)}`)
  }

  if (!p.lmMultiplier || p.lmMultiplier === 0) {
    flag('DQ-E004', 'lmMultiplier', p.lmMultiplier)
  }

  // ── Warnings ────────────────────────────────────────────────────────
  if (p.totalLMs === 0 || !p.totalLMs) {
    flag('DQ-W001', 'totalLMs', 0)
  }

  if (p.orbitSource === 'inferred_column_absent') {
    flag('DQ-W011', 'orbit', p.orbit)
  }

  if (p.orbitSource === 'missing_value') {
    flag('DQ-W010', 'orbit', p.orbitRaw)
  }

  if (p.orbitSource === 'invalid') {
    flag('DQ-W002', 'orbit', p.orbitRaw)
  }

  if (!p.cluster || p.cluster === 'Unknown') {
    flag('DQ-W003', 'cluster', p.cluster)
  }

  if (!p.networkType) {
    flag('DQ-W004', 'networkType', null)
  }

  if (!p.assignedPM || isUnstaffed(p.assignedPM)) {
    flag('DQ-W005', 'assignedPM', p.assignedPM)
  }

  if (!p.assignedCSM || isUnstaffed(p.assignedCSM)) {
    flag('DQ-W006', 'assignedCSM', p.assignedCSM)
  }

  if (p.startDate && p.deliveryDate) {
    const monthsDiff = monthsBetween(p.startDate, p.deliveryDate)
    if (monthsDiff > 18) {
      flag('DQ-W007', 'deliveryDate', `${monthsDiff} months`)
    }
  }

  if (p.totalLMs > 100000) {
    flag('DQ-W008', 'totalLMs', p.totalLMs)
  }

  // ── Info ─────────────────────────────────────────────────────────────
  if (p.status === 'Done') {
    flag('DQ-I001', 'status', 'Done')
  }

  const placeholderAnalysts = ['BA1', 'BA2']
  if (placeholderAnalysts.includes(p.assignedAnalyst1) ||
      placeholderAnalysts.includes(p.assignedAnalyst2)) {
    flag('DQ-I002', 'assignedAnalyst1', p.assignedAnalyst1)
  }

  // if (p.vibeType === 'Validate' && p.totalLMs === 0) {
  if (p.totalLMs === 0 || !p.totalLMs ) {
    flag('DQ-I003', 'totalLMs', 0)
  }

  return flags
}

// ─────────────────────────────────────────────────────────────────────────
// HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────

/**
 * Try column names in order; return first non-null value found.
 */
function resolveColumn(row, candidates) {
  if (!candidates) return null
  for (const col of candidates) {
    const val = row[col]
    if (val !== null && val !== undefined && val !== '') return val
  }
  return null
}

function resolveColumnRaw(row, candidates) {
  if (!candidates) return null
  for (const col of candidates) {
    if (Object.prototype.hasOwnProperty.call(row, col)) return row[col]
  }
  return null
}

function projectListHasOrbitColumn(rows) {
  if (!rows || rows.length === 0) return false
  const keys = new Set()
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    Object.keys(rows[i] || {}).forEach(k => keys.add(k))
  }
  return ['Orbit', 'orbit', 'ORBIT'].some(k => keys.has(k))
}

/**
 * Parse a value as a float. Returns 0 for null/undefined/NaN.
 */
function parseNum(val) {
  if (val === null || val === undefined || val === '') return 0
  const n = parseFloat(String(val).replace(/,/g, ''))
  return isNaN(n) ? 0 : n
}

/**
 * Parse a value as a Date. Returns null if unparseable.
 * Handles JS Date objects (from cellDates:true), date strings, and Excel serials.
 */
function parseDate(val) {
  if (val === null || val === undefined || val === '') return null

  const normalizeToMonthStart = (d) => {
    if (!(d instanceof Date) || isNaN(d.getTime())) return null
    // SheetJS Date objects are effectively UTC-based; using local getters can shift month.
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), 1)
  }

  if (val instanceof Date) return normalizeToMonthStart(val)

  if (typeof val === 'number') {
    // Excel serial date safety-net
    const d = new Date((val - 25569) * 86400 * 1000)
    return normalizeToMonthStart(d)
  }

  if (typeof val === 'string') {
    const s = val.trim()
    if (!s) return null

    // Handle "MMM-YY" (e.g. "Jan-26") as month-year, not month-day
    const mmmYY = /^([A-Za-z]{3})-(\d{2})$/.exec(s)
    if (mmmYY) {
      const monStr = mmmYY[1].toLowerCase()
      const yy = parseInt(mmmYY[2], 10)
      const monthMap = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 }
      const m = monthMap[monStr]
      if (m === undefined) return null
      const year = yy <= 79 ? 2000 + yy : 1900 + yy
      return new Date(year, m, 1)
    }

    // Handle "MMM YYYY" or "MMM-YYYY" (e.g. "Jan 2026", "Jan-2026")
    const mmmYYYY = /^([A-Za-z]{3})[ -](\d{4})$/.exec(s)
    if (mmmYYYY) {
      const monStr = mmmYYYY[1].toLowerCase()
      const year = parseInt(mmmYYYY[2], 10)
      const monthMap = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 }
      const m = monthMap[monStr]
      if (m === undefined || !Number.isFinite(year)) return null
      return new Date(year, m, 1)
    }

    // Fall back to native parsing for ISO-like strings
    return normalizeToMonthStart(new Date(s))
  }

  return null
}

/**
 * Parse a value as an exact Date (preserves day-of-month).
 * Used for Analyst delivery-day proration.
 */
function parseExactDate(val) {
  if (val === null || val === undefined || val === '') return null
  const normalizeExactUtc = (d) => {
    if (!(d instanceof Date) || isNaN(d.getTime())) return null
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  }

  if (val instanceof Date) return normalizeExactUtc(val)
  if (typeof val === 'number') {
    const d = new Date((val - 25569) * 86400 * 1000)
    return normalizeExactUtc(d)
  }
  if (typeof val === 'string') {
    const s = val.trim()
    if (!s) return null

    // Handle US-style M/D/YY or M/D/YYYY (e.g. "10/1/26", "9/20/2026")
    const mdY = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s)
    if (mdY) {
      const mm = parseInt(mdY[1], 10)
      const dd = parseInt(mdY[2], 10)
      const yyRaw = parseInt(mdY[3], 10)
      if (!Number.isFinite(mm) || !Number.isFinite(dd) || !Number.isFinite(yyRaw)) return null
      const yyyy = mdY[3].length === 2 ? (yyRaw <= 79 ? 2000 + yyRaw : 1900 + yyRaw) : yyRaw
      if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null
      return new Date(Date.UTC(yyyy, mm - 1, dd))
    }

    const d = new Date(s)
    return normalizeExactUtc(d)
  }
  return null
}

/**
 * Return 0-based month index (0=Jan) from a Date, or -1 if null/invalid.
 */
function monthIndex(date) {
  if (!date || isNaN(date.getTime())) return -1
  return date.getMonth()
}

/**
 * Strip leading bracket tags like "[2025 SaaS Y1] " from project names.
 */
function stripBracketPrefix(name) {
  return (name || '').replace(/^\[.*?\]\s*/g, '').trim()
}

/**
 * Generate a stable pseudo-ID from a name when no Jira key is present.
 */
function generateId(name) {
  return 'proj_' + name.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 40)
}

/**
 * Normalize VIBE type to canonical form.
 */
function normalizeVibeType(raw) {
  if (!raw) return null
  const s = String(raw).trim()
  const map = { bond:'Bond', validate:'Validate', integrate:'Integrate', explore:'Explore' }
  return map[s.toLowerCase()] || s
}

/**
 * Normalize cluster name.
 */
function normalizeCluster(raw) {
  if (!raw) return 'Unknown'
  const s = String(raw).trim()
  if (!s) return 'Unknown'
  return s
}

/**
 * Normalize network type string.
 */
function normalizeNetworkType(raw) {
  if (!raw) return null
  const s = String(raw).trim()
  if (!s) return null
  // Normalize various spellings
  if (s.toLowerCase().includes('both')) return 'Both (Dx & Tx)'
  if (s.toLowerCase().includes('tx'))   return 'Transmission (Tx)'
  if (s.toLowerCase().includes('dx'))   return 'Distribution (Dx)'
  return s
}

/**
 * Sanitize person name. Returns null if it's a placeholder/empty.
 */
function sanitizePerson(raw) {
  if (!raw) return null
  const s = String(raw).trim()
  if (!s || s === 'NaN') return null
  return s
}

/**
 * Derive LM multiplier from total LMs using the tier table.
 * Used when the LM Multiplier column is missing.
 */
function deriveLmMultiplier(totalLMs) {
  const lms = totalLMs || 0
  for (const tier of LM_BUCKET_MULTIPLIERS) {
    if (lms <= tier.maxLMs) return tier.multiplier
  }
  return 2.00  // above 100,000 LMs → max multiplier
}

/**
 * Infer orbit tier from LM count and VIBE type.
 * This is a rough approximation — the actual orbit is assigned manually in Excel.
 * Used only when orbit data is unavailable (Project List doesn't have orbit).
 */
function inferOrbitFromLMs(totalLMs) {
  const lms = totalLMs || 0
  if (lms >= 25000)  return 'A'
  if (lms >= 5000)   return 'B'
  if (lms >= 1000)   return 'C'
  return 'D'
}

function normalizeOrbit(val) {
  if (val === null || val === undefined || val === '') return null
  const s = String(val).trim().toUpperCase()
  return s || null
}

function isValidOrbit(orbit) {
  return ['A', 'B', 'C', 'D'].includes(String(orbit || '').toUpperCase())
}

/**
 * Check if a person name is in the unstaffed placeholder list.
 */
function isUnstaffed(name) {
  if (!name) return true
  return UNSTAFFED_PERSON_NAMES.some(u =>
    u.toLowerCase() === String(name).toLowerCase().trim()
  )
}

/**
 * Count months between two dates.
 */
function monthsBetween(start, end) {
  return (end.getFullYear() - start.getFullYear()) * 12 +
         (end.getMonth() - start.getMonth())
}

/**
 * Format a Date as "MMM YYYY" for display in messages.
 */
function fmtDate(d) {
  if (!d || isNaN(d.getTime())) return 'invalid'
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

// ─────────────────────────────────────────────────────────────────────────
// CUSTOM ERROR
// ─────────────────────────────────────────────────────────────────────────

export class IngestError extends Error {
  constructor(message) {
    super(message)
    this.name = 'IngestError'
  }
}

import * as XLSX from 'xlsx'
import { PROJECT_LIST_COLUMN_MAP, VIBE_TYPES } from './schema.js'

function safeText(s) {
  return String(s || '').trim()
}

function readWorkbook(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, {
          type: 'binary',
          cellDates: true,
          cellNF: false,
          cellStyles: false,
        })
        resolve(wb)
      } catch (err) {
        reject(new Error(`Failed to read Excel file: ${err?.message || String(err)}`))
      }
    }
    reader.onerror = () => reject(new Error('File could not be read.'))
    reader.readAsBinaryString(file)
  })
}

function headerKeysForSheet(sheet) {
  if (!sheet) return []
  // Read a small sample so we can infer header keys.
  // If there are duplicate headers, SheetJS may suffix with `_1` in object keys.
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' })
  const first = rows?.[0] || {}
  return Object.keys(first)
}

function hasAnyKey(keysSet, names) {
  for (const n of (names || [])) {
    if (keysSet.has(n)) return true
  }
  return false
}

function demandKeyCandidates(base) {
  return [base, `${base}_1`, `${base}.1`]
}

function cellText(v) {
  return String(v ?? '').trim()
}

export async function validateSparkWorkbookFile(file) {
  const wb = await readWorkbook(file)
  const foundSheets = wb?.SheetNames || []

  const issues = [] // { severity:'error'|'warning', kind, sheet, field?, message, expected?, found? }

  const needs = ['Project List', 'Demand Base Matrix']
  for (const s of needs) {
    if (!foundSheets.includes(s)) {
      issues.push({
        severity: 'error',
        kind: 'missing_sheet',
        sheet: s,
        message: `Missing required sheet: "${s}".`,
      })
    }
  }

  // If required sheets are missing, stop here (column validation depends on the sheets).
  if (issues.some(i => i.kind === 'missing_sheet')) {
    return {
      ok: false,
      issues,
      meta: { fileName: safeText(file?.name), sheetsFound: foundSheets },
    }
  }

  // ── Project List columns ────────────────────────────────────────────────
  const pl = wb.Sheets['Project List']
  const plKeys = new Set(headerKeysForSheet(pl))
  // Required for correct engine math & attribution.
  // Note: although ingest can infer orbit if column is absent, UX requires an explicit Orbit column.
  const requiredProjectFields = [
    'id',
    'rawName',
    'vibeType',
    'startDate',
    'deliveryDate',
    'status',
    'orbit',
    'networkType',
    // Analyst splitting (missing column defaults to 0 → shifts load to Analyst 2).
    'analystUtilPct',
    // PM phase hours are consumed directly from Project List in the engine.
    'phaseStartM0',
    'phaseStartM1',
    'phaseMid',
    'phaseEndMinus1',
    'phaseEndM0',
    'phaseEndM1',
    'phaseEndM1Plus',
    // Assignment columns (needed so people workload isn't treated as unstaffed due to missing columns)
    'assignedCSM',
    'assignedPM',
    'assignedAnalyst1',
    'assignedAnalyst2',
  ]

  const requireAny = [
    { group: 'LMs', sheet: 'Project List', any: ['totalLMs', 'dxLMs', 'txLMs'] },
  ]

  for (const field of requiredProjectFields) {
    const candidates = PROJECT_LIST_COLUMN_MAP[field] || []
    if (!hasAnyKey(plKeys, candidates)) {
      issues.push({
        severity: 'error',
        kind: 'missing_column',
        sheet: 'Project List',
        field,
        expected: candidates,
        message: `Missing required column for ${field} in "Project List".`,
      })
    }
  }

  for (const g of requireAny) {
    const ok = g.any.some(f => hasAnyKey(plKeys, PROJECT_LIST_COLUMN_MAP[f] || []))
    if (!ok) {
      const exp = g.any.flatMap(f => (PROJECT_LIST_COLUMN_MAP[f] || [])).filter(Boolean)
      issues.push({
        severity: 'error',
        kind: 'missing_column_group',
        sheet: g.sheet,
        field: g.group,
        expected: exp,
        message: `Missing required LMs columns in "Project List": provide "Total LMs" or both "Dx LMs" and "Tx LMs".`,
      })
    }
  }

  // ── Demand Base Matrix columns ──────────────────────────────────────────
  const dm = wb.Sheets['Demand Base Matrix']
  const dmKeys = new Set(headerKeysForSheet(dm))
  // Validate the “base” names (e.g. Role) but accept `_1` and `.1`.
  const requiredDemandBases = [
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

  for (const base of requiredDemandBases) {
    const candidates = base === 'VIBE Tag' ? [base] : demandKeyCandidates(base)
    if (!hasAnyKey(dmKeys, candidates)) {
      issues.push({
        severity: 'error',
        kind: 'missing_column',
        sheet: 'Demand Base Matrix',
        field: base,
        expected: candidates,
        message: `Missing required column "${base}" in "Demand Base Matrix".`,
      })
    }
  }

  // Orbit×VIBE multipliers are required for correct CSM final hours.
  // ingest.js expects these in columns Y/Z/AA (0-based 24/25/26).
  const grid = XLSX.utils.sheet_to_json(dm, { header: 1, raw: true, defval: null })
  const combosFound = new Set()
  for (let r = 1; r < grid.length; r++) {
    const row = grid[r] || []
    const vibe = cellText(row[24])
    const orbit = cellText(row[25]).toUpperCase()
    const multRaw = row[26]
    const mult = typeof multRaw === 'number' ? multRaw : parseFloat(String(multRaw ?? '').replace(/,/g, ''))
    if (!vibe || !orbit) continue
    if (!VIBE_TYPES.includes(vibe)) continue
    if (!['A', 'B', 'C', 'D'].includes(orbit)) continue
    if (!Number.isFinite(mult) || mult <= 0) continue
    combosFound.add(`${vibe}__${orbit}`)
  }

  const expectedCombos = []
  for (const vibe of VIBE_TYPES) for (const orbit of ['A', 'B', 'C', 'D']) expectedCombos.push(`${vibe}__${orbit}`)
  const missingCombos = expectedCombos.filter(k => !combosFound.has(k))
  if (missingCombos.length > 0) {
    issues.push({
      severity: 'error',
      kind: 'missing_orbit_multipliers',
      sheet: 'Demand Base Matrix',
      field: 'Orbit×VIBE multipliers (Y/Z/AA)',
      message: `Missing Orbit×VIBE multiplier entries in "Demand Base Matrix" (columns Y/Z/AA). Missing ${missingCombos.length} of ${expectedCombos.length} combinations.`,
      expected: missingCombos.slice(0, 12),
    })
  }

  // Helpful context in the payload (for UI).
  const meta = {
    fileName: safeText(file?.name),
    sheetsFound: foundSheets,
    projectListColumns: [...plKeys].slice(0, 80),
    demandMatrixColumns: [...dmKeys].slice(0, 80),
  }

  const ok = !issues.some(i => i.severity === 'error')
  return { ok, issues, meta }
}


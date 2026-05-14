import fs from 'node:fs'
import path from 'node:path'
import * as XLSX from 'xlsx'
import { ingestWorkbook } from '../src/engine/ingest.js'
import { runCalculations } from '../src/engine/calculate.js'
import { VIBE_PHASE_HOURS } from '../src/engine/schema.js'

const WORKBOOK_PATH = path.resolve(process.cwd(), 'public', 'default-plan.xlsx')

function die(msg) {
  console.error(msg) // eslint-disable-line no-console
  process.exit(1)
}

function keyOf(a) {
  const pid = String(a?.projectId || a?.projectName || '')
  const mi = Number(a?.monthIndex)
  const role = String(a?.role || '')
  return `${pid}__${role}__${Number.isFinite(mi) ? mi : 'na'}`
}

function toNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function buildPmMap(assignments) {
  const map = new Map()
  for (const a of Array.isArray(assignments) ? assignments : []) {
    if (String(a?.role || '').trim() !== 'PM') continue
    const k = keyOf(a)
    map.set(k, (map.get(k) || 0) + toNum(a?.finalHours))
  }
  return map
}

function diffMaps(a, b) {
  const keys = new Set([...a.keys(), ...b.keys()])
  const diffs = []
  let totalAbs = 0
  let maxAbs = 0
  for (const k of keys) {
    const av = a.get(k) || 0
    const bv = b.get(k) || 0
    const d = bv - av
    const ad = Math.abs(d)
    totalAbs += ad
    if (ad > maxAbs) maxAbs = ad
    if (ad > 0.5) diffs.push({ k, av, bv, d })
  }
  diffs.sort((x, y) => Math.abs(y.d) - Math.abs(x.d))
  return { totalAbs, maxAbs, diffs }
}

async function main() {
  if (!fs.existsSync(WORKBOOK_PATH)) die(`Missing workbook: ${WORKBOOK_PATH}`)

  const buf = fs.readFileSync(WORKBOOK_PATH)
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true })
  const ingest = ingestWorkbook(wb, { fileName: 'default-plan.xlsx', fileSize: buf.length })

  const planningYear = ingest?.meta?.planningYear || 2026
  const orbit = ingest?.orbitMultipliers || {}

  // Scenario A: engine reconstructs PM stage-hours (no Project List stage columns)
  const projectsNoPmStages = ingest.projects.map(p => ({ ...p, phaseHours: {} }))
  const reconCalc = runCalculations(projectsNoPmStages, ingest.demandMatrix, orbit, planningYear, {
    capacityConfig: null,
  })

  // Scenario B: "Excel reconstruction" using the workbook's multiplier columns (LM Multiplier + Dx/Tx + Non-standard + IVMS)
  const dmIndex = new Map()
  for (const r of Array.isArray(ingest.demandMatrix) ? ingest.demandMatrix : []) {
    const vibe = String(r?.vibeType || '').trim()
    const role = String(r?.role || '').trim()
    if (!vibe || !role) continue
    dmIndex.set(`${vibe}__${role}`, r?.phaseHours || null)
  }

  const phases = ['Project Start M0', 'Project Start M1', 'Project Mid', 'Project End M-1', 'Project End M0', 'Project End M1', 'Project End M1+']
  const projectsExcelRebuilt = ingest.projects.map(p => {
    const base =
      dmIndex.get(`${String(p?.vibeType || '').trim()}__PM`) ||
      (VIBE_PHASE_HOURS?.[p?.vibeType] || {})?.PM ||
      null
    if (!base) return p

    const mult =
      (toNum(p?.lmMultiplier) || 1) *
      (toNum(p?.dxTxMultiplier) || 1) *
      (toNum(p?.nonStandardDataMultiplier) || 1) *
      (toNum(p?.nonStandardMetricMultiplier) || 1) *
      (toNum(p?.ivmsConfigurationMultiplier) || 1)

    const phaseHours = {}
    for (const ph of phases) phaseHours[ph] = toNum(base?.[ph]) * mult
    return { ...p, phaseHours }
  })

  const expectedCalc = runCalculations(projectsExcelRebuilt, ingest.demandMatrix, orbit, planningYear, {
    capacityConfig: null,
  })

  const expectedPm = buildPmMap(expectedCalc?.assignments || [])
  const reconPm = buildPmMap(reconCalc?.assignments || [])
  const { totalAbs, maxAbs, diffs } = diffMaps(expectedPm, reconPm)

  // eslint-disable-next-line no-console
  console.log(`PM reconstruction parity vs Excel-style rebuild (multiplier columns)`)
  // eslint-disable-next-line no-console
  console.log(`- compared cells: ${new Set([...expectedPm.keys(), ...reconPm.keys()]).size}`)
  // eslint-disable-next-line no-console
  console.log(`- total abs diff: ${totalAbs.toFixed(2)}h`)
  // eslint-disable-next-line no-console
  console.log(`- max abs diff:   ${maxAbs.toFixed(2)}h`)

  if (diffs.length) {
    // eslint-disable-next-line no-console
    console.log(`\nTop diffs (>0.5h):`)
    for (const row of diffs.slice(0, 15)) {
      // eslint-disable-next-line no-console
      console.log(`- ${row.k}: baseline=${row.av.toFixed(2)}h recon=${row.bv.toFixed(2)}h diff=${row.d.toFixed(2)}h`)
    }
  }

  const TOL = 1e-6
  if (maxAbs > TOL) process.exitCode = 2
}

main().catch((e) => die(e?.stack || e?.message || String(e)))


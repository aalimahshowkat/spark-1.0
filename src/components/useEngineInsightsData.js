import { useEffect, useMemo, useState } from 'react'
import { ingestExcelFile } from '../engine/ingest.js'
import { runCalculations } from '../engine/calculate.js'
import { ATTRITION_FACTOR, FTE_COUNT, HRS_PER_PERSON_MONTH, MONTHS as MONTHS_ABBR } from '../engine/schema.js'
import { computeRosterWorkingDaysByMonth } from '../engine/workingDays.js'

function safeText(s) {
  return String(s || '').trim()
}

function clampPct(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  return Math.max(0, Math.min(100, n))
}

function buildRosterPersonMap(roster) {
  const map = new Map() // name -> { fte, baseRole }
  for (const p of Array.isArray(roster) ? roster : []) {
    const name = safeText(p?.name)
    if (!name) continue
    const roleRaw = safeText(p?.role)
    const baseRole = roleRaw === 'Analyst' ? 'Analyst 1' : roleRaw
    const f = Number(p?.fte)
    if (!Number.isFinite(f) || f <= 0) continue
    const prev = map.get(name)
    if (!prev) map.set(name, { fte: f, baseRole })
    else map.set(name, { fte: Math.max(prev.fte || 0, f), baseRole: prev.baseRole || baseRole })
  }
  return map
}

function hrsPerPersonDayFrom(capRow) {
  const bd = capRow?.businessDaysByMonth
  const mo = capRow?.hrsPerPersonMonthByMonth
  if (!Array.isArray(bd) || !Array.isArray(mo)) return null
  for (let i = 0; i < 12; i++) {
    const days = Number(bd[i])
    const hrs = Number(mo[i])
    if (!Number.isFinite(days) || days <= 0) continue
    if (!Number.isFinite(hrs)) continue
    return +(hrs / days).toFixed(1)
  }
  return null
}

function sumArr(arr) {
  return (arr || []).reduce((a, b) => a + (b || 0), 0)
}

function clampMonth(i) {
  if (!Number.isFinite(i)) return 0
  return Math.max(0, Math.min(11, i))
}

function buildEngineInsightsData(ingest, calc, capacityConfig = null) {
  const demandByRole = calc?.demandByRole || {}
  const unstaffedByRole = calc?.unstaffedHours || {}

  const getRoleArr = (role) => demandByRole[role] || new Array(12).fill(0)
  const getUnstaffedArr = (role) => unstaffedByRole[role] || new Array(12).fill(0)

  // Analyst modelling:
  // - Analyst 1 = base capacity + base demand
  // - Analyst 2 = incremental demand (does not add capacity)
  const analystDemand1 = getRoleArr('Analyst 1')
  const analystDemand2 = getRoleArr('Analyst 2')
  const analystDemandTotal = analystDemand1.map((v, i) => v + (analystDemand2[i] || 0))

  const analystUnstaffed1 = getUnstaffedArr('Analyst 1')
  const analystUnstaffed2 = getUnstaffedArr('Analyst 2')
  const analystUnstaffedTotal = analystUnstaffed1.map((v, i) => v + (analystUnstaffed2[i] || 0))

  const demand = {
    CSM: getRoleArr('CSM'),
    PM: getRoleArr('PM'),
    // Default Analyst demand should reflect base demand (Analyst 1).
    Analyst: analystDemand1,
  }

  const unassigned = {
    CSM: getUnstaffedArr('CSM'),
    PM: getUnstaffedArr('PM'),
    Analyst: analystUnstaffed1,
  }

  const cap = calc?.capacity || {}
  const roleCap = (role) => cap?.[role] || null
  const RAW_CAP = {
    // expose average monthly raw cap for legacy UI; per-month arrays below
    CSM: roleCap('CSM')?.rawMonthly || 0,
    PM: roleCap('PM')?.rawMonthly || 0,
    // Analyst pool: base capacity is Analyst 1 only.
    Analyst: roleCap('Analyst 1')?.rawMonthly || 0,
  }
  const CAPACITY = {
    CSM: {
      rawMonthlyByMonth: roleCap('CSM')?.rawMonthlyByMonth || new Array(12).fill(0),
      effectiveMonthlyByMonth: roleCap('CSM')?.effectiveMonthlyByMonth || new Array(12).fill(0),
      fte: roleCap('CSM')?.fte || 0,
      hrsPerPersonMonthByMonth: roleCap('CSM')?.hrsPerPersonMonthByMonth || new Array(12).fill(HRS_PER_PERSON_MONTH),
      businessDaysByMonth: roleCap('CSM')?.businessDaysByMonth || null,
      hrsPerPersonDay: hrsPerPersonDayFrom(roleCap('CSM')) ?? null,
    },
    PM: {
      rawMonthlyByMonth: roleCap('PM')?.rawMonthlyByMonth || new Array(12).fill(0),
      effectiveMonthlyByMonth: roleCap('PM')?.effectiveMonthlyByMonth || new Array(12).fill(0),
      fte: roleCap('PM')?.fte || 0,
      hrsPerPersonMonthByMonth: roleCap('PM')?.hrsPerPersonMonthByMonth || new Array(12).fill(HRS_PER_PERSON_MONTH),
      businessDaysByMonth: roleCap('PM')?.businessDaysByMonth || null,
      hrsPerPersonDay: hrsPerPersonDayFrom(roleCap('PM')) ?? null,
    },
    Analyst: {
      rawMonthlyByMonth: roleCap('Analyst 1')?.rawMonthlyByMonth || new Array(12).fill(0),
      effectiveMonthlyByMonth: roleCap('Analyst 1')?.effectiveMonthlyByMonth || new Array(12).fill(0),
      fte: roleCap('Analyst 1')?.fte || 0,
      hrsPerPersonMonthByMonth: roleCap('Analyst 1')?.hrsPerPersonMonthByMonth || new Array(12).fill(HRS_PER_PERSON_MONTH),
      businessDaysByMonth: roleCap('Analyst 1')?.businessDaysByMonth || null,
      hrsPerPersonDay: hrsPerPersonDayFrom(roleCap('Analyst 1')) ?? null,
    },
  }

  const annualDemand = {
    CSM: sumArr(demand.CSM),
    PM: sumArr(demand.PM),
    Analyst: sumArr(demand.Analyst),
  }

  const monthsOver = {
    CSM: demand.CSM.filter((d, i) => d > (CAPACITY.CSM.effectiveMonthlyByMonth[i] || 0)).length,
    PM: demand.PM.filter((d, i) => d > (CAPACITY.PM.effectiveMonthlyByMonth[i] || 0)).length,
    Analyst: demand.Analyst.filter((d, i) => d > (CAPACITY.Analyst.effectiveMonthlyByMonth[i] || 0)).length,
  }

  const vibeMonthly = calc?.demandByVibe || {
    Bond: new Array(12).fill(0),
    Validate: new Array(12).fill(0),
    Integrate: new Array(12).fill(0),
    Explore: new Array(12).fill(0),
  }

  const projectsRaw = ingest?.projects || []
  const vibeProjectCounts = { Bond: 0, Validate: 0, Integrate: 0, Explore: 0 }
  const statusCounts = {}
  const lmsByVibe = { Bond: 0, Validate: 0, Integrate: 0, Explore: 0 }

  for (const p of projectsRaw) {
    if (vibeProjectCounts[p.vibeType] !== undefined) vibeProjectCounts[p.vibeType]++
    statusCounts[p.status] = (statusCounts[p.status] || 0) + 1
    if (lmsByVibe[p.vibeType] !== undefined) lmsByVibe[p.vibeType] += (p.totalLMs || 0)
  }

  // People: aggregate Analyst 1/2 into a single Analyst role for Insights UX.
  const people = { CSM: [], PM: [], Analyst: [] }
  const personMap = calc?.demandByPerson || {}
  const analystPeopleBase = {}
  const analystPeopleIncremental = {}
  const agg = {}

  // Per-person capacity denominators (supports multi-role allocations).
  const rosterPeople = buildRosterPersonMap(ingest?.roster || [])
  const allocByPerson = capacityConfig?.allocationsByPerson || null
  const hasAnyAlloc = !!(allocByPerson && typeof allocByPerson === 'object' && Object.keys(allocByPerson).length > 0)
  const DEFAULT_HALF_TIME_NAME = 'Aalimah Showkat'
  const isDefaultHalfTime = (name) => safeText(name).toLowerCase() === DEFAULT_HALF_TIME_NAME.toLowerCase()

  const baseBusinessDaysByMonth = CAPACITY.CSM.businessDaysByMonth || null
  const rosterDays = computeRosterWorkingDaysByMonth({
    year: ingest?.meta?.planningYear || 2026,
    baseBusinessDaysByMonth,
    roster: ingest?.roster || [],
    workingDays: capacityConfig?.workingDays || null,
  })

  const capMonthArrForRole = (insightsRole) => {
    if (insightsRole === 'CSM') return CAPACITY.CSM.hrsPerPersonMonthByMonth
    if (insightsRole === 'PM') return CAPACITY.PM.hrsPerPersonMonthByMonth
    return CAPACITY.Analyst.hrsPerPersonMonthByMonth // Analyst = Analyst 1 capacity
  }

  const pctFor = (name, insightsRole) => {
    const rec = allocByPerson?.[name]
    const targetRole = insightsRole === 'Analyst' ? 'Analyst 1' : insightsRole
    if (rec && typeof rec === 'object') {
      const v = clampPct(rec?.roles?.[targetRole])
      return v ?? 0
    }
    // Org-wide default: treat this named person as 50% available to their roster role.
    if (isDefaultHalfTime(name)) {
      const baseRole = rosterPeople.get(name)?.baseRole
      return baseRole === targetRole ? 50 : 0
    }
    if (!hasAnyAlloc) return 100
    const baseRole = rosterPeople.get(name)?.baseRole
    return baseRole === targetRole ? 100 : 0
  }

  const isEligibleForRole = (name, insightsRole) => {
    const n = safeText(name)
    if (!n) return false
    const baseRole = rosterPeople.get(n)?.baseRole
    const targetRole = insightsRole === 'Analyst' ? 'Analyst 1' : insightsRole
    if (!hasAnyAlloc) {
      // No allocations configured: only include people in their roster role.
      return baseRole === targetRole || (insightsRole === 'Analyst' && baseRole === 'Analyst 1')
    }
    return (pctFor(n, insightsRole) || 0) > 0
  }

  const personCapMonthly = (name, insightsRole) => {
    const fte = rosterPeople.get(name)?.fte || 0
    const pct = pctFor(name, insightsRole)
    const monthArr = capMonthArrForRole(insightsRole) || new Array(12).fill(HRS_PER_PERSON_MONTH)
    const daysArr = rosterDays?.[name]?.daysByMonth || null
    const baseDays = baseBusinessDaysByMonth
    return monthArr.map((h, i) => {
      const base = Number(h) || 0
      const bd = Number(baseDays?.[i] || 0)
      const d = Number(daysArr?.[i] || 0)
      const scaled = (bd > 0 && Number.isFinite(d)) ? base * (d / bd) : base
      return scaled * fte * (pct / 100)
    })
  }

  for (const [key, row] of Object.entries(personMap)) {
    const role = row.role
    const name = row.name
    if (!name || !role) continue

    const insightsRole =
      role === 'Analyst 1' || role === 'Analyst 2' ? 'Analyst' :
      role === 'CSM' ? 'CSM' :
      role === 'PM' ? 'PM' :
      null
    if (!insightsRole) continue

    const akey = `${insightsRole}__${name}`
    if (!agg[akey]) {
      agg[akey] = { role: insightsRole, name, monthly: new Array(12).fill(0) }
    }
    for (let i = 0; i < 12; i++) agg[akey].monthly[i] += (row.monthly?.[i] || 0)

    if (role === 'Analyst 1') {
      if (!analystPeopleBase[name]) analystPeopleBase[name] = new Array(12).fill(0)
      for (let i = 0; i < 12; i++) analystPeopleBase[name][i] += (row.monthly?.[i] || 0)
    }
    if (role === 'Analyst 2') {
      if (!analystPeopleIncremental[name]) analystPeopleIncremental[name] = new Array(12).fill(0)
      for (let i = 0; i < 12; i++) analystPeopleIncremental[name][i] += (row.monthly?.[i] || 0)
    }
  }

  // Ensure every roster person appears in the role lists (even if demand is 0),
  // so the UI can show “available capacity” candidates consistently.
  for (const [name, info] of rosterPeople.entries()) {
    if (!name) continue
    for (const r of ['CSM', 'PM', 'Analyst']) {
      if (!isEligibleForRole(name, r)) continue
      const akey = `${r}__${name}`
      if (!agg[akey]) agg[akey] = { role: r, name, monthly: new Array(12).fill(0) }
    }
    // Analyst breakdown arrays (base/incremental) should include roster analysts with 0 demand.
    const baseRole = info?.baseRole
    const isAnalyst = baseRole === 'Analyst 1' || safeText(baseRole) === 'Analyst'
    if (isAnalyst) {
      if (!analystPeopleBase[name]) analystPeopleBase[name] = new Array(12).fill(0)
      if (!analystPeopleIncremental[name]) analystPeopleIncremental[name] = new Array(12).fill(0)
    }
  }
  for (const v of Object.values(agg)) {
    const total = sumArr(v.monthly)
    const capMonthly = personCapMonthly(v.name, v.role)
    const capAnnual = sumArr(capMonthly)
    const fte = rosterPeople.get(v.name)?.fte || 0
    people[v.role].push({
      name: v.name,
      fte,
      monthly: v.monthly.map(Math.round),
      total: Math.round(total),
      capacityMonthly: capMonthly.map(v => Math.round(v)),
      capacityAnnual: Math.round(capAnnual),
      allocationPct: pctFor(v.name, v.role),
    })
  }
  ;['CSM', 'PM', 'Analyst'].forEach(r => people[r].sort((a, b) => b.total - a.total))

  const enrichAnalyst = (name, monthly) => {
    const capMonthly = personCapMonthly(name, 'Analyst')
    const capAnnual = sumArr(capMonthly)
    return {
      name,
      fte: rosterPeople.get(name)?.fte || 0,
      monthly: (monthly || new Array(12).fill(0)).map(Math.round),
      total: Math.round(sumArr(monthly || [])),
      capacityMonthly: capMonthly.map(v => Math.round(v)),
      capacityAnnual: Math.round(capAnnual),
      allocationPct: pctFor(name, 'Analyst'),
    }
  }

  const analystPeople = {
    base: Object.entries(analystPeopleBase).map(([name, monthly]) => enrichAnalyst(name, monthly)).sort((a, b) => b.total - a.total),
    incremental: Object.entries(analystPeopleIncremental).map(([name, monthly]) => enrichAnalyst(name, monthly)).sort((a, b) => b.total - a.total),
  }

  // Projects list for Insights (Gantt + table)
  const projects = projectsRaw
    .filter(p => p?.name)
    .map(p => {
      const sm = clampMonth(p.startMonthIndex)
      const em = clampMonth(p.deliveryMonthIndex)
      return {
        name: p.name,
        type: p.vibeType || 'Bond',
        status: p.status || 'Open',
        start: sm,
        end: Math.max(sm, em),
        pm: p.assignedPM || '',
        csm: p.assignedCSM || '',
        lms: p.totalLMs || 0,
        multiplier: p.lmMultiplier || 1,
      }
    })

  const meta = {
    totalRows: calc?.assignments?.length || 0,
    totalProjects: projects.length,
    teamSize: Object.keys(personMap).length,
    fileName: ingest?.meta?.fileName || '',
  }

  return {
    assignments: Array.isArray(calc?.assignments) ? calc.assignments : [],
    roster: Array.isArray(ingest?.roster) ? ingest.roster : [],
    demand,
    analystDemand: {
      base: analystDemand1,
      incremental: analystDemand2,
      total: analystDemandTotal,
    },
    vibeMonthly,
    people,
    analystPeople,
    projects,
    unassigned,
    analystUnassigned: {
      base: analystUnstaffed1,
      incremental: analystUnstaffed2,
      total: analystUnstaffedTotal,
    },
    annualDemand,
    monthsOver,
    lmsByVibe,
    vibeProjectCounts,
    statusCounts,
    meta,
    // constants exposed for charts
    RAW_CAP,
    CAPACITY,
    FTE_COUNT: { CSM: CAPACITY.CSM.fte || 0, PM: CAPACITY.PM.fte || 0, Analyst: CAPACITY.Analyst.fte || 0 },
    ATTRITION: ATTRITION_FACTOR,
    HRS_PER_PERSON_MONTH: roleCap('CSM')?.hrsPerPersonMonth || HRS_PER_PERSON_MONTH,
    HRS_PER_PERSON_YEAR: (roleCap('CSM')?.hrsPerPersonMonthByMonth || new Array(12).fill(HRS_PER_PERSON_MONTH)).reduce((a, b) => a + (b || 0), 0),
    MONTHS: MONTHS_ABBR,
  }
}

export function useEngineInsightsData(uploadedFile, enabled = true) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [data, setData] = useState(null)

  const inputKey = useMemo(() => {
    if (!uploadedFile) return null
    const capKey = (() => {
      try { return JSON.stringify(uploadedFile?.capacityConfig || null) } catch { return '' }
    })()
    if (uploadedFile?.kind === 'file' && uploadedFile.file) {
      const f = uploadedFile.file
      return `file__${f.name}__${f.size}__${f.lastModified}__cap__${capKey}`
    }
    if (uploadedFile?.kind === 'ingest' && uploadedFile.ingest) {
      const m = uploadedFile.ingest?.meta || {}
      return `ingest__${m.fileName || ''}__${m.parsedAt || ''}__${m.durationMs || 0}__cap__${capKey}`
    }
    // Back-compat: a real File passed in
    if (uploadedFile instanceof File) {
      return `file__${uploadedFile.name}__${uploadedFile.size}__${uploadedFile.lastModified}__cap__${capKey}`
    }
    return null
  }, [uploadedFile])

  useEffect(() => {
    if (!enabled) return
    if (!uploadedFile) {
      setData(null)
      setError(null)
      setLoading(false)
      return
    }

    let alive = true
    setLoading(true)
    setError(null)

    const runFromIngest = (ingest) => {
      const calc = runCalculations(
        ingest.projects,
        ingest.demandMatrix,
        ingest.orbitMultipliers,
        ingest?.meta?.planningYear,
        {
          roster: ingest?.roster || [],
          capacityConfig: uploadedFile?.capacityConfig || null,
          demandTasks: ingest?.demandTasks || null,
        }
      )
      const out = buildEngineInsightsData(ingest, calc, uploadedFile?.capacityConfig || null)
      setData(out)
      setLoading(false)
    }

    // New: engine input object form
    if (uploadedFile?.kind === 'ingest' && uploadedFile.ingest) {
      Promise.resolve()
        .then(() => {
          if (!alive) return
          runFromIngest(uploadedFile.ingest)
        })
        .catch((e) => {
          if (!alive) return
          setError(e?.message || 'Failed to compute SPARK Engine insights.')
          setLoading(false)
        })
      return () => { alive = false }
    }

    if (uploadedFile?.kind === 'file' && uploadedFile.file) {
      ingestExcelFile(uploadedFile.file)
        .then((ingest) => {
          if (!alive) return
          runFromIngest(ingest)
        })
        .catch((e) => {
          if (!alive) return
          setError(e?.message || 'Failed to compute SPARK Engine insights.')
          setLoading(false)
        })
      return () => { alive = false }
    }

    // Back-compat: real File passed in
    ingestExcelFile(uploadedFile)
      .then((ingest) => {
        if (!alive) return
        runFromIngest(ingest)
      })
      .catch((e) => {
        if (!alive) return
        setError(e?.message || 'Failed to compute SPARK Engine insights.')
        setLoading(false)
      })

    return () => { alive = false }
  }, [enabled, inputKey])

  return { data, loading, error }
}


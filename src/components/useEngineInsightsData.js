import { useEffect, useMemo, useState } from 'react'
import { ingestExcelFile } from '../engine/ingest.js'
import { runCalculations } from '../engine/calculate.js'
import { ATTRITION_FACTOR, FTE_COUNT, HRS_PER_PERSON_MONTH, MONTHS as MONTHS_ABBR } from '../engine/schema.js'

function sumArr(arr) {
  return (arr || []).reduce((a, b) => a + (b || 0), 0)
}

function clampMonth(i) {
  if (!Number.isFinite(i)) return 0
  return Math.max(0, Math.min(11, i))
}

function buildEngineInsightsData(ingest, calc) {
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
    },
    PM: {
      rawMonthlyByMonth: roleCap('PM')?.rawMonthlyByMonth || new Array(12).fill(0),
      effectiveMonthlyByMonth: roleCap('PM')?.effectiveMonthlyByMonth || new Array(12).fill(0),
      fte: roleCap('PM')?.fte || 0,
      hrsPerPersonMonthByMonth: roleCap('PM')?.hrsPerPersonMonthByMonth || new Array(12).fill(HRS_PER_PERSON_MONTH),
    },
    Analyst: {
      rawMonthlyByMonth: roleCap('Analyst 1')?.rawMonthlyByMonth || new Array(12).fill(0),
      effectiveMonthlyByMonth: roleCap('Analyst 1')?.effectiveMonthlyByMonth || new Array(12).fill(0),
      fte: roleCap('Analyst 1')?.fte || 0,
      hrsPerPersonMonthByMonth: roleCap('Analyst 1')?.hrsPerPersonMonthByMonth || new Array(12).fill(HRS_PER_PERSON_MONTH),
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
  for (const v of Object.values(agg)) {
    const total = sumArr(v.monthly)
    people[v.role].push({ name: v.name, monthly: v.monthly.map(Math.round), total: Math.round(total) })
  }
  ;['CSM', 'PM', 'Analyst'].forEach(r => people[r].sort((a, b) => b.total - a.total))

  const analystPeople = {
    base: Object.entries(analystPeopleBase).map(([name, monthly]) => ({
      name,
      monthly: monthly.map(Math.round),
      total: Math.round(sumArr(monthly)),
    })).sort((a, b) => b.total - a.total),
    incremental: Object.entries(analystPeopleIncremental).map(([name, monthly]) => ({
      name,
      monthly: monthly.map(Math.round),
      total: Math.round(sumArr(monthly)),
    })).sort((a, b) => b.total - a.total),
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
    if (uploadedFile?.kind === 'file' && uploadedFile.file) {
      const f = uploadedFile.file
      return `file__${f.name}__${f.size}__${f.lastModified}`
    }
    if (uploadedFile?.kind === 'ingest' && uploadedFile.ingest) {
      const m = uploadedFile.ingest?.meta || {}
      return `ingest__${m.fileName || ''}__${m.parsedAt || ''}__${m.durationMs || 0}`
    }
    // Back-compat: a real File passed in
    if (uploadedFile instanceof File) {
      return `file__${uploadedFile.name}__${uploadedFile.size}__${uploadedFile.lastModified}`
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
      const calc = runCalculations(ingest.projects, ingest.demandMatrix, ingest.orbitMultipliers, ingest?.meta?.planningYear, { roster: ingest?.roster || [] })
      const out = buildEngineInsightsData(ingest, calc)
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


import React, { useMemo, useState } from 'react'
import { Bar } from 'react-chartjs-2'
import {
  SectionHeader,
  Card,
  CardHeader,
  CardBody,
  Grid,
  RoleSelector,
  ChartBox,
  Pill,
  Legend,
} from './ui'
import { useEngineInsightsData } from './useEngineInsightsData'
import { computePersonAvailabilityAdjustmentsByMonth } from '../engine/workingDays.js'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const ROLE_OPTIONS = ['CSM', 'PM', 'Analyst'] // Analyst = Analyst 1 + Analyst 2 combined
const DEMAND_ROLE_OPTIONS = ['All', 'CSM', 'PM', 'Analyst']
const TOP_DEMAND_N = 10

const C = {
  border: 'var(--border)',
  ink: 'var(--ink)',
  muted: 'var(--ink-muted)',
  faint: 'var(--ink-faint)',
}

function roleMatchesSet(role) {
  if (role === 'Analyst') return new Set(['Analyst 1', 'Analyst 2'])
  return new Set([role])
}

function sumArr(arr) {
  return (arr || []).reduce((a, b) => a + (b || 0), 0)
}

function safeNum(n) {
  const x = typeof n === 'number' ? n : parseFloat(n)
  return Number.isFinite(x) ? x : 0
}

function roleBucket(role) {
  if (role === 'Analyst 1' || role === 'Analyst 2') return 'Analyst'
  return role
}

function formatRoleTotals(t) {
  if (!t) return ''
  const parts = []
  if ((t.CSM || 0) > 0) parts.push(`CSM ${Math.round(t.CSM).toLocaleString()}h`)
  if ((t.PM || 0) > 0) parts.push(`PM ${Math.round(t.PM).toLocaleString()}h`)
  if ((t.Analyst || 0) > 0) parts.push(`Analyst ${Math.round(t.Analyst).toLocaleString()}h`)
  return parts.join(' · ')
}

export default function WorkloadExplorerView({ engineInput, engineCalc }) {
  const { data: insightsData, loading: insightsLoading, error: insightsError } =
    useEngineInsightsData(engineInput, !!engineInput)

  const assignments = engineCalc?.assignments || []
  const planningYear = engineInput?.ingest?.meta?.planningYear || engineInput?.meta?.planningYear || 2026

  // Project-level totals across all roles (for “demand for completion”)
  const projectRoleTotals = useMemo(() => {
    const out = new Map()
    for (const row of assignments) {
      const key = row?.projectId || row?.projectName
      if (!key) continue
      const hrs = safeNum(row?.finalHours)
      if (hrs <= 0) continue

      if (!out.has(key)) out.set(key, { total: 0, CSM: 0, PM: 0, Analyst: 0 })
      const rec = out.get(key)
      rec.total += hrs
      const b = roleBucket(row?.role)
      if (b in rec) rec[b] += hrs
    }
    return out
  }, [assignments])

  const [role, setRole] = useState('CSM')
  const [person, setPerson] = useState('')
  const [demandRole, setDemandRole] = useState('All')
  const [showTopDemand, setShowTopDemand] = useState(false)
  const [showCollab, setShowCollab] = useState(false)
  const [collabView, setCollabView] = useState('pm_analyst') // future: pm_csm, csm_analyst
  const [collabPmQ, setCollabPmQ] = useState('')
  const [collabAnalystQ, setCollabAnalystQ] = useState('')
  const [collabPeriod, setCollabPeriod] = useState('monthly') // 'monthly' | 'annual'
  const [collabMonthIndex, setCollabMonthIndex] = useState(0)
  const [portfolioQuery, setPortfolioQuery] = useState('')
  const [demandQuery, setDemandQuery] = useState('')

  const roleMatches = useMemo(() => roleMatchesSet(role), [role])
  const demandRoleMatches = useMemo(() => {
    if (demandRole === 'All') return new Set(['CSM', 'PM', 'Analyst 1', 'Analyst 2'])
    if (demandRole === 'Analyst') return new Set(['Analyst 1', 'Analyst 2'])
    return new Set([demandRole])
  }, [demandRole])

  const roleRows = useMemo(() => {
    return assignments.filter(r => roleMatches.has(r.role))
  }, [assignments, roleMatches])

  const peopleOptions = useMemo(() => {
    const set = new Set()
    // Include roster people even when they have 0 demand, so planners can select
    // newly-added capacity and see “0 workload” (available) states.
    const roster = insightsData?.roster || engineInput?.ingest?.roster || engineInput?.roster || []
    const rosterMatch = (r) => {
      const rr = String(r?.role || '').trim()
      if (!rr) return false
      if (role === 'Analyst') return rr === 'Analyst' || rr === 'Analyst 1' || rr === 'Analyst 2'
      return rr === role
    }
    for (const r of Array.isArray(roster) ? roster : []) {
      if (!rosterMatch(r)) continue
      const n = String(r?.name || '').trim()
      if (n) set.add(n)
    }
    for (const r of roleRows) {
      if (r?.isUnstaffed) continue
      const p = String(r?.person || '').trim()
      if (!p) continue
      set.add(p)
    }
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [roleRows, role, insightsData?.roster, engineInput])

  const effectivePerson = useMemo(() => {
    const p = String(person || '').trim()
    if (!p) return peopleOptions[0] || ''
    return peopleOptions.includes(p) ? p : ''
  }, [person, peopleOptions])

  const availabilityAdj = useMemo(() => {
    if (!effectivePerson) return null
    return computePersonAvailabilityAdjustmentsByMonth({
      year: planningYear,
      personName: effectivePerson,
      workingDays: engineInput?.capacityConfig?.workingDays || null,
    })
  }, [effectivePerson, planningYear, engineInput?.capacityConfig?.workingDays])

  const availabilitySummary = useMemo(() => {
    if (!effectivePerson) return null
    const roleSet = roleMatches
    const ptoRemovedDays = sumArr(availabilityAdj?.removedByKind?.pto || [])
    const nonProjectRemovedDays = sumArr(availabilityAdj?.removedByKind?.non_project || [])
    const weekendAddedDays = sumArr(availabilityAdj?.addedWeekendDaysByMonth || [])

    let unallocatedHours = 0
    const unallocProjects = new Set()
    let backfillReceivedHours = 0
    const backfillReceivedProjects = new Set()
    const backfillReceivedByProject = new Map()
    let backfillMovedAwayHours = 0
    const backfillMovedAwayProjects = new Set()
    const backfillMovedAwayByProject = new Map()

    for (const r of assignments) {
      if (!r || !roleSet.has(r.role)) continue
      const h = safeNum(r.finalHours)
      if (h <= 0) continue
      const projKey = r.projectId || r.projectName || ''
      const projName = String(r.projectName || '').trim() || projKey || '(unknown project)'

      if (r.isUnstaffed && r.unstaffedReason === 'availability' && String(r.sourcePerson || '').trim() === effectivePerson) {
        unallocatedHours += h
        if (projKey) unallocProjects.add(projKey)
      }

      if (!r.isUnstaffed && r.reassignmentReason === 'backfill' && String(r.person || '').trim() === effectivePerson) {
        backfillReceivedHours += h
        if (projKey) backfillReceivedProjects.add(projKey)
        backfillReceivedByProject.set(projName, (backfillReceivedByProject.get(projName) || 0) + h)
      }

      if (r.reassignmentReason === 'backfill' && String(r.backfillFrom || '').trim() === effectivePerson) {
        backfillMovedAwayHours += h
        if (projKey) backfillMovedAwayProjects.add(projKey)
        backfillMovedAwayByProject.set(projName, (backfillMovedAwayByProject.get(projName) || 0) + h)
      }
    }

    const topPairs = (m, n = 4) => {
      const arr = [...m.entries()].map(([k, v]) => ({ project: k, hours: v }))
        .sort((a, b) => (b.hours || 0) - (a.hours || 0))
      return { top: arr.slice(0, n), more: Math.max(0, arr.length - n) }
    }
    const recv = topPairs(backfillReceivedByProject)
    const moved = topPairs(backfillMovedAwayByProject)

    return {
      ptoRemovedDays,
      nonProjectRemovedDays,
      weekendAddedDays,
      unallocatedHours,
      unallocProjectCount: unallocProjects.size,
      backfillReceivedHours,
      backfillReceivedProjectCount: backfillReceivedProjects.size,
      backfillReceivedTop: recv.top,
      backfillReceivedMore: recv.more,
      backfillMovedAwayHours,
      backfillMovedAwayProjectCount: backfillMovedAwayProjects.size,
      backfillMovedAwayTop: moved.top,
      backfillMovedAwayMore: moved.more,
    }
  }, [effectivePerson, roleMatches, availabilityAdj, assignments])

  const hasPeopleForRole = peopleOptions.length > 0
  const typedPerson = String(person || '').trim()
  const isTypedPersonValid = !typedPerson ? true : peopleOptions.includes(typedPerson)
  const showNoMatch = !!typedPerson && !isTypedPersonValid

  const personRows = useMemo(() => {
    if (!effectivePerson) return []
    return roleRows.filter(r =>
      !r?.isUnstaffed &&
      String(r?.person || '').trim() === effectivePerson &&
      safeNum(r?.finalHours) > 0
    )
  }, [roleRows, effectivePerson])

  // Map projectName -> metadata (from insightsData projects list)
  const projectMetaByName = useMemo(() => {
    const map = new Map()
    for (const p of (insightsData?.projects || [])) {
      const name = String(p?.name || '').trim()
      if (!name) continue
      if (!map.has(name)) map.set(name, p)
    }
    return map
  }, [insightsData])

  // (Intentionally removed) "Projects with unallocated demand (missing assignment)" section
  // will be reintroduced once roster/project name normalization is finalized.

  const topDemandProjects = useMemo(() => {
    const byProject = new Map()

    for (const row of assignments) {
      if (!demandRoleMatches.has(row?.role)) continue
      const key = row?.projectId || row?.projectName
      if (!key) continue
      const name = String(row?.projectName || '').trim() || '(unnamed)'
      const mi = Number.isFinite(+row?.monthIndex) ? +row.monthIndex : 0
      const hrs = safeNum(row?.finalHours)
      if (hrs <= 0) continue

      if (!byProject.has(key)) {
        const meta = projectMetaByName.get(name)
        byProject.set(key, {
          key,
          name,
          type: meta?.type || row?.vibeType || 'Bond',
          status: meta?.status || '—',
          monthly: new Array(12).fill(0),
          total: 0,
        })
      }

      const rec = byProject.get(key)
      rec.monthly[mi] += hrs
      rec.total += hrs
    }

    const q = String(demandQuery || '').trim().toLowerCase()
    const rows = [...byProject.values()]
      .filter(p => {
        if (!q) return true
        return String(p?.name || '').toLowerCase().includes(q)
      })
      .sort((a, b) => b.total - a.total)
    const maxTotal = rows[0]?.total || 0

    return {
      rows: rows.slice(0, TOP_DEMAND_N),
      maxTotal,
      totalWithDemand: byProject.size,
      totalMatched: rows.length,
    }
  }, [assignments, demandRoleMatches, projectMetaByName, demandQuery])

  // Group to: projectKey -> { name, type, status, start, end, monthly[12], total, hasAnalyst2 }
  const projectsForPerson = useMemo(() => {
    const byProject = new Map()

    for (const row of personRows) {
      const key = row?.projectId || row?.projectName
      const name = String(row?.projectName || '').trim() || '(unnamed)'
      if (!key) continue

      if (!byProject.has(key)) {
        const meta = projectMetaByName.get(name)
        byProject.set(key, {
          key,
          projectId: row?.projectId || null,
          name,
          type: meta?.type || row?.vibeType || 'Bond',
          status: meta?.status || '—',
          start: Number.isFinite(+meta?.start) ? +meta.start : null,
          end: Number.isFinite(+meta?.end) ? +meta.end : null,
          monthly: new Array(12).fill(0),
          total: 0,
          hasAnalyst2: false,
        })
      }

      const rec = byProject.get(key)
      const mi = Number.isFinite(+row?.monthIndex) ? +row.monthIndex : 0
      rec.monthly[mi] += safeNum(row?.finalHours)
      rec.total += safeNum(row?.finalHours)
      if (role === 'Analyst' && row?.role === 'Analyst 2' && safeNum(row?.finalHours) > 0) {
        rec.hasAnalyst2 = true
      }
    }

    const out = [...byProject.values()]
      .filter(p => p.total > 0)
      .map(p => {
        // For workload: the timeline should reflect months that actually carry hours.
        // If project list meta exists, we expand to include it (never shrink staffed months).
        const first = p.monthly.findIndex(v => (v || 0) > 0)
        const last = (() => {
          for (let i = p.monthly.length - 1; i >= 0; i--) if ((p.monthly[i] || 0) > 0) return i
          return -1
        })()

        const staffedStart = first >= 0 ? first : 0
        const staffedEnd = last >= 0 ? last : staffedStart

        const metaStart = Number.isFinite(p.start) ? p.start : staffedStart
        const metaEnd = Number.isFinite(p.end) ? p.end : staffedEnd

        const s = Math.min(staffedStart, metaStart)
        const e = Math.max(staffedEnd, metaEnd)

        return { ...p, start: s, end: Math.max(s, e) }
      })
      .sort((a, b) => b.total - a.total)

    return out
  }, [personRows, role, projectMetaByName])

  const pmAnalystMatrix = useMemo(() => {
    if (!showCollab) return { months: [], monthIndex: null, pmList: [], analystList: [], cell: new Map(), projectNameByKey: new Map() }

    const scopeProjectKeys = new Set()
    for (const a of assignments) {
      const key = a?.projectId || a?.projectName
      if (key) scopeProjectKeys.add(key)
    }
    const projectKeyInScope = (k) => !!k && scopeProjectKeys.has(k)
    const projectNameByKey = new Map()
    for (const a of assignments) {
      const key = a?.projectId || a?.projectName
      if (!projectKeyInScope(key)) continue
      const name = String(a?.projectName || '').trim() || '(unnamed)'
      if (!projectNameByKey.has(key)) projectNameByKey.set(key, name)
    }

    // Determine which months actually have both PM + Analyst on the same project in-scope.
    const monthsWithAny = new Set()

    // projectKey__monthIndex -> { pm:Set, analyst:Set }
    const byProjectMonth = new Map()
    const add = (key, mi, bucket, name) => {
      const k = `${key}__${mi}`
      if (!byProjectMonth.has(k)) byProjectMonth.set(k, { projectKey: key, monthIndex: mi, pm: new Set(), analyst: new Set() })
      const rec = byProjectMonth.get(k)
      if (bucket === 'PM') rec.pm.add(name)
      if (bucket === 'Analyst') rec.analyst.add(name)
    }

    // hoursBy (projectKey, monthIndex, bucket, person) for totals
    const hoursBy = new Map()
    const addHours = (key, mi, bucket, name, hrs) => {
      const k = `${key}__${mi}__${bucket}__${name}`
      hoursBy.set(k, (hoursBy.get(k) || 0) + hrs)
    }

    for (const a of assignments) {
      if (!a || a.isUnstaffed) continue
      const hrs = safeNum(a?.finalHours)
      if (hrs <= 0) continue
      const key = a?.projectId || a?.projectName
      if (!projectKeyInScope(key)) continue
      const mi = Number.isFinite(+a?.monthIndex) ? +a.monthIndex : null
      if (mi === null || mi < 0 || mi > 11) continue

      const bucket = roleBucket(a?.role)
      if (bucket !== 'PM' && bucket !== 'Analyst') continue

      const name = String(a?.person || '').trim()
      if (!name) continue
      add(key, mi, bucket, name)
      addHours(key, mi, bucket, name, hrs)
    }

    for (const rec of byProjectMonth.values()) {
      if (rec.pm.size && rec.analyst.size) monthsWithAny.add(rec.monthIndex)
    }

    const months = [...monthsWithAny].sort((a, b) => a - b)
    if (months.length === 0) {
      return { months: [], monthIndex: null, pmList: [], analystList: [], cell: new Map(), projectNameByKey }
    }

    // Keep selection stable: if current month has no data, snap to first month with data.
    const monthIndex = months.includes(collabMonthIndex) ? collabMonthIndex : months[0]
    const effectiveMonthIndex = collabPeriod === 'annual' ? null : monthIndex

    const buildCells = (targetMonthIndex) => {
      const pmTotals = new Map()
      const analystTotals = new Map()

      // pm__analyst -> { projects: Map(projectKey -> { name, pmHours, analystHours }) }
      const cell = new Map()
      const ensureCell = (pm, analyst) => {
        const k = `${pm}__${analyst}`
        if (!cell.has(k)) cell.set(k, { pm, analyst, projects: new Map(), pmHours: 0, analystHours: 0 })
        return cell.get(k)
      }

      for (const rec of byProjectMonth.values()) {
        if (!rec.pm.size || !rec.analyst.size) continue
        if (targetMonthIndex !== null && rec.monthIndex !== targetMonthIndex) continue

        const mi = rec.monthIndex
        const projectKey = rec.projectKey
        const projectName = projectNameByKey.get(projectKey) || '(unnamed)'

        for (const pm of rec.pm) {
          const pmH = hoursBy.get(`${projectKey}__${mi}__PM__${pm}`) || 0
          pmTotals.set(pm, (pmTotals.get(pm) || 0) + pmH)
          for (const an of rec.analyst) {
            const anH = hoursBy.get(`${projectKey}__${mi}__Analyst__${an}`) || 0
            analystTotals.set(an, (analystTotals.get(an) || 0) + anH)

            const c = ensureCell(pm, an)
            if (!c.projects.has(projectKey)) c.projects.set(projectKey, { key: projectKey, name: projectName, pmHours: 0, analystHours: 0 })
            const pRec = c.projects.get(projectKey)
            pRec.pmHours += pmH
            pRec.analystHours += anH
            c.pmHours += pmH
            c.analystHours += anH
          }
        }
      }

      const pmList = [...pmTotals.entries()]
        .sort((a, b) => (b[1] || 0) - (a[1] || 0))
        .map(([name]) => name)
      const analystList = [...analystTotals.entries()]
        .sort((a, b) => (b[1] || 0) - (a[1] || 0))
        .map(([name]) => name)

      return { pmList, analystList, cell }
    }

    const built = buildCells(effectiveMonthIndex)
    return { months, monthIndex: effectiveMonthIndex, pmList: built.pmList, analystList: built.analystList, cell: built.cell, projectNameByKey }
  }, [assignments, collabMonthIndex, collabPeriod, showCollab])

  const exportPmAnalystCsv = () => {
    if (!pmAnalystMatrix?.months?.length) return
    const monthIndex = pmAnalystMatrix.monthIndex

    const norm = (s) => String(s || '').trim().toLowerCase()
    const pmQ = norm(collabPmQ)
    const anQ = norm(collabAnalystQ)
    const pmList = (pmAnalystMatrix.pmList || []).filter(n => !pmQ || norm(n).includes(pmQ))
    const analystList = (pmAnalystMatrix.analystList || []).filter(n => !anQ || norm(n).includes(anQ))

    const esc = (v) => {
      const s = String(v ?? '')
      const needs = s.includes(',') || s.includes('"') || s.includes('\n')
      const out = s.replace(/\"/g, '\"\"')
      return needs ? `"${out}"` : out
    }

    const lines = []
    const title = (monthIndex === null || monthIndex === undefined)
      ? `Annual ${planningYear}`
      : `Month ${MONTHS[monthIndex]} ${planningYear}`
    lines.push([title, ...pmList].map(esc).join(','))

    for (const an of analystList) {
      const row = [an]
      for (const pm of pmList) {
        const k = `${pm}__${an}`
        const cell = pmAnalystMatrix.cell.get(k) || null
        const projects = cell ? [...cell.projects.values()] : []
        projects.sort((a, b) => ((b.analystHours + b.pmHours) || 0) - ((a.analystHours + a.pmHours) || 0))
        const count = projects.length
        if (!count) { row.push(''); continue }
        const names = projects.map(p => p.name).slice(0, 12)
        const more = count > 12 ? count - 12 : 0
        const total = Math.round((cell?.analystHours || 0) + (cell?.pmHours || 0))
        row.push(`${count} projects · ${total}h · ${names.join('; ')}${more ? `; +${more} more` : ''}`)
      }
      lines.push(row.map(esc).join(','))
    }

    const csv = lines.join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = (monthIndex === null || monthIndex === undefined)
      ? `spark_collaboration_pm_analyst_${planningYear}_annual.csv`
      : `spark_collaboration_pm_analyst_${planningYear}_${String((monthIndex + 1)).padStart(2, '0')}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => { try { URL.revokeObjectURL(url) } catch {} }, 250)
  }

  const monthlyTotals = useMemo(() => {
    const tot = new Array(12).fill(0)
    for (const p of projectsForPerson) {
      for (let i = 0; i < 12; i++) tot[i] += (p.monthly[i] || 0)
    }
    return tot
  }, [projectsForPerson])

  const overlapMonths = useMemo(() => {
    const activeCounts = new Array(12).fill(0)
    for (const p of projectsForPerson) {
      for (let i = 0; i < 12; i++) if ((p.monthly[i] || 0) > 0) activeCounts[i]++
    }
    return MONTHS.map((m, i) => ({
      month: m,
      monthIndex: i,
      projectsActive: activeCounts[i],
      totalHours: monthlyTotals[i] || 0,
    }))
      .filter(r => r.projectsActive >= 2)
      .sort((a, b) => b.totalHours - a.totalHours)
      .slice(0, 5)
  }, [projectsForPerson, monthlyTotals])

  const explainPeak = useMemo(() => {
    if (!projectsForPerson.length) return null

    let peakIdx = 0
    let peakVal = -1
    for (let i = 0; i < 12; i++) {
      const v = monthlyTotals[i] || 0
      if (v > peakVal) { peakVal = v; peakIdx = i }
    }
    if (peakVal <= 0) return null

    const byProject = projectsForPerson
      .map(p => ({ key: p.key, name: p.name, hours: p.monthly[peakIdx] || 0, hasAnalyst2: p.hasAnalyst2 }))
      .filter(x => x.hours > 0)
      .sort((a, b) => b.hours - a.hours)

    const topK = byProject.slice(0, 3)
    const sumTopK = sumArr(topK.map(x => x.hours))
    const pct = Math.round((sumTopK / peakVal) * 100)

    return {
      month: MONTHS[peakIdx],
      monthIndex: peakIdx,
      total: peakVal,
      pct,
      topK,
    }
  }, [projectsForPerson, monthlyTotals])

  function colorForProject(name, alpha = 0.65) {
    const s = String(name || '')
    let h = 0
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
    const hue = h % 360
    // Balanced palette: readable on light background.
    const sat = 72
    const light = 52
    return `hsla(${hue} ${sat}% ${light}% / ${alpha})`
  }

  const stackedChart = useMemo(() => {
    const TOP_N = 10
    const sorted = [...projectsForPerson].sort((a, b) => b.total - a.total)
    const top = sorted.slice(0, TOP_N)
    const rest = sorted.slice(TOP_N)

    const otherMonthly = new Array(12).fill(0)
    for (const p of rest) for (let i = 0; i < 12; i++) otherMonthly[i] += (p.monthly[i] || 0)

    const datasets = top.map((p, idx) => ({
      label: p.name,
      data: p.monthly.map(v => Math.round(v || 0)),
      backgroundColor: colorForProject(p.name, 0.70),
      stack: 'hours',
      borderWidth: 0,
      borderRadius: 3,
    }))

    if (rest.length) {
      datasets.push({
        label: 'Other',
        data: otherMonthly.map(v => Math.round(v || 0)),
        backgroundColor: 'rgba(148,163,184,0.45)',
        stack: 'hours',
        borderWidth: 0,
        borderRadius: 3,
      })
    }

    return { labels: MONTHS, datasets }
  }, [projectsForPerson])

  const allProjects = insightsData?.projects || []
  const filteredPortfolioProjects = useMemo(() => {
    const q = String(portfolioQuery || '').trim().toLowerCase()
    if (!q) return allProjects
    return (allProjects || []).filter(p => String(p?.name || '').toLowerCase().includes(q))
  }, [allProjects, portfolioQuery])

  return (
    <div style={{ animation: 'fadeUp 0.22s ease both' }}>
      <SectionHeader
        title="Workload Explorer"
        subtitle="Trace why someone is busy: project timelines, overlaps, and month-by-month drivers"
      />

      {!engineInput && (
        <div style={{ padding: 20, color: 'var(--ink-muted)' }}>
          Load a plan to explore workload drivers.
        </div>
      )}

      {engineInput && (insightsLoading || !engineCalc) && (
        <div style={{ padding: 20, color: 'var(--ink-muted)' }}>
          Computing workload data…
        </div>
      )}

      {engineInput && insightsError && (
        <div style={{ padding: 20, color: 'var(--red)' }}>{insightsError}</div>
      )}

      {/* Portfolio timeline */}
      {!!allProjects.length && (
        <Card style={{ marginBottom: 16 }}>
          <CardHeader
            title="All Projects Timeline"
            tag={`${filteredPortfolioProjects.length} shown · ${allProjects.length} total`}
          >
            <input
              value={portfolioQuery}
              onChange={(e) => setPortfolioQuery(e.target.value)}
              placeholder="Search projects…"
              style={{
                padding: '6px 10px',
                borderRadius: 8,
                border: `1px solid ${C.border}`,
                background: 'white',
                fontSize: 12,
                fontFamily: 'var(--font-sans)',
                outline: 'none',
                width: 220,
              }}
            />
          </CardHeader>
          <CardBody>
            <GanttChart projects={filteredPortfolioProjects} />
            <Legend items={[
              { label: 'Bond',      color: '#2857a4' },
              { label: 'Validate',  color: '#2a7a52' },
              { label: 'Integrate', color: '#c84b31' },
              { label: 'Explore',   color: '#c47b1a' },
            ]} />
          </CardBody>
        </Card>
      )}

      {/* Top demand projects (collapsible) */}
      {!!allProjects.length && (
        <Card style={{ marginBottom: 16 }}>
          <CardHeader
            title="Top demand projects"
            tag={`Top ${TOP_DEMAND_N} by demand`}
          >
            <button
              onClick={() => setShowTopDemand(v => !v)}
              style={{
                padding: '6px 10px',
                borderRadius: 8,
                border: `1px solid ${C.border}`,
                background: 'white',
                fontSize: 12,
                fontFamily: 'var(--font-sans)',
                cursor: 'pointer',
              }}
              title={showTopDemand ? 'Collapse' : 'Expand'}
            >
              {showTopDemand ? 'Hide' : 'Show'}
            </button>
          </CardHeader>
          {showTopDemand && (
            <CardBody>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 11.5, color: C.muted, fontWeight: 800, letterSpacing: '0.02em' }}>
                  Role
                </div>
                <select
                  value={demandRole}
                  onChange={(e) => setDemandRole(e.target.value)}
                  style={{
                    padding: '7px 10px',
                    borderRadius: 8,
                    border: `1px solid ${C.border}`,
                    background: 'white',
                    fontSize: 12,
                    fontFamily: 'var(--font-sans)',
                    cursor: 'pointer',
                    outline: 'none',
                  }}
                >
                  {DEMAND_ROLE_OPTIONS.map(r => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>

                <input
                  value={demandQuery}
                  onChange={(e) => setDemandQuery(e.target.value)}
                  placeholder="Search projects…"
                  style={{
                    padding: '7px 10px',
                    borderRadius: 8,
                    border: `1px solid ${C.border}`,
                    background: 'white',
                    fontSize: 12,
                    fontFamily: 'var(--font-sans)',
                    outline: 'none',
                    width: 220,
                  }}
                />

                <div style={{ marginLeft: 'auto', fontSize: 11.5, color: C.faint }}>
                  {topDemandProjects.totalWithDemand
                    ? `${topDemandProjects.totalWithDemand} with demand · ${allProjects.length} total`
                    : `— · ${allProjects.length} total`}
                </div>
              </div>

              {topDemandProjects.rows.length ? (
                <div style={{ maxHeight: 320, overflow: 'auto', paddingRight: 6 }}>
                  {topDemandProjects.rows.map(p => {
                    const pct = topDemandProjects.maxTotal ? (p.total / topDemandProjects.maxTotal) : 0
                    const peak = (() => {
                      let idx = 0, best = -1
                      for (let i = 0; i < 12; i++) {
                        const v = p.monthly[i] || 0
                        if (v > best) { best = v; idx = i }
                      }
                      return { idx, val: best }
                    })()

                    const VIBE_COLORS = {
                      Bond: '#2857a4',
                      Validate: '#2a7a52',
                      Integrate: '#c84b31',
                      Explore: '#c47b1a',
                    }
                    const vibeColor = VIBE_COLORS[p.type] || '#888'
                    const demandForCompletion = projectRoleTotals.get(p.key)
                    const demandForCompletionText = formatRoleTotals(demandForCompletion)

                    return (
                      <div key={p.key} style={{ padding: '8px 0', borderBottom: '1px solid var(--paper-warm)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ width: 9, height: 9, borderRadius: 3, background: vibeColor, flexShrink: 0 }} />
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontSize: 12.5, fontWeight: 650, color: C.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {p.name}
                            </div>
                            <div style={{ fontSize: 11.5, color: C.faint }}>
                              {p.type} · Peak: {MONTHS[peak.idx]} {Math.round(peak.val).toLocaleString()}h
                            </div>
                            {!!demandForCompletionText && (
                              <div style={{ fontSize: 11.5, color: C.faint }}>
                                All roles: {demandForCompletionText}
                              </div>
                            )}
                          </div>
                          <div style={{ fontSize: 12, fontWeight: 800, color: C.ink, flexShrink: 0 }}>
                            {Math.round(p.total).toLocaleString()}h
                          </div>
                        </div>
                        <div style={{ marginTop: 6, height: 8, background: 'var(--surface-1)', borderRadius: 99, overflow: 'hidden' }}>
                          <div style={{ width: `${Math.max(0.06, pct) * 100}%`, height: '100%', background: vibeColor, opacity: 0.85 }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div style={{ padding: '16px 0', color: C.faint, fontSize: 12.5 }}>
                  {demandQuery ? 'No projects match your search.' : 'No demand found for this selection.'}
                </div>
              )}
            </CardBody>
          )}
        </Card>
      )}

      {/* Collaboration mapping (collapsible) */}
      {engineInput && (
        <Card style={{ marginBottom: 16 }}>
          <CardHeader
            title="Collaboration mapping"
            tag="PM × Analyst"
          >
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <Pill type="amber">New</Pill>
              <button
                onClick={() => setShowCollab(v => !v)}
                style={{
                  padding: '6px 10px',
                  borderRadius: 8,
                  border: `1px solid ${C.border}`,
                  background: 'white',
                  fontSize: 12,
                  fontFamily: 'var(--font-sans)',
                  cursor: 'pointer',
                }}
                title={showCollab ? 'Collapse' : 'Expand'}
              >
                {showCollab ? 'Hide' : 'Show'}
              </button>
            </div>
          </CardHeader>
          {showCollab && (
            <CardBody>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
                <div style={{ fontSize: 11.5, color: C.muted, fontWeight: 800, letterSpacing: '0.02em' }}>
                  View
                </div>
                <select
                  value={collabView}
                  onChange={(e) => setCollabView(e.target.value)}
                  style={{
                    padding: '7px 10px',
                    borderRadius: 8,
                    border: `1px solid ${C.border}`,
                    background: 'white',
                    fontSize: 12,
                    fontFamily: 'var(--font-sans)',
                    cursor: 'pointer',
                    outline: 'none',
                  }}
                >
                  <option value="pm_analyst">PM × Analyst</option>
                </select>

                <input
                  value={collabPmQ}
                  onChange={(e) => setCollabPmQ(e.target.value)}
                  placeholder="Search PM…"
                  style={{
                    padding: '7px 10px',
                    borderRadius: 8,
                    border: `1px solid ${C.border}`,
                    background: 'white',
                    fontSize: 12,
                    fontFamily: 'var(--font-sans)',
                    outline: 'none',
                    width: 200,
                  }}
                />
                <input
                  value={collabAnalystQ}
                  onChange={(e) => setCollabAnalystQ(e.target.value)}
                  placeholder="Search Analyst…"
                  style={{
                    padding: '7px 10px',
                    borderRadius: 8,
                    border: `1px solid ${C.border}`,
                    background: 'white',
                    fontSize: 12,
                    fontFamily: 'var(--font-sans)',
                    outline: 'none',
                    width: 200,
                  }}
                />

                <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button
                    onClick={() => exportPmAnalystCsv()}
                    style={{
                      padding: '7px 10px',
                      borderRadius: 8,
                      border: `1px solid ${C.border}`,
                      background: 'white',
                      fontSize: 12,
                      fontFamily: 'var(--font-sans)',
                      cursor: pmAnalystMatrix.months.length ? 'pointer' : 'not-allowed',
                      opacity: pmAnalystMatrix.months.length ? 1 : 0.6,
                    }}
                    title={pmAnalystMatrix.months.length ? 'Export as CSV' : 'No collaboration data to export'}
                    disabled={!pmAnalystMatrix.months.length}
                  >
                    Export CSV
                  </button>
                </div>
              </div>

              {pmAnalystMatrix.months.length === 0 ? (
                <div style={{ fontSize: 12.5, color: C.faint, lineHeight: 1.6 }}>
                  No PM↔Analyst collaboration detected. (This section lights up when a PM and an Analyst share the same project in the same month.)
                </div>
              ) : (
                <div style={{ display: 'grid', gap: 10 }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ fontSize: 11, fontWeight: 950, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.muted }}>
                      Period
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button
                          onClick={() => setCollabPeriod('annual')}
                          style={{
                            padding: '6px 10px',
                            borderRadius: 999,
                            border: `1px solid ${collabPeriod === 'annual' ? 'rgba(99,102,241,0.55)' : C.border}`,
                            background: collabPeriod === 'annual' ? 'rgba(99,102,241,0.10)' : 'var(--surface-0)',
                            color: collabPeriod === 'annual' ? 'rgba(67,56,202,1)' : C.muted,
                            fontWeight: 900,
                            cursor: 'pointer',
                            fontSize: 12,
                          }}
                          title="Aggregate across all months"
                        >
                          Annual
                        </button>
                      {pmAnalystMatrix.months.map(mi => {
                        const active = collabPeriod !== 'annual' && mi === pmAnalystMatrix.monthIndex
                        return (
                          <button
                            key={mi}
                            onClick={() => setCollabMonthIndex(mi)}
                            style={{
                              padding: '6px 10px',
                              borderRadius: 999,
                              border: `1px solid ${active ? 'rgba(99,102,241,0.55)' : C.border}`,
                              background: active ? 'rgba(99,102,241,0.10)' : 'var(--surface-0)',
                              color: active ? 'rgba(67,56,202,1)' : C.muted,
                              fontWeight: 900,
                              cursor: 'pointer',
                              fontSize: 12,
                            }}
                          >
                            {MONTHS[mi]}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {(() => {
                    const norm = (s) => String(s || '').trim().toLowerCase()
                    const pmQ = norm(collabPmQ)
                    const anQ = norm(collabAnalystQ)
                    const pmList = (pmAnalystMatrix.pmList || []).filter(n => !pmQ || norm(n).includes(pmQ))
                    const analystList = (pmAnalystMatrix.analystList || []).filter(n => !anQ || norm(n).includes(anQ))

                    return (
                      <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
                        <div style={{ overflow: 'auto', maxHeight: 420 }}>
                          <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 12.5 }}>
                            <thead>
                              <tr>
                                <th
                                  style={{
                                    position: 'sticky',
                                    top: 0,
                                    left: 0,
                                    zIndex: 3,
                                    textAlign: 'left',
                                    padding: '10px 12px',
                                    background: 'var(--surface-1)',
                                    borderBottom: `1px solid ${C.border}`,
                                    minWidth: 180,
                                  }}
                                >
                                  Analyst
                                </th>
                                {pmList.map(pm => (
                                  <th
                                    key={pm}
                                    style={{
                                      position: 'sticky',
                                      top: 0,
                                      zIndex: 2,
                                      textAlign: 'left',
                                      padding: '10px 12px',
                                      background: 'var(--surface-1)',
                                      borderBottom: `1px solid ${C.border}`,
                                      minWidth: 220,
                                      whiteSpace: 'nowrap',
                                    }}
                                    title={pm}
                                  >
                                    <div style={{ fontWeight: 950, color: C.ink, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                      {pm}
                                    </div>
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {analystList.map(an => (
                                <tr key={an}>
                                  <td
                                    style={{
                                      position: 'sticky',
                                      left: 0,
                                      zIndex: 1,
                                      padding: '10px 12px',
                                      background: 'var(--surface-0)',
                                      borderBottom: `1px solid ${C.border}`,
                                      minWidth: 180,
                                    }}
                                    title={an}
                                  >
                                    <div style={{ fontWeight: 900, color: C.ink, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                      {an}
                                    </div>
                                  </td>
                                  {pmList.map(pm => {
                                    const k = `${pm}__${an}`
                                    const cell = pmAnalystMatrix.cell.get(k) || null
                                    const projects = cell ? [...cell.projects.values()] : []
                                    projects.sort((a, b) => ((b.analystHours + b.pmHours) || 0) - ((a.analystHours + a.pmHours) || 0))
                                    const count = projects.length
                                    const names = projects.slice(0, 2).map(p => p.name)
                                    const more = count > 2 ? count - 2 : 0
                                    const title = count
                                      ? projects.map(p => `${p.name} (PM ${Math.round(p.pmHours)}h · Analyst ${Math.round(p.analystHours)}h)`).join('\n')
                                      : ''

                                    return (
                                      <td
                                        key={pm}
                                        style={{
                                          padding: '10px 12px',
                                          borderBottom: `1px solid ${C.border}`,
                                          borderLeft: `1px solid ${C.border}`,
                                          verticalAlign: 'top',
                                          background: count ? 'rgba(34,197,94,0.06)' : 'transparent',
                                        }}
                                        title={title}
                                      >
                                        {count === 0 ? (
                                          <div style={{ color: C.faint, fontSize: 12 }}>—</div>
                                        ) : (
                                          <div style={{ display: 'grid', gap: 4 }}>
                                            <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', justifyContent: 'space-between' }}>
                                              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: C.muted, fontWeight: 900 }}>
                                                {count} project{count === 1 ? '' : 's'}
                                              </div>
                                              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: C.faint, fontWeight: 900 }}>
                                                {Math.round((cell?.analystHours || 0) + (cell?.pmHours || 0)).toLocaleString()}h
                                              </div>
                                            </div>
                                            <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.4 }}>
                                              {names.join(', ')}{more ? ` +${more} more` : ''}
                                            </div>
                                          </div>
                                        )}
                                      </td>
                                    )
                                  })}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )
                  })()}

                  <div style={{ fontSize: 12, color: C.faint, lineHeight: 1.6 }}>
                    {pmAnalystMatrix.monthIndex === null
                      ? `Each cell lists projects where the PM and Analyst both have staffed hours in ${planningYear}.`
                      : `Each cell lists projects where the PM and Analyst both have staffed hours in ${MONTHS[pmAnalystMatrix.monthIndex]}.`
                    }
                  </div>
                </div>
              )}
            </CardBody>
          )}
        </Card>
      )}

      {/* Controls */}
      <Card style={{ marginBottom: 16 }}>
        <CardHeader title="Explore a person" tag="Role → Person" />
        <CardBody>
          <RoleSelector
            roles={ROLE_OPTIONS}
            active={role}
            onChange={(r) => { setRole(r); setPerson('') }}
          />

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ fontSize: 12, color: 'var(--ink-muted)', fontWeight: 800, letterSpacing: '0.02em' }}>
              Person
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <input
                value={person}
                onChange={(e) => setPerson(e.target.value)}
                placeholder={hasPeopleForRole ? 'Type to search…' : 'No staffed people found'}
                list="spark_workload_people"
                style={{
                  padding: '8px 10px',
                  borderRadius: 10,
                  border: `1px solid ${showNoMatch ? 'rgba(220,38,38,0.45)' : 'var(--border)'}`,
                  background: 'var(--surface-0)',
                  fontSize: 12.5,
                  minWidth: 320,
                  boxShadow: showNoMatch ? '0 0 0 3px rgba(220,38,38,0.08)' : 'none',
                }}
              />
              <datalist id="spark_workload_people">
                {peopleOptions.map(p => <option key={p} value={p} />)}
              </datalist>
              {showNoMatch && (
                <div style={{ fontSize: 11.5, color: 'var(--red)' }}>
                  No matching staffed person for {role}.
                </div>
              )}
            </div>

            {effectivePerson && (
              <Pill type="blue">{projectsForPerson.length} projects contributing</Pill>
            )}
          </div>

        </CardBody>
      </Card>

      {/* Outputs */}
      {effectivePerson && (
        <Grid cols="1.2fr 1fr" gap={14}>
          <Card>
            <CardHeader title="Projects driving workload (heatmap)" tag={`${role} · ${effectivePerson}`} />
            <CardBody>
              <ProjectMonthHeatmap
                projects={projectsForPerson.map(p => ({
                  key: p.key,
                  name: p.name,
                  type: p.type,
                  status: p.status,
                  monthly: p.monthly,
                  badge: (role === 'Analyst' && p.hasAnalyst2) ? 'A2' : '',
                  badgeHint: (role === 'Analyst' && p.hasAnalyst2) ? 'Has Analyst 2 hours' : '',
                }))}
                maxHeight={420}
              />

              {!!availabilitySummary && (
                <div style={{ marginTop: 12, borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.muted, marginBottom: 8 }}>
                    Availability summary
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5, color: C.muted, lineHeight: 1.6 }}>
                    {(availabilitySummary.weekendAddedDays || 0) > 0 && (
                      <div>
                        Worked extra on <strong>{Math.round(availabilitySummary.weekendAddedDays)}</strong> weekend days (adds capacity).
                      </div>
                    )}
                    {((availabilitySummary.ptoRemovedDays || 0) + (availabilitySummary.nonProjectRemovedDays || 0)) > 0 && (
                      <div>
                        Unavailable days: <strong>{Math.round(availabilitySummary.ptoRemovedDays)}</strong> PTO + <strong>{Math.round(availabilitySummary.nonProjectRemovedDays)}</strong> non-project (reduces capacity).
                      </div>
                    )}
                    {(availabilitySummary.unallocatedHours || 0) > 0 && (
                      <div>
                        Work unallocated due to unavailability: <strong>{Math.round(availabilitySummary.unallocatedHours).toLocaleString()}h</strong> across <strong>{availabilitySummary.unallocProjectCount}</strong> projects.
                      </div>
                    )}
                    {(availabilitySummary.backfillReceivedHours || 0) > 0 && (
                      <div>
                        Backfilled work received: <strong>{Math.round(availabilitySummary.backfillReceivedHours).toLocaleString()}h</strong> across <strong>{availabilitySummary.backfillReceivedProjectCount}</strong> projects.
                        {Array.isArray(availabilitySummary.backfillReceivedTop) && availabilitySummary.backfillReceivedTop.length ? (
                          <div style={{ marginTop: 4, fontSize: 12, color: C.faint, fontFamily: 'var(--font-mono)' }}>
                            {availabilitySummary.backfillReceivedTop.map(x => `${x.project} (+${Math.round(x.hours)}h)`).join(' · ')}
                            {availabilitySummary.backfillReceivedMore ? ` · +${availabilitySummary.backfillReceivedMore} more` : ''}
                          </div>
                        ) : null}
                      </div>
                    )}
                    {(availabilitySummary.backfillMovedAwayHours || 0) > 0 && (
                      <div>
                        Backfilled work moved away: <strong>{Math.round(availabilitySummary.backfillMovedAwayHours).toLocaleString()}h</strong> across <strong>{availabilitySummary.backfillMovedAwayProjectCount}</strong> projects.
                        {Array.isArray(availabilitySummary.backfillMovedAwayTop) && availabilitySummary.backfillMovedAwayTop.length ? (
                          <div style={{ marginTop: 4, fontSize: 12, color: C.faint, fontFamily: 'var(--font-mono)' }}>
                            {availabilitySummary.backfillMovedAwayTop.map(x => `${x.project} (-${Math.round(x.hours)}h)`).join(' · ')}
                            {availabilitySummary.backfillMovedAwayMore ? ` · +${availabilitySummary.backfillMovedAwayMore} more` : ''}
                          </div>
                        ) : null}
                      </div>
                    )}
                    {(availabilitySummary.weekendAddedDays || 0) > 0 && (
                      <div style={{ fontSize: 12, color: C.faint }}>
                        Tip: if utilization still looks high, review which projects drive the busiest months in this heatmap.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </CardBody>
          </Card>

          <div>
            <Card style={{ marginBottom: 14 }}>
              <CardHeader title="Monthly load (stacked by project)" tag="hours" />
              <CardBody>
                <ChartBox height={260}>
                  <Bar
                    data={stackedChart}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: {
                        legend: {
                          position: 'bottom',
                          labels: { boxWidth: 10, font: { size: 10 } },
                        },
                      },
                      scales: {
                        x: { stacked: true, grid: { display: false } },
                        y: { stacked: true, grid: { color: '#f0ede6' }, ticks: { callback: v => v.toLocaleString() } },
                      },
                    }}
                  />
                </ChartBox>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Why they’re busy" tag="overlaps + drivers" />
              <CardBody>
                {overlapMonths.length ? (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{
                      fontSize: 11,
                      fontWeight: 900,
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      color: 'var(--ink-muted)',
                      marginBottom: 8,
                    }}>
                      Top overlap months
                    </div>
                    {overlapMonths.map(m => (
                      <div key={m.month} style={{ fontSize: 12.5, marginBottom: 4 }}>
                        <strong>{m.month}</strong> — {m.projectsActive} projects · {Math.round(m.totalHours).toLocaleString()}h
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ color: 'var(--ink-muted)', fontSize: 12.5, marginBottom: 12 }}>
                    No overlap months (2+ projects) for this person/role.
                  </div>
                )}

                {explainPeak ? (
                  <div>
                    <div style={{ fontSize: 12.5, marginBottom: 8, lineHeight: 1.6 }}>
                      <strong>Explainability:</strong>{' '}
                      {(() => {
                        const n = explainPeak.topK.length
                        if (n <= 1) return <>Top project drives <strong>{explainPeak.pct}%</strong> of load in <strong>{explainPeak.month}</strong>.</>
                        return <>Top {n} projects drive <strong>{explainPeak.pct}%</strong> of load in <strong>{explainPeak.month}</strong>.</>
                      })()}
                    </div>
                    {explainPeak.topK.map(p => (
                      <div key={p.name} style={{ fontSize: 12.5, color: 'var(--ink-muted)', marginBottom: 4 }}>
                        - <strong style={{ color: 'var(--ink)' }}>{p.name}</strong>: {Math.round(p.hours).toLocaleString()}h
                        {role === 'Analyst' && p.hasAnalyst2 ? <span style={{ marginLeft: 8, color: 'var(--accent)', fontWeight: 800 }}>A2</span> : null}
                        {(() => {
                          const t = projectRoleTotals.get(p.key)
                          const txt = formatRoleTotals(t)
                          if (!txt) return null
                          return <span style={{ marginLeft: 10, color: 'var(--ink-faint)' }}>· All roles: {txt}</span>
                        })()}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ color: 'var(--ink-muted)', fontSize: 12.5 }}>
                    Not enough monthly hours to generate an explainability summary.
                  </div>
                )}
              </CardBody>
            </Card>
          </div>
        </Grid>
      )}
    </div>
  )
}

function GanttChart({ projects, maxHeight = 520 }) {
  const VIBE_COLORS = {
    Bond: '#2857a4',
    Validate: '#2a7a52',
    Integrate: '#c84b31',
    Explore: '#c47b1a',
  }

  const rows = Array.isArray(projects) ? projects : []
  if (rows.length === 0) {
    return (
      <div style={{ padding: '16px', textAlign: 'center', color: 'var(--ink-muted)' }}>
        No projects.
      </div>
    )
  }

  const COL_PCT = 100 / 12
  const LABEL_W = 340
  // Ensures Dec column is always reachable/visible (prevents it from being squeezed/clipped).
  const MIN_TOTAL_W = 1120

  return (
    <div style={{ overflow: 'auto', maxHeight }}>
      {/* Month headers */}
      <div style={{ minWidth: MIN_TOTAL_W }}>
        <div style={{
          display: 'flex',
          borderBottom: '1px solid var(--rule)',
          paddingBottom: 6,
          marginBottom: 4,
          position: 'sticky',
          top: 0,
          background: 'white',
          zIndex: 2,
        }}>
          <div style={{ width: LABEL_W, flexShrink: 0 }} />
          <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(12,1fr)', paddingRight: 10 }}>
            {MONTHS.map(m => (
              <div key={m} style={{ textAlign: 'center', fontSize: 10, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                {m}
              </div>
            ))}
          </div>
        </div>

        {rows.map((p, i) => {
          const start = Number.isFinite(+p?.start) ? +p.start : 0
          const end = Number.isFinite(+p?.end) ? +p.end : start
          const color = VIBE_COLORS[p?.type] || '#888'
          const safeEnd = Math.max(start, end)
          // Use (end+1) to make “ends in Dec” land exactly at 100%.
          const left = `${(start / 12) * 100}%`
          const width = `${((safeEnd + 1 - start) / 12) * 100}%`
          const statusDot = p?.status === 'In Progress' ? '●' : p?.status === 'Done' ? '✓' : '○'

          return (
            <div
              key={p?.key || p?.name || i}
              style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--paper-warm)', minHeight: 34 }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--paper-warm)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
            >
              <div style={{ width: LABEL_W, flexShrink: 0, paddingRight: 12, overflow: 'hidden', display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {p?.name || '(unnamed)'}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--ink-muted)' }}>
                    {statusDot} {p?.status || '—'}
                  </div>
                </div>
                {p?.badge ? (
                  <span
                    title={p?.badgeHint || ''}
                    style={{
                      marginLeft: 'auto',
                      fontSize: 10,
                      fontWeight: 900,
                      padding: '2px 6px',
                      borderRadius: 6,
                      background: 'var(--accent-light)',
                      color: 'var(--accent)',
                      flexShrink: 0,
                    }}
                  >
                    {p.badge}
                  </span>
                ) : null}
              </div>

              <div style={{ flex: 1, position: 'relative', height: 28, display: 'flex', alignItems: 'center', paddingRight: 10 }}>
                {MONTHS.map((_, mi) => (
                  <div key={mi} style={{ position: 'absolute', left: `${(mi / 12) * 100}%`, top: 0, bottom: 0, width: 1, background: 'var(--paper-warm)' }} />
                ))}
                {/* Right boundary line so Dec column is visually distinct */}
                <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 1, background: 'var(--paper-warm)' }} />
                <div
                  title={`${p?.name || ''} · ${MONTHS[start]}–${MONTHS[safeEnd]}`}
                  style={{
                    position: 'absolute',
                    left,
                    width,
                    height: 18,
                    borderRadius: 4,
                    background: color,
                    opacity: 0.85,
                  }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ProjectMonthHeatmap({ projects, maxHeight = 520 }) {
  const VIBE_COLORS = {
    Bond: '#2857a4',
    Validate: '#2a7a52',
    Integrate: '#c84b31',
    Explore: '#c47b1a',
  }

  const rows = Array.isArray(projects) ? projects : []
  if (rows.length === 0) {
    return (
      <div style={{ padding: '16px', textAlign: 'center', color: 'var(--ink-muted)' }}>
        No projects.
      </div>
    )
  }

  const LABEL_W = 340
  const MIN_TOTAL_W = 1120

  let maxCell = 0
  for (const p of rows) {
    const m = Array.isArray(p?.monthly) ? p.monthly : []
    for (let i = 0; i < 12; i++) maxCell = Math.max(maxCell, safeNum(m[i]))
  }
  const clamp01 = (x) => Math.max(0, Math.min(1, x))

  return (
    <div style={{ overflow: 'auto', maxHeight }}>
      <div style={{ minWidth: MIN_TOTAL_W }}>
        {/* Month headers */}
        <div style={{
          display: 'flex',
          borderBottom: '1px solid var(--rule)',
          paddingBottom: 6,
          marginBottom: 4,
          position: 'sticky',
          top: 0,
          background: 'white',
          zIndex: 2,
        }}>
          <div style={{ width: LABEL_W, flexShrink: 0 }}>
            <div style={{ fontSize: 11.5, color: 'var(--ink-faint)', paddingLeft: 4 }}>
              Low → High ({maxCell > 0 ? `${Math.round(maxCell).toLocaleString()}h max cell` : 'no hours'})
            </div>
          </div>
          <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(12,1fr)', paddingRight: 10 }}>
            {MONTHS.map(m => (
              <div key={m} style={{ textAlign: 'center', fontSize: 10, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                {m}
              </div>
            ))}
          </div>
        </div>

        {rows.map((p, i) => {
          const color = VIBE_COLORS[p?.type] || '#888'
          const statusDot = p?.status === 'In Progress' ? '●' : p?.status === 'Done' ? '✓' : '○'
          const monthly = Array.isArray(p?.monthly) ? p.monthly : new Array(12).fill(0)

          return (
            <div
              key={p?.key || p?.name || i}
              style={{ display: 'flex', alignItems: 'stretch', borderBottom: '1px solid var(--paper-warm)', minHeight: 38 }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--paper-warm)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
            >
              <div style={{ width: LABEL_W, flexShrink: 0, paddingRight: 12, overflow: 'hidden', display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 10, height: 10, borderRadius: 3, background: color, opacity: 0.9, flexShrink: 0 }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 650, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {p?.name || '(unnamed)'}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--ink-muted)' }}>
                    {statusDot} {p?.status || '—'}
                  </div>
                </div>
                {p?.badge ? (
                  <span
                    title={p?.badgeHint || ''}
                    style={{
                      marginLeft: 'auto',
                      fontSize: 10,
                      fontWeight: 900,
                      padding: '2px 6px',
                      borderRadius: 6,
                      background: 'var(--accent-light)',
                      color: 'var(--accent)',
                      flexShrink: 0,
                    }}
                  >
                    {p.badge}
                  </span>
                ) : null}
              </div>

              <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(12,1fr)', paddingRight: 10, gap: 6, alignItems: 'center' }}>
                {MONTHS.map((m, mi) => {
                  const hrs = safeNum(monthly[mi])
                  const t = maxCell > 0 ? clamp01(hrs / maxCell) : 0
                  const bg = hrs > 0 ? `rgba(37, 99, 235, ${0.10 + 0.55 * t})` : 'rgba(15,23,42,0.04)'
                  const border = hrs > 0 ? 'rgba(37,99,235,0.18)' : 'rgba(15,23,42,0.06)'
                  const txt = hrs > 0 ? `${Math.round(hrs).toLocaleString()}` : ''

                  return (
                    <div
                      key={`${p?.key || p?.name || i}_${mi}`}
                      title={`${p?.name || ''} · ${m}: ${Math.round(hrs).toLocaleString()}h`}
                      style={{
                        height: 22,
                        borderRadius: 6,
                        background: bg,
                        border: `1px solid ${border}`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 10.5,
                        fontWeight: 800,
                        color: hrs > 0 ? 'rgba(15,23,42,0.88)' : 'transparent',
                        userSelect: 'none',
                      }}
                    >
                      {txt}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}


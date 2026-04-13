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

export default function WorkloadExplorerView({ engineInput, engineCalc }) {
  const { data: insightsData, loading: insightsLoading, error: insightsError } =
    useEngineInsightsData(engineInput, !!engineInput)

  const assignments = engineCalc?.assignments || []

  const [role, setRole] = useState('CSM')
  const [person, setPerson] = useState('')
  const [demandRole, setDemandRole] = useState('All')
  const [showTopDemand, setShowTopDemand] = useState(false)
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
    for (const r of roleRows) {
      if (r?.isUnstaffed) continue
      const p = String(r?.person || '').trim()
      if (!p) continue
      set.add(p)
    }
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [roleRows])

  const effectivePerson = useMemo(() => {
    const p = String(person || '').trim()
    if (!p) return peopleOptions[0] || ''
    return peopleOptions.includes(p) ? p : ''
  }, [person, peopleOptions])

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
      .map(p => ({ name: p.name, hours: p.monthly[peakIdx] || 0, hasAnalyst2: p.hasAnalyst2 }))
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
            <CardHeader title="Projects driving workload (timeline)" tag={`${role} · ${effectivePerson}`} />
            <CardBody>
              <GanttChart
                projects={projectsForPerson.map(p => ({
                  key: p.key,
                  name: p.name,
                  type: p.type,
                  status: p.status,
                  start: p.start,
                  end: p.end,
                  badge: (role === 'Analyst' && p.hasAnalyst2) ? 'A2' : '',
                  badgeHint: (role === 'Analyst' && p.hasAnalyst2) ? 'Has Analyst 2 hours' : '',
                }))}
                maxHeight={420}
              />
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


import React, { useRef, useState } from 'react'
import { Bar, Line, Doughnut } from 'react-chartjs-2'
import {
  SectionHeader, KpiStrip, KpiCard, Grid, Card, CardHeader, CardBody,
  AlertBar, ChartBox, Legend, DataNote, SourceToggle, ActionButton
} from './ui'
import { CHART_COLORS } from '../lib/chartSetup'
import { exportChartPng } from '../lib/export'
import { useEngineInsightsData } from './useEngineInsightsData'

const SHOW_SOURCE_TOGGLE = import.meta.env.VITE_SHOW_SOURCE_TOGGLE === 'true'

export default function ExecutiveView({ data, uploadedFile, source = 'excel', onSource, onNavigate }) {
  const { data: engineData, loading: engineLoading, error: engineError } = useEngineInsightsData(uploadedFile, source === 'engine')
  const viewData = source === 'engine' ? engineData : data

  // Hooks MUST be unconditional (Overview was crashing with "Rendered more hooks than during the previous render").
  const demandRef = useRef(null)
  const utilRef = useRef(null)
  const vibeRef = useRef(null)
  const statusRef = useRef(null)
  const vibeStackRef = useRef(null)

  // IMPORTANT: In engine mode, `viewData` is async. Avoid computing any derived values
  // until we have data, otherwise the Overview page can crash and render blank.
  if (source === 'engine') {
    if (!uploadedFile) {
      return (
        <div>
          <SectionHeader title="Year at a Glance" subtitle="2026 full-year capacity outlook · SPARK" />
          {SHOW_SOURCE_TOGGLE && (
            <SourceToggle
              value={source}
              onChange={(v) => onSource?.(v)}
              engineEnabled={!!uploadedFile}
              engineHint={!uploadedFile ? 'Upload required for engine view' : undefined}
            />
          )}
          <div style={{ padding: 20, color: 'var(--ink-muted)' }}>Upload an Excel file to generate SPARK Engine insights.</div>
        </div>
      )
    }
    if (engineLoading || !viewData) {
      return (
        <div>
          <SectionHeader title="Year at a Glance" subtitle="2026 full-year capacity outlook · SPARK" />
          {SHOW_SOURCE_TOGGLE && (
            <SourceToggle
              value={source}
              onChange={(v) => onSource?.(v)}
              engineEnabled={!!uploadedFile}
            />
          )}
          <div style={{ padding: 20, color: 'var(--ink-muted)' }}>Computing SPARK Engine insights…</div>
        </div>
      )
    }
    if (engineError) {
      return (
        <div>
          <SectionHeader title="Year at a Glance" subtitle="2026 full-year capacity outlook · SPARK" />
          {SHOW_SOURCE_TOGGLE && (
            <SourceToggle
              value={source}
              onChange={(v) => onSource?.(v)}
              engineEnabled={!!uploadedFile}
            />
          )}
          <div style={{ padding: 20, color: 'var(--red)' }}>{engineError}</div>
        </div>
      )
    }
  }

  const {
    demand,
    vibeMonthly,
    vibeProjectCounts,
    statusCounts,
    MONTHS,
    RAW_CAP,
    annualDemand,
    annualCap,
    monthsOver,
    ATTRITION
  } = viewData || {}

  // Defensive defaults: even if engine data is partially shaped, never hard-crash the Overview.
  const MONTHS_SAFE = Array.isArray(MONTHS) && MONTHS.length ? MONTHS : ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const RAW_CAP_SAFE = RAW_CAP || { CSM: 0, PM: 0, Analyst: 0 }
  const ATTRITION_SAFE = Number.isFinite(+ATTRITION) ? +ATTRITION : 0
  const demandSafe = demand || { CSM: new Array(12).fill(0), PM: new Array(12).fill(0), Analyst: new Array(12).fill(0) }
  const monthsOverSafe = monthsOver || { CSM: 0, PM: 0, Analyst: 0 }
  const annualDemandSafe = annualDemand || { CSM: 0, PM: 0, Analyst: 0 }
  const vibeProjectCountsSafe = vibeProjectCounts || { Bond: 0, Validate: 0, Integrate: 0, Explore: 0 }
  const statusCountsSafe = statusCounts || {}
  const vibeMonthlySafe = vibeMonthly || { Bond: new Array(12).fill(0), Validate: new Array(12).fill(0), Integrate: new Array(12).fill(0), Explore: new Array(12).fill(0) }

  const effCapByMonth = {
    CSM: (viewData?.CAPACITY?.CSM?.effectiveMonthlyByMonth || demandSafe.CSM.map(() => (RAW_CAP_SAFE.CSM || 0) * ATTRITION_SAFE)).map(v => v || 0),
    PM: (viewData?.CAPACITY?.PM?.effectiveMonthlyByMonth || demandSafe.PM.map(() => (RAW_CAP_SAFE.PM || 0) * ATTRITION_SAFE)).map(v => v || 0),
    Analyst: (viewData?.CAPACITY?.Analyst?.effectiveMonthlyByMonth || demandSafe.Analyst.map(() => (RAW_CAP_SAFE.Analyst || 0) * ATTRITION_SAFE)).map(v => v || 0),
  }

  const analystBase = (source === 'engine') ? (viewData?.analystDemand?.base || demandSafe?.Analyst || new Array(12).fill(0)) : (demandSafe?.Analyst || new Array(12).fill(0))
  const analystInc = (source === 'engine') ? (viewData?.analystDemand?.incremental || new Array(12).fill(0)) : new Array(12).fill(0)
  const analystTotal = (source === 'engine') ? (viewData?.analystDemand?.total || analystBase.map((v, i) => v + (analystInc[i] || 0))) : analystBase
  // SPARK Engine Overview: Analyst annual demand always uses Analyst 1 + Analyst 2.
  // Analyst 2 represents incremental demand pressure (additional headcount), surfaced in "Unallocated Demand".
  const analystForRisk = (source === 'engine') ? analystTotal : analystBase
  const analystMonthsOverBase = analystBase.filter((d, i) => d > (effCapByMonth.Analyst[i] || 0)).length
  const analystMonthsOverTotal = analystTotal.filter((d, i) => d > (effCapByMonth.Analyst[i] || 0)).length

  // Worst-role breach summary (drives the banner)
  const totalMonths = 12
  const monthsOverByRole = {
    CSM: monthsOverSafe.CSM || 0,
    PM: monthsOverSafe.PM || 0,
    Analyst: (source === 'engine') ? analystMonthsOverTotal : (monthsOverSafe.Analyst || 0),
  }
  const roleDemandSeries = (r) => {
    if (r === 'CSM') return demandSafe.CSM || new Array(12).fill(0)
    if (r === 'PM') return demandSafe.PM || new Array(12).fill(0)
    return (source === 'engine') ? analystTotal : analystBase
  }
  const roleEffCap = (r, i) => (effCapByMonth[r]?.[i] || 0)
  const worstRole = Object.entries(monthsOverByRole).sort((a, b) => {
    // Primary: months over effective cap
    if (b[1] !== a[1]) return b[1] - a[1]
    // Tie-break: largest peak overage above effective cap
    const aSeries = roleDemandSeries(a[0])
    const bSeries = roleDemandSeries(b[0])
    const aOver = Math.max(...aSeries.map((v, i) => (v || 0) - roleEffCap(a[0], i)))
    const bOver = Math.max(...bSeries.map((v, i) => (v || 0) - roleEffCap(b[0], i)))
    return bOver - aOver
  })[0]?.[0] || 'CSM'
  const worstOver = monthsOverByRole[worstRole] || 0

  const peakMonthsForRole = (r, n = 3) => {
    const series = roleDemandSeries(r)
    const ranked = series
      .map((v, i) => ({ i, v: v || 0 }))
      .sort((a, b) => b.v - a.v)
      .slice(0, n)
      .map(x => MONTHS_SAFE[x.i])
    return ranked.filter(Boolean)
  }
  const worstPeaks = peakMonthsForRole(worstRole, 3)

  // Annual util %
  const annualUtil = (role) => {
    const annCap = (RAW_CAP_SAFE?.[role] || 0) * 12
    if (annCap <= 0) return '—'
    if (role !== 'Analyst' || source !== 'engine') return (( (annualDemandSafe?.[role] || 0) / annCap) * 100).toFixed(0) + '%'
    const annDem = (viewData?.analystDemand?.total || []).reduce((a, b) => a + (b || 0), 0)
    return ((annDem / annCap) * 100).toFixed(0) + '%'
  }

  // Months where all 3 roles breach simultaneously
  const tripleBreachMonths = MONTHS_SAFE.filter((_, i) =>
    (demandSafe.CSM?.[i] || 0) > (effCapByMonth.CSM[i] || 0) &&
    (demandSafe.PM?.[i] || 0)  > (effCapByMonth.PM[i] || 0)  &&
    analystForRisk[i] > (effCapByMonth.Analyst[i] || 0)
  )

  // Multi-line demand chart
  const demandChartData = {
    labels: MONTHS_SAFE,
    datasets: [
      { label:'CSM',     data: demandSafe.CSM,     borderColor: CHART_COLORS.CSM,     backgroundColor: CHART_COLORS.CSM+'15',     fill:true, tension:0.4, pointRadius:3, borderWidth:2 },
      { label:'PM',      data: demandSafe.PM,       borderColor: CHART_COLORS.PM,      backgroundColor: CHART_COLORS.PM+'15',      fill:true, tension:0.4, pointRadius:3, borderWidth:2 },
      { label: source === 'engine' ? 'Analyst (A1+A2 total)' : 'Analyst', data: (source === 'engine' ? analystTotal : analystBase),  borderColor: CHART_COLORS.Analyst, backgroundColor: CHART_COLORS.Analyst+'10', fill:true, tension:0.4, pointRadius:3, borderWidth:2 },
    ]
  }

  // Effective util % line chart
  const utilChartData = {
    labels: MONTHS_SAFE,
    datasets: [
      { label:'CSM %',     data: (demandSafe.CSM || []).map((d, i)     => (effCapByMonth.CSM[i] || 0) ? +((d / effCapByMonth.CSM[i]) * 100).toFixed(1) : 0), borderColor: CHART_COLORS.CSM,     tension:0.4, pointRadius:4, borderWidth:2, fill:false },
      { label:'PM %',      data: (demandSafe.PM || []).map((d, i)      => (effCapByMonth.PM[i] || 0) ? +((d / effCapByMonth.PM[i]) * 100).toFixed(1) : 0), borderColor: CHART_COLORS.PM,      tension:0.4, pointRadius:4, borderWidth:2, fill:false },
      { label: source === 'engine' ? 'Analyst % (A1+A2)' : 'Analyst %', data: (source === 'engine' ? analystTotal : analystBase).map((d, i)  => (effCapByMonth.Analyst[i] || 0) ? +((d / effCapByMonth.Analyst[i]) * 100).toFixed(1) : 0), borderColor: CHART_COLORS.Analyst, tension:0.4, pointRadius:4, borderWidth:2, fill:false },
      { label:'Breach',    data: new Array(12).fill(100), borderColor:'#c84b31', borderDash:[5,5], borderWidth:1.5, pointRadius:0, fill:false },
    ]
  }

  // VIBE doughnut
  const vibeLabels  = Object.keys(vibeProjectCountsSafe)
  const vibeDoughnut = {
    labels:   vibeLabels.map(k => `${k} (${vibeProjectCountsSafe[k]})`),
    datasets: [{ data: vibeLabels.map(k => vibeProjectCountsSafe[k]), backgroundColor: vibeLabels.map(k => CHART_COLORS[k] || '#888'), borderWidth:0 }]
  }

  // Status doughnut
  const statusLabels = Object.keys(statusCountsSafe)
  const statusDoughnut = {
    labels:   statusLabels.map(k => `${k} (${statusCountsSafe[k]})`),
    datasets: [{ data: statusLabels.map(k => statusCountsSafe[k]), backgroundColor:['#e8eef8','#fdf3e3','#e3f2eb'], borderColor:['#2857a4','#c47b1a','#2a7a52'], borderWidth:2 }]
  }

  // VIBE stacked monthly
  const vibeStackedData = {
    labels: MONTHS_SAFE,
    datasets: [
      { label:'Bond',      data: vibeMonthlySafe.Bond,      backgroundColor: CHART_COLORS.Bond,      stack:'s' },
      { label:'Validate',  data: vibeMonthlySafe.Validate,  backgroundColor: CHART_COLORS.Validate,  stack:'s' },
      { label:'Integrate', data: vibeMonthlySafe.Integrate, backgroundColor: CHART_COLORS.Integrate, stack:'s' },
      { label:'Explore',   data: vibeMonthlySafe.Explore,   backgroundColor: CHART_COLORS.Explore,   stack:'s' },
    ]
  }

  const totalProjects = Object.values(vibeProjectCountsSafe).reduce((a,b)=>a+b,0)
  const unassignedTotals = (viewData?.unassigned || {})
  const unassignedAllRolesTotal = ['CSM', 'PM', 'Analyst']
    .map(r => (unassignedTotals?.[r] || []))
    .reduce((sum, arr) => sum + (arr || []).reduce((a, b) => a + (b || 0), 0), 0)
  const unallocatedAnalyst2DemandTotal = (source === 'engine' ? analystInc : []).reduce((a, b) => a + (b || 0), 0)
  const unallocatedDemandTotal = unassignedAllRolesTotal + unallocatedAnalyst2DemandTotal

  return (
    <div>
      <SectionHeader title="Year at a Glance" subtitle="2026 full-year capacity outlook · SPARK" />

      {SHOW_SOURCE_TOGGLE && (
        <SourceToggle
          value={source}
          onChange={(v) => onSource?.(v)}
          engineEnabled={!!uploadedFile}
          engineHint={!uploadedFile ? 'Upload required for engine view' : undefined}
        />
      )}

      {(!source || source === 'excel' || (source === 'engine' && viewData && !engineLoading && !engineError)) && (
        <>
      <AlertBar>
        <strong>Capacity Risk:</strong>{' '}
        {worstOver > 0
          ? <>{worstRole} is over effective capacity in <strong>{worstOver} of {totalMonths} months</strong>{worstPeaks.length ? <> (peaks: <strong>{worstPeaks.join(', ')}</strong>)</> : null}.</>
          : <>No roles are over effective capacity based on the current plan.</>
        }
        {tripleBreachMonths.length > 0 && <> All 3 roles breach simultaneously in <strong>{tripleBreachMonths.join(', ')}</strong>.</>}
        {worstOver > 0 && <> Review the Demand and Utilization charts below to validate breach months and magnitude.</>}
        {(unallocatedDemandTotal || 0) > 0 && <> Also check <strong>Unallocated Demand</strong> (unassigned work / Analyst 2 pressure) — breaches often worsen when work isn’t staffed.</>}
      </AlertBar>

      <KpiStrip cols={5}>
        <KpiCard label="Total Projects"      value={totalProjects}           sub={`${statusCountsSafe['In Progress'] || 0} in-progress`}  badge="Pipeline growing" badgeType="amber" accent="blue" />
        <KpiCard label="CSM Utilization"     value={annualUtil('CSM')}       sub="vs 80% effective cap"  badge={`${monthsOverSafe.CSM} months over`}     badgeType="red"   accent="red"   />
        <KpiCard label="PM Utilization"      value={annualUtil('PM')}        sub="vs 80% effective cap"  badge={`${monthsOverSafe.PM} months over`}      badgeType="amber" accent="amber" />
        <KpiCard
          label="Analyst Utilization"
          value={annualUtil('Analyst')}
          sub={source === 'engine' ? 'vs 80% effective cap (Analyst A1+A2 demand)' : 'vs 80% effective cap'}
          badge={`${(source === 'engine' ? analystMonthsOverTotal : monthsOverSafe.Analyst)} months over`}
          badgeType="amber"
          accent="amber"
        />
        <KpiCard
          label="Unallocated Demand"
          value={(unallocatedDemandTotal / 1000).toFixed(1) + 'K'}
          sub={source === 'engine' ? 'unstaffed hrs (all roles) + Analyst 2 demand' : 'unstaffed hrs (all roles)'}
          badge="Allocation gap"
          badgeType="red"
          accent="red"
        />
      </KpiStrip>

      {/* Insight chips */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(260px, 1fr))', gap:12, marginBottom:20 }}>
        {[
          { icon:'🔴', title:'Sep peak is critical', body:'All 3 roles breach capacity in Sep — highest collision month of the year' },
          { icon:'📦', title:'Bond projects dominate', body:`${vibeProjectCountsSafe.Bond} of ${totalProjects} projects (${totalProjects ? ((vibeProjectCountsSafe.Bond/totalProjects)*100).toFixed(0) : '0'}%) are Bond engagements` },
        ].map(({ icon, title, body }) => (
          <div key={title} style={{
            background:'white', border:'1px solid var(--rule)', borderRadius:8,
            padding:'10px 14px', display:'flex', alignItems:'center',
            gap:8, minWidth:0
          }}>
            <span style={{ fontSize:18 }}>{icon}</span>
            <div>
              <div style={{ fontWeight:600, fontSize:13, marginBottom:2 }}>{title}</div>
              <div style={{ fontSize:11, color:'var(--ink-muted)' }}>{body}</div>
            </div>
          </div>
        ))}
      </div>

      <Grid cols="1fr 1fr">
        <Card>
          <CardHeader title="Monthly Demand vs. Effective Capacity" tag="All Roles">
            <ActionButton onClick={() => exportChartPng(demandRef, 'SPARK_Insights_Overview_Demand.png')}>
              Export PNG
            </ActionButton>
          </CardHeader>
          <CardBody>
            <ChartBox height={240}>
              <Line ref={demandRef} data={demandChartData} options={{
                responsive:true, maintainAspectRatio:false,
                plugins:{ legend:{ display:false } },
                scales:{ x:{ grid:{display:false} }, y:{ grid:{color:'#f0ede6'}, ticks:{ callback: v=>v.toLocaleString() } } }
              }} />
            </ChartBox>
            <Legend items={[
              { label:'CSM',     color: CHART_COLORS.CSM     },
              { label:'PM',      color: CHART_COLORS.PM      },
              { label: source === 'engine' ? 'Analyst (A1+A2)' : 'Analyst', color: CHART_COLORS.Analyst },
            ]} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Effective Utilization % by Role" tag="vs 80% threshold">
            <ActionButton onClick={() => exportChartPng(utilRef, 'SPARK_Insights_Overview_Utilization.png')}>
              Export PNG
            </ActionButton>
          </CardHeader>
          <CardBody>
            <ChartBox height={240}>
              <Line ref={utilRef} data={utilChartData} options={{
                responsive:true, maintainAspectRatio:false,
                plugins:{ legend:{ position:'bottom', labels:{ usePointStyle:true, boxWidth:8, font:{size:11} } } },
                scales:{ x:{ grid:{display:false} }, y:{ min:0, grid:{color:'#f0ede6'}, ticks:{ callback: v=>v+'%' } } }
              }} />
            </ChartBox>
            <DataNote>Effective capacity = raw capacity × 80% attrition. Red dashed = 100% breach.</DataNote>
          </CardBody>
        </Card>
      </Grid>

      <Grid cols="1fr 1fr 1fr">
        <Card>
          <CardHeader title="VIBE Type Mix" tag="Projects">
            <ActionButton onClick={() => exportChartPng(vibeRef, 'SPARK_Insights_Overview_VIBE_Mix.png')}>
              Export PNG
            </ActionButton>
          </CardHeader>
          <CardBody>
            <ChartBox height={200}>
              <Doughnut ref={vibeRef} data={vibeDoughnut} options={{
                cutout:'65%', responsive:true, maintainAspectRatio:false,
                plugins:{ legend:{ position:'bottom', labels:{ usePointStyle:true, boxWidth:8, font:{size:11} } } }
              }} />
            </ChartBox>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Project Status" tag="Pipeline">
            <ActionButton onClick={() => exportChartPng(statusRef, 'SPARK_Insights_Overview_Status.png')}>
              Export PNG
            </ActionButton>
          </CardHeader>
          <CardBody>
            <ChartBox height={200}>
              <Doughnut ref={statusRef} data={statusDoughnut} options={{
                cutout:'65%', responsive:true, maintainAspectRatio:false,
                plugins:{ legend:{ position:'bottom', labels:{ usePointStyle:true, boxWidth:8, font:{size:11} } } }
              }} />
            </ChartBox>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Demand Hours by VIBE Type" tag="Monthly">
            <ActionButton onClick={() => exportChartPng(vibeStackRef, 'SPARK_Insights_Overview_VIBE_Demand.png')}>
              Export PNG
            </ActionButton>
          </CardHeader>
          <CardBody>
            <ChartBox height={200}>
              <Bar ref={vibeStackRef} data={vibeStackedData} options={{
                responsive:true, maintainAspectRatio:false,
                plugins:{ legend:{ display:false } },
                scales:{ x:{ stacked:true, grid:{display:false} }, y:{ stacked:true, grid:{color:'#f0ede6'} } }
              }} />
            </ChartBox>
            <Legend items={Object.entries(CHART_COLORS).filter(([k]) => ['Bond','Validate','Integrate','Explore'].includes(k)).map(([k,v])=>({label:k,color:v}))} />
          </CardBody>
        </Card>
      </Grid>
        </>
      )}
    </div>
  )
}

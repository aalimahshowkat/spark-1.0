/**
 * CapacityView.jsx
 *
 * Role-level capacity + demand, with People heatmap embedded
 * below the charts — progressive disclosure, single destination.
 *
 * Structure per role:
 *   KPI strip → Demand vs Capacity chart → FTE chart →
 *   Month table → [expandable] People breakdown
 */
import React, { useRef, useState } from 'react'
import { Bar } from 'react-chartjs-2'
import {
  SectionHeader, KpiStrip, KpiCard, Grid, Card, CardHeader, CardBody,
  RoleSelector, ChartBox, DataNote, Legend, ActionButton, statusStyle,
} from './ui'
import { CHART_COLORS } from '../lib/chartSetup'
import { downloadTableCsv, exportChartPng } from '../lib/export'
import { useEngineInsightsData } from './useEngineInsightsData'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// ─── Heat colour helpers ──────────────────────────────────────────────────
function heatColor(pct) {
  if (pct === 0)   return '#f7f6f2'
  if (pct < 70)    return '#d4edda'
  if (pct < 90)    return '#fff3cd'
  if (pct < 110)   return '#ffd6cc'
  return                  '#f5b3a0'
}
function heatFg(pct) { return pct > 110 ? '#7a2e1e' : 'var(--ink)' }

// ─── Main component ───────────────────────────────────────────────────────
export default function CapacityView({ data, uploadedFile, source = 'engine', onSource, onNavigate }) {
  const { data: engineData, loading: engineLoading, error: engineError } =
    useEngineInsightsData(uploadedFile, true)   // always compute

  const [role, setRole]           = useState('CSM')
  const [showPeople, setShowPeople] = useState(false)

  const demandRef  = useRef(null)
  const fteRef     = useRef(null)
  const tableRef   = useRef(null)
  const heatRef    = useRef(null)
  const annualRef  = useRef(null)

  // Always use engine data for this view
  const viewData = engineData

  if (!uploadedFile) {
    return (
      <div>
        <SectionHeader title="Capacity & People" subtitle="Monthly demand vs capacity · individual workload heatmap" />
        <div style={{ padding:'40px 0', color:'var(--ink-muted)', textAlign:'center' }}>
          Load a plan to see capacity data.
        </div>
      </div>
    )
  }
  if (engineLoading || !viewData) {
    return (
      <div>
        <SectionHeader title="Capacity & People" subtitle="Monthly demand vs capacity · individual workload heatmap" />
        <div style={{ padding:'20px 0', color:'var(--ink-muted)' }}>Computing engine insights…</div>
      </div>
    )
  }
  if (engineError) {
    return (
      <div>
        <SectionHeader title="Capacity & People" subtitle="Monthly demand vs capacity · individual workload heatmap" />
        <div style={{ padding:'20px 0', color:'var(--red)' }}>{engineError}</div>
      </div>
    )
  }

  const { demand, analystDemand, annualDemand, monthsOver, people, analystPeople, ATTRITION } = viewData

  const cap = viewData?.CAPACITY || {}
  const capRow = role === 'Analyst' ? cap.Analyst : cap[role]
  const rawCapByMonth = capRow?.rawMonthlyByMonth || new Array(12).fill(0)
  const effCapByMonth = capRow?.effectiveMonthlyByMonth || new Array(12).fill(0)
  const hrsPerPersonMonthByMonth = capRow?.hrsPerPersonMonthByMonth || new Array(12).fill(160)
  const hrsPerPersonDay = capRow?.hrsPerPersonDay ?? 10
  const fteAvailable = capRow?.fte || 0

  const rawCapAvg = rawCapByMonth.reduce((a, b) => a + (b || 0), 0) / 12
  const effCapAvg = effCapByMonth.reduce((a, b) => a + (b || 0), 0) / 12
  const annCap = rawCapByMonth.reduce((a, b) => a + (b || 0), 0)

  // Demand array for selected role
  const isAnalyst = role === 'Analyst'
  const hasAnalyst2 = isAnalyst
    ? ((analystDemand?.incremental || []).some(v => (v || 0) > 0) || (analystPeople?.incremental || []).some(p => (p.total || 0) > 0))
    : false
  const analystDemandLabel = hasAnalyst2 ? 'Analyst 1 + Analyst 2' : 'Analyst 1'
  const dem = isAnalyst
    ? (hasAnalyst2 ? analystDemand.total : analystDemand.base)
    : demand[role]

  const annualDem = isAnalyst
    ? (hasAnalyst2 ? analystDemand.total : analystDemand.base).reduce((a,b) => a+(b||0), 0)
    : annualDemand[role]
  const monthsOverEff = dem.filter((d, i) => d > (effCapByMonth[i] || 0)).length

  // Charts
  const barColors = dem.map(d =>
    d > effCapAvg ? 'rgba(200,75,49,0.75)' :
    d > rawCapAvg * 0.8 ? 'rgba(196,123,26,0.75)' :
    'rgba(42,122,82,0.75)'
  )
  const barData = {
    labels: MONTHS,
    datasets: [
      { label:'Demand',        data: dem,                         backgroundColor: barColors, borderRadius:3 },
      { label:'Raw Capacity',  data: rawCapByMonth,  type:'line', borderColor:'#aaa', borderDash:[4,4], borderWidth:1.5, pointRadius:0, fill:false },
      { label:'Eff. Capacity', data: effCapByMonth,  type:'line', borderColor:'#c84b31', borderDash:[6,3], borderWidth:2, pointRadius:0, fill:false },
    ]
  }
  const fteNeeded = dem.map((d, i) => {
    const denom = hrsPerPersonMonthByMonth[i] || 0
    if (!denom) return d > 0 ? null : 0
    return +(d / denom).toFixed(2)
  })
  const fteData = {
    labels: MONTHS,
    datasets: [
      { label:'FTE Needed',    data: fteNeeded, backgroundColor: fteNeeded.map(f => f > fteAvailable * 0.8 ? 'rgba(200,75,49,0.75)' : `${CHART_COLORS[role]}bb`), borderRadius:3, type:'bar' },
      { label:'Available FTE', data: new Array(12).fill(fteAvailable),          borderColor:'#2a7a52', borderWidth:2, pointRadius:0, fill:false, type:'line' },
      { label:'Eff. FTE (80%)',data: new Array(12).fill(+(fteAvailable*0.8).toFixed(1)), borderColor:'#c84b31', borderDash:[5,3], borderWidth:1.5, pointRadius:0, fill:false, type:'line' },
    ]
  }

  // People for current role
  const peopleList = isAnalyst
    ? (hasAnalyst2 ? buildAnalystMerged(analystPeople) : (analystPeople.base || []))
    : (people[role] || [])
  const sortedPeople = [...peopleList].sort((a,b) => b.total - a.total)
  const roleHrsPerPersonYear = hrsPerPersonMonthByMonth.reduce((a, b) => a + (b || 0), 0) || 0

  // Annual bar chart for people
  const annualBarData = {
    labels: sortedPeople.map(p => p.name),
    datasets: [{
      label: 'Annual Hours',
      data: sortedPeople.map(p => p.total),
      backgroundColor: sortedPeople.map(p => {
        const denom = p.capacityAnnual ?? roleHrsPerPersonYear
        return (denom && p.total > denom) ? 'rgba(200,75,49,0.7)' : (CHART_COLORS[role] || '#888') + 'bb'
      }),
      borderRadius: 3,
    }]
  }

  const chartOpts = {
    responsive:true, maintainAspectRatio:false,
    plugins:{ legend:{ position:'bottom', labels:{ usePointStyle:true, boxWidth:8, font:{size:11} } } },
    scales:{ x:{ grid:{display:false} }, y:{ grid:{color:'#f0ede6'}, ticks:{ callback: v=>v.toLocaleString() } } }
  }

  return (
    <div style={{ animation:'fadeUp 0.22s ease both' }}>
      <SectionHeader title="Capacity & People" subtitle="Monthly demand vs capacity · individual workload heatmap" />

      <RoleSelector roles={['CSM','PM','Analyst']} active={role} onChange={(r) => { setRole(r); setShowPeople(false) }} />

      {/* KPI strip */}
      <KpiStrip cols={4}>
        <KpiCard label="Annual Demand" value={Math.round(annualDem).toLocaleString()} sub={isAnalyst ? `${analystDemandLabel} demand hours` : 'hours'} accent="blue" />
        <KpiCard label="Raw Capacity"  value={(annCap).toLocaleString()} sub="hours (12 mo)" accent="green" />
        <KpiCard label="Eff. Capacity" value={Math.round(annCap * ATTRITION).toLocaleString()} sub="hours @ 80%" accent="amber" />
        <KpiCard
          label="Months Over Cap" value={monthsOverEff} sub="of 12 months"
          accent={monthsOverEff > 6 ? 'red' : monthsOverEff > 3 ? 'amber' : 'green'}
          badge={monthsOverEff > 6 ? 'Critical' : monthsOverEff > 3 ? 'Elevated' : 'Healthy'}
          badgeType={monthsOverEff > 6 ? 'red' : monthsOverEff > 3 ? 'amber' : 'green'}
        />
      </KpiStrip>

      {/* Charts */}
      <Grid cols="1fr 1fr" gap={14}>
        <Card>
          <CardHeader title="Demand vs Capacity" tag={`${role}${isAnalyst ? ` (${analystDemandLabel})` : ''} · ${fteAvailable} FTE`}>
            <ActionButton onClick={() => exportChartPng(demandRef, `SPARK_Capacity_${role}_Demand.png`)}>Export PNG</ActionButton>
          </CardHeader>
          <CardBody>
            <ChartBox height={240}>
              <Bar ref={demandRef} data={barData} options={chartOpts} />
            </ChartBox>
            <DataNote>
              Dashed grey = raw cap · Red dashed = effective cap (×80%) · Bars = demand
              {isAnalyst ? ` · Analyst demand shows ${analystDemandLabel} when present in the plan.` : ''}
            </DataNote>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="FTE Needed vs Available" tag={`business-days × ${hrsPerPersonDay} hrs/day`}>
            <ActionButton onClick={() => exportChartPng(fteRef, `SPARK_Capacity_${role}_FTE.png`)}>Export PNG</ActionButton>
          </CardHeader>
          <CardBody>
            <ChartBox height={240}>
              <Bar ref={fteRef} data={fteData} options={chartOpts} />
            </ChartBox>
            {hrsPerPersonMonthByMonth.every(v => !v) && (
              <DataNote>
                Working hours per day are set to 0 for this role, so per-person monthly capacity is 0 and “FTE Needed” is undefined.
              </DataNote>
            )}
          </CardBody>
        </Card>
      </Grid>

      {/* Month-by-month table */}
      <Card style={{ marginBottom:14 }}>
        <CardHeader title="Month-by-Month Detail" tag={role}>
          <ActionButton onClick={() => downloadTableCsv(tableRef, `SPARK_Capacity_${role}_Table.csv`)}>Download CSV</ActionButton>
        </CardHeader>
        <CardBody style={{ padding:0 }}>
          <div style={{ overflowX:'auto' }}>
            <table ref={tableRef} style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
              <thead>
                <tr style={{ background:'var(--surface-1)' }}>
                  {['Month', isAnalyst ? `Demand hrs (${analystDemandLabel})` : 'Demand hrs','Raw Cap','Eff. Cap','Util %','Eff. Util %','Status'].map(h => (
                    <th key={h} style={{ padding:'10px 14px', border:'1px solid var(--border)', fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.5px', color:'var(--ink-muted)', textAlign:'left' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {MONTHS.map((m,i) => {
                  const d = dem[i]
                  const rawCap = rawCapByMonth[i] || 0
                  const effCap = effCapByMonth[i] || 0
                  const s = statusStyle(d, effCap, rawCap)
                  const utilText = rawCap ? ((d / rawCap) * 100).toFixed(1) : (d > 0 ? '∞' : '0.0')
                  const effUtilText = effCap ? ((d / effCap) * 100).toFixed(1) : (d > 0 ? '∞' : '0.0')
                  return (
                    <tr key={m} style={{ borderBottom:'1px solid var(--border)' }}>
                      <td style={{ padding:'9px 14px', fontWeight:600 }}>{m}</td>
                      <td style={{ padding:'9px 14px', fontFamily:'var(--font-mono)' }}>{Math.round(d).toLocaleString()}</td>
                      <td style={{ padding:'9px 14px', fontFamily:'var(--font-mono)', color:'var(--ink-muted)' }}>{Math.round(rawCap).toLocaleString()}</td>
                      <td style={{ padding:'9px 14px', fontFamily:'var(--font-mono)', color:'var(--ink-muted)' }}>{Math.round(effCap).toLocaleString()}</td>
                      <td style={{ padding:'9px 14px', fontFamily:'var(--font-mono)' }}>{utilText}%</td>
                      <td style={{ padding:'9px 14px', fontFamily:'var(--font-mono)', color:s.color, fontWeight:s.weight }}>{effUtilText}%</td>
                      <td style={{ padding:'9px 14px', color:s.color, fontWeight:s.weight }}>{s.text}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      {/* ── People section ─────────────────────────────────────────────── */}
      <div style={{ marginBottom:6 }}>
        <button
          onClick={() => setShowPeople(v => !v)}
          style={{
            display:'flex', alignItems:'center', gap:8,
            width:'100%', padding:'12px 18px',
            background:'var(--surface-0)', border:'1px solid var(--border)',
            borderRadius: showPeople ? '10px 10px 0 0' : 10,
            cursor:'pointer', textAlign:'left', fontFamily:'var(--font-sans)',
          }}
        >
          <span style={{ fontSize:13, fontWeight:600, color:'var(--ink)' }}>
            👤 People — {role} ({sortedPeople.length} team members)
          </span>
          <span style={{ marginLeft:'auto', fontSize:11, color:'var(--ink-muted)' }}>
            {showPeople ? '▲ Collapse' : '▼ Expand utilisation heatmap'}
          </span>
        </button>

        {showPeople && (
          <div style={{ border:'1px solid var(--border)', borderTop:'none', borderRadius:'0 0 10px 10px', overflow:'hidden', background:'var(--surface-0)' }}>
            {sortedPeople.length === 0 ? (
              <div style={{ padding:'32px', textAlign:'center', color:'var(--ink-muted)', fontSize:13 }}>
                No named team members found for {role}.
              </div>
            ) : (
              <>
                {/* Heatmap + Annual bar */}
                <Grid cols="2fr 1fr" gap={0} style={{ marginBottom:0 }}>
                  <div style={{ borderRight:'1px solid var(--border)', padding:16 }}>
                    <div style={{ fontSize:12, fontWeight:700, color:'var(--ink-muted)', marginBottom:10, textTransform:'uppercase', letterSpacing:'0.5px' }}>
                      Monthly Utilisation Heatmap <span style={{ fontWeight:400 }}>— % of business-days × {hrsPerPersonDay} hrs/day</span>
                    </div>
                    <div style={{ overflowX:'auto' }}>
                      <table ref={heatRef} style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
                        <thead>
                          <tr>
                            <th style={thSt()}>Person</th>
                            {MONTHS.map(m => <th key={m} style={thSt(true)}>{m}</th>)}
                            <th style={thSt(true)}>Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedPeople.map(p => {
                            const annDen = p.capacityAnnual ?? roleHrsPerPersonYear
                            const annPct = annDen ? (p.total / annDen) * 100 : (p.total > 0 ? 999 : 0)
                            return (
                              <tr key={p.name}>
                                <td style={nameSt()}>{p.name}</td>
                                {p.monthly.map((h,i) => {
                                  const denom = (p.capacityMonthly?.[i] ?? hrsPerPersonMonthByMonth[i]) || 0
                                  const pct = denom ? (h / denom) * 100 : (h > 0 ? 999 : 0)
                                  return <td key={i} style={cellSt(pct)}>{h > 0 ? h : '—'}</td>
                                })}
                                <td style={{ ...cellSt(annPct), fontWeight:700 }}>{p.total}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                    <Legend items={[
                      { label:'<70%', color:'#d4edda' }, { label:'70–90%', color:'#fff3cd' },
                      { label:'90–110%', color:'#ffd6cc' }, { label:'>110%', color:'#f5b3a0' },
                    ]} />
                    <div style={{ display:'flex', gap:8, marginTop:10 }}>
                      <ActionButton onClick={() => downloadTableCsv(heatRef, `SPARK_People_${role}_Heatmap.csv`)}>Download CSV</ActionButton>
                    </div>
                  </div>

                  <div style={{ padding:16 }}>
                    <div style={{ fontSize:12, fontWeight:700, color:'var(--ink-muted)', marginBottom:10, textTransform:'uppercase', letterSpacing:'0.5px' }}>
                      Annual Hours
                    </div>
                    <ChartBox height={Math.max(180, sortedPeople.length * 28)}>
                      <Bar ref={annualRef} data={annualBarData} options={{
                        indexAxis:'y', responsive:true, maintainAspectRatio:false,
                        plugins:{ legend:{ display:false } },
                        scales:{ x:{ grid:{color:'#f0ede6'}, ticks:{ callback: v=>v.toLocaleString() } }, y:{ grid:{display:false}, ticks:{ font:{size:11} } } }
                      }} />
                    </ChartBox>
                    <div style={{ marginTop:10 }}>
                      <ActionButton onClick={() => exportChartPng(annualRef, `SPARK_People_${role}_Annual.png`)}>Export PNG</ActionButton>
                    </div>
                  </div>
                </Grid>

                {/* Utilisation bars */}
                <div style={{ padding:16, borderTop:'1px solid var(--border)' }}>
                  <div style={{ fontSize:12, fontWeight:700, color:'var(--ink-muted)', marginBottom:12, textTransform:'uppercase', letterSpacing:'0.5px' }}>Annual Utilisation vs Capacity</div>
                  {sortedPeople.map(p => {
                    const den = p.capacityAnnual ?? roleHrsPerPersonYear
                    const ratioPct = den ? (p.total / den) * 100 : (p.total > 0 ? 999 : 0)
                    const pct = Math.min(ratioPct, 130)
                    const rawPct = den ? ratioPct.toFixed(0) : '∞'
                    const hoursText = den
                      ? `${Math.round(p.total).toLocaleString()}h / ${Math.round(den).toLocaleString()}h`
                      : `${Math.round(p.total).toLocaleString()}h / —`
                    const barColor = den
                      ? (p.total > den ? 'var(--red)' : p.total > den * 0.8 ? 'var(--amber)' : 'var(--green)')
                      : (p.total > 0 ? 'var(--red)' : 'var(--green)')
                    return (
                      <div key={p.name} style={{ display:'flex', alignItems:'center', gap:12, padding:'7px 0', borderBottom:'1px solid var(--border)' }}>
                        <div style={{ width:150, fontSize:13, fontWeight:500, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flexShrink:0, color:'var(--ink)' }}>
                          {p.name}
                        </div>
                        <div style={{ flex:1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <div style={{ fontSize: 10.5, color: 'var(--ink-faint)', fontFamily: 'var(--font-mono)', lineHeight: 1 }}>
                            {hoursText}
                          </div>
                          <div style={{ height:7, background:'var(--surface-1)', borderRadius:4 }}>
                            <div style={{ width:`${Math.min(pct,100)}%`, height:'100%', borderRadius:4, background:barColor, transition:'width 0.4s ease' }} />
                          </div>
                        </div>
                        <div style={{ width:56, textAlign:'right', fontFamily:'var(--font-mono)', fontSize:12, fontWeight:650, color:barColor }}>
                          {rawPct}%
                        </div>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────
function buildAnalystMerged(analystPeople) {
  const map = new Map()
  for (const p of (analystPeople.base || [])) {
    map.set(p.name, {
      name: p.name,
      fte: p.fte || 0,
      allocationPct: p.allocationPct ?? null,
      monthly: [...(p.monthly || new Array(12).fill(0))],
      total: p.total || 0,
      capacityMonthly: [...(p.capacityMonthly || new Array(12).fill(0))],
      capacityAnnual: p.capacityAnnual ?? 0,
    })
  }
  for (const p of (analystPeople.incremental || [])) {
    if (map.has(p.name)) {
      const r = map.get(p.name)
      r.monthly = r.monthly.map((v,i) => v + (p.monthly[i] || 0))
      r.total += p.total
    } else {
      map.set(p.name, {
        name: p.name,
        fte: p.fte || 0,
        allocationPct: p.allocationPct ?? null,
        monthly: [...(p.monthly || new Array(12).fill(0))],
        total: p.total || 0,
        capacityMonthly: [...(p.capacityMonthly || new Array(12).fill(0))],
        capacityAnnual: p.capacityAnnual ?? 0,
      })
    }
  }
  return [...map.values()].sort((a,b) => b.total - a.total)
}

function thSt(center=false) {
  return { padding:'6px 8px', textAlign:center?'center':'left', fontWeight:600, fontSize:10, textTransform:'uppercase', letterSpacing:'0.5px', color:'var(--ink-muted)', background:'var(--surface-1)', border:'1px solid var(--border)', whiteSpace:'nowrap' }
}
function nameSt() {
  return { padding:'5px 8px', textAlign:'left', border:'1px solid var(--border)', background:'white', fontSize:12, fontWeight:500, whiteSpace:'nowrap', maxWidth:180, overflow:'hidden', textOverflow:'ellipsis' }
}
function cellSt(pct) {
  return { padding:'4px 6px', textAlign:'center', border:'1px solid var(--border)', fontFamily:'var(--font-mono)', fontSize:10, fontWeight:500, background:heatColor(pct), color:heatFg(pct) }
}

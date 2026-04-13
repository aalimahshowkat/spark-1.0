import React, { useRef, useState } from 'react'
import { Bar } from 'react-chartjs-2'
import {
  SectionHeader, Grid, Card, CardHeader, CardBody,
  RoleSelector, ChartBox, Legend, DataNote, SourceToggle, ActionButton
} from './ui'
import { CHART_COLORS } from '../lib/chartSetup'
import { downloadTableCsv, exportChartPng } from '../lib/export'
import { useEngineInsightsData } from './useEngineInsightsData'

const SHOW_SOURCE_TOGGLE = import.meta.env.VITE_SHOW_SOURCE_TOGGLE === 'true'

const DEFAULT_HRS_MONTH = 160

function heatColor(pct) {
  if (pct === 0)    return '#f7f6f2'
  if (pct < 70)     return '#d4edda'
  if (pct < 90)     return '#fff3cd'
  if (pct < 110)    return '#ffd6cc'
  return                   '#f5b3a0'
}

function heatTextColor(pct) {
  return pct > 110 ? '#7a2e1e' : 'var(--ink)'
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

export default function PeopleView({ data, uploadedFile, source = 'excel', onSource, onNavigate }) {
  const { data: engineData, loading: engineLoading, error: engineError } = useEngineInsightsData(uploadedFile, source === 'engine')
  const viewData = source === 'engine' ? engineData : data

  const [role, setRole] = useState('CSM')

  const analystBasePeople = (source === 'engine' && role === 'Analyst')
    ? (viewData?.analystPeople?.base || viewData?.people?.Analyst || [])
    : null
  const analystIncPeople = (source === 'engine' && role === 'Analyst')
    ? (viewData?.analystPeople?.incremental || [])
    : null
  const hasAnalyst2 = (source === 'engine' && role === 'Analyst')
    ? (analystIncPeople || []).some(p => (p.total || 0) > 0)
    : false

  const analystTotalPeople = (source === 'engine' && role === 'Analyst') ? (() => {
    const map = new Map()
    const add = (arr, kind) => {
      for (const p of (arr || [])) {
        if (!map.has(p.name)) map.set(p.name, { name: p.name, base: new Array(12).fill(0), inc: new Array(12).fill(0) })
        const row = map.get(p.name)
        const src = (p.monthly || new Array(12).fill(0))
        for (let i = 0; i < 12; i++) row[kind][i] += (src[i] || 0)
      }
    }
    add(analystBasePeople, 'base')
    add(analystIncPeople, 'inc')

    const out = []
    for (const row of map.values()) {
      const monthly = row.base.map((v, i) => Math.round(v + (row.inc[i] || 0)))
      out.push({ name: row.name, monthly, total: Math.round(monthly.reduce((a, b) => a + (b || 0), 0)) })
    }
    out.sort((a, b) => b.total - a.total)
    return out
  })() : null

  const people =
    (source === 'engine' && role === 'Analyst')
      ? (hasAnalyst2 ? analystTotalPeople : analystBasePeople)
      : (viewData?.people?.[role] || [])

  const heatmapRef = useRef(null)
  const heatmapIncRef = useRef(null)
  const annualRef = useRef(null)

  const color = CHART_COLORS[role] || '#888'
  const hrsPerPersonMonthByMonth =
    (source === 'engine' && viewData?.CAPACITY)
      ? ((role === 'CSM' ? viewData.CAPACITY.CSM?.hrsPerPersonMonthByMonth :
          role === 'PM' ? viewData.CAPACITY.PM?.hrsPerPersonMonthByMonth :
          viewData.CAPACITY.Analyst?.hrsPerPersonMonthByMonth) || new Array(12).fill(DEFAULT_HRS_MONTH))
      : new Array(12).fill(DEFAULT_HRS_MONTH)
  const hrsPerPersonYear = hrsPerPersonMonthByMonth.reduce((a, b) => a + (b || 0), 0) || (DEFAULT_HRS_MONTH * 12)

  // Annual bar chart
  const sorted = [...people].sort((a, b) => b.total - a.total)
  const analystBaseSorted = (source === 'engine' && role === 'Analyst') ? [...(analystBasePeople || [])].sort((a, b) => b.total - a.total) : null
  const analystIncSorted = (source === 'engine' && role === 'Analyst') ? [...(analystIncPeople || [])].sort((a, b) => b.total - a.total) : null

  const annualBarData = (source === 'engine' && role === 'Analyst' && hasAnalyst2)
    ? {
      labels: (analystTotalPeople || []).map(p => p.name),
      datasets: [
        {
          label: 'Analyst 1 (base)',
          data:  (analystTotalPeople || []).map(p => {
            const b = (analystBasePeople || []).find(x => x.name === p.name)?.total || 0
            return b
          }),
          backgroundColor: 'rgba(40, 120, 220, 0.75)',
          borderRadius: 3,
          stack: 'hours',
        },
        {
          label: 'Analyst 2 (incremental)',
          data:  (analystTotalPeople || []).map(p => {
            const inc = (analystIncPeople || []).find(x => x.name === p.name)?.total || 0
            return inc
          }),
          backgroundColor: 'rgba(196, 123, 26, 0.7)',
          borderRadius: 3,
          stack: 'hours',
        },
      ]
    }
    : {
      labels: sorted.map(p => p.name),
      datasets: [{
        label: 'Annual Hours',
        data:  sorted.map(p => p.total),
        backgroundColor: sorted.map(p => p.total > hrsPerPersonYear ? 'rgba(200,75,49,0.7)' : color + 'bb'),
        borderRadius: 3,
      }]
    }

  return (
    <div>
      <SectionHeader title="People & Utilization" subtitle="Individual workload, availability and monthly allocation heatmap" />

      {SHOW_SOURCE_TOGGLE && (
        <SourceToggle
          value={source}
          onChange={(v) => onSource?.(v)}
          engineEnabled={!!uploadedFile}
          engineHint={!uploadedFile ? 'Upload required for engine view' : undefined}
        />
      )}

      {source === 'engine' && !uploadedFile && (
        <div style={{ padding: 20, color: 'var(--ink-muted)' }}>Upload an Excel file to generate SPARK Engine insights.</div>
      )}
      {source === 'engine' && uploadedFile && engineLoading && (
        <div style={{ padding: 20, color: 'var(--ink-muted)' }}>Computing SPARK Engine insights…</div>
      )}
      {source === 'engine' && uploadedFile && engineError && (
        <div style={{ padding: 20, color: 'var(--red)' }}>{engineError}</div>
      )}
      {(!source || source === 'excel' || (source === 'engine' && viewData && !engineLoading && !engineError)) && (
        <>
      <RoleSelector roles={['CSM','PM','Analyst']} active={role} onChange={setRole} />

      {people.length === 0 ? (
        <EmptyPeople role={role} />
      ) : (
        <>
          <Grid cols="2fr 1fr">
            {/* Heatmap */}
            <Card>
              <CardHeader title="Monthly Utilization Heatmap" tag="% of 160 hrs/month">
                <ActionButton onClick={() => downloadTableCsv(heatmapRef, `SPARK_Insights_People_${role}_Heatmap.csv`)}>
                  Download Table
                </ActionButton>
              </CardHeader>
              <CardBody style={{ padding:'12px', overflowX:'auto' }}>
                <table ref={heatmapRef} style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
                  <thead>
                    <tr>
                      <th style={thStyle()}>Person</th>
                      {MONTHS.map(m => <th key={m} style={thStyle(true)}>{m}</th>)}
                      <th style={thStyle(true)}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {people.map(p => {
                      const total   = p.total
                      const annPct  = (total / hrsPerPersonYear * 100)
                      return (
                        <tr key={p.name}>
                          <td style={nameTdStyle()}>{p.name}</td>
                          {p.monthly.map((h, i) => {
                            const denom = hrsPerPersonMonthByMonth[i] || DEFAULT_HRS_MONTH
                            const pct = denom ? (h / denom * 100) : 0
                            return (
                              <td key={i} style={cellStyle(pct)}>
                                {h > 0 ? h : '—'}
                              </td>
                            )
                          })}
                          <td style={{ ...cellStyle(annPct), fontWeight:600 }}>{total}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                <Legend items={[
                  { label:'<70%',    color:'#d4edda' },
                  { label:'70–90%',  color:'#fff3cd' },
                  { label:'90–110%', color:'#ffd6cc' },
                  { label:'>110%',   color:'#f5b3a0' },
                ]} />
                {source === 'engine' && role === 'Analyst' ? (
                  <DataNote>
                    {hasAnalyst2 ? 'Heatmap shows Analyst 1 + Analyst 2 (total) hours per person.' : 'Heatmap shows Analyst 1 (base) hours per person.'}
                  </DataNote>
                ) : (
                  <DataNote>Each cell = hours · colour = % of 160 hrs monthly capacity per person.</DataNote>
                )}
              </CardBody>
            </Card>

            {/* Annual bar */}
            <Card>
              <CardHeader title="Annual Hours by Person" tag="FY2026 Total">
                <ActionButton onClick={() => exportChartPng(annualRef, `SPARK_Insights_People_${role}_Annual.png`)}>
                  Export PNG
                </ActionButton>
              </CardHeader>
              <CardBody>
                <ChartBox height={Math.max(240, sorted.length * 32)}>
                  <Bar ref={annualRef} data={annualBarData} options={{
                    indexAxis: 'y',
                    responsive:true, maintainAspectRatio:false,
                    plugins:{ legend:{ display: !(source === 'engine' && role === 'Analyst' && hasAnalyst2) ? false : true, position:'bottom', labels:{ usePointStyle:true, boxWidth:8, font:{size:11} } } },
                    scales:{
                      x:{ grid:{color:'#f0ede6'}, ticks:{ callback: v=>v.toLocaleString() } },
                      y:{ grid:{display:false},   ticks:{ font:{size:11} } }
                    }
                  }} />
                </ChartBox>
              </CardBody>
            </Card>
          </Grid>

          {source === 'engine' && role === 'Analyst' && hasAnalyst2 && (analystIncPeople?.length || 0) > 0 && (
            <Card>
              <CardHeader title="Analyst 2 (Incremental) Heatmap" tag="extra load (hours)">
                <ActionButton onClick={() => downloadTableCsv(heatmapIncRef, `SPARK_Insights_People_${role}_Heatmap_Analyst2.csv`)}>
                  Download Table
                </ActionButton>
              </CardHeader>
              <CardBody style={{ padding:'12px', overflowX:'auto' }}>
                <table ref={heatmapIncRef} style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
                  <thead>
                    <tr>
                      <th style={thStyle()}>Person</th>
                      {MONTHS.map(m => <th key={m} style={thStyle(true)}>{m}</th>)}
                      <th style={thStyle(true)}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analystIncPeople.map(p => {
                      const total   = p.total
                      const annPct  = (total / hrsPerPersonYear * 100)
                      return (
                        <tr key={p.name}>
                          <td style={nameTdStyle()}>{p.name}</td>
                          {p.monthly.map((h, i) => {
                            const denom = hrsPerPersonMonthByMonth[i] || DEFAULT_HRS_MONTH
                            const pct = denom ? (h / denom * 100) : 0
                            return (
                              <td key={i} style={cellStyle(pct)}>
                                {h > 0 ? h : '—'}
                              </td>
                            )
                          })}
                          <td style={{ ...cellStyle(annPct), fontWeight:600 }}>{total}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                <DataNote>Analyst 2 demand is modeled as incremental demand (does not increase capacity).</DataNote>
              </CardBody>
            </Card>
          )}

          {/* Utilization bars */}
          <Card>
            <CardHeader title="Annual Utilization vs. Capacity" tag={`${Math.round(hrsPerPersonYear).toLocaleString()} hrs/yr per person`} />
            <CardBody>
              {sorted.map(p => {
                const pct      = Math.min((p.total / hrsPerPersonYear * 100), 130)
                const rawPct   = (p.total / hrsPerPersonYear * 100).toFixed(0)
                const barColor = p.total > hrsPerPersonYear ? 'var(--red)' : p.total > hrsPerPersonYear * 0.8 ? 'var(--amber)' : 'var(--green)'
                return (
                  <div key={p.name} style={{ display:'flex', alignItems:'center', gap:12, padding:'8px 0', borderBottom:'1px solid var(--rule)' }}>
                    <div style={{ width:160, fontSize:13, fontWeight:500, flexShrink:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {p.name}
                    </div>
                    <div style={{ flex:1, height:8, background:'var(--paper-warm)', borderRadius:4, position:'relative' }}>
                      <div style={{ width:`${Math.min(pct,100)}%`, height:'100%', borderRadius:4, background:barColor, transition:'width 0.5s ease' }} />
                    </div>
                    <div style={{ width:52, textAlign:'right', fontFamily:'DM Mono,monospace', fontSize:12, fontWeight:500, color:barColor, flexShrink:0 }}>
                      {rawPct}%
                    </div>
                  </div>
                )
              })}
            </CardBody>
          </Card>
        </>
      )}
        </>
      )}
    </div>
  )
}

function EmptyPeople({ role }) {
  return (
    <div style={{ padding:'48px', textAlign:'center', color:'var(--ink-muted)', background:'white', borderRadius:10, border:'1px solid var(--rule)' }}>
      No named people found for role <strong>{role}</strong> in the uploaded data.
    </div>
  )
}

// ── Style helpers ──────────────────────────────────────────
function thStyle(center = false) {
  return {
    padding:'6px 8px', textAlign: center ? 'center' : 'left',
    fontWeight:600, fontSize:10, textTransform:'uppercase', letterSpacing:'0.5px',
    color:'var(--ink-muted)', background:'var(--paper-warm)',
    border:'1px solid var(--rule)', whiteSpace:'nowrap'
  }
}

function nameTdStyle() {
  return {
    padding:'5px 8px', textAlign:'left',
    border:'1px solid var(--rule)', background:'white',
    fontFamily:'Instrument Sans,sans-serif', fontSize:12, fontWeight:500,
    whiteSpace:'nowrap', maxWidth:180, overflow:'hidden', textOverflow:'ellipsis'
  }
}

function cellStyle(pct) {
  return {
    padding:'4px 6px', textAlign:'center',
    border:'1px solid var(--rule)',
    fontFamily:'DM Mono,monospace', fontSize:10, fontWeight:500,
    background: heatColor(pct),
    color: heatTextColor(pct),
    transition:'background 0.2s'
  }
}

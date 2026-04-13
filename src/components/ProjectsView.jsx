import React, { useRef, useState, useMemo } from 'react'
import { Bar } from 'react-chartjs-2'
import {
  SectionHeader, Grid, Card, CardHeader, CardBody,
  ChartBox, Legend, Pill, SourceToggle, ActionButton
} from './ui'
import { CHART_COLORS } from '../lib/chartSetup'
import { downloadTableCsv, exportChartPng } from '../lib/export'
import { useEngineInsightsData } from './useEngineInsightsData'

const SHOW_SOURCE_TOGGLE = import.meta.env.VITE_SHOW_SOURCE_TOGGLE === 'true'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

const VIBE_COLORS = {
  Bond:      '#2857a4',
  Validate:  '#2a7a52',
  Integrate: '#c84b31',
  Explore:   '#c47b1a',
}

const STATUS_PILL = {
  'Open':        'blue',
  'In Progress': 'amber',
  'Done':        'green',
}

export default function ProjectsView({ data, uploadedFile, source = 'excel', onSource, onNavigate }) {
  const { data: engineData, loading: engineLoading, error: engineError } = useEngineInsightsData(uploadedFile, source === 'engine')
  const viewData = source === 'engine' ? engineData : data

  const { projects, lmsByVibe } = viewData || { projects: [], lmsByVibe: { Bond: 0, Validate: 0, Integrate: 0, Explore: 0 } }
  const lmsRef = useRef(null)
  const tableRef = useRef(null)

  const [statusF,  setStatusF]  = useState('all')
  const [vibeF,    setVibeF]    = useState('all')

  const filtered = useMemo(() => projects.filter(p => {
    if (statusF  !== 'all' && p.status  !== statusF)  return false
    if (vibeF    !== 'all' && p.type    !== vibeF)    return false
    return true
  }), [projects, statusF, vibeF])

  // LMs bar
  const lmsData = {
    labels:   ['Integrate', 'Bond', 'Validate', 'Explore'],
    datasets: [{
      label: 'Total LMs',
      data:  [lmsByVibe.Integrate, lmsByVibe.Bond, lmsByVibe.Validate, lmsByVibe.Explore],
      backgroundColor: ['#c84b31','#2857a4','#2a7a52','#c47b1a'],
      borderRadius: 4,
    }]
  }

  const filterSelect = (value, onChange, options) => (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{
        padding:'6px 12px', border:'1px solid var(--rule)', borderRadius:6,
        fontFamily:'Instrument Sans,sans-serif', fontSize:13,
        background:'white', color:'var(--ink)', cursor:'pointer', outline:'none'
      }}
    >
      {options.map(([val, label]) => <option key={val} value={val}>{label}</option>)}
    </select>
  )

  return (
    <div>
      <SectionHeader title="Project Pipeline" subtitle={`Timeline, allocation and delivery tracking · ${projects.length} projects`} />

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
      {/* Filters */}
      <div style={{ display:'flex', gap:12, alignItems:'center', marginBottom:20, flexWrap:'wrap' }}>
        <span style={{ fontSize:12, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.5px', color:'var(--ink-muted)' }}>Filter:</span>
        {filterSelect(statusF,  setStatusF,  [['all','All Status'],['Open','Open'],['In Progress','In Progress'],['Done','Done']])}
        {filterSelect(vibeF,    setVibeF,    [['all','All VIBE'],['Bond','Bond'],['Validate','Validate'],['Integrate','Integrate'],['Explore','Explore']])}
        <span style={{ fontSize:12, color:'var(--ink-muted)' }}>{filtered.length} of {projects.length} projects</span>
      </div>

      {/* Gantt */}
      <Card style={{ marginBottom:20 }}>
        <CardHeader title="Project Timeline — Gantt View" tag="Jan–Dec 2026" />
        <CardBody style={{ padding:'16px' }}>
          <GanttChart projects={filtered} />
          <Legend items={Object.entries(VIBE_COLORS).map(([k,v])=>({ label:k, color:v }))} />
        </CardBody>
      </Card>

      <Grid cols="1fr">
        <Card>
          <CardHeader title="Total LMs by VIBE Type" tag="Line Miles (weighted)">
            <ActionButton onClick={() => exportChartPng(lmsRef, 'SPARK_Insights_Projects_LMs.png')}>
              Export PNG
            </ActionButton>
          </CardHeader>
          <CardBody>
            <ChartBox height={200}>
              <Bar ref={lmsRef} data={lmsData} options={{
                responsive:true, maintainAspectRatio:false,
                plugins:{ legend:{display:false} },
                scales:{ x:{ grid:{display:false} }, y:{ grid:{color:'#f0ede6'}, ticks:{ callback: v=>(v/1000).toFixed(0)+'K' } } }
              }} />
            </ChartBox>
          </CardBody>
        </Card>
      </Grid>

      {/* Project table */}
      <Card>
        <CardHeader title="Project List" tag={`${filtered.length} projects`}>
          <ActionButton onClick={() => downloadTableCsv(tableRef, 'SPARK_Insights_Projects_Table.csv')}>
            Download Table
          </ActionButton>
        </CardHeader>
        <CardBody style={{ padding:0 }}>
          <div style={{ overflowX:'auto', maxHeight:400 }}>
            <table ref={tableRef} style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
              <thead style={{ position:'sticky', top:0, zIndex:2 }}>
                <tr style={{ background:'var(--paper-warm)' }}>
                  {['Project','VIBE','Status','Start','End','LMs','PM'].map(h=>(
                    <th key={h} style={{ padding:'10px 12px', border:'1px solid var(--rule)', fontSize:11, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.5px', color:'var(--ink-muted)', textAlign:'left', whiteSpace:'nowrap' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((p, i) => (
                  <tr key={i} style={{ borderBottom:'1px solid var(--rule)' }}>
                    <td style={{ padding:'9px 12px', border:'1px solid var(--rule)', fontWeight:500, maxWidth:260, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p.name}</td>
                    <td style={{ padding:'9px 12px', border:'1px solid var(--rule)' }}>
                      <span style={{ display:'inline-block', width:8, height:8, borderRadius:'50%', background:VIBE_COLORS[p.type]||'#888', marginRight:6 }} />
                      {p.type}
                    </td>
                    <td style={{ padding:'9px 12px', border:'1px solid var(--rule)' }}>
                      <Pill type={STATUS_PILL[p.status] || 'blue'}>{p.status}</Pill>
                    </td>
                    <td style={{ padding:'9px 12px', border:'1px solid var(--rule)', fontFamily:'DM Mono,monospace', color:'var(--ink-muted)' }}>{MONTHS[p.start]}</td>
                    <td style={{ padding:'9px 12px', border:'1px solid var(--rule)', fontFamily:'DM Mono,monospace', color:'var(--ink-muted)' }}>{MONTHS[p.end]}</td>
                    <td style={{ padding:'9px 12px', border:'1px solid var(--rule)', fontFamily:'DM Mono,monospace' }}>{p.lms ? p.lms.toLocaleString() : '—'}</td>
                    <td style={{ padding:'9px 12px', border:'1px solid var(--rule)', color:'var(--ink-muted)', maxWidth:140, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p.pm || '—'}</td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={7} style={{ padding:'32px', textAlign:'center', color:'var(--ink-muted)' }}>No projects match your filters.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
        </>
      )}
    </div>
  )
}

// ── Gantt Chart ────────────────────────────────────────────
function GanttChart({ projects }) {
  if (projects.length === 0) {
    return (
      <div style={{ padding:'32px', textAlign:'center', color:'var(--ink-muted)' }}>
        No projects match filters.
      </div>
    )
  }

  const COL_PCT = 100 / 12

  return (
    <div style={{ overflowY:'auto', maxHeight:400 }}>
      {/* Month headers */}
      <div style={{ display:'flex', borderBottom:'1px solid var(--rule)', paddingBottom:6, marginBottom:4, position:'sticky', top:0, background:'white', zIndex:2 }}>
        <div style={{ width:240, flexShrink:0 }} />
        <div style={{ flex:1, display:'grid', gridTemplateColumns:'repeat(12,1fr)' }}>
          {MONTHS.map(m => (
            <div key={m} style={{ textAlign:'center', fontSize:10, fontWeight:600, color:'var(--ink-muted)', textTransform:'uppercase', letterSpacing:'0.5px' }}>
              {m}
            </div>
          ))}
        </div>
      </div>

      {/* Rows */}
      {projects.map((p, i) => {
        const color  = VIBE_COLORS[p.type] || '#888'
        const left   = `${p.start * COL_PCT}%`
        const width  = `${(p.end - p.start + 1) * COL_PCT}%`
        const statusDot = p.status === 'In Progress' ? '●' : p.status === 'Done' ? '✓' : '○'

        return (
          <div key={i} style={{ display:'flex', alignItems:'center', borderBottom:'1px solid var(--paper-warm)', minHeight:32 }}
            onMouseEnter={e => e.currentTarget.style.background='var(--paper-warm)'}
            onMouseLeave={e => e.currentTarget.style.background='transparent'}
          >
            <div style={{ width:240, flexShrink:0, paddingRight:12, overflow:'hidden' }}>
              <div style={{ fontSize:12, fontWeight:500, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{p.name}</div>
              <div style={{ fontSize:10, color:'var(--ink-muted)' }}>{statusDot} {p.status}</div>
            </div>
            <div style={{ flex:1, position:'relative', height:32, display:'flex', alignItems:'center' }}>
              {/* Month grid lines */}
              {MONTHS.map((_, mi) => (
                <div key={mi} style={{ position:'absolute', left:`${mi*COL_PCT}%`, top:0, bottom:0, width:1, background:'var(--paper-warm)' }} />
              ))}
              {/* Bar */}
              <div
                title={`${p.name} (${p.type}) · ${MONTHS[p.start]}–${MONTHS[p.end]}`}
                style={{
                  position:'absolute', left, width,
                  height:18, borderRadius:4,
                  background:color, opacity:0.85,
                  display:'flex', alignItems:'center', padding:'0 6px',
                  fontSize:10, fontWeight:600, color:'white',
                  overflow:'hidden', whiteSpace:'nowrap', textOverflow:'ellipsis',
                  cursor:'default'
                }}
              >
                {p.name}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

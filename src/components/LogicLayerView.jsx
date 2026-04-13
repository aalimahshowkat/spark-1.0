/**
 * LogicLayerView.jsx — Logic Layer Tab
 *
 * Shows the output of the Python-equivalent calculation engine:
 *   1. Phase assignment preview (per project × role)
 *   2. Demand lookup results (hours per phase)
 *   3. Monthly aggregations (role × month demand table)
 *   4. Capacity calculations (FTE, raw, effective)
 *   5. Effort equivalent totals
 *
 * This sits ALONGSIDE existing dashboard tabs — does not replace them.
 * As engine accuracy improves, these numbers will match the existing charts.
 */

import React, { useRef, useState, useEffect, useMemo } from 'react'
import { ingestExcelFile } from '../engine/ingest.js'
import { runCalculations, computeCapacity, computeEffortEquivalent, getPeopleList } from '../engine/calculate.js'
import { PHASE_NA } from '../engine/phaseEngine.js'
import { MONTHS, PRIMARY_ROLES, FTE_COUNT, ATTRITION_FACTOR, HRS_PER_PERSON_MONTH } from '../engine/schema.js'
import { runValidation } from '../engine/validate.js'
import { Bar, Line } from 'react-chartjs-2'
import { ActionButton, Mono } from './ui'
import { downloadTableCsv, exportChartPng } from '../lib/export'

// ─── Styles ───────────────────────────────────────────────────────────────
const S = {
  card:      { background:'white', border:'1px solid var(--rule)', borderRadius:10, overflow:'hidden', marginBottom:20 },
  cardHead:  { padding:'14px 20px', borderBottom:'1px solid var(--rule)', display:'flex', alignItems:'center', justifyContent:'space-between' },
  cardTitle: { fontFamily:'DM Serif Display,serif', fontSize:16, letterSpacing:'-0.3px' },
  cardBody:  { padding:20 },
  tag:       { fontFamily:'DM Mono,monospace', fontSize:10, padding:'3px 8px', borderRadius:4, background:'var(--paper-warm)', color:'var(--ink-muted)', fontWeight:500 },
  table:     { width:'100%', borderCollapse:'collapse', fontSize:12 },
  th:        { padding:'8px 12px', border:'1px solid var(--rule)', fontWeight:600, fontSize:11, textTransform:'uppercase', letterSpacing:'0.5px', color:'var(--ink-muted)', background:'var(--paper-warm)', textAlign:'left', whiteSpace:'nowrap' },
  thC:       { padding:'8px 12px', border:'1px solid var(--rule)', fontWeight:600, fontSize:11, textTransform:'uppercase', letterSpacing:'0.5px', color:'var(--ink-muted)', background:'var(--paper-warm)', textAlign:'center', whiteSpace:'nowrap' },
  td:        { padding:'7px 12px', border:'1px solid var(--rule)', verticalAlign:'top' },
  tdMono:    { padding:'7px 12px', border:'1px solid var(--rule)', fontFamily:'DM Mono,monospace', fontSize:11, textAlign:'right' },
  tdMonoC:   { padding:'7px 12px', border:'1px solid var(--rule)', fontFamily:'DM Mono,monospace', fontSize:11, textAlign:'center' },
  subTabBar: { display:'flex', gap:0, borderBottom:'1px solid var(--rule)', marginBottom:20 },
  subTab:    (a) => ({ padding:'10px 18px', fontSize:13, fontWeight:a?600:500, color:a?'var(--accent)':'var(--ink-muted)', borderBottom:`2px solid ${a?'var(--accent)':'transparent'}`, cursor:'pointer', background:'none', border:'none', borderBottomWidth:2, borderBottomStyle:'solid', borderBottomColor:a?'var(--accent)':'transparent', fontFamily:'Instrument Sans,sans-serif' }),
  kpi:       { background:'white', border:'1px solid var(--rule)', borderRadius:8, padding:'14px 16px' },
  kpiLabel:  { fontSize:11, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.8px', color:'var(--ink-muted)', marginBottom:6 },
  kpiValue:  { fontFamily:'DM Serif Display,serif', fontSize:28, letterSpacing:'-0.5px', lineHeight:1 },
  kpiSub:    { fontSize:11, color:'var(--ink-muted)', marginTop:4 },
  grid3:     { display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:16, marginBottom:20 },
  grid4:     { display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:16, marginBottom:20 },
  pill:      (c) => ({ display:'inline-block', padding:'2px 8px', borderRadius:10, fontSize:11, fontWeight:600, background:c==='ok'?'var(--green-light)':c==='warn'?'var(--amber-light)':'var(--red-light)', color:c==='ok'?'var(--green)':c==='warn'?'var(--amber)':'var(--red)' }),
}

const ROLE_COLOR = { CSM:'#2857a4', PM:'#2a7a52', Analyst:'#6b3fa0', 'Analyst 1':'#6b3fa0', 'Analyst 2':'#8b5cf6', SE:'#7c8090' }
const VIBE_COLOR = { Bond:'#2857a4', Validate:'#2a7a52', Integrate:'#c84b31', Explore:'#c47b1a' }
const ROLE_UI = ['CSM', 'PM', 'Analyst']

// ─────────────────────────────────────────────────────────────────────────
export default function LogicLayerView({ uploadedFile, startTab }) {
  const [ingestResult, setIngestResult] = useState(null)
  const [calcResult,   setCalcResult]   = useState(null)
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState(null)
  const validationOnly = startTab === 'validation'
  const [subTab,       setSubTab]       = useState(validationOnly ? 'validation' : 'capacity')

  useEffect(() => {
    if (!uploadedFile) return
    setLoading(true)
    setError(null)

    // Support persisted base ingest
    if (uploadedFile?.kind === 'ingest' && uploadedFile.ingest) {
      const ingest = uploadedFile.ingest
      setIngestResult(ingest)
      const calc = runCalculations(ingest.projects, ingest.demandMatrix, ingest.orbitMultipliers)
      setCalcResult(calc)
      setLoading(false)
      return
    }

    const file =
      (uploadedFile?.kind === 'file' && uploadedFile.file) ? uploadedFile.file :
      (uploadedFile instanceof File ? uploadedFile : null)

    if (!file) {
      setIngestResult(null)
      setCalcResult(null)
      setError('No workbook file available. Upload a workbook to run Logic/Validation, or switch to a saved Base dataset.')
      setLoading(false)
      return
    }

    ingestExcelFile(file)
      .then(ingest => {
        setIngestResult(ingest)
        const calc = runCalculations(ingest.projects, ingest.demandMatrix, ingest.orbitMultipliers)
        setCalcResult(calc)
        setLoading(false)
      })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [uploadedFile])

  if (!uploadedFile) return <NoFile />
  if (loading)       return <Loading />
  if (error)         return <ErrorMsg msg={error} />

  return (
    <div>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'baseline', gap:12, marginBottom:24 }}>
        <h1 style={{ fontFamily:'DM Serif Display,serif', fontSize:26, letterSpacing:'-0.5px' }}>
          {validationOnly ? 'Validation Layer' : 'Logic Layer'}
        </h1>
        <span style={{ fontSize:13, color:'var(--ink-muted)' }}>
          {validationOnly
            ? 'Parity check — SPARK Engine output vs Excel Capacity Model (temporary)'
            : 'Phase engine · Demand lookup · Aggregation · Capacity · Effort equivalent'}
        </span>
      </div>

      {!validationOnly && (
        <>
          {/* Sub-tabs */}
          <div style={S.subTabBar}>
            {[
              { id:'capacity', label:'Capacity & Demand' },
              { id:'phases',   label:'Phase Assignment' },
              { id:'people',   label:'People Utilization' },
              { id:'effort',   label:'Effort Equivalent' },
              { id:'debug',    label:'Assignment Debug' },
            ].map(t => (
              <button key={t.id} style={S.subTab(subTab===t.id)} onClick={()=>setSubTab(t.id)}>{t.label}</button>
            ))}
          </div>

          {calcResult && ingestResult && (
            <>
              {subTab === 'capacity' && <CapacityTab  calc={calcResult} />}
              {subTab === 'phases'   && <PhasesTab    calc={calcResult} projects={ingestResult.projects} />}
              {subTab === 'people'   && <PeopleTab    calc={calcResult} />}
              {subTab === 'effort'   && <EffortTab    calc={calcResult} />}
              {subTab === 'debug'    && <DebugTab     calc={calcResult} />}
            </>
          )}
        </>
      )}

      {validationOnly && calcResult && (
        <ValidationTab uploadedFile={uploadedFile} calcResult={calcResult} />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// TAB: CAPACITY & DEMAND
// ─────────────────────────────────────────────────────────────────────────
function CapacityTab({ calc }) {
  const { demandByRole, capacity, annualDemand, monthsOverEffective, peakMonths } = calc
  const [selectedRole, setSelectedRole] = useState('CSM')
  const [includeAnalyst2, setIncludeAnalyst2] = useState(false)
  const tableRef = useRef(null)

  const isAnalyst = selectedRole === 'Analyst'
  const capKey = isAnalyst ? 'Analyst 1' : selectedRole
  const cap     = capacity[capKey] || {}

  const aBase = calc?.analystModel?.demandBase || demandByRole?.['Analyst 1'] || new Array(12).fill(0)
  const aInc  = calc?.analystModel?.demandIncremental || demandByRole?.['Analyst 2'] || new Array(12).fill(0)
  const aTot  = calc?.analystModel?.demandTotal || aBase.map((v, i) => v + (aInc[i] || 0))

  const monthly = isAnalyst
    ? (includeAnalyst2 ? aTot : aBase)
    : (demandByRole[selectedRole] || new Array(12).fill(0))

  const annDem  = isAnalyst
    ? Math.round(monthly.reduce((a, b) => a + (b || 0), 0))
    : (annualDemand[selectedRole] || 0)
  const annUtil = cap.rawAnnual ? ((annDem / cap.rawAnnual) * 100).toFixed(1) : '—'
  const effUtil = cap.effectiveAnnual ? ((annDem / cap.effectiveAnnual) * 100).toFixed(1) : '—'

  return (
    <>
      {/* Role selector */}
      <div style={{ display:'flex', gap:8, marginBottom:20 }}>
        {ROLE_UI.map(r => (
          <button key={r} onClick={() => setSelectedRole(r)} style={{
            padding:'7px 16px', borderRadius:20, border:`1.5px solid ${selectedRole===r ? ROLE_COLOR[r] : 'var(--rule)'}`,
            background: selectedRole===r ? ROLE_COLOR[r]+'22' : 'white',
            color: selectedRole===r ? ROLE_COLOR[r] : 'var(--ink-muted)',
            fontFamily:'Instrument Sans,sans-serif', fontSize:12, fontWeight:600, cursor:'pointer'
          }}>{r}</button>
        ))}
      </div>

      {isAnalyst && (
        <div style={{ display:'flex', alignItems:'center', gap:10, margin:'-8px 0 18px', flexWrap:'wrap' }}>
          <span style={{ fontSize: 12, color: 'var(--ink-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px' }}>
            Analyst modeling
          </span>
          <label style={{ display:'flex', alignItems:'center', gap:8, fontSize: 12.5, color: 'var(--ink)', cursor:'pointer' }}>
            <input type="checkbox" checked={includeAnalyst2} onChange={e => setIncludeAnalyst2(e.target.checked)} />
            Include Analyst 2 demand (incremental)
          </label>
          <span style={{ fontSize: 11.5, color: 'var(--ink-muted)' }}>Capacity remains tied to Analyst 1.</span>
        </div>
      )}

      {/* KPIs */}
      <div style={S.grid4}>
        <div style={S.kpi}><div style={S.kpiLabel}>Annual Demand</div><div style={S.kpiValue}>{annDem.toLocaleString()}</div><div style={S.kpiSub}>hrs (engine)</div></div>
        <div style={S.kpi}><div style={S.kpiLabel}>Raw Capacity</div><div style={S.kpiValue}>{(cap.rawAnnual||0).toLocaleString()}</div><div style={S.kpiSub}>{cap.fte} FTE × 160 × 12</div></div>
        <div style={S.kpi}><div style={S.kpiLabel}>Effective Cap (80%)</div><div style={S.kpiValue}>{(cap.effectiveAnnual||0).toLocaleString()}</div><div style={S.kpiSub}>after attrition</div></div>
        <div style={S.kpi}>
          <div style={S.kpiLabel}>Months Over Eff. Cap</div>
          <div style={S.kpiValue}>
            {isAnalyst
              ? (includeAnalyst2 ? (calc?.analystModel?.monthsOverEffective?.total ?? aTot.filter(v => v > (cap.effectiveMonthly || 0)).length) : (calc?.analystModel?.monthsOverEffective?.base ?? aBase.filter(v => v > (cap.effectiveMonthly || 0)).length))
              : (monthsOverEffective[capKey] || 0)}
          </div>
          <div style={S.kpiSub}>of 12</div>
        </div>
      </div>

      {/* Monthly table */}
      <div style={S.card}>
        <div style={S.cardHead}>
          <span style={S.cardTitle}>Month-by-Month: {selectedRole}</span>
          <span style={S.tag}>{cap.fte} FTE · {cap.rawMonthly} raw hrs/mo · {cap.effectiveMonthly} eff. hrs/mo</span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <ActionButton onClick={() => downloadTableCsv(tableRef, `SPARK_LogicLayer_${selectedRole}_MonthByMonth.csv`)}>
              Download Table
            </ActionButton>
          </div>
        </div>
        <div style={{ ...S.cardBody, padding:0 }}>
          <table ref={tableRef} style={S.table}>
            <thead><tr>
              <th style={S.th}>Month</th>
              {isAnalyst ? (
                <>
                  <th style={S.thC}>Demand A1</th>
                  <th style={S.thC}>Demand A2</th>
                  <th style={S.thC}>Demand Total</th>
                </>
              ) : (
                <th style={S.thC}>Demand Hrs</th>
              )}
              <th style={S.thC}>Raw Cap</th>
              <th style={S.thC}>Eff. Cap (80%)</th>
              <th style={S.thC}>Util %</th>
              <th style={S.thC}>Eff. Util %</th>
              <th style={S.thC}>FTE Needed</th>
              <th style={S.thC}>Status</th>
            </tr></thead>
            <tbody>
              {MONTHS.map((mo, i) => {
                const dem     = Math.round(monthly[i] || 0)
                const demA1   = isAnalyst ? Math.round(aBase[i] || 0) : null
                const demA2   = isAnalyst ? Math.round(aInc[i] || 0) : null
                const demTot  = isAnalyst ? Math.round(aTot[i] || 0) : null
                const rawCap  = cap.rawMonthly || 0
                const effCap  = cap.effectiveMonthly || 0
                const util    = rawCap ? ((dem/rawCap)*100).toFixed(1) : '—'
                const eUtil   = effCap ? ((dem/effCap)*100).toFixed(1) : '—'
                const fteNeed = HRS_PER_PERSON_MONTH ? (dem/HRS_PER_PERSON_MONTH).toFixed(2) : '—'
                const over    = dem > effCap
                const high    = dem > rawCap * 0.8
                const status  = over ? 'over' : high ? 'warn' : 'ok'
                const statusText = over ? '🔴 Over' : high ? '🟡 High' : '🟢 OK'
                return (
                  <tr key={mo} style={{ background: i%2===0?'white':'var(--paper-warm)' }}>
                    <td style={S.td}><strong>{mo}</strong></td>
                    {isAnalyst ? (
                      <>
                        <td style={{ ...S.tdMono, fontWeight: 500 }}>{demA1.toLocaleString()}</td>
                        <td style={{ ...S.tdMono, color: 'var(--ink-muted)' }}>{demA2.toLocaleString()}</td>
                        <td style={{ ...S.tdMono, fontWeight: 700 }}>{demTot.toLocaleString()}</td>
                      </>
                    ) : (
                      <td style={{ ...S.tdMono, color: over?'var(--red)':over?'var(--amber)':'inherit', fontWeight: over?700:400 }}>{dem.toLocaleString()}</td>
                    )}
                    <td style={{ ...S.tdMono, color:'var(--ink-muted)' }}>{rawCap.toLocaleString()}</td>
                    <td style={{ ...S.tdMono, color:'var(--ink-muted)' }}>{effCap.toLocaleString()}</td>
                    <td style={S.tdMonoC}>{util}%</td>
                    <td style={{ ...S.tdMonoC, color: over?'var(--red)':high?'var(--amber)':'inherit', fontWeight: over?700:400 }}>{eUtil}%</td>
                    <td style={S.tdMonoC}>{fteNeed}</td>
                    <td style={{ ...S.td, textAlign:'center' }}><span style={S.pill(status)}>{statusText}</span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// TAB: PHASE ASSIGNMENT
// ─────────────────────────────────────────────────────────────────────────
function PhasesTab({ calc, projects }) {
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('CSM')
  const [caseView, setCaseView] = useState('driver')
  const tableRef = useRef(null)

  const shown = useMemo(() => {
    return projects
      .filter(p => p.startDate && p.deliveryDate)
      .filter(p => !search || p.name.toLowerCase().includes(search.toLowerCase()))
      .slice(0, 20)
  }, [projects, search])

  return (
    <>
      <div style={{ display:'flex', gap:12, marginBottom:16, alignItems:'center' }}>
        <input placeholder="Search projects…" value={search} onChange={e=>setSearch(e.target.value)}
          style={{ padding:'7px 12px', border:'1px solid var(--rule)', borderRadius:6, fontSize:13, fontFamily:'Instrument Sans,sans-serif', outline:'none', width:240 }} />
        <select value={caseView} onChange={e=>setCaseView(e.target.value)}
          style={{ padding:'7px 10px', border:'1px solid var(--rule)', borderRadius:6, fontSize:12, background:'white', fontFamily:'Instrument Sans,sans-serif' }}>
          <option value="driver">Driver Phase (used for hours)</option>
          <option value="case1">Case 1 - Adjusted Start Timeline</option>
          <option value="case2">Case 2 - Project Timeline (Standard)</option>
          <option value="case3">Case 3 - Adjusted Analytics Timeline</option>
          <option value="case4">Case 4 - Analytics Timeline</option>
        </select>
        <div style={{ display:'flex', gap:6 }}>
          {['CSM','PM','Analyst 1','Analyst 2','SE'].map(r => (
            <button key={r} onClick={()=>setRoleFilter(r)} style={{
              padding:'5px 12px', borderRadius:16, border:`1.5px solid ${roleFilter===r?ROLE_COLOR[r]:'var(--rule)'}`,
              background:roleFilter===r?ROLE_COLOR[r]+'22':'white', color:roleFilter===r?ROLE_COLOR[r]:'var(--ink-muted)',
              fontFamily:'Instrument Sans,sans-serif', fontSize:11, fontWeight:600, cursor:'pointer'
            }}>{r}</button>
          ))}
        </div>
      </div>

      <div style={S.card}>
        <div style={S.cardHead}>
          <span style={S.cardTitle}>Phase Assignment — {roleFilter}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={S.tag}>{shown.length} projects shown</span>
            <ActionButton onClick={() => {
              const safeRole = String(roleFilter).replace(/\s+/g, '')
              downloadTableCsv(tableRef, `SPARK_LogicLayer_PhaseAssignment_${safeRole}_${caseView}.csv`)
            }}>
              Download Table
            </ActionButton>
          </div>
        </div>
        <div style={{ ...S.cardBody, padding:0, overflowX:'auto' }}>
          <table ref={tableRef} style={S.table}>
            <thead><tr>
              <th style={S.th}>Project</th>
              <th style={S.th}>VIBE</th>
              <th style={S.th}>Start</th>
              <th style={S.th}>Delivery</th>
              <th style={S.th}>Analytics Start</th>
              {MONTHS.map(m=><th key={m} style={S.thC}>{m}</th>)}
            </tr></thead>
            <tbody>
              {shown.map((p, i) => {
                const byMonth = new Array(12).fill(PHASE_NA)
                const rows = calc.assignments
                  .filter(r => r.projectId === p.id && r.role === roleFilter)
                  .sort((a,b) => a.monthIndex - b.monthIndex)

                for (const r of rows) {
                  const v =
                    caseView === 'driver' ? (r.phase || PHASE_NA) :
                    caseView === 'case1'  ? (r.case1 || PHASE_NA) :
                    caseView === 'case2'  ? (r.case2 || PHASE_NA) :
                    caseView === 'case3'  ? (r.case3 || PHASE_NA) :
                    caseView === 'case4'  ? (r.case4 || PHASE_NA) :
                    (r.phase || PHASE_NA)
                  byMonth[r.monthIndex] = v
                }
                return (
                  <tr key={p.id} style={{ background:i%2===0?'white':'var(--paper-warm)' }}>
                    <td style={{ ...S.td, fontWeight:500, maxWidth:180, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p.name}</td>
                    <td style={S.td}><span style={{ color:VIBE_COLOR[p.vibeType]||'#888', fontWeight:600, fontSize:11 }}>{p.vibeType}</span></td>
                    <td style={{ ...S.tdMono, textAlign:'left', fontSize:10 }}>{fmtDate(p.startDate)}</td>
                    <td style={{ ...S.tdMono, textAlign:'left', fontSize:10 }}>{fmtDate(p.deliveryDate)}</td>
                    <td style={{ ...S.tdMono, textAlign:'left', fontSize:10 }}>{fmtDate(p.analyticsStartDate)}</td>
                    {byMonth.map((ph, mi) => (
                      <td key={mi} style={{ ...S.tdMonoC, fontSize:9, padding:'4px 3px', background: phaseColor(ph), color: (ph && ph !== PHASE_NA)?'var(--ink)':'var(--rule)' }}>
                        {ph === PHASE_NA ? '' : phaseShort(ph)}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Phase legend */}
      <div style={{ display:'flex', gap:12, flexWrap:'wrap', fontSize:11, color:'var(--ink-muted)' }}>
        {[['M0','#dbeafe'],['M1','#e0f2fe'],['Mid','#f0fdf4'],['M-1','#fef9c3'],['End','#fee2e2'],['E+','#fce7f3'],['E1+','#f3e8ff']]
          .map(([label,color])=>(
          <div key={label} style={{ display:'flex', alignItems:'center', gap:4 }}>
            <div style={{ width:12,height:12,borderRadius:2,background:color,border:'1px solid var(--rule)' }}/>
            {label}
          </div>
        ))}
        <div style={{ display:'flex', alignItems:'center', gap:4 }}>
          <div style={{ width:12,height:12,borderRadius:2,background:'var(--paper)' }}/>—
        </div>
      </div>
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// TAB: PEOPLE UTILIZATION
// ─────────────────────────────────────────────────────────────────────────
function PeopleTab({ calc }) {
  const [roleFilter, setRoleFilter] = useState('CSM')
  const [includeAnalyst2, setIncludeAnalyst2] = useState(false)
  const peopleList = useMemo(() => getPeopleList(calc.demandByPerson), [calc])
  const isAnalyst = roleFilter === 'Analyst'

  const basePeople = peopleList['Analyst 1'] || []
  const incPeople = peopleList['Analyst 2'] || []
  const totalPeople = useMemo(() => {
    const map = new Map()
    const add = (arr, kind) => {
      for (const p of (arr || [])) {
        if (!map.has(p.name)) map.set(p.name, { name: p.name, base: new Array(12).fill(0), inc: new Array(12).fill(0) })
        const row = map.get(p.name)
        const src = p.monthly || new Array(12).fill(0)
        for (let i = 0; i < 12; i++) row[kind][i] += (src[i] || 0)
      }
    }
    add(basePeople, 'base')
    add(incPeople, 'inc')
    const out = []
    for (const row of map.values()) {
      const monthly = row.base.map((v, i) => Math.round(v + (row.inc[i] || 0)))
      out.push({ name: row.name, monthly, total: Math.round(monthly.reduce((a, b) => a + (b || 0), 0)) })
    }
    out.sort((a, b) => b.total - a.total)
    return out
  }, [basePeople, incPeople])

  const people = isAnalyst
    ? (includeAnalyst2 ? totalPeople : basePeople)
    : (peopleList[roleFilter] || [])
  const tableRef = useRef(null)

  return (
    <>
      <div style={{ display:'flex', gap:8, marginBottom:20 }}>
        {ROLE_UI.map(r => (
          <button key={r} onClick={()=>setRoleFilter(r)} style={{
            padding:'7px 16px', borderRadius:20, border:`1.5px solid ${roleFilter===r?ROLE_COLOR[r]:'var(--rule)'}`,
            background:roleFilter===r?ROLE_COLOR[r]+'22':'white', color:roleFilter===r?ROLE_COLOR[r]:'var(--ink-muted)',
            fontFamily:'Instrument Sans,sans-serif', fontSize:12, fontWeight:600, cursor:'pointer'
          }}>{r}</button>
        ))}
      </div>

      {isAnalyst && (
        <div style={{ display:'flex', alignItems:'center', gap:10, margin:'-8px 0 18px', flexWrap:'wrap' }}>
          <span style={{ fontSize: 12, color: 'var(--ink-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px' }}>
            Analyst modeling
          </span>
          <label style={{ display:'flex', alignItems:'center', gap:8, fontSize: 12.5, color: 'var(--ink)', cursor:'pointer' }}>
            <input type="checkbox" checked={includeAnalyst2} onChange={e => setIncludeAnalyst2(e.target.checked)} />
            Include Analyst 2 demand (incremental)
          </label>
          <span style={{ fontSize: 11.5, color: 'var(--ink-muted)' }}>Totals become Analyst 1 + Analyst 2.</span>
        </div>
      )}

      {people.length === 0 ? (
        <div style={{ padding:32, textAlign:'center', color:'var(--ink-muted)', background:'white', borderRadius:10, border:'1px solid var(--rule)' }}>
          No named people found for {roleFilter}
        </div>
      ) : (
        <div style={S.card}>
          <div style={S.cardHead}>
            <span style={S.cardTitle}>{roleFilter} — Monthly Hours (Engine Calculated)</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={S.tag}>{people.length} people · 1,920 hrs/yr capacity</span>
              <ActionButton onClick={() => {
                const safeRole = String(roleFilter).replace(/\s+/g, '')
                downloadTableCsv(tableRef, `SPARK_LogicLayer_PeopleUtilization_${safeRole}.csv`)
              }}>
                Download Table
              </ActionButton>
            </div>
          </div>
          <div style={{ ...S.cardBody, padding:0, overflowX:'auto' }}>
            <table ref={tableRef} style={S.table}>
              <thead><tr>
                <th style={S.th}>Person</th>
                {MONTHS.map(m=><th key={m} style={S.thC}>{m}</th>)}
                <th style={S.thC}>Total</th>
                <th style={S.thC}>Util %</th>
              </tr></thead>
              <tbody>
                {people.map((p, i) => {
                  const annPct = (p.total / 1920 * 100).toFixed(0)
                  const over = p.total > 1920
                  return (
                    <tr key={p.name} style={{ background:i%2===0?'white':'var(--paper-warm)' }}>
                      <td style={{ ...S.td, fontWeight:500 }}>{p.name}</td>
                      {p.monthly.map((h, mi) => {
                        const pct = h/160*100
                        return (
                          <td key={mi} style={{ ...S.tdMonoC, fontSize:11, background:heatColor(pct), color:pct>110?'#7a2e1e':'inherit' }}>
                            {h > 0 ? h : '—'}
                          </td>
                        )
                      })}
                      <td style={{ ...S.tdMonoC, fontWeight:700, color:over?'var(--red)':'inherit' }}>{p.total.toLocaleString()}</td>
                      <td style={{ ...S.tdMonoC, fontWeight:600, color:over?'var(--red)':+annPct>80?'var(--amber)':'var(--green)' }}>{annPct}%</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// TAB: EFFORT EQUIVALENT
// ─────────────────────────────────────────────────────────────────────────
function EffortTab({ calc }) {
  const { assignments } = calc

  // Aggregate effort by role × month
  const effortByRole = useMemo(() => {
    const result = {}
    PRIMARY_ROLES.forEach(r => { result[r] = new Array(12).fill(0) })
    for (const row of assignments) {
      if (!result[row.role]) result[row.role] = new Array(12).fill(0)
      result[row.role][row.monthIndex] += row.effortEquivalent || 0
    }
    return result
  }, [assignments])

  return (
    <>
      <div style={{ padding:'12px 16px', background:'var(--amber-light)', border:'1px solid #f5e0a0', borderRadius:8, marginBottom:20, fontSize:13, color:'#7a4a00' }}>
        ⚠️ <strong>Note:</strong> Effort equivalent rates (AB column constants from Excel) were not accessible.
        Currently using 1:1 passthrough (effort = hours). Update <code style={{fontFamily:'DM Mono,monospace'}}>EFFORT_RATES</code> in <code style={{fontFamily:'DM Mono,monospace'}}>schema.js</code> once confirmed.
      </div>

      <div style={S.card}>
        <div style={S.cardHead}>
          <span style={S.cardTitle}>Effort Equivalent by Role × Month</span>
          <span style={S.tag}>Effort = Hours × Rate</span>
        </div>
        <div style={{ ...S.cardBody, padding:0, overflowX:'auto' }}>
          <table style={S.table}>
            <thead><tr>
              <th style={S.th}>Role</th>
              {MONTHS.map(m=><th key={m} style={S.thC}>{m}</th>)}
              <th style={S.thC}>Annual Total</th>
            </tr></thead>
            <tbody>
              {PRIMARY_ROLES.map((role, i) => {
                const monthly = effortByRole[role] || []
                const total   = monthly.reduce((a,b)=>a+b,0)
                return (
                  <tr key={role} style={{ background:i%2===0?'white':'var(--paper-warm)' }}>
                    <td style={{ ...S.td, fontWeight:600, color:ROLE_COLOR[role] }}>{role}</td>
                    {monthly.map((v,mi)=>(
                      <td key={mi} style={S.tdMonoC}>{Math.round(v).toLocaleString()}</td>
                    ))}
                    <td style={{ ...S.tdMono, fontWeight:700 }}>{Math.round(total).toLocaleString()}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// TAB: ASSIGNMENT DEBUG
// ─────────────────────────────────────────────────────────────────────────
function DebugTab({ calc }) {
  const [search, setSearch] = useState('')
  const [roleF,  setRoleF]  = useState('CSM')
  const tableRef = useRef(null)

  const rows = useMemo(() => {
    return calc.assignments
      .filter(r => r.role === roleF)
      .filter(r => r.finalHours > 0)
      .filter(r => !search || r.projectName.toLowerCase().includes(search.toLowerCase()))
      .slice(0, 100)
  }, [calc.assignments, roleF, search])

  return (
    <>
      <div style={{ display:'flex', gap:12, marginBottom:16, alignItems:'center' }}>
        <input placeholder="Filter project…" value={search} onChange={e=>setSearch(e.target.value)}
          style={{ padding:'7px 12px', border:'1px solid var(--rule)', borderRadius:6, fontSize:13, fontFamily:'Instrument Sans,sans-serif', outline:'none', width:220 }} />
        <div style={{ display:'flex', gap:6 }}>
          {PRIMARY_ROLES.map(r=>(
            <button key={r} onClick={()=>setRoleF(r)} style={{
              padding:'5px 12px', borderRadius:16, border:`1.5px solid ${roleF===r?ROLE_COLOR[r]:'var(--rule)'}`,
              background:roleF===r?ROLE_COLOR[r]+'22':'white', color:roleF===r?ROLE_COLOR[r]:'var(--ink-muted)',
              fontFamily:'Instrument Sans,sans-serif', fontSize:11, fontWeight:600, cursor:'pointer'
            }}>{r}</button>
          ))}
        </div>
        <span style={{ fontSize:12, color:'var(--ink-muted)' }}>{rows.length} rows (max 100)</span>
      </div>

      <div style={S.card}>
        <div style={S.cardHead}>
          <span style={S.cardTitle}>Assignment Debug — {roleF}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={S.tag}>{rows.length} rows (max 100)</span>
            <ActionButton onClick={() => {
              const safeRole = String(roleF).replace(/\s+/g, '')
              downloadTableCsv(tableRef, `SPARK_LogicLayer_AssignmentDebug_${safeRole}.csv`)
            }}>
              Download Table
            </ActionButton>
          </div>
        </div>
        <div style={{ ...S.cardBody, padding:0, overflowX:'auto', maxHeight:500 }}>
          <table ref={tableRef} style={S.table}>
            <thead style={{ position:'sticky', top:0, zIndex:2 }}><tr>
              {[
                'Project','VIBE','Month',
                'Driver Phase',
                'Case 1 - Adjusted Start Timeline',
                'Case 2 - Project Timeline (Standard)',
                'Case 3 - Adjusted Analytics Timeline',
                'Case 4 - Analytics Timeline',
                'Person','Orbit','LM Mult','Calc Hrs','Final Hrs','Effort Eq'
              ].map(h=>(
                <th key={h} style={h==='Project'?S.th:S.thC}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {rows.map((r,i)=>(
                <tr key={i} style={{ background:i%2===0?'white':'var(--paper-warm)' }}>
                  <td style={{ ...S.td, maxWidth:180, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontWeight:500 }}>{r.projectName}</td>
                  <td style={{ ...S.td, color:VIBE_COLOR[r.vibeType], fontWeight:600, fontSize:11 }}>{r.vibeType}</td>
                  <td style={S.tdMonoC}>{MONTHS[r.monthIndex]}</td>
                  <td style={{ ...S.tdMono, fontSize:10, textAlign:'left' }}>{r.phase || '—'}</td>
                  <td style={{ ...S.tdMono, fontSize:10, textAlign:'left' }}>{r.case1 || '—'}</td>
                  <td style={{ ...S.tdMono, fontSize:10, textAlign:'left' }}>{r.case2 || '—'}</td>
                  <td style={{ ...S.tdMono, fontSize:10, textAlign:'left' }}>{r.case3 || '—'}</td>
                  <td style={{ ...S.tdMono, fontSize:10, textAlign:'left' }}>{r.case4 || '—'}</td>
                  <td style={{ ...S.td, fontSize:11, maxWidth:120, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.person || '—'}</td>
                  <td style={S.tdMonoC}>{r.orbit}</td>
                  <td style={S.tdMonoC}>{r.lmMultiplier}</td>
                  <td style={S.tdMonoC}>{r.calculatedHours?.toFixed(2)}</td>
                  <td style={{ ...S.tdMonoC, fontWeight:600 }}>{r.finalHours}</td>
                  <td style={S.tdMonoC}>{r.effortEquivalent?.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

// ─── TAB: VALIDATION ─────────────────────────────────────────────────────
// Compares Logic Layer computed values (calcResult.assignments) against
// Excel Capacity Model values (ground truth). This is NOT a pass-through —
// it reveals real differences between what the engine computes and what Excel shows.

const VAL_CATEGORY_META = {
  exact_match:       { label:'Exact Match',       color:'var(--green)',     bg:'var(--green-light)'  },
  rounding_delta:    { label:'Rounding ±1hr',     color:'#1e7b74',          bg:'#e8f5f4'             },
  value_mismatch:    { label:'Value Mismatch',    color:'var(--red)',       bg:'var(--red-light)'    },
  engine_overcounts: { label:'Engine Overcounts', color:'var(--amber)',     bg:'var(--amber-light)'  },
  engine_undercounts:{ label:'Engine Undercounts',color:'#6b3fa0',          bg:'var(--purple-light)' },
  engine_missing:    { label:'Engine Missing',    color:'var(--red)',       bg:'var(--red-light)'    },
  engine_only:       { label:'Engine Only',       color:'var(--blue)',      bg:'var(--blue-light)'   },
  both_zero:         { label:'Both Zero',         color:'var(--ink-muted)', bg:'var(--paper-warm)'   },
}

function ValidationTab({ uploadedFile, calcResult }) {
  const [valResult,   setValResult]   = useState(null)
  const [valLoading,  setValLoading]  = useState(false)
  const [valError,    setValError]    = useState(null)
  const [innerTab,    setInnerTab]    = useState('summary')

  useEffect(() => {
    if (!uploadedFile || !calcResult) return
    const file =
      (uploadedFile?.kind === 'file' && uploadedFile.file) ? uploadedFile.file :
      (uploadedFile instanceof File ? uploadedFile : null)
    if (!file) return
    setValLoading(true)
    setValError(null)
    setValResult(null)
    runValidation(file, calcResult)
      .then(r  => { setValResult(r);  setValLoading(false) })
      .catch(e => { setValError(e.message); setValLoading(false) })
  }, [uploadedFile, calcResult])

  if (valLoading) return (
    <div style={{ display:'flex', alignItems:'center', gap:12, padding:'24px 0', color:'var(--ink-muted)' }}>
      <div style={{ width:20, height:20, border:'2px solid var(--rule)', borderTopColor:'var(--accent)', borderRadius:'50%', animation:'spin 0.7s linear infinite' }} />
      <span>Comparing Logic Layer output against Capacity Model…</span>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )

  if (valError) return (
    <div style={{ background:'var(--red-light)', border:'1px solid #f5ccc4', borderRadius:8, padding:'16px 20px', color:'#7a2e1e', fontSize:13 }}>
      <strong>Validation failed:</strong> {valError}
    </div>
  )

  if (!valResult) {
    const file =
      (uploadedFile?.kind === 'file' && uploadedFile.file) ? uploadedFile.file :
      (uploadedFile instanceof File ? uploadedFile : null)
    if (!file) {
      return (
        <div style={{ background:'var(--paper-warm)', border:'1px solid var(--rule)', borderRadius:8, padding:'16px 20px', color:'var(--ink-muted)', fontSize:13 }}>
          <strong>Validation requires the uploaded workbook</strong> (to read the Excel <Mono>Capacity Model</Mono> sheet).
          Switch to an uploaded override dataset to run Validation.
        </div>
      )
    }
    return (
      <div style={{ textAlign:'center', padding:'40px', color:'var(--ink-muted)', fontSize:13 }}>
        Waiting for validation to run…
      </div>
    )
  }

  // ── Inner sub-tabs ────────────────────────────────────────────────────
  const innerTabs = [
    { id:'summary',    label:'Summary' },
    { id:'by-role',    label:'By Role' },
    { id:'by-month',   label:'By Month' },
    { id:'by-project', label:`By Project (${valResult.byProject.length})` },
    { id:'row-drill',  label:'Row Drill-Down' },
  ]

  return (
    <div>
      {/* Header banner */}
      <div style={{ background:'#e8f5f4', border:'1px solid #9fd3ce', borderRadius:8, padding:'10px 16px', marginBottom:20, fontSize:12, color:'#1e7b74', display:'flex', gap:8 }}>
        <span>🔍</span>
        <span>
          <strong>True validation.</strong> Comparing Logic Layer computed values against Excel Capacity Model (ground truth).
          Mismatches = real bugs in the engine. This is NOT a pass-through.
        </span>
      </div>

      {/* Inner navigation */}
      <div style={{ display:'flex', gap:0, borderBottom:'1px solid var(--rule)', marginBottom:20 }}>
        {innerTabs.map(t => (
          <button key={t.id} style={S.subTab(innerTab===t.id)} onClick={() => setInnerTab(t.id)}>{t.label}</button>
        ))}
      </div>

      {innerTab === 'summary'    && <ValSummaryTab    result={valResult} />}
      {innerTab === 'by-role'    && <ValByRoleTab     result={valResult} />}
      {innerTab === 'by-month'   && <ValByMonthTab    result={valResult} />}
      {innerTab === 'by-project' && <ValByProjectTab  result={valResult} />}
      {innerTab === 'row-drill'  && <ValRowDrillTab   result={valResult} />}
    </div>
  )
}

function ValSummaryTab({ result }) {
  const { summary, meta } = result
  const gaugeColor = summary.withinTolPct >= 90 ? 'var(--green)' : summary.withinTolPct >= 70 ? 'var(--amber)' : 'var(--red)'
  const monthLineRef = useRef(null)

  const catEntries = Object.entries(summary.categoryBreakdown)
    .filter(([k]) => k !== 'both_zero')
    .sort((a, b) => b[1] - a[1])

  const monthData = {
    labels: result.byMonth.map(m => m.monthLabel),
    datasets: [
      { label:'Excel (Ground Truth)', data:result.byMonth.map(m=>m.excelHours),  borderColor:'var(--ink)',    backgroundColor:'rgba(15,17,23,0.06)',   fill:true, tension:0.3, borderWidth:2, pointRadius:3 },
      { label:'Engine (Computed)',    data:result.byMonth.map(m=>m.engineHours), borderColor:'var(--accent)', backgroundColor:'rgba(200,75,49,0.06)', fill:true, tension:0.3, borderWidth:2, pointRadius:3 },
    ]
  }

  return (
    <>
      {/* Parity score */}
      <div style={{ ...S.card, borderTop:`4px solid ${gaugeColor}` }}>
        <div style={S.cardHead}>
          <span style={S.cardTitle}>Engine vs Excel Parity</span>
          <span style={{ fontFamily:'DM Mono,monospace', fontSize:10, padding:'3px 8px', borderRadius:4, background:'var(--paper-warm)', color:'var(--ink-muted)', fontWeight:500 }}>
            {meta.matchedRows.toLocaleString()} matched rows · {meta.durationMs}ms
          </span>
        </div>
        <div style={{ ...S.cardBody, display:'flex', alignItems:'center', gap:40 }}>
          <div style={{ textAlign:'center', minWidth:150 }}>
            <div style={{ fontFamily:'DM Serif Display,serif', fontSize:52, letterSpacing:'-2px', color:gaugeColor, lineHeight:1 }}>
              {summary.withinTolPct.toFixed(1)}%
            </div>
            <div style={{ fontSize:12, color:'var(--ink-muted)', marginTop:4 }}>within ±1hr of Excel</div>
            <div style={{ fontSize:11, color:'var(--ink-muted)' }}>{summary.exactMatchPct.toFixed(1)}% exact match</div>
          </div>
          <div style={{ flex:1 }}>
            <div style={{ height:22, borderRadius:6, overflow:'hidden', display:'flex', marginBottom:10 }}>
              {[
                { val: summary.exactMatchPct, color:'var(--green)', label:'Exact' },
                { val: summary.withinTolPct - summary.exactMatchPct, color:'#1e7b74', label:'±1hr' },
                { val: 100 - summary.withinTolPct, color:'var(--red)', label:'Miss' },
              ].map(({ val, color, label }) => val > 0 && (
                <div key={label} style={{ width:`${val}%`, background:color, display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, color:'white', fontWeight:600 }}>
                  {val > 5 ? `${val.toFixed(0)}%` : ''}
                </div>
              ))}
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12 }}>
              {[
                { label:'Excel Total (hrs)', value:summary.excelTotalHours.toLocaleString(), sub:'ground truth' },
                { label:'Engine Total (hrs)', value:summary.engineTotalHours.toLocaleString(), sub:'computed' },
                { label:'Aggregate Δ', value:(summary.aggregateDelta>0?'+':'')+summary.aggregateDelta.toLocaleString(), sub:`${summary.aggregateDeltaPct}% variance`, color:Math.abs(summary.aggregateDelta)<500?'var(--green)':'var(--red)' },
                { label:'Unmatched Rows', value:summary.unmatchedExcel + summary.engineOnly, sub:'Excel-only + engine-only', color:summary.unmatchedExcel+summary.engineOnly>0?'var(--amber)':'var(--green)' },
              ].map(({ label, value, sub, color }) => (
                <div key={label} style={S.kpi}>
                  <div style={S.kpiLabel}>{label}</div>
                  <div style={{ ...S.kpiValue, fontSize:22, color: color||'var(--ink)' }}>{value}</div>
                  <div style={S.kpiSub}>{sub}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Charts row */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:20, marginBottom:20 }}>
        {/* Category breakdown */}
        <div style={S.card}>
          <div style={S.cardHead}><span style={S.cardTitle}>Mismatch Categories</span></div>
          <div style={S.cardBody}>
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              {catEntries.map(([k, v]) => {
                const meta = VAL_CATEGORY_META[k] || {}
                const total = catEntries.reduce((s,[,n])=>s+n,0)
                const barW = total > 0 ? (v/total)*100 : 0
                return (
                  <div key={k} style={{ display:'flex', alignItems:'center', gap:10 }}>
                    <div style={{ width:140, fontSize:11, flexShrink:0 }}>{meta.label || k}</div>
                    <div style={{ flex:1, height:18, borderRadius:4, overflow:'hidden', background:'var(--paper-warm)' }}>
                      <div style={{ width:`${barW}%`, height:'100%', background:meta.color||'#888', minWidth:barW>0?2:0 }} />
                    </div>
                    <div style={{ fontFamily:'DM Mono,monospace', fontSize:11, width:40, textAlign:'right', fontWeight:600 }}>{v}</div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* Monthly hours line */}
        <div style={S.card}>
          <div style={S.cardHead}>
            <span style={S.cardTitle}>Monthly: Engine vs Excel</span>
            <ActionButton onClick={() => exportChartPng(monthLineRef, 'SPARK_Validation_Monthly_Engine_vs_Excel.png')}>
              Export PNG
            </ActionButton>
          </div>
          <div style={S.cardBody}>
            <div style={{ position:'relative', height:200 }}>
              <Line ref={monthLineRef} data={monthData} options={{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'bottom', labels:{ usePointStyle:true, boxWidth:8, font:{size:11} } } }, scales:{ x:{grid:{display:false}}, y:{grid:{color:'#f0ede6'},ticks:{callback:v=>v.toLocaleString()}} } }} />
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

function ValByRoleTab({ result }) {
  return (
    <div style={S.card}>
      <div style={S.cardHead}><span style={S.cardTitle}>Parity by Role — Engine vs Excel</span></div>
      <div style={{ ...S.cardBody, padding:0 }}>
        <table style={S.table}>
          <thead><tr>
            {['Role','Excel Hours','Engine Hours','Δ Hours','Δ %','Exact','Match %','Active Rows'].map(h=>(
              <th key={h} style={S.th}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {result.byRole.map((r,i) => {
              const mc = r.matchPct>=90?'var(--green)':r.matchPct>=70?'var(--amber)':'var(--red)'
              const dc = Math.abs(r.aggregateDelta)>100?'var(--red)':Math.abs(r.aggregateDelta)>10?'var(--amber)':'var(--green)'
              return (
                <tr key={r.role} style={{ background:i%2===0?'white':'var(--paper-warm)' }}>
                  <td style={{ ...S.td, fontWeight:600 }}>{r.role}</td>
                  <td style={S.tdMono}>{r.excelHours.toLocaleString()}</td>
                  <td style={S.tdMono}>{r.engineHours.toLocaleString()}</td>
                  <td style={{ ...S.tdMono, color:dc, fontWeight:600 }}>{r.aggregateDelta>0?'+':''}{r.aggregateDelta.toLocaleString()}</td>
                  <td style={{ ...S.tdMono, color:dc }}>{r.excelHours?((r.aggregateDelta/r.excelHours)*100).toFixed(1)+'%':'—'}</td>
                  <td style={S.tdMono}>{r.exactMatches.toLocaleString()}</td>
                  <td style={{ ...S.tdMono, color:mc, fontWeight:700 }}>{r.activeRows>0?r.matchPct.toFixed(1)+'%':'—'}</td>
                  <td style={S.tdMono}>{r.activeRows.toLocaleString()}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ValByMonthTab({ result }) {
  const monthBarRef = useRef(null)
  const barData = {
    labels: result.byMonth.map(m=>m.monthLabel),
    datasets: [
      { label:'Excel', data:result.byMonth.map(m=>m.excelHours),  backgroundColor:'rgba(15,17,23,0.7)',    borderRadius:3 },
      { label:'Engine',data:result.byMonth.map(m=>m.engineHours), backgroundColor:'rgba(200,75,49,0.65)', borderRadius:3 },
    ]
  }
  return (
    <>
      <div style={S.card}>
        <div style={S.cardHead}>
          <span style={S.cardTitle}>Monthly Comparison: Engine vs Excel</span>
          <ActionButton onClick={() => exportChartPng(monthBarRef, 'SPARK_Validation_Monthly_Bar.png')}>
            Export PNG
          </ActionButton>
        </div>
        <div style={S.cardBody}>
          <div style={{ position:'relative', height:220 }}>
            <Bar ref={monthBarRef} data={barData} options={{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'bottom', labels:{ usePointStyle:true, boxWidth:8, font:{size:11} } } }, scales:{ x:{grid:{display:false}}, y:{grid:{color:'#f0ede6'},ticks:{callback:v=>v.toLocaleString()}} } }} />
          </div>
        </div>
      </div>
      <div style={S.card}>
        <div style={{ ...S.cardBody, padding:0 }}>
          <table style={S.table}>
            <thead><tr>{['Month','Excel Hrs','Engine Hrs','Δ Hrs','Δ %','Exact','Match %'].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              {result.byMonth.map((m,i) => {
                const mc = m.matchPct>=90?'var(--green)':m.matchPct>=70?'var(--amber)':'var(--red)'
                const dc = Math.abs(m.aggregateDelta)>200?'var(--red)':Math.abs(m.aggregateDelta)>20?'var(--amber)':'var(--green)'
                return (
                  <tr key={m.monthLabel} style={{ background:i%2===0?'white':'var(--paper-warm)' }}>
                    <td style={{ ...S.td, fontWeight:500 }}>{m.monthLabel}</td>
                    <td style={S.tdMono}>{m.excelHours.toLocaleString()}</td>
                    <td style={S.tdMono}>{m.engineHours.toLocaleString()}</td>
                    <td style={{ ...S.tdMono, color:dc, fontWeight:600 }}>{m.aggregateDelta>0?'+':''}{m.aggregateDelta.toLocaleString()}</td>
                    <td style={{ ...S.tdMono, color:dc }}>{m.deltaPct}%</td>
                    <td style={S.tdMono}>{m.exactMatches}</td>
                    <td style={{ ...S.tdMono, fontWeight:700, color:mc }}>{m.activeRows>0?m.matchPct.toFixed(1)+'%':'—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

function ValByProjectTab({ result }) {
  const [filter, setFilter] = useState('all')
  const [sort,   setSort]   = useState('matchPct')

  const sorted = useMemo(() => {
    let rows = [...result.byProject]
    if (filter === 'issues') rows = rows.filter(p => p.matchPct < 90 && p.activeRows > 0)
    if (filter === 'good')   rows = rows.filter(p => p.matchPct >= 90)
    rows.sort((a,b) => sort === 'matchPct' ? a.matchPct - b.matchPct : Math.abs(b.aggregateDelta) - Math.abs(a.aggregateDelta))
    return rows
  }, [result.byProject, filter, sort])

  return (
    <>
      <div style={{ display:'flex', gap:8, marginBottom:16 }}>
        {[['all','All'],['issues','< 90% match'],['good','≥ 90% match']].map(([v,l]) => (
          <button key={v} onClick={()=>setFilter(v)} style={{ padding:'6px 14px', borderRadius:20, fontSize:12, fontWeight:600, border:`1.5px solid ${filter===v?'var(--accent)':'var(--rule)'}`, background:filter===v?'var(--accent-light)':'white', color:filter===v?'var(--accent)':'var(--ink-muted)', cursor:'pointer', fontFamily:'Instrument Sans,sans-serif' }}>{l}</button>
        ))}
        <select value={sort} onChange={e=>setSort(e.target.value)} style={{ padding:'6px 12px', border:'1px solid var(--rule)', borderRadius:6, fontSize:12, background:'white', marginLeft:'auto', fontFamily:'Instrument Sans,sans-serif' }}>
          <option value="matchPct">Sort: Worst first</option>
          <option value="delta">Sort: Largest delta</option>
        </select>
      </div>
      <div style={S.card}>
        <div style={{ ...S.cardBody, padding:0 }}>
          <div style={{ overflowY:'auto', maxHeight:520 }}>
            <table style={S.table}>
              <thead><tr>{['Project','VIBE','Orbit','Excel Hrs','Engine Hrs','Δ Hrs','Match %','Exact','Max Δ'].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
              <tbody>
                {sorted.map((p,i) => {
                  const mc = p.matchPct>=90?'var(--green)':p.matchPct>=70?'var(--amber)':'var(--red)'
                  const VIBE_COLOR={Bond:'#2857a4',Validate:'#2a7a52',Integrate:'#c84b31',Explore:'#c47b1a'}
                  return (
                    <tr key={p.name} style={{ background:i%2===0?'white':'var(--paper-warm)' }}>
                      <td style={{ ...S.td, fontWeight:500, maxWidth:200, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontSize:11 }}>{p.name}</td>
                      <td style={S.td}><span style={{ display:'inline-flex', alignItems:'center', gap:5 }}><span style={{ width:8, height:8, borderRadius:'50%', background:VIBE_COLOR[p.vibeType]||'#888', flexShrink:0 }} />{p.vibeType}</span></td>
                      <td style={{ ...S.tdMono, color:p.orbit==='-'?'var(--ink-muted)':'var(--ink)' }}>{p.orbit}</td>
                      <td style={S.tdMono}>{p.excelHours.toLocaleString()}</td>
                      <td style={S.tdMono}>{p.engineHours.toLocaleString()}</td>
                      <td style={{ ...S.tdMono, color:Math.abs(p.aggregateDelta)>100?'var(--red)':Math.abs(p.aggregateDelta)>20?'var(--amber)':'var(--ink-muted)', fontWeight:Math.abs(p.aggregateDelta)>20?600:400 }}>{p.aggregateDelta>0?'+':''}{p.aggregateDelta}</td>
                      <td style={{ ...S.tdMono, fontWeight:700, color:mc }}>{p.activeRows>0?p.matchPct.toFixed(1)+'%':'—'}</td>
                      <td style={S.tdMono}>{p.exactMatches}</td>
                      <td style={{ ...S.tdMono, color:p.maxDeltaAbs>50?'var(--red)':'var(--ink-muted)' }}>{p.maxDeltaAbs}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  )
}

function ValRowDrillTab({ result }) {
  const [catFilter,     setCatFilter]     = useState('all')
  const [roleFilter,    setRoleFilter]    = useState('all')
  const [projectFilter, setProjectFilter] = useState('')
  const [metric,        setMetric]        = useState('both') // both | calc | final
  const [sortBy,        setSortBy]        = useState('worst') // worst | project
  const [page,          setPage]          = useState(0)
  const PAGE_SIZE = 50

  const filtered = useMemo(() => result.comparisons.filter(r => {
    if (r.category === 'both_zero') return false  // skip inactive rows by default
    if (catFilter  !== 'all' && r.category !== catFilter) return false
    if (roleFilter !== 'all' && r.role !== roleFilter) return false
    if (projectFilter && !r.projectName?.toLowerCase().includes(projectFilter.toLowerCase())) return false
    if (metric === 'calc'  && (r.calcDeltaAbs || 0) === 0) return false
    if (metric === 'final' && (r.finalDeltaAbs || 0) === 0) return false
    if (metric === 'both'  && (r.calcDeltaAbs || 0) === 0 && (r.finalDeltaAbs || 0) === 0) return false
    return true
  }), [result.comparisons, catFilter, roleFilter, projectFilter, metric])

  const sorted = useMemo(() => {
    const rows = [...filtered]
    const score = (r) => {
      if (metric === 'calc')  return (r.calcDeltaAbs || 0)
      if (metric === 'final') return (r.finalDeltaAbs || 0)
      return Math.max((r.calcDeltaAbs || 0), (r.finalDeltaAbs || 0))
    }
    rows.sort((a, b) => {
      if (sortBy === 'project') return String(a.projectName||'').localeCompare(String(b.projectName||''))
      return score(b) - score(a)
    })
    return rows
  }, [filtered, metric, sortBy])

  const pageRows   = sorted.slice(page * PAGE_SIZE, (page+1) * PAGE_SIZE)
  const totalPages = Math.ceil(sorted.length / PAGE_SIZE)

  return (
    <>
      <div style={{ display:'flex', gap:10, marginBottom:16, alignItems:'center', flexWrap:'wrap' }}>
        <input placeholder="Filter by project…" value={projectFilter}
          onChange={e=>{setProjectFilter(e.target.value);setPage(0)}}
          style={{ padding:'7px 12px', border:'1px solid var(--rule)', borderRadius:6, fontSize:12, fontFamily:'Instrument Sans,sans-serif', outline:'none', width:200 }}
        />
        <select value={metric} onChange={e=>{setMetric(e.target.value);setPage(0)}}
          style={{ padding:'7px 12px', border:'1px solid var(--rule)', borderRadius:6, fontSize:12, background:'white', fontFamily:'Instrument Sans,sans-serif' }}>
          <option value="both">Mismatches: Q or S</option>
          <option value="calc">Mismatches: Q only</option>
          <option value="final">Mismatches: S only</option>
        </select>
        <select value={catFilter} onChange={e=>{setCatFilter(e.target.value);setPage(0)}}
          style={{ padding:'7px 12px', border:'1px solid var(--rule)', borderRadius:6, fontSize:12, background:'white', fontFamily:'Instrument Sans,sans-serif' }}>
          <option value="all">All Categories</option>
          {Object.entries(VAL_CATEGORY_META).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
        </select>
        <select value={roleFilter} onChange={e=>{setRoleFilter(e.target.value);setPage(0)}}
          style={{ padding:'7px 12px', border:'1px solid var(--rule)', borderRadius:6, fontSize:12, background:'white', fontFamily:'Instrument Sans,sans-serif' }}>
          <option value="all">All Roles</option>
          {['CSM','PM','Analyst 1','Analyst 2','SE'].map(r=><option key={r} value={r}>{r}</option>)}
        </select>
        <select value={sortBy} onChange={e=>setSortBy(e.target.value)}
          style={{ padding:'7px 12px', border:'1px solid var(--rule)', borderRadius:6, fontSize:12, background:'white', fontFamily:'Instrument Sans,sans-serif' }}>
          <option value="worst">Sort: Worst first</option>
          <option value="project">Sort: Project name</option>
        </select>
        <span style={{ fontSize:12, color:'var(--ink-muted)', marginLeft:'auto' }}>{sorted.length.toLocaleString()} rows · page {page+1}/{Math.max(1,totalPages)}</span>
      </div>

      <div style={S.card}>
        <div style={{ ...S.cardBody, padding:0 }}>
          <div style={{ overflowX:'auto', overflowY:'auto', maxHeight:480 }}>
            <table style={S.table}>
              <thead><tr>
                {[
                  'Project','Role','Month',
                  'Driver','Case1','Case2','Case3','Case4',
                  'VIBE','Orbit',
                  'Excel_Q','Eng_Q','ΔQ',
                  'Excel_S','Eng_S','ΔS',
                  'Metric','ExcelRows','EngineRows',
                  'Category','Note'
                ].map(h=>(
                  <th key={h} style={S.th}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {pageRows.map((r,i) => {
                  const cm = VAL_CATEGORY_META[r.category] || {}
                  const dq = (r.calcDelta || 0)
                  const ds = (r.finalDelta || 0)
                  const dqC = dq > 1 ? 'var(--amber)' : dq < -1 ? 'var(--red)' : 'var(--green)'
                  const dsC = ds > 1 ? 'var(--amber)' : ds < -1 ? 'var(--red)' : 'var(--green)'
                  const dbg0 = Array.isArray(r.debugSamples) && r.debugSamples.length > 0 ? r.debugSamples[0] : null
                  const dbgText = dbg0
                    ? [
                        dbg0.baseHoursSource ? `src=${dbg0.baseHoursSource}` : null,
                        dbg0.baseHours != null ? `base=${Math.round(dbg0.baseHours)}` : null,
                        dbg0.distributionDenom && dbg0.distributionDenom !== 1 ? `den=${dbg0.distributionDenom}` : null,
                        dbg0.prorationFactor && dbg0.prorationFactor !== 1 ? `pror=${dbg0.prorationFactor}` : null,
                        dbg0.deliveryDay ? `day=${dbg0.deliveryDay}` : null,
                        dbg0.csmOrbitMultiplier != null ? `csmOrbit=${dbg0.csmOrbitMultiplier}` : null,
                      ].filter(Boolean).join(' · ')
                    : ''
                  return (
                    <tr key={i} style={{ background:i%2===0?'white':'var(--paper-warm)' }}>
                      <td style={{ ...S.td, maxWidth:160, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontWeight:500, fontSize:11 }}>{r.projectName}</td>
                      <td style={{ ...S.td, fontSize:11 }}>{r.role}</td>
                      <td style={{ ...S.tdMono, fontSize:10 }}>{r.monthLabel}</td>
                      <td style={{ ...S.td, fontSize:10, color:'var(--ink-muted)', maxWidth:90, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.phase}</td>
                      <td style={{ ...S.td, fontSize:10, color:'var(--ink-muted)', maxWidth:90, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.case1}</td>
                      <td style={{ ...S.td, fontSize:10, color:'var(--ink-muted)', maxWidth:90, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.case2}</td>
                      <td style={{ ...S.td, fontSize:10, color:'var(--ink-muted)', maxWidth:90, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.case3}</td>
                      <td style={{ ...S.td, fontSize:10, color:'var(--ink-muted)', maxWidth:90, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.case4}</td>
                      <td style={{ ...S.td, fontSize:11 }}>{r.vibeType}</td>
                      <td style={{ ...S.tdMono, fontSize:10 }}>{r.orbit}</td>
                      <td style={{ ...S.tdMono, fontWeight:600 }}>{r.excelCalc ?? '—'}</td>
                      <td style={{ ...S.tdMono, color:r.calcIsExactMatch?'var(--green)':r.engineCalc!=null?'var(--ink)':'var(--ink-muted)' }}>
                        {r.engineCalc ?? '—'}
                      </td>
                      <td style={{ ...S.tdMono, color:dqC, fontWeight:600 }}>
                        {r.calcDelta != null ? (r.calcDelta > 0 ? '+' : '') + r.calcDelta : '—'}
                      </td>
                      <td style={{ ...S.tdMono, fontWeight:600 }}>{r.excelFinal ?? '—'}</td>
                      <td style={{ ...S.tdMono, color:r.finalIsExactMatch?'var(--green)':r.engineFinal!=null?'var(--ink)':'var(--ink-muted)' }}>
                        {r.engineFinal ?? '—'}
                      </td>
                      <td style={{ ...S.tdMono, color:dsC, fontWeight:600 }}>
                        {r.finalDelta != null ? (r.finalDelta > 0 ? '+' : '') + r.finalDelta : '—'}
                      </td>
                      <td style={{ ...S.tdMono, fontSize:10 }}>{r.mismatchMetric || '—'}</td>
                      <td style={S.tdMonoC}>{r.rowCount ?? '—'}</td>
                      <td style={S.tdMonoC}>{r.engineRowCount ?? '—'}</td>
                      <td style={S.td}>
                        <span style={{ padding:'2px 7px', borderRadius:8, fontSize:10, fontWeight:600, background:cm.bg||'var(--paper-warm)', color:cm.color||'var(--ink-muted)' }}>
                          {cm.label || r.category}
                        </span>
                      </td>
                      <td style={{ ...S.td, fontSize:10, color:'var(--ink-muted)', maxWidth:260, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                        {dbgText ? `${dbgText} — ` : ''}{r.note}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {totalPages > 1 && (
        <div style={{ display:'flex', gap:8, justifyContent:'center', marginTop:12 }}>
          <button onClick={()=>setPage(p=>Math.max(0,p-1))} disabled={page===0}
            style={{ padding:'6px 14px', borderRadius:6, border:'1px solid var(--rule)', background:'white', cursor:page===0?'not-allowed':'pointer', color:page===0?'var(--rule)':'var(--ink)', fontSize:13 }}>← Prev</button>
          {Array.from({length:Math.min(totalPages,7)},(_,i)=>{const p=page<4?i:page-3+i;if(p>=totalPages)return null;return <button key={p} onClick={()=>setPage(p)} style={{ padding:'6px 12px', borderRadius:6, border:`1px solid ${page===p?'var(--accent)':'var(--rule)'}`, background:page===p?'var(--accent-light)':'white', cursor:'pointer', fontSize:13, color:page===p?'var(--accent)':'var(--ink)' }}>{p+1}</button>})}
          <button onClick={()=>setPage(p=>Math.min(totalPages-1,p+1))} disabled={page===totalPages-1}
            style={{ padding:'6px 14px', borderRadius:6, border:'1px solid var(--rule)', background:'white', cursor:page===totalPages-1?'not-allowed':'pointer', color:page===totalPages-1?'var(--rule)':'var(--ink)', fontSize:13 }}>Next →</button>
        </div>
      )}
    </>
  )
}

// ─── State components ─────────────────────────────────────────────────────
function NoFile() {
  return (
    <div style={{ textAlign:'center', padding:'64px 40px', background:'white', borderRadius:10, border:'1px solid var(--rule)' }}>
      <div style={{ fontSize:48, marginBottom:16 }}>⚙️</div>
      <div style={{ fontFamily:'DM Serif Display,serif', fontSize:22, marginBottom:8 }}>Logic Layer not yet running</div>
      <div style={{ fontSize:13, color:'var(--ink-muted)' }}>Upload an Excel file to activate the calculation engine.</div>
    </div>
  )
}

function Loading() {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:12, padding:'24px 0', color:'var(--ink-muted)' }}>
      <div style={{ width:20, height:20, border:'2px solid var(--rule)', borderTopColor:'var(--accent)', borderRadius:'50%', animation:'spin 0.7s linear infinite' }} />
      <span style={{ fontSize:14 }}>Running phase engine, demand lookup, aggregations…</span>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

function ErrorMsg({ msg }) {
  return (
    <div style={{ background:'var(--red-light)', border:'1px solid #f5ccc4', borderRadius:8, padding:'16px 20px', color:'#7a2e1e', fontSize:13 }}>
      <strong>Engine error:</strong> {msg}
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────
function fmtDate(d) {
  if (!d || isNaN(d?.getTime?.())) return '—'
  return d.toLocaleDateString('en-US', { month:'short', year:'2-digit' })
}

function heatColor(pct) {
  if (pct === 0)   return '#f7f6f2'
  if (pct < 70)    return '#d4edda'
  if (pct < 90)    return '#fff3cd'
  if (pct < 110)   return '#ffd6cc'
  return '#f5b3a0'
}

function phaseColor(ph) {
  if (!ph || ph === PHASE_NA) return 'transparent'
  if (ph === 'Project Start M0')  return '#dbeafe'
  if (ph === 'Project Start M1')  return '#e0f2fe'
  if (ph === 'Project Mid')       return '#f0fdf4'
  if (ph === 'Project End M-1')   return '#fef9c3'
  if (ph === 'Project End M0')    return '#fee2e2'
  if (ph === 'Project End M1')    return '#fce7f3'
  if (ph === 'Project End M1+')   return '#f3e8ff'
  return 'var(--paper-warm)'
}

function phaseShort(ph) {
  if (!ph || ph === PHASE_NA) return ''
  const map = {
    'Project Start M0': 'M0',
    'Project Start M1': 'M1',
    'Project Mid':      'Mid',
    'Project End M-1':  'M-1',
    'Project End M0':   'End',
    'Project End M1':   'E1',
    'Project End M1+':  'E1+',
  }
  return map[ph] || ph.slice(0, 3)
}

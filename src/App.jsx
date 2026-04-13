import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import './lib/chartSetup'
import { parseExcelFile } from './lib/parseExcel'
import Sidebar           from './components/Sidebar'
import TopBar            from './components/TopBar'
import PlanView          from './components/PlanView'
import ExecutiveView     from './components/ExecutiveView'
import CapacityView      from './components/CapacityView'
import ProjectsView      from './components/ProjectsView'
import WorkloadExplorerView from './components/WorkloadExplorerView'
import DataEngineView    from './components/DataEngineView'
import LogicLayerView    from './components/LogicLayerView'
import ExportsView       from './components/ExportsView'
import ScenarioView      from './components/ScenarioView'
import SparkAiView       from './components/SparkAiView'
import SparkAssistantWidget from './components/SparkAssistantWidget'
import { useEngineCalc } from './components/useEngineCalc'
import { usePersistedBaseDataset } from './components/usePersistedBaseDataset'
import { validateSparkWorkbookFile } from './engine/workbookValidator.js'

const SHOW_ADVANCED = import.meta.env.VITE_SHOW_ADVANCED === 'true'

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(e) { return { error: e } }
  componentDidCatch(e) { console.error(e) }
  render() {
    if (this.state.error) {
      return (
        <div style={{ background:'var(--red-light)', border:'1px solid #fecaca', borderRadius:10, padding:'14px 16px', color:'#991b1b' }}>
          <div style={{ fontWeight:800, marginBottom:6 }}>This page crashed while rendering.</div>
          <div style={{ fontFamily:'var(--font-mono)', fontSize:12, whiteSpace:'pre-wrap' }}>{this.state.error?.message}</div>
        </div>
      )
    }
    return this.props.children
  }
}

// ── Navigation ────────────────────────────────────────────────────────────
// Primary product navigation. Advanced/dev views are hidden by default.
export const NAV = [
  {
    group: 'primary',
    label: 'Planning',
    items: [
      { id: 'plan',       label: 'Plan',         icon: IconPlan,     alwaysEnabled: true },
      { id: 'overview',   label: 'Overview',     icon: IconGrid },
      { id: 'capacity',   label: 'Capacity',     icon: IconGauge },
      { id: 'workload',   label: 'Workload Explorer', icon: IconWorkload },
      { id: 'scenarios',  label: 'Scenarios',    icon: IconScenario },
      { id: 'exports',    label: 'Exports',      icon: IconExport,   alwaysEnabled: true },
    ]
  },
  {
    group: 'ai',
    label: 'Intelligence',
    items: [
      { id: 'ai',         label: 'SPARK AI',     icon: IconAI,       alwaysEnabled: true, badge: 'New' },
    ]
  },
  ...(SHOW_ADVANCED ? [{
    group: 'advanced',
    label: 'Advanced',
    collapsed: true,
    items: [
      { id: 'projects',   label: 'Projects',     icon: IconProjects },
      { id: 'dataEngine', label: 'Data Engine',  icon: IconDataEngine, alwaysEnabled: true },
      { id: 'logic',      label: 'Logic Layer',  icon: IconLogic,    alwaysEnabled: true },
      { id: 'validation', label: 'Validation',   icon: IconCheck,    alwaysEnabled: true, badge: 'Temp' },
    ]
  }] : []),
]

export default function App() {
  const [activeTab,    setActiveTab]    = useState('plan')
  const [data,         setData]         = useState(null)
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState(null)
  const [notice,       setNotice]       = useState(null)
  const [planIssues,   setPlanIssues]   = useState(null) // { ok, issues, meta } | null
  const [fileName,     setFileName]     = useState(null)
  const [uploadedFile, setUploadedFile] = useState(null)
  const [insightsSource, setInsightsSource] = useState('engine')
  const [datasetMode,  setDatasetMode]  = useState('override')

  const { base, baseSummary, loading: baseLoading, error: baseError,
          setBaseFromFile, updateBaseProjects, updateBaseRoster, clearBase } = usePersistedBaseDataset()

  const engineInput = useMemo(() => {
    if (datasetMode === 'base') {
      return base?.ingest ? { kind: 'ingest', ingest: base.ingest } : null
    }
    return uploadedFile ? { kind: 'file', file: uploadedFile } : null
  }, [datasetMode, base?.ingest, uploadedFile])

  const { calc: engineCalc } = useEngineCalc(engineInput)
  const hasEngineInput   = !!engineInput
  const canRenderInsights = !!data || hasEngineInput

  // ── Auto-activate persisted plan and jump to Overview ────────────────────
  const didAutoSelectRef = useRef(false)
  useEffect(() => {
    if (didAutoSelectRef.current) return
    if (uploadedFile) return
    if (!base?.ingest) return
    didAutoSelectRef.current = true
    setDatasetMode('base')
    setInsightsSource('engine')
    const name = base?.sourceFileName || base?.ingest?.meta?.fileName || 'Current plan'
    setFileName(name)
  }, [base, uploadedFile])

  const handleFile = useCallback(async (file) => {
    setLoading(true)
    setError(null)
    setNotice(null)
    setPlanIssues(null)
    try {
      const v = await validateSparkWorkbookFile(file)
      if (!v?.ok) {
        setPlanIssues(v)
        setActiveTab('plan')
        return
      }

      // Accept file only after validation passes.
      setUploadedFile(file)
      setDatasetMode('override')
      const parsed = await parseExcelFile(file)
      parsed.meta.fileName = file.name
      setData(parsed)
      setFileName(file.name)
    } catch (err) {
      const msg = err?.message || 'Failed to parse file.'
      const missingCapacityModel = msg.includes('Sheet "Capacity Model" not found')
      if (missingCapacityModel) {
        setData(null)
        setFileName(file.name)
        setInsightsSource('engine')
      } else {
        setError(msg)
        // Reject file on parse failures to prevent working with unknown schema.
        setUploadedFile(null)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  const handlePromoteToBase = useCallback(async () => {
    if (!uploadedFile) return
    const saved = await setBaseFromFile(uploadedFile)
    if (saved?.ingest) {
      setDatasetMode('base')
      setFileName(uploadedFile.name)
      setNotice('Plan saved — loads automatically next session.')
    }
  }, [uploadedFile, setBaseFromFile])

  const handleClearBase = useCallback(async () => {
    await clearBase()
    setDatasetMode('override')
    setData(null)
    setFileName(null)
    setUploadedFile(null)
    setActiveTab('plan')
  }, [clearBase])

  const isTabEnabled = useCallback((item) => {
    if (!item) return false
    if (item.alwaysEnabled) return true
    if (data) return true
    if (hasEngineInput && ['overview','capacity','workload','scenarios','projects'].includes(item.id)) return true
    return false
  }, [data, hasEngineInput])

  const handleNav = (id) => {
    const allItems = NAV.flatMap(g => g.items)
    const item = allItems.find(i => i.id === id)
    if (!item || !isTabEnabled(item)) return
    setActiveTab(id)
  }

  const planName = fileName || 'Current plan'

  return (
    <div style={{ display:'flex', minHeight:'100vh', background:'var(--surface-base)' }}>
      <Sidebar nav={NAV} active={activeTab} onNav={handleNav} isEnabled={isTabEnabled} fileName={fileName} />

      <div style={{ flex:1, display:'flex', flexDirection:'column', minWidth:0, marginLeft:'var(--sidebar-w)' }}>
        <TopBar onUpload={handleFile} fileName={fileName} activeTab={activeTab} loading={loading} />

        <main style={{ flex:1, padding:'28px 36px', width:'100%', maxWidth:'none' }}>
          {error    && <Banner type="error"  msg={error}  onDismiss={() => setError(null)} />}
          {notice   && <Banner type="notice" msg={notice} onDismiss={() => setNotice(null)} />}
          {baseError && <Banner type="notice" msg={`Plan data error: ${baseError}`} onDismiss={() => {}} />}

          {/* Unsaved-file nudge */}
          {uploadedFile && datasetMode === 'override' && !notice && (
            <SavePlanNudge
              fileName={uploadedFile.name}
              onSave={handlePromoteToBase}
              onDismiss={() => setNotice(null)}
            />
          )}

          <ErrorBoundary key={activeTab}>
            {activeTab === 'plan' && (
              <PlanView
                onFile={handleFile}
                loading={loading}
                planIssues={planIssues}
                onDismissPlanIssues={() => setPlanIssues(null)}
                base={base}
                baseSummary={baseSummary}
                baseLoading={baseLoading}
                datasetMode={datasetMode}
                onPromoteOverrideToBase={handlePromoteToBase}
                onClearBase={handleClearBase}
                onUpdateBaseProjects={updateBaseProjects}
                onUpdateBaseRoster={updateBaseRoster}
                hasOverride={!!uploadedFile}
                uploadedFileName={uploadedFile?.name}
                engineInput={engineInput}
                onGoToOverview={() => setActiveTab('overview')}
              />
            )}
            {activeTab === 'overview' && canRenderInsights && (
              <ExecutiveView data={data} uploadedFile={engineInput} source={insightsSource}
                onSource={setInsightsSource} onNavigate={setActiveTab} />
            )}
            {activeTab === 'capacity' && canRenderInsights && (
              <CapacityView data={data} uploadedFile={engineInput} source={insightsSource}
                onSource={setInsightsSource} onNavigate={setActiveTab} />
            )}
            {activeTab === 'workload' && hasEngineInput && (
              <WorkloadExplorerView engineInput={engineInput} engineCalc={engineCalc} />
            )}
            {activeTab === 'projects' && canRenderInsights && (
              <ProjectsView data={data} uploadedFile={engineInput} source={insightsSource}
                onSource={setInsightsSource} onNavigate={setActiveTab} />
            )}
            {activeTab === 'scenarios' && (
              <ScenarioView uploadedFile={engineInput} baselineCalc={engineCalc} baselineData={data} />
            )}
            {activeTab === 'ai' && (
              <SparkAiView engineCalc={engineCalc} engineInput={engineInput} planName={planName} />
            )}
            {activeTab === 'exports' && (
              <ExportsView
                data={data}
                engineInput={engineInput}
                workbookFile={uploadedFile}
                baseWorkbookBlob={base?.workbookBlob || null}
                baseWorkbookName={base?.sourceFileName || base?.ingest?.meta?.fileName || ''}
              />
            )}
            {SHOW_ADVANCED && activeTab === 'dataEngine' && <DataEngineView uploadedFile={engineInput} />}
            {SHOW_ADVANCED && activeTab === 'logic'      && <LogicLayerView uploadedFile={engineInput} />}
            {SHOW_ADVANCED && activeTab === 'validation' && <LogicLayerView uploadedFile={engineInput} startTab="validation" />}
          </ErrorBoundary>

          {!canRenderInsights && !['plan','ai','exports','scenarios'].includes(activeTab) && (
            <EmptyState onGoPlan={() => setActiveTab('plan')} />
          )}
        </main>
      </div>

      <SparkAssistantWidget engineCalc={engineCalc} engineInput={engineInput} planName={planName} />
    </div>
  )
}

// ── Nudge banner for unsaved uploads ─────────────────────────────────────
function SavePlanNudge({ fileName, onSave }) {
  const [dismissed, setDismissed] = useState(false)
  if (dismissed) return null
  return (
    <div style={{
      display:'flex', alignItems:'center', gap:12, marginBottom:14,
      background:'var(--accent-light)', border:'1px solid var(--accent-dim)',
      borderRadius:8, padding:'9px 14px', fontSize:12.5,
    }}>
      <span style={{ fontSize:15 }}>💾</span>
      <span style={{ flex:1, color:'var(--ink)' }}>
        <strong>{fileName}</strong> is active but not saved. Save it as your current plan so it loads automatically next time.
      </span>
      <button onClick={onSave} style={{ padding:'5px 12px', background:'var(--accent)', color:'white', border:'none', borderRadius:6, fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'var(--font-sans)' }}>
        Save as plan
      </button>
      <button onClick={() => setDismissed(true)} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--ink-muted)', fontSize:16, lineHeight:1, padding:4 }}>×</button>
    </div>
  )
}

function Banner({ type, msg, onDismiss }) {
  const s = type === 'error'
    ? { bg:'var(--red-light)', border:'#fecaca', color:'#991b1b', icon:'⚠' }
    : { bg:'var(--amber-light)', border:'#fde68a', color:'#92400e', icon:'ℹ' }
  return (
    <div style={{ display:'flex', alignItems:'center', gap:12, background:s.bg, border:`1px solid ${s.border}`, borderRadius:8, padding:'11px 16px', marginBottom:14, fontSize:13, color:s.color }}>
      <span>{s.icon}</span>
      <span style={{ flex:1 }}><strong>{type==='error'?'Error':'Note'}:</strong> {msg}</span>
      <button onClick={onDismiss} style={{ background:'none', border:'none', cursor:'pointer', color:s.color, fontSize:18, lineHeight:1 }}>×</button>
    </div>
  )
}

function EmptyState({ onGoPlan }) {
  return (
    <div style={{ textAlign:'center', padding:'80px 40px', color:'var(--ink-muted)' }}>
      <div style={{ fontWeight:700, fontSize:20, color:'var(--ink)', marginBottom:8 }}>No plan loaded</div>
      <p style={{ fontSize:13, marginBottom:24, maxWidth:320, margin:'0 auto 24px' }}>Go to Plan to upload your Excel capacity model.</p>
      <button onClick={onGoPlan} style={{ background:'var(--accent)', color:'white', border:'none', padding:'9px 20px', borderRadius:7, fontFamily:'var(--font-sans)', fontSize:13, fontWeight:600, cursor:'pointer' }}>
        Go to Plan →
      </button>
    </div>
  )
}

// ── Icons ─────────────────────────────────────────────────────────────────
export function IconPlan({ size=16, color='currentColor' }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
}
export function IconGrid({ size=16, color='currentColor' }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
}
export function IconGauge({ size=16, color='currentColor' }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a10 10 0 100 20A10 10 0 0012 2z"/><path d="M12 6v6l4 2"/></svg>
}
export function IconWorkload({ size=16, color='currentColor' }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h18"/><path d="M7 12v7"/><path d="M12 12v4"/><path d="M17 12v9"/><path d="M7 8h0"/><path d="M12 6h0"/><path d="M17 9h0"/></svg>
}
export function IconProjects({ size=16, color='currentColor' }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 000 4h6a2 2 0 000-4M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>
}
export function IconLogic({ size=16, color='currentColor' }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 3v3m0 12v3M3 12h3m12 0h3m-3.2-6.8l-2.1 2.1M8.3 15.7l-2.1 2.1m12.6 0l-2.1-2.1M8.3 8.3L6.2 6.2"/></svg>
}
export function IconCheck({ size=16, color='currentColor' }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
}
export function IconScenario({ size=16, color='currentColor' }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
}
export function IconAI({ size=16, color='currentColor' }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
}
export function IconDataEngine({ size=16, color='currentColor' }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="5" rx="7" ry="3"/><path d="M5 5v6c0 1.7 3.1 3 7 3s7-1.3 7-3V5"/><path d="M5 11v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/></svg>
}
export function IconExport({ size=16, color='currentColor' }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v10M8 9l4 4 4-4M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/></svg>
}
export function IconUpload({ size=16, color='currentColor' }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>
}

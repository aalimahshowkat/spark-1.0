/**
 * useScenario.js — Scenario state hook
 *
 * Manages the full scenario lifecycle:
 *   - Active scenario selection
 *   - Draft editing (project / resource / assumption overrides)
 *   - Persistence to/from localStorage
 *   - Triggering recalculation via applyScenario()
 *
 * Used by ScenarioView and consumed by any component needing scenario context.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { ingestExcelFile } from '../engine/ingest.js'
import { runCalculations } from '../engine/calculate.js'
import {
  createScenario,
  applyScenario,
  computeCapacityScenario,
  diffResults,
  loadScenarios,
  saveScenarios,
  upsertScenario,
  deleteScenario,
  duplicateScenario,
  getScenarioSummary,
  SCENARIO_STATUS,
} from '../engine/scenarioEngine.js'

export function useScenario(engineInput, baselineCalc) {
  // ── Persisted scenario list ───────────────────────────────────────────
  const [scenarios,        setScenarios]        = useState(() => loadScenarios())
  const [activeScenarioId, setActiveScenarioId] = useState(null)
  const [editDraft,        setEditDraft]        = useState(null)  // currently-edited draft
  const [panel,            setPanel]            = useState('list') // 'list' | 'edit' | 'compare'

  // ── Recalculation state ───────────────────────────────────────────────
  const [scenarioCalc,   setScenarioCalc]   = useState(null)
  const [scenarioCap,    setScenarioCap]    = useState(null)
  const [calcLoading,    setCalcLoading]    = useState(false)
  const [calcError,      setCalcError]      = useState(null)
  const [baselineIngest, setBaselineIngest] = useState(null)

  // Persist whenever scenarios list changes
  useEffect(() => { saveScenarios(scenarios) }, [scenarios])

  // Load baseline ingest when file changes
  const fileKey = useMemo(() => {
    if (!engineInput) return null
    if (engineInput?.kind === 'file' && engineInput.file) {
      const f = engineInput.file
      return `file__${f.name}__${f.size}__${f.lastModified}`
    }
    if (engineInput?.kind === 'ingest' && engineInput.ingest) {
      const m = engineInput.ingest?.meta || {}
      return `ingest__${m.fileName || ''}__${m.parsedAt || ''}__${m.durationMs || 0}`
    }
    // Back-compat: real File passed in
    if (engineInput instanceof File) {
      return `file__${engineInput.name}__${engineInput.size}__${engineInput.lastModified}`
    }
    return null
  }, [engineInput])

  useEffect(() => {
    if (!engineInput) { setBaselineIngest(null); return }
    let alive = true
    if (engineInput?.kind === 'ingest' && engineInput.ingest) {
      setBaselineIngest(engineInput.ingest)
      return () => { alive = false }
    }
    const file =
      (engineInput?.kind === 'file' && engineInput.file) ? engineInput.file :
      (engineInput instanceof File ? engineInput : null)
    if (!file) { setBaselineIngest(null); return () => { alive = false } }
    ingestExcelFile(file).then(r => { if (alive) setBaselineIngest(r) }).catch(() => {})
    return () => { alive = false }
  }, [fileKey, engineInput])

  // ── Active scenario ───────────────────────────────────────────────────
  const activeScenario = useMemo(
    () => scenarios.find(s => s.id === activeScenarioId) || null,
    [scenarios, activeScenarioId]
  )

  // ── Run calculation when active scenario + baseline both ready ────────
  useEffect(() => {
    if (!activeScenario || !baselineIngest) {
      setScenarioCalc(null)
      setScenarioCap(null)
      return
    }

    let alive = true
    setCalcLoading(true)
    setCalcError(null)

    try {
      const planningYear = baselineCalc?.meta?.planningYear || 2026
      const modified = applyScenario(baselineIngest, activeScenario, {
        planningYear,
        baselineCapacityConfig: engineInput?.capacityConfig || null,
      })
      if (!modified) { setCalcLoading(false); return }

      // runCalculations is synchronous
      const calc = runCalculations(
        modified.projects,
        modified.demandMatrix,
        modified.orbitMultipliers,
        planningYear,
        {
          roster: baselineIngest?.roster || [],
          capacityConfig: modified.scenarioCapacityConfig || null,
        }
      )

      if (!alive) return
      const cap = computeCapacityScenario(modified.scenarioCapacityConfig)
      setScenarioCalc(calc)
      setScenarioCap(cap)
      setCalcLoading(false)
    } catch (e) {
      if (!alive) return
      setCalcError(e?.message || 'Scenario calculation failed.')
      setCalcLoading(false)
    }

    return () => { alive = false }
  }, [activeScenario, baselineIngest, baselineCalc])

  // Optional: cache a tiny computed snapshot on the scenario record.
  // Keep this lightweight (annual + breach counts) to avoid bloating localStorage.
  useEffect(() => {
    if (!activeScenarioId || !scenarioCalc) return
    setScenarios(prev => {
      const idx = prev.findIndex(s => s.id === activeScenarioId)
      if (idx === -1) return prev

      const nextScenario = { ...prev[idx] }
      const snapshot = {
        planningYear: scenarioCalc?.meta?.planningYear,
        annualDemand: scenarioCalc.annualDemand || {},
        monthsOverEffective: scenarioCalc.monthsOverEffective || {},
        cachedAt: new Date().toISOString(),
      }

      const prevSnap = nextScenario.lastComputed
      const same =
        prevSnap &&
        JSON.stringify(prevSnap.annualDemand || {}) === JSON.stringify(snapshot.annualDemand || {}) &&
        JSON.stringify(prevSnap.monthsOverEffective || {}) === JSON.stringify(snapshot.monthsOverEffective || {}) &&
        prevSnap.planningYear === snapshot.planningYear

      if (same) return prev

      nextScenario.lastComputed = snapshot
      const out = [...prev]
      out[idx] = nextScenario
      return out
    })
  }, [activeScenarioId, scenarioCalc])

  // ── Diff: scenario vs baseline ────────────────────────────────────────
  const diff = useMemo(
    () => diffResults(baselineCalc, scenarioCalc),
    [baselineCalc, scenarioCalc]
  )

  // ── Actions ───────────────────────────────────────────────────────────

  const newScenario = useCallback((opts = {}) => {
    const sc = createScenario(opts)
    setScenarios(prev => upsertScenario(prev, sc))
    setEditDraft(sc)
    setPanel('edit')
    return sc
  }, [])

  const selectScenario = useCallback((id) => {
    setActiveScenarioId(id)
    setPanel('compare')
  }, [])

  const editScenario = useCallback((id) => {
    const sc = scenarios.find(s => s.id === id)
    if (!sc) return
    setEditDraft({ ...sc })
    setPanel('edit')
  }, [scenarios])

  const saveEditDraft = useCallback(() => {
    if (!editDraft) return
    const saved = { ...editDraft, status: SCENARIO_STATUS.DRAFT }
    setScenarios(prev => upsertScenario(prev, saved))
    setActiveScenarioId(saved.id)
    setPanel('compare')
    setEditDraft(null)
  }, [editDraft])

  const discardEditDraft = useCallback(() => {
    setEditDraft(null)
    setPanel(activeScenarioId ? 'compare' : 'list')
  }, [activeScenarioId])

  const removeScenario = useCallback((id) => {
    setScenarios(prev => deleteScenario(prev, id))
    if (activeScenarioId === id) {
      setActiveScenarioId(null)
      setScenarioCalc(null)
      setPanel('list')
    }
  }, [activeScenarioId])

  const cloneScenario = useCallback((id) => {
    const sc = scenarios.find(s => s.id === id)
    if (!sc) return
    const copy = duplicateScenario(sc)
    setScenarios(prev => upsertScenario(prev, copy))
    setEditDraft(copy)
    setPanel('edit')
  }, [scenarios])

  // ── Draft patch helpers ───────────────────────────────────────────────

  const patchDraftProject = useCallback((projectId, patch) => {
    setEditDraft(prev => {
      if (!prev) return prev
      const existing = prev.projectOverrides[projectId] || {}
      return {
        ...prev,
        projectOverrides: {
          ...prev.projectOverrides,
          [projectId]: { ...existing, ...patch },
        }
      }
    })
  }, [])

  const removeDraftProject = useCallback((projectId) => {
    setEditDraft(prev => {
      if (!prev) return prev
      const { [projectId]: _, ...rest } = prev.projectOverrides
      return { ...prev, projectOverrides: rest }
    })
  }, [])

  const patchDraftResource = useCallback((role, patch) => {
    setEditDraft(prev => {
      if (!prev) return prev
      const existing = prev.resourceOverrides[role] || {}
      return {
        ...prev,
        resourceOverrides: {
          ...prev.resourceOverrides,
          [role]: { ...existing, ...patch },
        }
      }
    })
  }, [])

  const patchDraftAssumptions = useCallback((patch) => {
    setEditDraft(prev => {
      if (!prev) return prev
      return {
        ...prev,
        assumptionOverrides: { ...prev.assumptionOverrides, ...patch },
      }
    })
  }, [])

  const patchDraftAttrition = useCallback((role, value) => {
    setEditDraft(prev => {
      if (!prev) return prev
      const existing = { ...(prev.attritionOverrides || {}) }
      if (value === undefined || value === null) {
        delete existing[role]
      } else {
        existing[role] = value
      }
      return {
        ...prev,
        attritionOverrides: existing,
      }
    })
  }, [])

  // ── Derived ───────────────────────────────────────────────────────────
  const activeSummary = useMemo(
    () => activeScenario ? getScenarioSummary(activeScenario) : null,
    [activeScenario]
  )

  const editSummary = useMemo(
    () => editDraft ? getScenarioSummary(editDraft) : null,
    [editDraft]
  )

  return {
    // State
    scenarios,
    activeScenario,
    activeScenarioId,
    editDraft,
    panel,
    setPanel,
    // Calculation
    scenarioCalc,
    scenarioCap,
    calcLoading,
    calcError,
    diff,
    baselineIngest,
    // Actions
    newScenario,
    selectScenario,
    editScenario,
    saveEditDraft,
    discardEditDraft,
    removeScenario,
    cloneScenario,
    // Draft patch
    patchDraftProject,
    removeDraftProject,
    patchDraftResource,
    patchDraftAssumptions,
    patchDraftAttrition,
    // Escape hatch for inline draft mutations
    setEditDraft,
    // Derived
    activeSummary,
    editSummary,
  }
}

import { useEffect, useMemo, useState } from 'react'
import { ingestExcelFile } from '../engine/ingest.js'
import { runCalculations } from '../engine/calculate.js'

function mergeCapacityConfigWithWorkbookTables(capacityConfig, ingestMeta) {
  const base = (capacityConfig && typeof capacityConfig === 'object') ? { ...capacityConfig } : {}
  const wb = ingestMeta?.workbookAdvancedMultipliers || null
  if (!wb || typeof wb !== 'object') return Object.keys(base).length ? base : null

  // LM bucket multipliers (if user hasn't overridden via Advanced planning)
  if (!Array.isArray(base.lmBucketMultipliers) || base.lmBucketMultipliers.length === 0) {
    const wbLm = wb?.lmBucketMultipliers
    if (Array.isArray(wbLm) && wbLm.length) base.lmBucketMultipliers = wbLm
  }

  const wbAdv = wb?.advancedMultipliers
  if (wbAdv && typeof wbAdv === 'object') {
    const adv = (base.advancedMultipliers && typeof base.advancedMultipliers === 'object') ? { ...base.advancedMultipliers } : {}

    const fillIfMissing = (key) => {
      const cur = adv?.[key]
      if (cur && typeof cur === 'object' && Object.keys(cur).length) return
      const v = wbAdv?.[key]
      if (v && typeof v === 'object' && Object.keys(v).length) adv[key] = v
    }

    fillIfMissing('networkTypeMultipliers')
    fillIfMissing('nonStandardDataMultipliers')
    fillIfMissing('nonStandardMetricMultipliers')
    fillIfMissing('ivmsConfigurationMultipliers')

    // Track source so the engine can prefer reconstruction when workbook provides weights.
    if (!adv.source && (Object.keys(adv).length || Object.keys(wbAdv || {}).length)) adv.source = 'workbook'
    if (Object.keys(adv).length) base.advancedMultipliers = adv
  }

  return Object.keys(base).length ? base : null
}

export function useEngineCalc(engineInput) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [calc, setCalc] = useState(null)
  const [ingest, setIngest] = useState(null)

  const inputKey = useMemo(() => {
    if (!engineInput) return null
    const capKey = (() => {
      try { return JSON.stringify(engineInput?.capacityConfig || null) } catch { return '' }
    })()
    const overrideKey = (() => {
      try {
        return JSON.stringify({
          roster: engineInput?.rosterOverride || null,
          projects: engineInput?.projectsOverride || null,
        })
      } catch { return '' }
    })()
    if (engineInput.kind === 'file' && engineInput.file) {
      const f = engineInput.file
      return `file__${f.name}__${f.size}__${f.lastModified}__cap__${capKey}__ovr__${overrideKey}`
    }
    if (engineInput.kind === 'ingest' && engineInput.ingest) {
      const m = engineInput.ingest?.meta || {}
      return `ingest__${m.fileName || ''}__${m.parsedAt || ''}__${m.durationMs || 0}__cap__${capKey}__ovr__${overrideKey}`
    }
    return null
  }, [engineInput])

  useEffect(() => {
    if (!engineInput) {
      setCalc(null)
      setIngest(null)
      setError(null)
      setLoading(false)
      return
    }

    let alive = true
    setLoading(true)
    setError(null)

    const applyOverrides = (ing) => {
      const rosterOverride = engineInput?.rosterOverride
      const projectsOverride = engineInput?.projectsOverride
      const nextRoster = Array.isArray(rosterOverride) ? rosterOverride : (ing?.roster || [])
      const nextProjects = Array.isArray(projectsOverride) ? projectsOverride : (ing?.projects || [])
      return { ...(ing || {}), roster: nextRoster, projects: nextProjects }
    }

    const runFromIngest = (rawIngest) => {
      const ing = applyOverrides(rawIngest)
      setIngest(ing)
      const effectiveCapacityConfig = mergeCapacityConfigWithWorkbookTables(engineInput?.capacityConfig || null, ing?.meta || null)
      const c = runCalculations(
        ing.projects,
        ing.demandMatrix,
        ing.orbitMultipliers,
        ing?.meta?.planningYear,
        { roster: ing?.roster || [], capacityConfig: effectiveCapacityConfig }
      )
      setCalc(c)
      setLoading(false)
    }

    if (engineInput.kind === 'ingest' && engineInput.ingest) {
      Promise.resolve()
        .then(() => {
          if (!alive) return
          runFromIngest(engineInput.ingest)
        })
        .catch((e) => {
          if (!alive) return
          setError(e?.message || 'Failed to run SPARK Engine.')
          setLoading(false)
        })
      return () => { alive = false }
    }

    if (engineInput.kind !== 'file' || !engineInput.file) {
      setCalc(null)
      setError('No engine input available.')
      setLoading(false)
      return () => { alive = false }
    }

    ingestExcelFile(engineInput.file)
      .then((ingest) => {
        if (!alive) return
        runFromIngest(ingest)
      })
      .catch((e) => {
        if (!alive) return
        setError(e?.message || 'Failed to run SPARK Engine.')
        setLoading(false)
      })

    return () => { alive = false }
  }, [inputKey])

  return { calc, ingest, loading, error }
}


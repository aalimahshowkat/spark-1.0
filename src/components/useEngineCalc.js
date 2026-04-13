import { useEffect, useMemo, useState } from 'react'
import { ingestExcelFile } from '../engine/ingest.js'
import { runCalculations } from '../engine/calculate.js'

export function useEngineCalc(engineInput) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [calc, setCalc] = useState(null)

  const inputKey = useMemo(() => {
    if (!engineInput) return null
    if (engineInput.kind === 'file' && engineInput.file) {
      const f = engineInput.file
      return `file__${f.name}__${f.size}__${f.lastModified}`
    }
    if (engineInput.kind === 'ingest' && engineInput.ingest) {
      const m = engineInput.ingest?.meta || {}
      return `ingest__${m.fileName || ''}__${m.parsedAt || ''}__${m.durationMs || 0}`
    }
    return null
  }, [engineInput])

  useEffect(() => {
    if (!engineInput) {
      setCalc(null)
      setError(null)
      setLoading(false)
      return
    }

    let alive = true
    setLoading(true)
    setError(null)

    const runFromIngest = (ingest) => {
      const c = runCalculations(ingest.projects, ingest.demandMatrix, ingest.orbitMultipliers, ingest?.meta?.planningYear, { roster: ingest?.roster || [] })
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

  return { calc, loading, error }
}


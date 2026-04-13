import { useCallback, useEffect, useMemo, useState } from 'react'
import { ingestExcelFile } from '../engine/ingest.js'
import { clearBaseDataset, loadBaseDataset, saveBaseDataset } from '../lib/datasetStore'

function safeText(s) {
  return String(s || '').trim()
}

function nowIso() {
  return new Date().toISOString()
}

function summarizeIngest(ingest) {
  const projects = ingest?.projects || []
  const demandMatrix = ingest?.demandMatrix || []
  const meta = ingest?.meta || {}
  return {
    fileName: safeText(meta.fileName),
    parsedAt: meta.parsedAt || '',
    totalProjects: projects.length,
    matrixRows: demandMatrix.length,
    schemaVersion: meta.schemaVersion || '',
  }
}

export function usePersistedBaseDataset() {
  const [base, setBase] = useState(null) // { savedAt, sourceFileName, ingest }
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    loadBaseDataset()
      .then((v) => {
        if (!alive) return
        setBase(v)
        setLoading(false)
      })
      .catch((e) => {
        if (!alive) return
        setError(e?.message || 'Failed to load base dataset.')
        setLoading(false)
      })
    return () => { alive = false }
  }, [])

  const baseSummary = useMemo(() => summarizeIngest(base?.ingest), [base])

  const setBaseFromFile = useCallback(async (file) => {
    if (!file) return null
    setLoading(true)
    setError(null)
    try {
      const ingest = await ingestExcelFile(file)
      const payload = {
        savedAt: nowIso(),
        sourceFileName: safeText(file.name),
        ingest,
        audit: [
          ...(base?.audit || []),
          {
            at: nowIso(),
            by: safeText(localStorage.getItem('spark_editor_name') || ''),
            action: 'base_set_from_file',
            sourceFileName: safeText(file.name),
          }
        ],
      }
      await saveBaseDataset(payload)
      setBase(payload)
      setLoading(false)
      return payload
    } catch (e) {
      setError(e?.message || 'Failed to save base dataset.')
      setLoading(false)
      return null
    }
  }, [])

  const updateBaseIngest = useCallback(async ({ editorName = '', note = '', mutate }) => {
    if (!base?.ingest) return null
    if (typeof mutate !== 'function') return null
    setLoading(true)
    setError(null)
    try {
      const ingestNext = mutate(base.ingest)
      const payload = {
        ...base,
        savedAt: nowIso(),
        ingest: ingestNext,
        audit: [
          ...(base?.audit || []),
          {
            at: nowIso(),
            by: safeText(editorName),
            action: 'base_updated',
            note: safeText(note),
          }
        ],
      }
      await saveBaseDataset(payload)
      setBase(payload)
      setLoading(false)
      return payload
    } catch (e) {
      setError(e?.message || 'Failed to update base dataset.')
      setLoading(false)
      return null
    }
  }, [base])

  const updateBaseProjects = useCallback(async ({ editorName = '', note = '', projects }) => {
    return await updateBaseIngest({
      editorName,
      note,
      mutate: (ingest) => {
        const next = { ...(ingest || {}) }
        next.projects = Array.isArray(projects) ? projects : (ingest?.projects || [])
        // meta is used in some UI displays; keep it consistent.
        next.meta = { ...(ingest?.meta || {}), parsedAt: nowIso() }
        return next
      }
    })
  }, [updateBaseIngest])

  const updateBaseRoster = useCallback(async ({ editorName = '', note = '', roster }) => {
    return await updateBaseIngest({
      editorName,
      note,
      mutate: (ingest) => {
        const next = { ...(ingest || {}) }
        next.roster = Array.isArray(roster) ? roster : (ingest?.roster || [])
        next.meta = { ...(ingest?.meta || {}), parsedAt: nowIso() }
        return next
      }
    })
  }, [updateBaseIngest])

  const clearBase = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      await clearBaseDataset()
      setBase(null)
      setLoading(false)
    } catch (e) {
      setError(e?.message || 'Failed to clear base dataset.')
      setLoading(false)
    }
  }, [])

  return {
    base,
    baseSummary,
    loading,
    error,
    setBaseFromFile,
    updateBaseIngest,
    updateBaseProjects,
    updateBaseRoster,
    clearBase,
    reload: async () => {
      setLoading(true)
      setError(null)
      try {
        const v = await loadBaseDataset()
        setBase(v)
        setLoading(false)
        return v
      } catch (e) {
        setError(e?.message || 'Failed to reload base dataset.')
        setLoading(false)
        return null
      }
    }
  }
}


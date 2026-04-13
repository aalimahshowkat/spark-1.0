import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ingestExcelFile } from '../engine/ingest.js'
import { clearBaseDataset, loadBaseDataset, saveBaseDataset } from '../lib/datasetStore'

const DEFAULT_PLAN_FILENAME = 'default-plan.xlsx'

function safeText(s) {
  return String(s || '').trim()
}

function nowIso() {
  return new Date().toISOString()
}

function defaultPlanUrlCandidates() {
  // `vite.config.js` uses base:'./' which makes asset paths relative.
  // These candidates cover:
  // - dev server at /
  // - production hosted under a subpath
  // - direct navigation to nested SPA routes (e.g. /overview)
  const base = (import.meta?.env?.BASE_URL || './')
  return [
    // best default for base:'./' — relative to current route
    new URL(DEFAULT_PLAN_FILENAME, window.location.href).toString(),
    // relative to Vite base (may resolve to origin root for './', but ok)
    new URL(DEFAULT_PLAN_FILENAME, new URL(base, window.location.href)).toString(),
    // origin root fallback
    new URL(`/${DEFAULT_PLAN_FILENAME}`, window.location.origin).toString(),
  ]
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
  const seedInFlightRef = useRef(null) // Promise | null
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    let alive = true
    setLoading(true)

    const withTimeout = (p, ms) => {
      return Promise.race([
        p,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Base dataset load timed out.')), ms)),
      ])
    }

    withTimeout(loadBaseDataset(), 1500)
      .then((v) => {
        if (!alive) return
        setBase(v)
        setLoading(false)
      })
      .catch((e) => {
        if (!alive) return
        // Treat load failures/timeouts as "no base" so default seeding can proceed.
        // (Safari/private browsing can sometimes stall IndexedDB open.)
        setBase(null)
        setError(null)
        setLoading(false)
      })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    // Seed default plan only when:
    // - base is missing
    // - initial load finished
    if (loading) return
    if (base?.ingest) return
    if (seedInFlightRef.current) return

    const seedDefaultPlan = async () => {
      const urls = defaultPlanUrlCandidates()
      let res = null
      let lastErr = null
      for (const url of urls) {
        try {
          // Use no-store so dev changes to public file show up immediately.
          const r = await fetch(url, { cache: 'no-store' })
          if (r.ok) { res = r; break }
          lastErr = new Error(`Default plan not found at ${url} (${r.status}).`)
        } catch (e) {
          lastErr = e
        }
      }
      if (!res) throw (lastErr || new Error('Default plan not found.'))
      const blob = await res.blob()
      const file = new File([blob], 'SPARK Default Plan.xlsx', {
        type: blob.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      const ingest = await ingestExcelFile(file)
      const payload = {
        savedAt: nowIso(),
        sourceFileName: safeText(file.name),
        workbookBlob: blob,
        ingest,
        audit: [
          {
            at: nowIso(),
            by: safeText(localStorage.getItem('spark_editor_name') || ''),
            action: 'base_seed_default_plan',
            sourceFileName: safeText(file.name),
          }
        ],
      }
      try {
        await saveBaseDataset(payload)
      } catch {
        // If IndexedDB isn't available (rare in privacy modes), still allow the app
        // to function this session using an in-memory base dataset.
      }
      return payload
    }

    // Trigger seed.
    setLoading(true)
    seedInFlightRef.current = seedDefaultPlan()
      .then((payload) => {
        seedInFlightRef.current = null
        if (!mountedRef.current) return
        setBase(payload)
        setLoading(false)
      })
      .catch((e) => {
        seedInFlightRef.current = null
        if (!mountedRef.current) return
        // Non-fatal: user can still upload.
        setError(e?.message || 'Failed to seed default plan.')
        setLoading(false)
      })
  }, [base, loading])

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
        workbookBlob: file, // File is a Blob; persisted for "export as-is"
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


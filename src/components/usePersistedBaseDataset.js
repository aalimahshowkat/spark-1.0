import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ingestExcelFile } from '../engine/ingest.js'
import { clearBaseDataset, loadBaseDataset, saveBaseDataset } from '../lib/datasetStore'

const DEFAULT_PLAN_FILENAME = 'default-plan.xlsx'
const DEFAULT_PLAN_META_FILENAME = 'default-plan.meta.json'

function safeText(s) {
  return String(s || '').trim()
}

function nowIso() {
  return new Date().toISOString()
}

function fingerprintFromHeaders(headers) {
  const etag = safeText(headers?.get?.('etag') || '')
  const lastModified = safeText(headers?.get?.('last-modified') || '')
  const contentLength = safeText(headers?.get?.('content-length') || '')
  const fingerprint = [etag, lastModified, contentLength].filter(Boolean).join('__')
  return { etag, lastModified, contentLength, fingerprint }
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

function defaultPlanMetaUrlCandidates() {
  const base = (import.meta?.env?.BASE_URL || './')
  return [
    new URL(DEFAULT_PLAN_META_FILENAME, window.location.href).toString(),
    new URL(DEFAULT_PLAN_META_FILENAME, new URL(base, window.location.href)).toString(),
    new URL(`/${DEFAULT_PLAN_META_FILENAME}`, window.location.origin).toString(),
  ]
}

async function fetchBundledDefaultPlanMeta() {
  const urls = defaultPlanMetaUrlCandidates()
  let res = null
  let lastErr = null
  for (const url of urls) {
    try {
      const r = await fetch(url, { cache: 'no-store' })
      if (r.ok) { res = r; break }
      lastErr = new Error(`Default plan meta not found at ${url} (${r.status}).`)
    } catch (e) {
      lastErr = e
    }
  }
  if (!res) throw (lastErr || new Error('Default plan meta not found.'))
  const json = await res.json()
  const workbookModifiedAt = safeText(json?.workbookModifiedAt || '')
  const size = Number(json?.size || 0)
  const version = safeText(json?.version || '') || [workbookModifiedAt, size || ''].filter(Boolean).join('__')
  return { workbookModifiedAt, size, version }
}

async function fetchBundledDefaultPlanFingerprint() {
  // Preferred: meta JSON (reliable even when hosts strip headers)
  try {
    const meta = await fetchBundledDefaultPlanMeta()
    return {
      etag: '',
      lastModified: meta?.workbookModifiedAt || '',
      contentLength: meta?.size ? String(meta.size) : '',
      fingerprint: safeText(meta?.version || ''),
    }
  } catch {
    // fall back to headers-based fingerprint below
  }

  const urls = defaultPlanUrlCandidates()
  let lastErr = null
  for (const url of urls) {
    try {
      // Prefer HEAD (cheap). Some hosts block HEAD; fall back to GET and cancel body.
      let r = await fetch(url, { method: 'HEAD', cache: 'no-store' })
      if (!r.ok) {
        // 405/403/etc — try GET and cancel body.
        r = await fetch(url, { method: 'GET', cache: 'no-store' })
      }
      if (!r.ok) {
        lastErr = new Error(`Default plan not found at ${url} (${r.status}).`)
        continue
      }
      const fp = fingerprintFromHeaders(r.headers)
      try { await r.body?.cancel?.() } catch { /* ignore */ }
      return fp
    } catch (e) {
      lastErr = e
    }
  }
  if (lastErr) throw lastErr
  return null
}

async function fetchBundledDefaultPlanFile() {
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
  const fp = fingerprintFromHeaders(res.headers)
  const blob = await res.blob()
  const file = new File([blob], 'SPARK Default Plan.xlsx', {
    type: blob.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  // Try to augment fingerprint with meta JSON if present.
  let meta = null
  try { meta = await fetchBundledDefaultPlanMeta() } catch { meta = null }
  const effectiveFp = meta?.version
    ? { etag: '', lastModified: meta.workbookModifiedAt || fp.lastModified || '', contentLength: meta.size ? String(meta.size) : fp.contentLength || '', fingerprint: meta.version }
    : fp
  return { file, blob, fingerprint: effectiveFp }
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
  const [loadState, setLoadState] = useState('loading') // 'loading' | 'loaded' | 'failed'
  const [bundledDefaultUpdate, setBundledDefaultUpdate] = useState({ checking: false, available: false, etag: '', lastModified: '', contentLength: '', fingerprint: '', reason: '' })
  const seedInFlightRef = useRef(null) // Promise | null
  const mountedRef = useRef(true)
  const autoBundledUpdateRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    let alive = true
    setLoading(true)
    setLoadState('loading')

    const withTimeout = (p, ms) => {
      return Promise.race([
        p,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Base dataset load timed out.')), ms)),
      ])
    }

    // Important: never assume "empty" if IndexedDB open/get stalls.
    // If we did, we'd risk overwriting an existing saved plan by re-seeding the default.
    withTimeout(loadBaseDataset(), 6000)
      .then((v) => {
        if (!alive) return
        setBase(v)
        setLoading(false)
        setLoadState('loaded')
      })
      .catch((e) => {
        if (!alive) return
        // If IndexedDB is slow/unavailable (Safari/private browsing can stall),
        // do NOT overwrite storage by seeding. We'll fall back to an in-memory default plan.
        setBase(null)
        setError(e?.message || 'Failed to load saved plan from this browser.')
        setLoading(false)
        setLoadState('failed')
      })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    // Seed default plan only when:
    // - base is missing
    // - initial load finished
    // - IndexedDB load succeeded (otherwise we risk overwriting an existing saved plan)
    if (loading) return
    if (base?.ingest) return
    if (seedInFlightRef.current) return
    if (loadState !== 'loaded') return

    const seedDefaultPlan = async () => {
      const { file, blob, fingerprint } = await fetchBundledDefaultPlanFile()
      const ingest = await ingestExcelFile(file)
      const payload = {
        savedAt: nowIso(),
        isBundledDefault: true,
        sourceFileName: safeText(file.name),
        workbookBlob: blob,
        bundledDefaultFingerprint: fingerprint?.fingerprint || '',
        bundledDefaultLastModified: fingerprint?.lastModified || '',
        capacityConfig: null,
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
      await saveBaseDataset(payload)
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
  }, [base, loading, loadState])

  useEffect(() => {
    // If we cannot reliably load IndexedDB, keep the app usable by seeding
    // the default plan in-memory only (do not write to IndexedDB).
    if (loading) return
    if (base?.ingest) return
    if (seedInFlightRef.current) return
    if (loadState !== 'failed') return

    const seedInMemoryDefaultPlan = async () => {
      const { file, blob, fingerprint } = await fetchBundledDefaultPlanFile()
      const ingest = await ingestExcelFile(file)
      const payload = {
        savedAt: nowIso(),
        isBundledDefault: true,
        sourceFileName: safeText(file.name),
        workbookBlob: blob,
        bundledDefaultFingerprint: fingerprint?.fingerprint || '',
        bundledDefaultLastModified: fingerprint?.lastModified || '',
        capacityConfig: null,
        ingest,
        audit: [
          {
            at: nowIso(),
            by: safeText(localStorage.getItem('spark_editor_name') || ''),
            action: 'base_seed_default_plan_in_memory_only',
            sourceFileName: safeText(file.name),
          }
        ],
      }
      return payload
    }

    setLoading(true)
    seedInFlightRef.current = seedInMemoryDefaultPlan()
      .then((payload) => {
        seedInFlightRef.current = null
        if (!mountedRef.current) return
        setBase(payload)
        setLoading(false)
      })
      .catch((e) => {
        seedInFlightRef.current = null
        if (!mountedRef.current) return
        setError(e?.message || 'Failed to load default plan.')
        setLoading(false)
      })
  }, [base, loading, loadState])

  const baseSummary = useMemo(() => summarizeIngest(base?.ingest), [base])

  const setBaseFromFile = useCallback(async (file, { capacityConfig } = {}) => {
    if (!file) return null
    setLoading(true)
    setError(null)
    try {
      const ingest = await ingestExcelFile(file)
      const payload = {
        savedAt: nowIso(),
        isBundledDefault: false,
        sourceFileName: safeText(file.name),
        workbookBlob: file, // File is a Blob; persisted for "export as-is"
        capacityConfig: capacityConfig ?? base?.capacityConfig ?? null,
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
  }, [base])

  const resetToBundledDefaultPlan = useCallback(async ({ editorName = '', note = '' } = {}) => {
    setLoading(true)
    setError(null)
    try {
      const { file, blob, fingerprint } = await fetchBundledDefaultPlanFile()
      const ingest = await ingestExcelFile(file)
      const payload = {
        savedAt: nowIso(),
        isBundledDefault: true,
        sourceFileName: safeText(file.name),
        workbookBlob: blob,
        bundledDefaultFingerprint: fingerprint?.fingerprint || '',
        bundledDefaultLastModified: fingerprint?.lastModified || '',
        capacityConfig: null,
        ingest,
        audit: [
          ...(base?.audit || []),
          {
            at: nowIso(),
            by: safeText(editorName || localStorage.getItem('spark_editor_name') || ''),
            action: 'base_reset_to_default_plan',
            note: safeText(note) || 'Reset to bundled SPARK default plan',
            sourceFileName: safeText(file.name),
          }
        ],
      }
      await saveBaseDataset(payload)
      setBase(payload)
      setLoading(false)
      return payload
    } catch (e) {
      setError(e?.message || 'Failed to reset to default plan.')
      setLoading(false)
      return null
    }
  }, [base])

  const resetBaseToSourceWorkbook = useCallback(async ({ editorName = '', note = '' } = {}) => {
    if (!base?.ingest) return null
    setLoading(true)
    setError(null)
    try {
      const wb = base?.workbookBlob
      if (!wb) {
        // No stored workbook: best-effort reset of "Advanced Planning" settings only.
        const payload = {
          ...base,
          savedAt: nowIso(),
          capacityConfig: null,
          audit: [
            ...(base?.audit || []),
            {
              at: nowIso(),
              by: safeText(editorName || localStorage.getItem('spark_editor_name') || ''),
              action: 'base_updated',
              note: safeText(note) || 'Reset planning settings (no workbook available to re-ingest)',
            }
          ],
        }
        await saveBaseDataset(payload)
        setBase(payload)
        setLoading(false)
        return payload
      }

      const file = new File([wb], safeText(base?.sourceFileName) || 'plan.xlsx', {
        type: wb.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      const ingest = await ingestExcelFile(file)
      const payload = {
        ...base,
        savedAt: nowIso(),
        ingest,
        capacityConfig: null,
        audit: [
          ...(base?.audit || []),
          {
            at: nowIso(),
            by: safeText(editorName || localStorage.getItem('spark_editor_name') || ''),
            action: 'base_reset_to_source_workbook',
            note: safeText(note) || 'Reset plan edits and planning settings to the uploaded workbook',
          }
        ],
      }
      await saveBaseDataset(payload)
      setBase(payload)
      setLoading(false)
      return payload
    } catch (e) {
      setError(e?.message || 'Failed to reset plan to source workbook.')
      setLoading(false)
      return null
    }
  }, [base])

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

  const updateBaseCapacityConfig = useCallback(async ({ editorName = '', note = '', capacityConfig }) => {
    if (!base?.ingest) return null
    setLoading(true)
    setError(null)
    try {
      const payload = {
        ...base,
        savedAt: nowIso(),
        capacityConfig: capacityConfig ?? null,
        audit: [
          ...(base?.audit || []),
          {
            at: nowIso(),
            by: safeText(editorName),
            action: 'base_updated',
            note: safeText(note) || 'Updated capacity assumptions',
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

  const detachBaseWorkbook = useCallback(async ({ editorName = '', note = '' } = {}) => {
    if (!base?.ingest) return null
    setLoading(true)
    setError(null)
    try {
      const payload = {
        ...base,
        savedAt: nowIso(),
        sourceFileName: '',
        workbookBlob: null,
        audit: [
          ...(base?.audit || []),
          {
            at: nowIso(),
            by: safeText(editorName),
            action: 'base_updated',
            note: safeText(note) || 'Detached source workbook (kept plan data)',
          }
        ],
      }
      await saveBaseDataset(payload)
      setBase(payload)
      setLoading(false)
      return payload
    } catch (e) {
      setError(e?.message || 'Failed to detach workbook from base dataset.')
      setLoading(false)
      return null
    }
  }, [base])

  useEffect(() => {
    if (loading) return
    if (loadState !== 'loaded') return
    if (!base?.ingest) return

    const isBundledDefault = !!(base?.isBundledDefault || (base?.audit || []).some(a => a?.action === 'base_seed_default_plan'))
    if (!isBundledDefault) {
      setBundledDefaultUpdate(prev => ({ ...(prev || {}), checking: false, available: false, reason: '' }))
      return
    }

    let alive = true
    ;(async () => {
      try {
        setBundledDefaultUpdate(prev => ({ ...(prev || {}), checking: true, reason: '' }))
        const fp = await fetchBundledDefaultPlanFingerprint()
        if (!alive) return

        const currentFp = safeText(base?.bundledDefaultFingerprint || '')
        const remoteFp = safeText(fp?.fingerprint || '')

        const currentModIso = safeText(base?.ingest?.meta?.workbookModifiedAt || '')
        const currentMod = currentModIso ? new Date(currentModIso) : null
        const remoteMod = fp?.lastModified ? new Date(fp.lastModified) : null
        const currentModOk = currentMod instanceof Date && !isNaN(currentMod.getTime())
        const remoteModOk = remoteMod instanceof Date && !isNaN(remoteMod.getTime())

        const fingerprintDiff = !!(currentFp && remoteFp && currentFp !== remoteFp)

        const remoteLen = Number(fp?.contentLength || 0)
        const currentLen = Number(base?.workbookBlob?.size || 0)
        const lengthDiff = remoteLen > 0 && currentLen > 0 ? (remoteLen !== currentLen) : false

        const currentSaved = base?.savedAt ? new Date(base.savedAt) : null
        const currentSavedOk = currentSaved instanceof Date && !isNaN(currentSaved.getTime())

        const modifiedDiff = currentModOk && remoteModOk ? (remoteMod.getTime() - currentMod.getTime() > 60 * 1000) : false
        const savedDiff = currentSavedOk && remoteModOk ? (remoteMod.getTime() - currentSaved.getTime() > 60 * 1000) : false

        // If we can't compare fingerprints (older saved plans may not have it),
        // fall back to size + Last-Modified comparisons.
        const available =
          fingerprintDiff ||
          (!fingerprintDiff && lengthDiff) ||
          (!currentFp && (modifiedDiff || savedDiff))

        setBundledDefaultUpdate({
          checking: false,
          available,
          etag: fp?.etag || '',
          lastModified: fp?.lastModified || '',
          contentLength: fp?.contentLength || '',
          fingerprint: fp?.fingerprint || '',
          reason: fingerprintDiff ? 'fingerprint_changed' : lengthDiff ? 'content_length_changed' : (available ? 'last_modified_newer' : ''),
        })

        // Auto-update ONLY when user has not edited the bundled default locally.
        const audit = Array.isArray(base?.audit) ? base.audit : []
        const hasUserEdits = audit.some(a => a?.action === 'base_updated')
        const hasCapacityEdits = !!base?.capacityConfig
        const canAuto = available && !hasUserEdits && !hasCapacityEdits
        if (canAuto && !autoBundledUpdateRef.current) {
          autoBundledUpdateRef.current = true
          await resetToBundledDefaultPlan?.({ note: 'Auto-updated to latest bundled default plan' })
        }
      } catch {
        if (!alive) return
        setBundledDefaultUpdate(prev => ({ ...(prev || {}), checking: false }))
      }
    })()

    return () => { alive = false }
  }, [base, loading, loadState, resetToBundledDefaultPlan])

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
    bundledDefaultUpdate,
    setBaseFromFile,
    updateBaseIngest,
    updateBaseProjects,
    updateBaseRoster,
    updateBaseCapacityConfig,
    detachBaseWorkbook,
    resetToBundledDefaultPlan,
    resetBaseToSourceWorkbook,
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


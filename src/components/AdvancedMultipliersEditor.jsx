import React, { useMemo, useState } from 'react'
import NumericField from './NumericField'
import { Pill } from './ui'
import {
  NETWORK_TYPE_MULTIPLIERS,
  NON_STANDARD_DATA_MULTIPLIERS,
  NON_STANDARD_METRIC_MULTIPLIERS,
  IVMS_CONFIGURATION_MULTIPLIERS,
} from '../engine/schema.js'

function safeText(s) {
  return String(s || '').trim()
}

function normLower(s) {
  return safeText(s).toLowerCase()
}

function pickLevel(raw) {
  const s = normLower(raw)
  if (!s || s === '-' || s === 'na' || s === 'n/a') return ''
  if (s === 'low') return 'Low'
  if (s === 'medium' || s === 'med') return 'Medium'
  if (s === 'high') return 'High'
  return ''
}

function setOrDelete(obj, key, val) {
  const out = { ...(obj || {}) }
  if (val === undefined || val === null || val === '') delete out[key]
  else out[key] = val
  return out
}

export default function AdvancedMultipliersEditor({
  projects = [],
  value,
  onChange,
  mode = 'plan', // 'plan' | 'scenario' (labeling only)
}) {
  const overrides = (value && typeof value === 'object') ? value : {}

  const netOverrides = (overrides.networkTypeMultipliers && typeof overrides.networkTypeMultipliers === 'object') ? overrides.networkTypeMultipliers : {}
  const nsdOverrides = (overrides.nonStandardDataMultipliers && typeof overrides.nonStandardDataMultipliers === 'object') ? overrides.nonStandardDataMultipliers : {}
  const nsmOverrides = (overrides.nonStandardMetricMultipliers && typeof overrides.nonStandardMetricMultipliers === 'object') ? overrides.nonStandardMetricMultipliers : {}
  const ivmsOverrides = (overrides.ivmsConfigurationMultipliers && typeof overrides.ivmsConfigurationMultipliers === 'object') ? overrides.ivmsConfigurationMultipliers : {}
  const projectOverrides = (overrides.projectOverrides && typeof overrides.projectOverrides === 'object') ? overrides.projectOverrides : {}

  const [q, setQ] = useState('')

  const filteredProjects = useMemo(() => {
    const qq = normLower(q)
    const list = Array.isArray(projects) ? projects : []
    const out = list
      .filter(p => {
        if (!qq) return true
        const name = normLower(p?.name || p?.rawName)
        const acct = normLower(p?.accountName)
        return name.includes(qq) || acct.includes(qq)
      })
      .slice()
      .sort((a, b) => safeText(a?.name || '').localeCompare(safeText(b?.name || '')))
    return out
  }, [projects, q])

  const update = (patch) => {
    const next = { ...(overrides || {}) }
    for (const [k, v] of Object.entries(patch || {})) {
      if (v === undefined) delete next[k]
      else next[k] = v
    }
    // Mark as user-driven so the engine knows to apply reconstruction even if
    // the Project List contains PM stage-hour columns.
    next.source = 'ui'
    const cleaned = Object.keys(next).length ? next : undefined
    onChange?.(cleaned)
  }

  const updateProjectOverride = (projectId, patch) => {
    const pid = safeText(projectId)
    if (!pid) return
    const prev = (projectOverrides?.[pid] && typeof projectOverrides[pid] === 'object') ? projectOverrides[pid] : {}
    const nextRec = { ...prev, ...(patch || {}) }
    // clean empties
    for (const k of Object.keys(nextRec)) {
      const v = nextRec[k]
      if (v === undefined || v === null || v === '') delete nextRec[k]
    }
    const nextAll = { ...(projectOverrides || {}) }
    if (Object.keys(nextRec).length === 0) delete nextAll[pid]
    else nextAll[pid] = nextRec
    update({ projectOverrides: Object.keys(nextAll).length ? nextAll : undefined })
  }

  const LEVELS = ['Low', 'Medium', 'High']
  const NETWORKS = Object.keys(NETWORK_TYPE_MULTIPLIERS)

  const hasAnyOverrides =
    Object.keys(netOverrides).length ||
    Object.keys(nsdOverrides).length ||
    Object.keys(nsmOverrides).length ||
    Object.keys(ivmsOverrides).length ||
    Object.keys(projectOverrides).length

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ fontSize: 12.5, color: 'var(--ink-muted)', lineHeight: 1.7 }}>
        <strong>Advanced multipliers</strong> reconstruct PM stage-hours when your workbook doesn’t include the PM stage columns on Project List.
        You typically only edit <strong>project flags</strong>; tables below are defaults (editable).
        <span style={{ display: 'inline-block', marginLeft: 8, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-faint)' }}>
          ({mode === 'scenario' ? 'scenario-only' : 'plan-wide'})
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '10px 12px', background: 'var(--surface-1)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ fontWeight: 900, color: 'var(--ink)' }}>Dx/Tx multipliers</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--ink-faint)' }}>used for PM reconstruction</div>
          </div>
          <div style={{ padding: 12, display: 'grid', gap: 8 }}>
            {NETWORKS.map(k => {
              const baseVal = NETWORK_TYPE_MULTIPLIERS[k]
              const has = netOverrides?.[k] !== undefined && netOverrides?.[k] !== null
              return (
                <div key={k} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ fontSize: 12.5, color: 'var(--ink)', fontWeight: 800 }}>{k}</div>
                  <NumericField
                    kind="float"
                    value={has ? netOverrides?.[k] : undefined}
                    placeholder={String(baseVal)}
                    style={{
                      width: 110,
                      padding: '10px 12px',
                      borderRadius: 10,
                      border: `1px solid ${has ? 'rgba(99,102,241,0.55)' : 'var(--border)'}`,
                      background: has ? 'rgba(99,102,241,0.08)' : 'white',
                      fontFamily: 'var(--font-mono)',
                    }}
                    onCommit={(val) => {
                      const next = setOrDelete(netOverrides, k, val)
                      update({ networkTypeMultipliers: Object.keys(next).length ? next : undefined })
                    }}
                  />
                </div>
              )
            })}
          </div>
        </div>

        <div style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '10px 12px', background: 'var(--surface-1)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ fontWeight: 900, color: 'var(--ink)' }}>Complexity multipliers</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--ink-faint)' }}>defaults shown as placeholders</div>
          </div>
          <div style={{ padding: 12, display: 'grid', gap: 10 }}>
            {[
              { title: 'Non-standard data', base: NON_STANDARD_DATA_MULTIPLIERS, ov: nsdOverrides, key: 'nonStandardDataMultipliers' },
              { title: 'Non-standard metric', base: NON_STANDARD_METRIC_MULTIPLIERS, ov: nsmOverrides, key: 'nonStandardMetricMultipliers' },
              { title: 'IVMS configuration', base: IVMS_CONFIGURATION_MULTIPLIERS, ov: ivmsOverrides, key: 'ivmsConfigurationMultipliers' },
            ].map(group => (
              <div key={group.title} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 10, background: 'white' }}>
                <div style={{ fontSize: 11, fontWeight: 950, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-muted)', marginBottom: 8 }}>
                  {group.title}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                  {LEVELS.map(lvl => {
                    const baseVal = group.base?.[lvl]
                    const has = group.ov?.[lvl] !== undefined && group.ov?.[lvl] !== null
                    return (
                      <div key={lvl} style={{ display: 'grid', gap: 6 }}>
                        <div style={{ fontSize: 11.5, color: 'var(--ink)', fontWeight: 800 }}>{lvl}</div>
                        <NumericField
                          kind="float"
                          value={has ? group.ov?.[lvl] : undefined}
                          placeholder={String(baseVal)}
                          style={{
                            width: '100%',
                            padding: '10px 12px',
                            borderRadius: 10,
                            border: `1px solid ${has ? 'rgba(99,102,241,0.55)' : 'var(--border)'}`,
                            background: has ? 'rgba(99,102,241,0.08)' : 'white',
                            fontFamily: 'var(--font-mono)',
                          }}
                          onCommit={(val) => {
                            const next = setOrDelete(group.ov, lvl, val)
                            update({ [group.key]: Object.keys(next).length ? next : undefined })
                          }}
                        />
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ padding: '10px 12px', background: 'var(--surface-1)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ fontWeight: 900, color: 'var(--ink)' }}>Project flags</div>
            <Pill type="blue">{filteredProjects.length} shown</Pill>
            {Object.keys(projectOverrides).length ? <Pill type="amber">{Object.keys(projectOverrides).length} overridden</Pill> : null}
          </div>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search projects…"
            style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid var(--border)', background: 'white', fontSize: 12.5, minWidth: 240 }}
          />
        </div>
        <div style={{ padding: 12, overflow: 'auto', maxHeight: 360 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead style={{ background: 'var(--surface-1)' }}>
              <tr>
                {['Project', 'VIBE', 'Network', 'NS data', 'NS metric', 'IVMS'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '10px 10px', borderBottom: '1px solid var(--border)', fontSize: 10.5, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--ink-muted)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredProjects.slice(0, 120).map(p => {
                const pid = safeText(p?.id)
                const ovr = pid ? (projectOverrides?.[pid] || null) : null
                const network = safeText(ovr?.networkType ?? p?.networkType) || 'Distribution (Dx)'
                const nsd = pickLevel(ovr?.nonStandardData ?? p?.nonStandardData) || 'Low'
                const nsm = pickLevel(ovr?.nonStandardMetric ?? p?.nonStandardMetric) || 'Low'
                const ivms = pickLevel(ovr?.ivmsConfiguration ?? p?.ivmsConfiguration) || 'Low'
                const hasOvr = !!(ovr && Object.keys(ovr).length)
                return (
                  <tr key={pid || p?.name}>
                    <td style={{ padding: '10px 10px', borderBottom: '1px solid var(--border)', maxWidth: 360 }}>
                      <div style={{ fontWeight: 850, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {safeText(p?.name) || safeText(p?.rawName) || '(unnamed)'}
                      </div>
                      {hasOvr ? (
                        <div style={{ fontSize: 11.5, color: 'var(--ink-faint)', fontFamily: 'var(--font-mono)' }}>
                          override
                        </div>
                      ) : null}
                    </td>
                    <td style={{ padding: '10px 10px', borderBottom: '1px solid var(--border)', color: 'var(--ink-muted)' }}>
                      {safeText(p?.vibeType) || '—'}
                    </td>
                    <td style={{ padding: '10px 10px', borderBottom: '1px solid var(--border)' }}>
                      <select
                        value={network}
                        onChange={(e) => updateProjectOverride(pid, { networkType: e.target.value })}
                        style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid var(--border)', background: 'white', fontSize: 12.5, minWidth: 190 }}
                      >
                        <option value="">Use workbook (default Dx)</option>
                        {NETWORKS.map(x => <option key={x} value={x}>{x}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: '10px 10px', borderBottom: '1px solid var(--border)' }}>
                      <select
                        value={nsd}
                        onChange={(e) => updateProjectOverride(pid, { nonStandardData: e.target.value })}
                        style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid var(--border)', background: 'white', fontSize: 12.5, minWidth: 150 }}
                      >
                        <option value="">Use workbook (default Low)</option>
                        {LEVELS.map(x => <option key={x} value={x}>{x}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: '10px 10px', borderBottom: '1px solid var(--border)' }}>
                      <select
                        value={nsm}
                        onChange={(e) => updateProjectOverride(pid, { nonStandardMetric: e.target.value })}
                        style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid var(--border)', background: 'white', fontSize: 12.5, minWidth: 150 }}
                      >
                        <option value="">Use workbook (default Low)</option>
                        {LEVELS.map(x => <option key={x} value={x}>{x}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: '10px 10px', borderBottom: '1px solid var(--border)' }}>
                      <select
                        value={ivms}
                        onChange={(e) => updateProjectOverride(pid, { ivmsConfiguration: e.target.value })}
                        style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid var(--border)', background: 'white', fontSize: 12.5, minWidth: 150 }}
                      >
                        <option value="">Use workbook (default Low)</option>
                        {LEVELS.map(x => <option key={x} value={x}>{x}</option>)}
                      </select>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {filteredProjects.length > 120 ? (
            <div style={{ marginTop: 10, fontSize: 12, color: 'var(--ink-faint)' }}>
              Showing first 120 projects. Refine your search to edit more.
            </div>
          ) : null}
        </div>
      </div>

      {hasAnyOverrides ? (
        <button
          onClick={() => onChange?.(undefined)}
          style={{ padding: '10px 12px', borderRadius: 12, border: '1px solid rgba(248,113,113,0.35)', background: 'transparent', color: 'var(--red)', fontWeight: 900, cursor: 'pointer', width: 'fit-content' }}
        >
          Reset Advanced multipliers overrides
        </button>
      ) : null}
    </div>
  )
}


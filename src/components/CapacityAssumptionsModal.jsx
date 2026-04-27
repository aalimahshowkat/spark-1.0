import React, { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import NumericField from './NumericField'
import { ActionButton, Mono, Pill } from './ui'

const ROLES = ['CSM', 'PM', 'Analyst 1']

function clampToDayRange(n) {
  if (!Number.isFinite(n)) return undefined
  if (n < 0) return 0
  if (n > 24) return 24
  return n
}

function normalizeConfig(capacityConfig) {
  const byRole = capacityConfig?.hrsPerPersonDayByRole || {}
  const out = {}
  for (const r of ROLES) {
    const v = byRole?.[r]
    const n = Number(v)
    out[r] = Number.isFinite(n) ? clampToDayRange(n) : undefined
  }
  return out
}

export default function CapacityAssumptionsModal({
  isOpen,
  onClose,
  capacityConfig,
  onSave, // ({ capacityConfig })
  planLabel,
  persistHint, // optional string
}) {
  const initial = useMemo(() => normalizeConfig(capacityConfig), [capacityConfig])
  const [draft, setDraft] = useState(initial)

  useEffect(() => {
    if (!isOpen) return
    setDraft(initial)
  }, [isOpen, initial])

  if (!isOpen) return null

  const save = async () => {
    const byRole = {}
    for (const r of ROLES) {
      const v = clampToDayRange(draft?.[r])
      if (v === undefined) continue
      byRole[r] = v
    }
    const next =
      Object.keys(byRole).length === 0
        ? null
        : { ...(capacityConfig || {}), hrsPerPersonDayByRole: byRole }

    await onSave?.({ capacityConfig: next })
    onClose?.()
  }

  const reset = () => setDraft({})

  return createPortal((
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.35)',
        zIndex: 1000,
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        overflow: 'auto',
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.() }}
    >
      <div style={{
        width: 'min(720px, 96vw)',
        maxHeight: '86vh',
        overflow: 'hidden',
        background: 'white',
        borderRadius: 14,
        border: '1px solid var(--border)',
        boxShadow: '0 20px 60px rgba(15, 23, 42, 0.25)',
        display: 'flex',
        flexDirection: 'column',
      }}>
        <div style={{
          padding: '14px 16px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}>
          <div>
            <div style={{ fontWeight: 900, fontSize: 14.5, letterSpacing: '-0.01em' }}>
              Capacity assumptions
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
              Working hours per business day · <Mono>{planLabel || 'Current plan'}</Mono>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <ActionButton onClick={reset} title="Reset to default assumptions">
              Reset
            </ActionButton>
            <ActionButton onClick={() => onClose?.()}>Close</ActionButton>
          </div>
        </div>

        <div style={{ padding: 16, overflow: 'auto' }}>
          <div style={{ fontSize: 12.5, color: 'var(--ink-muted)', lineHeight: 1.7, marginBottom: 14 }}>
            Default is <strong>10</strong> hours per business day. Leave a field blank to use the default.
          </div>

          {persistHint ? (
            <div style={{ marginBottom: 14 }}>
              <Pill type="amber">{persistHint}</Pill>
            </div>
          ) : null}

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead style={{ background: 'var(--surface-1)' }}>
              <tr>
                {['Role', 'Hours per business day'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 10.5, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--ink-muted)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROLES.map((role, i) => (
                <tr key={role} style={{ background: i % 2 ? 'var(--surface-1)' : 'white' }}>
                  <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontWeight: 800, color: 'var(--ink)' }}>
                    {role}
                  </td>
                  <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
                    <NumericField
                      kind="float"
                      value={draft?.[role]}
                      onCommit={(v) => setDraft(prev => ({ ...(prev || {}), [role]: v }))}
                      placeholder="Default (10)"
                      min={0}
                      max={24}
                      step={0.5}
                      style={{
                        width: 180,
                        padding: '10px 12px',
                        borderRadius: 10,
                        border: '1px solid var(--border)',
                        background: 'var(--surface-0)',
                        fontSize: 12.5,
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
            <button
              onClick={() => onClose?.()}
              style={{
                padding: '10px 12px',
                borderRadius: 10,
                border: '1px solid var(--border)',
                background: 'transparent',
                cursor: 'pointer',
                fontWeight: 800,
                fontSize: 12.5,
                color: 'var(--ink-muted)',
              }}
            >
              Cancel
            </button>
            <button
              onClick={save}
              style={{
                padding: '10px 12px',
                borderRadius: 10,
                border: 'none',
                background: 'var(--accent)',
                cursor: 'pointer',
                fontWeight: 900,
                fontSize: 12.5,
                color: 'white',
              }}
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  ), document.body)
}


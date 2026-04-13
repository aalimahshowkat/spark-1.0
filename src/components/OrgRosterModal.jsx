import React, { useMemo, useState } from 'react'
import { ActionButton, Mono, Pill } from './ui'

const ROLES = ['CSM', 'PM', 'Analyst 1', 'Analyst 2', 'SE']

function safeText(s) {
  return String(s || '').trim()
}

function safeLocalStorageGet(key) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeLocalStorageSet(key, value) {
  try {
    localStorage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

function newId(role, name) {
  const r = safeText(role) || 'Role'
  const n = safeText(name) || 'Person'
  return `${r}__${n}`
}

function normalizeFte(v) {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return 1
  return Math.round(n * 100) / 100
}

function rosterSummary(roster) {
  const out = {}
  for (const r of ROLES) out[r] = 0
  for (const p of roster || []) {
    const role = safeText(p.role)
    const fte = Number(p.fte) || 0
    if (!out[role]) out[role] = 0
    out[role] += fte
  }
  return out
}

export default function OrgRosterModal({
  isOpen,
  onClose,
  roster,
  seedFromProjects, // () => roster[]
  onSaveRoster, // ({ roster, editorName, note })
  planLabel,
}) {
  const [q, setQ] = useState('')
  const [editorName, setEditorName] = useState(() => safeText(safeLocalStorageGet('spark_editor_name') || ''))
  const [note, setNote] = useState('')
  const [draft, setDraft] = useState(null) // { id, name, role, fte }
  const [errors, setErrors] = useState([])

  const list = useMemo(() => {
    const rows = Array.isArray(roster) ? roster : []
    const t = safeText(q).toLowerCase()
    const filtered = t
      ? rows.filter(p =>
          String(p?.name || '').toLowerCase().includes(t) ||
          String(p?.role || '').toLowerCase().includes(t)
        )
      : rows
    return filtered.slice().sort((a, b) => (String(a.role || '') + String(a.name || '')).localeCompare(String(b.role || '') + String(b.name || '')))
  }, [roster, q])

  const summary = useMemo(() => rosterSummary(roster || []), [roster])

  const startAdd = () => {
    setErrors([])
    setDraft({ id: `person_${Date.now()}`, name: '', role: 'CSM', fte: 1 })
  }

  const startEdit = (p) => {
    setErrors([])
    setDraft({
      id: safeText(p.id) || newId(p.role, p.name),
      name: safeText(p.name),
      role: safeText(p.role) || 'CSM',
      fte: normalizeFte(p.fte),
    })
  }

  const remove = async (p) => {
    const next = (roster || []).filter(x => x.id !== p.id)
    safeLocalStorageSet('spark_editor_name', safeText(editorName))
    await onSaveRoster?.({
      roster: next,
      editorName: safeText(editorName),
      note: safeText(note) || `Removed ${p.name} (${p.role})`,
    })
    setNote('')
  }

  const applySave = async () => {
    const errs = []
    if (!safeText(draft?.name)) errs.push('Name is required.')
    if (!safeText(draft?.role)) errs.push('Role is required.')
    const f = normalizeFte(draft?.fte)
    if (f <= 0) errs.push('FTE must be > 0.')
    setErrors(errs)
    if (errs.length) return

    safeLocalStorageSet('spark_editor_name', safeText(editorName))

    const id = safeText(draft.id) || newId(draft.role, draft.name)
    const row = {
      id,
      name: safeText(draft.name),
      role: safeText(draft.role),
      fte: normalizeFte(draft.fte),
    }
    const next = (roster || []).slice()
    const idx = next.findIndex(x => x.id === id)
    if (idx >= 0) next[idx] = row
    else next.push(row)

    await onSaveRoster?.({
      roster: next,
      editorName: safeText(editorName),
      note: safeText(note) || (idx >= 0 ? `Updated ${row.name} (${row.role})` : `Added ${row.name} (${row.role})`),
    })
    setDraft(null)
    setErrors([])
    setNote('')
  }

  const importFromProjects = async () => {
    const seeded = seedFromProjects?.() || []
    safeLocalStorageSet('spark_editor_name', safeText(editorName))
    await onSaveRoster?.({
      roster: seeded,
      editorName: safeText(editorName),
      note: safeText(note) || 'Seeded roster from project assignments',
    })
    setNote('')
  }

  if (!isOpen) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.35)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.() }}
    >
      <div style={{
        width: 'min(980px, 96vw)',
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
              Team roster
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
              Source of truth for capacity headcount · <Mono>{planLabel || 'Current plan'}</Mono>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <ActionButton onClick={startAdd}>+ Add person</ActionButton>
            <ActionButton onClick={importFromProjects} title="Seed roster from project assignment fields">
              Import from assignments
            </ActionButton>
            <ActionButton onClick={() => onClose?.()}>Close</ActionButton>
          </div>
        </div>

        <div style={{ padding: 14, borderBottom: '1px solid var(--border)', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search people (name/role)…"
            style={{
              flex: 1,
              minWidth: 240,
              padding: '10px 12px',
              borderRadius: 10,
              border: '1px solid var(--border)',
              background: 'var(--surface-0)',
              fontSize: 12.5,
            }}
          />

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>Editor</span>
            <input
              value={editorName}
              onChange={(e) => setEditorName(e.target.value)}
              placeholder="Name (optional)"
              style={{
                width: 220,
                padding: '10px 12px',
                borderRadius: 10,
                border: '1px solid var(--border)',
                background: 'var(--surface-0)',
                fontSize: 12.5,
              }}
            />
          </div>

          <Pill type="blue">{list.length} people</Pill>
        </div>

        <div style={{ padding: 14, borderBottom: '1px solid var(--border)', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {ROLES.map(r => (
            <div key={r} style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
              <strong style={{ color: 'var(--ink)' }}>{r}:</strong> {summary[r] ? summary[r].toFixed(2) : '0'} FTE
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: draft ? '1fr 360px' : '1fr', minHeight: 0, flex: 1 }}>
          <div style={{ overflow: 'auto' }}>
            {list.length === 0 ? (
              <div style={{ padding: 24, color: 'var(--ink-muted)' }}>No people in roster yet.</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead style={{ position: 'sticky', top: 0, background: 'var(--surface-1)', zIndex: 2 }}>
                  <tr>
                    {['Name', 'Role', 'FTE', ''].map(h => (
                      <th key={h} style={{ textAlign: 'left', padding: '10px 14px', borderBottom: '1px solid var(--border)', fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--ink-muted)' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {list.map(p => (
                    <tr key={p.id} style={{ borderBottom: '1px solid rgba(15,23,42,0.06)' }}>
                      <td style={{ padding: '10px 14px', fontWeight: 650 }}>{p.name}</td>
                      <td style={{ padding: '10px 14px', color: 'var(--ink-muted)' }}>{p.role}</td>
                      <td style={{ padding: '10px 14px', fontFamily: 'var(--font-mono)' }}>{Number(p.fte || 0).toFixed(2)}</td>
                      <td style={{ padding: '10px 14px' }}>
                        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                          <ActionButton onClick={() => startEdit(p)}>Edit</ActionButton>
                          <ActionButton onClick={() => remove(p)} title="Remove from roster">Remove</ActionButton>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {draft && (
            <div style={{ borderLeft: '1px solid var(--border)', padding: 14, overflow: 'auto' }}>
              <div style={{ fontWeight: 900, fontSize: 13.5, marginBottom: 10 }}>
                {safeText(draft.id).startsWith('person_') ? 'Add person' : 'Edit person'}
              </div>

              <div style={{ display: 'grid', gap: 10 }}>
                <div>
                  <div style={labelStyle}>Name</div>
                  <input
                    value={draft.name}
                    onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
                    placeholder="e.g. A. Khan"
                    style={inputStyle}
                  />
                </div>
                <div>
                  <div style={labelStyle}>Role</div>
                  <select value={draft.role} onChange={e => setDraft(d => ({ ...d, role: e.target.value }))}
                    style={{ ...inputStyle, paddingRight: 28 }}
                  >
                    {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <div>
                  <div style={labelStyle}>FTE</div>
                  <input
                    value={String(draft.fte)}
                    onChange={e => setDraft(d => ({ ...d, fte: e.target.value }))}
                    placeholder="1"
                    style={inputStyle}
                  />
                </div>

                {errors.length > 0 && (
                  <div style={{ background: 'var(--red-light)', border: '1px solid #fecaca', borderRadius: 10, padding: '10px 12px', color: '#991b1b', fontSize: 12.5 }}>
                    <strong>Please fix:</strong>
                    <ul style={{ margin: '6px 0 0 18px' }}>
                      {errors.map((e, i) => <li key={i}>{e}</li>)}
                    </ul>
                  </div>
                )}

                <div>
                  <div style={labelStyle}>Note (optional)</div>
                  <input
                    value={note}
                    onChange={e => setNote(e.target.value)}
                    placeholder="Why this change?"
                    style={inputStyle}
                  />
                </div>

                <div style={{ display: 'flex', gap: 10 }}>
                  <button onClick={applySave} style={primaryBtn}>Save</button>
                  <button onClick={() => { setDraft(null); setErrors([]) }} style={ghostBtn}>Cancel</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const labelStyle = {
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--ink-muted)',
  marginBottom: 6,
}

const inputStyle = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid var(--border)',
  background: 'var(--surface-0)',
  fontSize: 13,
  outline: 'none',
  fontFamily: 'var(--font-sans)',
}

const primaryBtn = {
  padding: '9px 14px',
  background: 'var(--accent)',
  color: 'white',
  border: 'none',
  borderRadius: 10,
  fontSize: 13,
  fontWeight: 800,
  cursor: 'pointer',
  flex: 1,
  fontFamily: 'var(--font-sans)',
}

const ghostBtn = {
  padding: '9px 14px',
  background: 'transparent',
  color: 'var(--ink)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer',
  flex: 1,
  fontFamily: 'var(--font-sans)',
}


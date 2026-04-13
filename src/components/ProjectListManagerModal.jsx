import React, { useMemo, useState } from 'react'
import { VIBE_TYPES } from '../engine/schema'
import { ActionButton, Mono, Pill } from './ui'

const ORBITS = ['', 'A', 'B', 'C', 'D']
const STATUSES = ['Open', 'In Progress', 'Done']

function safeText(s) {
  return String(s || '').trim()
}

function monthToInput(date) {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) return ''
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  return `${yyyy}-${mm}`
}

function inputToMonth(s) {
  const t = safeText(s)
  const m = /^(\d{4})-(\d{2})$/.exec(t)
  if (!m) return null
  const yyyy = Number(m[1])
  const mm = Number(m[2])
  if (!Number.isFinite(yyyy) || !Number.isFinite(mm) || mm < 1 || mm > 12) return null
  return new Date(yyyy, mm - 1, 1)
}

function dateToInput(date) {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) return ''
  // Stored in UTC in ingest; use UTC getters.
  const yyyy = date.getUTCFullYear()
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(date.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function inputToUtcDate(s) {
  const t = safeText(s)
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t)
  if (!m) return null
  const yyyy = Number(m[1])
  const mm = Number(m[2])
  const dd = Number(m[3])
  if (!Number.isFinite(yyyy) || !Number.isFinite(mm) || !Number.isFinite(dd)) return null
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null
  return new Date(Date.UTC(yyyy, mm - 1, dd))
}

function newId() {
  return `proj_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

function validateDraft(d) {
  const errs = []
  if (!safeText(d.name)) errs.push('Project name is required.')
  if (!d.startDate) errs.push('Start month is required.')
  if (!d.deliveryDate) errs.push('Due month is required.')
  if (d.startDate && d.deliveryDate && d.deliveryDate < d.startDate) {
    errs.push('Due month must be on/after start month.')
  }
  if (d.vibeType && !VIBE_TYPES.includes(d.vibeType)) errs.push('VIBE type is invalid.')
  if (d.orbit && !ORBITS.includes(d.orbit)) errs.push('Orbit is invalid.')
  return errs
}

export default function ProjectListManagerModal({
  isOpen,
  onClose,
  projects,
  roster = [],
  onSaveProjects,
  baseLabel,
}) {
  const [q, setQ] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [editorName, setEditorName] = useState(() => safeText(localStorage.getItem('spark_editor_name') || ''))
  const [note, setNote] = useState('')
  const [mode, setMode] = useState('view') // view | edit | add
  const [draft, setDraft] = useState(null)
  const [errors, setErrors] = useState([])
  const [confirmDelete, setConfirmDelete] = useState(false)

  const list = useMemo(() => {
    const rows = Array.isArray(projects) ? projects : []
    const t = safeText(q).toLowerCase()
    const out = t
      ? rows.filter(p =>
          String(p?.name || '').toLowerCase().includes(t) ||
          String(p?.accountName || '').toLowerCase().includes(t) ||
          String(p?.vibeType || '').toLowerCase().includes(t)
        )
      : rows
    return out.slice().sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || '')))
  }, [projects, q])

  const selected = useMemo(() => {
    if (!selectedId) return null
    return (projects || []).find(p => p.id === selectedId) || null
  }, [projects, selectedId])

  const startEdit = (p) => {
    setMode('edit')
    setConfirmDelete(false)
    setErrors([])
    setDraft({
      id: p.id,
      name: safeText(p.name),
      accountName: safeText(p.accountName),
      vibeType: safeText(p.vibeType) || 'Bond',
      status: safeText(p.status) || 'Open',
      orbit: safeText(p.orbit),
      startDate: p.startDate instanceof Date ? p.startDate : null,
      deliveryDate: p.deliveryDate instanceof Date ? p.deliveryDate : null,
      analyticsStartDate: p.analyticsStartDate instanceof Date ? p.analyticsStartDate : null,
      deliveryDateExact: p.deliveryDateExact instanceof Date ? p.deliveryDateExact : null,
      totalLMs: Number.isFinite(+p.totalLMs) ? +p.totalLMs : 0,
      lmMultiplier: Number.isFinite(+p.lmMultiplier) ? +p.lmMultiplier : 1,
      assignedCSM: safeText(p.assignedCSM),
      assignedPM: safeText(p.assignedPM),
      assignedSE: safeText(p.assignedSE),
      assignedAnalyst1: safeText(p.assignedAnalyst1),
      assignedAnalyst2: safeText(p.assignedAnalyst2),
    })
  }

  const startAdd = () => {
    setMode('add')
    setSelectedId(null)
    setConfirmDelete(false)
    setErrors([])
    setDraft({
      id: newId(),
      name: '',
      accountName: '',
      vibeType: 'Bond',
      status: 'Open',
      orbit: '',
      startDate: null,
      deliveryDate: null,
      analyticsStartDate: null,
      deliveryDateExact: null,
      totalLMs: 0,
      lmMultiplier: 1,
      assignedCSM: '',
      assignedPM: '',
      assignedSE: '',
      assignedAnalyst1: '',
      assignedAnalyst2: '',
    })
  }

  const applySave = async () => {
    const errs = validateDraft(draft)
    setErrors(errs)
    if (errs.length) return

    localStorage.setItem('spark_editor_name', safeText(editorName))

    const nextProjects = (projects || []).slice()
    const idx = nextProjects.findIndex(p => p.id === draft.id)
    const base = idx >= 0 ? nextProjects[idx] : {}

    const startMonthIndex = draft.startDate ? draft.startDate.getMonth() : -1
    const deliveryMonthIndex = draft.deliveryDate ? draft.deliveryDate.getMonth() : -1

    const updated = {
      ...base,
      id: draft.id,
      name: safeText(draft.name),
      rawName: safeText(draft.name),
      accountName: safeText(draft.accountName),
      vibeType: draft.vibeType,
      status: draft.status,
      orbit: safeText(draft.orbit) || null,
      startDate: draft.startDate,
      deliveryDate: draft.deliveryDate,
      analyticsStartDate: draft.analyticsStartDate,
      deliveryDateExact: draft.deliveryDateExact,
      startMonthIndex,
      deliveryMonthIndex,
      totalLMs: Number.isFinite(+draft.totalLMs) ? +draft.totalLMs : 0,
      lmMultiplier: Number.isFinite(+draft.lmMultiplier) ? +draft.lmMultiplier : 1,
      assignedCSM: safeText(draft.assignedCSM),
      assignedPM: safeText(draft.assignedPM),
      assignedSE: safeText(draft.assignedSE),
      assignedAnalyst1: safeText(draft.assignedAnalyst1),
      assignedAnalyst2: safeText(draft.assignedAnalyst2),
      _audit: {
        ...(base?._audit || {}),
        updatedAt: new Date().toISOString(),
        updatedBy: safeText(editorName),
      }
    }

    if (idx >= 0) nextProjects[idx] = updated
    else nextProjects.push(updated)

    await onSaveProjects?.({
      projects: nextProjects,
      editorName: safeText(editorName),
      note: safeText(note) || (mode === 'add' ? `Added project "${updated.name}"` : `Updated project "${updated.name}"`),
    })

    setMode('view')
    setDraft(null)
    setNote('')
    setErrors([])
    setConfirmDelete(false)
    setSelectedId(updated.id)
  }

  const applyDelete = async () => {
    if (!selected) return
    const nextProjects = (projects || []).filter(p => p.id !== selected.id)
    await onSaveProjects?.({
      projects: nextProjects,
      editorName: safeText(editorName),
      note: safeText(note) || `Deleted project "${selected.name}"`,
    })
    setSelectedId(null)
    setMode('view')
    setDraft(null)
    setErrors([])
    setConfirmDelete(false)
    setNote('')
  }

  const rosterByRole = useMemo(() => {
    // Suggestions come from roster (source of truth) PLUS any names already present
    // in projects, so old saved plans (no roster yet) still get dropdown suggestions.
    const map = {
      CSM: new Set(),
      PM: new Set(),
      SE: new Set(),
      'Analyst 1': new Set(),
      'Analyst 2': new Set(),
    }

    const isPlaceholder = (n) => {
      const t = safeText(n)
      if (!t) return true
      return ['Unassigned', 'Need to allocate', '?', 'TBD', 'BA1', 'BA2', 'New PM1', 'New PM2'].includes(t)
    }

    const add = (role, name) => {
      const n = safeText(name)
      if (!n || isPlaceholder(n)) return
      if (!map[role]) return
      map[role].add(n)
    }

    // 1) Roster entries
    for (const p of (roster || [])) {
      add(safeText(p.role), p.name)
    }

    // 2) Fallback: infer from projects
    for (const p of (projects || [])) {
      add('CSM', p.assignedCSM)
      add('PM', p.assignedPM)
      add('SE', p.assignedSE)
      add('Analyst 1', p.assignedAnalyst1)
      add('Analyst 2', p.assignedAnalyst2)
    }

    const out = {}
    for (const k of Object.keys(map)) out[k] = [...map[k]].sort((a, b) => a.localeCompare(b))
    return out
  }, [roster, projects])

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
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.()
      }}
    >
      <div style={{
        width: 'min(1100px, 96vw)',
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
        }}>
          <div>
            <div style={{ fontWeight: 850, fontSize: 14.5, letterSpacing: '-0.01em' }}>
              Manage Projects
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
              Editing Base Project List · <Mono>{baseLabel || 'Base dataset'}</Mono>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <ActionButton onClick={startAdd} title="Add a new project">+ Add project</ActionButton>
            <ActionButton onClick={() => onClose?.()} title="Close">Close</ActionButton>
          </div>
        </div>

        <div style={{ padding: 14, borderBottom: '1px solid var(--border)', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search projects (name/account/VIBE)…"
            style={{
              flex: 1,
              minWidth: 260,
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
          <Pill type="blue">{list.length} projects</Pill>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', minHeight: 0, flex: 1 }}>
          {/* Left list */}
          <div style={{ borderRight: '1px solid var(--border)', overflow: 'auto' }}>
            {list.map(p => {
              const active = p.id === selectedId
              return (
                <button
                  key={p.id}
                  onClick={() => { setSelectedId(p.id); setMode('view'); setDraft(null); setErrors([]); setConfirmDelete(false) }}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '12px 14px',
                    border: 'none',
                    borderBottom: '1px solid rgba(15,23,42,0.06)',
                    background: active ? 'rgba(37,99,235,0.08)' : 'white',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                    <div style={{ fontWeight: 750, fontSize: 12.8, color: 'var(--ink)' }}>
                      {p.name || '(unnamed)'}
                    </div>
                    <Pill type="amber">{p.vibeType || '—'}</Pill>
                  </div>
                  <div style={{ marginTop: 4, fontSize: 11.5, color: 'var(--ink-muted)', display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                    <span>{p.accountName || '—'}</span>
                    <span>{p.deliveryDate ? monthToInput(p.deliveryDate).replace('-', '–') : '—'}</span>
                  </div>
                </button>
              )
            })}
            {list.length === 0 && (
              <div style={{ padding: 16, color: 'var(--ink-muted)', fontSize: 12.5 }}>No projects match your search.</div>
            )}
          </div>

          {/* Right details */}
          <div style={{ padding: 16, overflow: 'auto' }}>
            {mode === 'view' && !selected && (
              <div style={{ color: 'var(--ink-muted)', fontSize: 12.5 }}>
                Select a project to edit, or add a new one.
              </div>
            )}

            {mode === 'view' && selected && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontWeight: 900, fontSize: 16 }}>{selected.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
                      <Mono>{selected.id}</Mono>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <ActionButton onClick={() => startEdit(selected)} title="Edit project">Edit</ActionButton>
                    <ActionButton onClick={() => setConfirmDelete(true)} title="Delete project">Delete</ActionButton>
                  </div>
                </div>

                {confirmDelete && (
                  <div style={{ marginTop: 14, padding: 12, border: '1px solid #fecaca', background: 'var(--red-light)', borderRadius: 10 }}>
                    <div style={{ fontWeight: 800, marginBottom: 6, color: '#991b1b' }}>Confirm delete</div>
                    <div style={{ fontSize: 12.5, color: '#7f1d1d', marginBottom: 10 }}>
                      This will remove the project from the Base dataset.
                    </div>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <ActionButton onClick={applyDelete} title="Confirm delete">Yes, delete</ActionButton>
                      <ActionButton onClick={() => setConfirmDelete(false)} title="Cancel delete">Cancel</ActionButton>
                    </div>
                  </div>
                )}

                <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  {[
                    ['Account', selected.accountName || '—'],
                    ['VIBE', selected.vibeType || '—'],
                    ['Orbit', selected.orbit || '—'],
                    ['Status', selected.status || '—'],
                    ['Start', selected.startDate ? monthToInput(selected.startDate) : '—'],
                    ['Due', selected.deliveryDate ? monthToInput(selected.deliveryDate) : '—'],
                  ].map(([k, v]) => (
                    <div key={k} style={{ padding: 10, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface-0)' }}>
                      <div style={{ fontSize: 10.5, fontWeight: 850, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--ink-muted)', marginBottom: 4 }}>
                        {k}
                      </div>
                      <div style={{ fontWeight: 800, fontSize: 13 }}>{v}</div>
                    </div>
                  ))}
                </div>

                <div style={{ marginTop: 14, fontSize: 11.5, color: 'var(--ink-faint)' }}>
                  Last edited: {selected?._audit?.updatedAt ? new Date(selected._audit.updatedAt).toLocaleString() : '—'}
                  {selected?._audit?.updatedBy ? ` by ${selected._audit.updatedBy}` : ''}
                </div>
              </>
            )}

            {(mode === 'edit' || mode === 'add') && draft && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 12 }}>
                  <div style={{ fontWeight: 900, fontSize: 16 }}>
                    {mode === 'add' ? 'Add project' : 'Edit project'}
                  </div>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <ActionButton onClick={applySave} title="Save changes">Save</ActionButton>
                    <ActionButton onClick={() => { setMode('view'); setDraft(null); setErrors([]); setNote('') }} title="Cancel">Cancel</ActionButton>
                  </div>
                </div>

                {errors.length > 0 && (
                  <div style={{ marginBottom: 12, padding: 12, borderRadius: 10, border: '1px solid #fde68a', background: 'var(--amber-light)' }}>
                    <div style={{ fontWeight: 850, marginBottom: 6, color: 'var(--amber)' }}>Fix these first</div>
                    <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--ink-muted)', fontSize: 12.5 }}>
                      {errors.map(e => <li key={e}>{e}</li>)}
                    </ul>
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <Field label="Project name *">
                    <input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} style={inputStyle} />
                  </Field>
                  <Field label="Account">
                    <input value={draft.accountName} onChange={e => setDraft({ ...draft, accountName: e.target.value })} style={inputStyle} />
                  </Field>
                  <Field label="VIBE">
                    <select value={draft.vibeType} onChange={e => setDraft({ ...draft, vibeType: e.target.value })} style={inputStyle}>
                      {VIBE_TYPES.map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </Field>
                  <Field label="Status">
                    <select value={draft.status} onChange={e => setDraft({ ...draft, status: e.target.value })} style={inputStyle}>
                      {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </Field>
                  <Field label="Orbit">
                    <select value={draft.orbit} onChange={e => setDraft({ ...draft, orbit: e.target.value })} style={inputStyle}>
                      {ORBITS.map(o => <option key={o || 'blank'} value={o}>{o || '—'}</option>)}
                    </select>
                  </Field>
                  <Field label="LMs">
                    <input type="number" value={draft.totalLMs} onChange={e => setDraft({ ...draft, totalLMs: e.target.value })} style={inputStyle} />
                  </Field>
                  <Field label="LM multiplier">
                    <input type="number" step="0.01" value={draft.lmMultiplier} onChange={e => setDraft({ ...draft, lmMultiplier: e.target.value })} style={inputStyle} />
                  </Field>
                  <div />
                  <Field label="Start month *">
                    <input type="month" value={monthToInput(draft.startDate)} onChange={e => setDraft({ ...draft, startDate: inputToMonth(e.target.value) })} style={inputStyle} />
                  </Field>
                  <Field label="Due month *">
                    <input type="month" value={monthToInput(draft.deliveryDate)} onChange={e => setDraft({ ...draft, deliveryDate: inputToMonth(e.target.value) })} style={inputStyle} />
                  </Field>
                  <Field label="Analytics start month">
                    <input type="month" value={monthToInput(draft.analyticsStartDate)} onChange={e => setDraft({ ...draft, analyticsStartDate: inputToMonth(e.target.value) })} style={inputStyle} />
                  </Field>
                  <Field label="Due exact date (optional)">
                    <input type="date" value={dateToInput(draft.deliveryDateExact)} onChange={e => setDraft({ ...draft, deliveryDateExact: inputToUtcDate(e.target.value) })} style={inputStyle} />
                  </Field>
                </div>

                <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid rgba(15,23,42,0.08)' }}>
                  <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-muted)', marginBottom: 10 }}>
                    Staffing (optional)
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <StaffField
                      label="Assigned Product Consultant (CSM)"
                      value={draft.assignedCSM}
                      onChange={(v) => setDraft({ ...draft, assignedCSM: v })}
                      options={rosterByRole.CSM}
                      listId="spark_roster_csm"
                    />
                    <StaffField
                      label="Assigned Project Manager (PM)"
                      value={draft.assignedPM}
                      onChange={(v) => setDraft({ ...draft, assignedPM: v })}
                      options={rosterByRole.PM}
                      listId="spark_roster_pm"
                    />
                    <StaffField
                      label="Assigned Business Analyst (Analyst 1)"
                      value={draft.assignedAnalyst1}
                      onChange={(v) => setDraft({ ...draft, assignedAnalyst1: v })}
                      options={rosterByRole['Analyst 1']}
                      listId="spark_roster_a1"
                    />
                    <StaffField
                      label="Assigned Business Analyst 2 (Analyst 2)"
                      value={draft.assignedAnalyst2}
                      onChange={(v) => setDraft({ ...draft, assignedAnalyst2: v })}
                      options={rosterByRole['Analyst 2']}
                      listId="spark_roster_a2"
                    />
                    <StaffField
                      label="Assigned Solutions Engineer (SE)"
                      value={draft.assignedSE}
                      onChange={(v) => setDraft({ ...draft, assignedSE: v })}
                      options={rosterByRole.SE}
                      listId="spark_roster_se"
                    />
                  </div>
                </div>

                <div style={{ marginTop: 12 }}>
                  <Field label="Audit note (optional)">
                    <input value={note} onChange={e => setNote(e.target.value)} placeholder="Why is this change being made?" style={inputStyle} />
                  </Field>
                </div>

                <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--ink-faint)' }}>
                  Required: Project name, Start month, Due month.
                  Saving updates the persisted Base dataset and will affect SPARK Engine calculations immediately.
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function StaffField({ label, value, onChange, options, listId }) {
  return (
    <Field label={label}>
      <input
        value={value || ''}
        onChange={(e) => onChange?.(e.target.value)}
        style={inputStyle}
        list={listId}
        placeholder="Type a name or pick from roster"
      />
      <datalist id={listId}>
        {(options || []).map((n) => <option key={n} value={n} />)}
      </datalist>
    </Field>
  )
}

function Field({ label, children }) {
  return (
    <label style={{ display: 'block' }}>
      <div style={{ fontSize: 11.5, color: 'var(--ink-muted)', marginBottom: 6, fontWeight: 750 }}>
        {label}
      </div>
      {children}
    </label>
  )
}

const inputStyle = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid var(--border)',
  background: 'var(--surface-0)',
  fontSize: 12.5,
}


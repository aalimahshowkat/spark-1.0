import React from 'react'

// ── Card ──────────────────────────────────────────────────────────────────
export function Card({ children, style }) {
  return (
    <div style={{
      background: 'var(--surface-0)',
      border: '1px solid var(--border)',
      borderRadius: 10,
      overflow: 'hidden',
      boxShadow: 'var(--shadow-sm)',
      ...style
    }}>
      {children}
    </div>
  )
}

export function CardHeader({ title, tag, children }) {
  return (
    <div style={{
      padding: '13px 18px',
      borderBottom: '1px solid var(--border)',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    }}>
      <span style={{ fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 13.5, color: 'var(--ink)', letterSpacing: '-0.01em' }}>
        {title}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {tag && <Tag>{tag}</Tag>}
        {children}
      </div>
    </div>
  )
}

export function CardBody({ children, style }) {
  return <div style={{ padding: '18px', ...style }}>{children}</div>
}

// ── Tag ───────────────────────────────────────────────────────────────────
export function Tag({ children }) {
  return (
    <span style={{
      fontFamily: 'var(--font-mono)', fontSize: 10, padding: '2px 7px',
      borderRadius: 4, background: 'var(--surface-1)',
      color: 'var(--ink-muted)', fontWeight: 500,
      border: '1px solid var(--border)',
    }}>
      {children}
    </span>
  )
}

// ── KPI Card ──────────────────────────────────────────────────────────────
const ACCENT_MAP = {
  blue:   '#2563eb',
  green:  '#059669',
  amber:  '#d97706',
  red:    '#dc2626',
  purple: '#7c3aed',
  teal:   '#0d9488',
}
const BADGE_MAP = {
  red:   { bg: 'var(--red-light)',    fg: '#991b1b' },
  amber: { bg: 'var(--amber-light)',  fg: '#92400e' },
  green: { bg: 'var(--green-light)',  fg: '#065f46' },
}

export function KpiCard({ label, value, sub, badge, badgeType = 'amber', accent = 'blue' }) {
  const color = ACCENT_MAP[accent] || ACCENT_MAP.blue
  const bc = BADGE_MAP[badgeType] || BADGE_MAP.amber

  return (
    <div style={{
      background: 'var(--surface-0)',
      border: '1px solid var(--border)',
      borderRadius: 10,
      padding: '16px 18px',
      position: 'relative',
      overflow: 'hidden',
      boxShadow: 'var(--shadow-sm)',
    }}>
      <div style={{
        position: 'absolute', left: 0, top: 0, bottom: 0, width: 3,
        background: color, borderRadius: '10px 0 0 10px',
      }} />
      <div style={{
        fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase',
        letterSpacing: '0.7px', color: 'var(--ink-muted)', marginBottom: 7,
      }}>
        {label}
      </div>
      <div style={{
        fontFamily: 'var(--font-serif)', fontSize: 30,
        letterSpacing: '-1px', lineHeight: 1, color: 'var(--ink)', marginBottom: 3,
      }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11.5, color: 'var(--ink-muted)' }}>{sub}</div>}
      {badge && (
        <div style={{
          display: 'inline-flex', alignItems: 'center',
          fontSize: 10.5, fontWeight: 600, padding: '2px 7px',
          borderRadius: 99, marginTop: 6,
          background: bc.bg, color: bc.fg,
        }}>
          {badge}
        </div>
      )}
    </div>
  )
}

export function KpiStrip({ children, cols = 5 }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(${cols}, 1fr)`,
      gap: 14, marginBottom: 24,
    }}>
      {children}
    </div>
  )
}

// ── Section Header ────────────────────────────────────────────────────────
export function SectionHeader({ title, subtitle }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 20 }}>
      <h1 style={{
        fontFamily: 'var(--font-serif)', fontSize: 24,
        letterSpacing: '-0.4px', color: 'var(--ink)', fontWeight: 400,
      }}>
        {title}
      </h1>
      {subtitle && (
        <span style={{ fontSize: 12.5, color: 'var(--ink-muted)' }}>{subtitle}</span>
      )}
    </div>
  )
}

// ── Grid ──────────────────────────────────────────────────────────────────
export function Grid({ cols = '1fr 1fr', gap = 16, style, children }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: cols, gap, marginBottom: 16, ...style }}>
      {children}
    </div>
  )
}

// ── ChartBox ──────────────────────────────────────────────────────────────
export function ChartBox({ height = 220, children }) {
  return <div style={{ position: 'relative', height }}>{children}</div>
}

// ── AlertBar ──────────────────────────────────────────────────────────────
export function AlertBar({ children, type = 'red' }) {
  const styles = {
    red:   { bg: 'var(--red-light)',   border: '#fecaca', text: '#991b1b' },
    amber: { bg: 'var(--amber-light)', border: '#fde68a', text: '#92400e' },
    blue:  { bg: 'var(--blue-light)',  border: '#bfdbfe', text: '#1e40af' },
  }
  const s = styles[type] || styles.red
  return (
    <div style={{
      background: s.bg, border: `1px solid ${s.border}`, borderRadius: 8,
      padding: '11px 14px', display: 'flex', alignItems: 'flex-start', gap: 10,
      marginBottom: 18, fontSize: 12.5, color: s.text, lineHeight: 1.5,
    }}>
      <span style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }}>
        {type === 'amber' ? '⚠' : type === 'blue' ? 'ℹ' : '⚠'}
      </span>
      <span>{children}</span>
    </div>
  )
}

// ── RoleSelector ──────────────────────────────────────────────────────────
const ROLE_ST = {
  CSM:       { border: '#0d9488', bg: '#f0fdfa', color: '#0d9488' },
  PM:        { border: '#2563eb', bg: '#eff6ff', color: '#2563eb' },
  Analyst:   { border: '#7c3aed', bg: '#f5f3ff', color: '#7c3aed' },
  'Analyst 1':{ border: '#7c3aed', bg: '#f5f3ff', color: '#7c3aed' },
  'Analyst 2':{ border: '#a855f7', bg: '#faf5ff', color: '#a855f7' },
  SE:        { border: '#475569', bg: '#f8fafc', color: '#475569' },
}

export function RoleSelector({ roles, active, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 6, marginBottom: 18, flexWrap: 'wrap' }}>
      {roles.map(r => {
        const s = ROLE_ST[r] || {}
        const isActive = active === r
        return (
          <button
            key={r}
            onClick={() => onChange(r)}
            style={{
              padding: '6px 14px', borderRadius: 99,
              border: `1.5px solid ${isActive ? s.border : 'var(--border)'}`,
              background: isActive ? s.bg : 'var(--surface-0)',
              color: isActive ? s.color : 'var(--ink-muted)',
              fontFamily: 'var(--font-sans)', fontSize: 12, fontWeight: isActive ? 600 : 500,
              cursor: 'pointer', transition: 'all 0.12s',
              boxShadow: isActive ? 'none' : 'var(--shadow-sm)',
            }}
          >
            {r}
          </button>
        )
      })}
    </div>
  )
}

// ── Pill ──────────────────────────────────────────────────────────────────
const PILL_ST = {
  green:  { bg: 'var(--green-light)',  color: '#065f46'  },
  amber:  { bg: 'var(--amber-light)',  color: '#92400e'  },
  red:    { bg: 'var(--red-light)',    color: '#991b1b'  },
  blue:   { bg: 'var(--blue-light)',   color: '#1e40af'  },
  purple: { bg: 'var(--purple-light)', color: '#5b21b6'  },
}

export function Pill({ children, type = 'green' }) {
  const s = PILL_ST[type] || PILL_ST.green
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '2px 8px', borderRadius: 99,
      fontSize: 11, fontWeight: 600,
      background: s.bg, color: s.color,
    }}>
      {children}
    </span>
  )
}

// ── Legend ────────────────────────────────────────────────────────────────
export function Legend({ items }) {
  return (
    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 10 }}>
      {items.map(({ label, color }) => (
        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--ink-muted)' }}>
          <div style={{ width: 9, height: 9, borderRadius: 2, background: color }} />
          {label}
        </div>
      ))}
    </div>
  )
}

// ── Mono ──────────────────────────────────────────────────────────────────
export function Mono({ children, style }) {
  return <span style={{ fontFamily: 'var(--font-mono)', ...style }}>{children}</span>
}

// ── DataNote ──────────────────────────────────────────────────────────────
export function DataNote({ children }) {
  return (
    <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 8, fontStyle: 'italic', lineHeight: 1.5 }}>
      {children}
    </p>
  )
}

// ── Status helper ─────────────────────────────────────────────────────────
export function statusStyle(demand, effCap, rawCap) {
  if (demand > effCap)       return { text: 'Over capacity', color: 'var(--red)',   weight: 700 }
  if (demand > rawCap * 0.8) return { text: 'High',          color: 'var(--amber)', weight: 600 }
  return                            { text: 'Healthy',        color: 'var(--green)', weight: 500 }
}

// ── Divider ───────────────────────────────────────────────────────────────
export function Divider() {
  return <div style={{ height: 1, background: 'var(--border)', margin: '24px 0' }} />
}

// ── Source Toggle (Insights bridge) ────────────────────────────────────────
export function SourceToggle({
  value,
  onChange,
  excelEnabled = true,
  engineEnabled = true,
  engineHint,
}) {
  const baseBtn = {
    padding: '6px 10px',
    borderRadius: 10,
    fontSize: 12,
    fontWeight: 600,
    border: '1px solid var(--border)',
    background: 'var(--surface-0)',
    color: 'var(--ink-muted)',
    cursor: 'pointer',
    transition: 'all 0.12s',
  }

  const activeBtn = {
    border: '1px solid rgba(167,139,250,0.55)',
    background: 'var(--accent-light)',
    color: 'var(--accent)',
  }

  const disabledBtn = {
    cursor: 'not-allowed',
    opacity: 0.45,
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '12px 0 18px' }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ink-muted)', letterSpacing: '0.02em' }}>
        View Source:
      </div>
      <div style={{
        display: 'inline-flex',
        border: '1px solid var(--border)',
        background: 'var(--surface-1)',
        borderRadius: 12,
        padding: 3,
        gap: 3,
        boxShadow: 'var(--shadow-sm)',
      }}>
        <button
          onClick={() => excelEnabled && onChange('excel')}
          style={{
            ...baseBtn,
            ...(value === 'excel' ? activeBtn : null),
            ...(excelEnabled ? null : disabledBtn),
          }}
          title="Business-trusted view based on Excel-derived outputs"
        >
          Excel Model
        </button>
        <button
          onClick={() => engineEnabled && onChange('engine')}
          style={{
            ...baseBtn,
            ...(value === 'engine' ? activeBtn : null),
            ...(engineEnabled ? null : disabledBtn),
          }}
          title={engineEnabled ? 'System-generated view from SPARK Engine outputs' : (engineHint || 'Unavailable')}
        >
          SPARK Engine
        </button>
      </div>
      {!engineEnabled && engineHint && (
        <span style={{ fontSize: 11.5, color: 'var(--ink-muted)' }}>
          {engineHint}
        </span>
      )}
    </div>
  )
}

// ── Small action button (header actions) ───────────────────────────────────
export function ActionButton({ children, onClick, title }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        padding: '6px 10px',
        borderRadius: 9,
        border: '1px solid var(--border)',
        background: 'var(--surface-0)',
        color: 'var(--ink-soft)',
        fontFamily: 'var(--font-sans)',
        fontSize: 12,
        fontWeight: 650,
        cursor: 'pointer',
        boxShadow: 'var(--shadow-sm)',
        transition: 'background 0.12s, border-color 0.12s',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-1)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--surface-0)' }}
    >
      {children}
    </button>
  )
}

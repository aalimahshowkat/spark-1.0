import React, { useState } from 'react'

export default function Sidebar({ nav, active, onNav, isEnabled, fileName }) {
  return (
    <aside style={{
      position: 'fixed', left: 0, top: 0, bottom: 0,
      width: 'var(--sidebar-w)',
      background: 'var(--sidebar-bg)',
      borderRight: '1px solid var(--sidebar-border)',
      display: 'flex', flexDirection: 'column',
      zIndex: 200, userSelect: 'none',
    }}>
      {/* Brand */}
      <div style={{ padding: '18px 18px 14px', borderBottom: '1px solid var(--sidebar-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 4 }}>
          <SparkLogo />
          <span style={{ fontFamily: 'var(--font-sans)', fontWeight: 800, fontSize: 16, color: '#fff', letterSpacing: '-0.03em' }}>
            SPARK
          </span>
        </div>
        <div style={{ fontSize: 10, color: 'var(--sidebar-text)', paddingLeft: 33, lineHeight: 1.3, opacity: 0.7 }}>
          Scenario Planning and Resource Capacity
        </div>
      </div>

      {/* Active file chip */}
      {fileName && (
        <div style={{ margin: '9px 12px 0', padding: '7px 10px', background: 'rgba(167,139,250,0.12)', border: '1px solid rgba(167,139,250,0.2)', borderRadius: 6 }}>
          <div style={{ fontSize: 9, color: 'rgba(167,139,250,0.8)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 2 }}>Active plan</div>
          <div style={{ fontSize: 10.5, color: 'rgba(167,139,250,0.95)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fileName}</div>
        </div>
      )}

      {/* Nav */}
      <nav style={{ flex: 1, overflowY: 'auto', padding: '6px 0', marginTop: fileName ? 0 : 4 }}>
        {nav.map(group => (
          <NavGroup key={group.group} group={group} active={active} onNav={onNav} isEnabled={isEnabled} />
        ))}
      </nav>

      {/* Footer */}
      <div style={{ padding: '10px 18px', borderTop: '1px solid var(--sidebar-border)' }}>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', textAlign: 'center', letterSpacing: '0.3px' }}>
          Spark 1.0 · 2026
        </div>
      </div>
    </aside>
  )
}

function NavGroup({ group, active, onNav, isEnabled }) {
  const [expanded, setExpanded] = useState(!group.collapsed)

  return (
    <div style={{ marginBottom: 2 }}>
      {group.label && (
        <div
          onClick={group.collapsed !== undefined ? () => setExpanded(v => !v) : undefined}
          style={{
            fontSize: 9.5, fontWeight: 700, letterSpacing: '0.8px',
            textTransform: 'uppercase', color: 'rgba(255,255,255,0.25)',
            padding: '10px 18px 3px',
            cursor: group.collapsed !== undefined ? 'pointer' : 'default',
            display: 'flex', alignItems: 'center', gap: 4,
          }}
        >
          {group.label}
          {group.collapsed !== undefined && (
            <span style={{ marginLeft: 'auto', fontSize: 9, opacity: 0.5, transform: expanded ? 'none' : 'rotate(-90deg)', transition: 'transform 0.15s' }}>▾</span>
          )}
        </div>
      )}
      {expanded && group.items.map(item => (
        <NavItem key={item.id} item={item} isActive={active === item.id} isEnabled={isEnabled} onNav={onNav} />
      ))}
    </div>
  )
}

function NavItem({ item, isActive, isEnabled, onNav }) {
  const [hovered, setHovered] = useState(false)
  const enabled = isEnabled(item)
  const clickable = enabled && !item.comingSoon

  const textColor = isActive ? '#fff' : !enabled ? 'rgba(255,255,255,0.2)' : hovered ? 'rgba(255,255,255,0.9)' : 'var(--sidebar-text)'
  const bg = isActive ? 'rgba(255,255,255,0.09)' : hovered && clickable ? 'rgba(255,255,255,0.04)' : 'transparent'
  const Icon = item.icon

  return (
    <button
      onClick={() => clickable && onNav(item.id)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 9,
        width: '100%', padding: '7px 18px',
        background: bg, border: 'none',
        cursor: clickable ? 'pointer' : 'default',
        textAlign: 'left', position: 'relative',
        transition: 'background 0.1s',
      }}
    >
      {isActive && (
        <div style={{ position: 'absolute', left: 0, top: '20%', bottom: '20%', width: 2.5, background: 'var(--accent)', borderRadius: '0 2px 2px 0' }} />
      )}
      <span style={{ color: textColor, opacity: !enabled ? 0.3 : 1, flexShrink: 0 }}>
        {Icon && <Icon size={15} color={textColor} />}
      </span>
      <span style={{ fontSize: 13, fontWeight: isActive ? 650 : 420, color: textColor, flex: 1, letterSpacing: isActive ? '-0.01em' : 0 }}>
        {item.label}
      </span>
      {item.badge && (
        <span style={{
          fontSize: 9, fontWeight: 700, letterSpacing: '0.3px',
          padding: '1px 5px', borderRadius: 3,
          background: item.badge === 'New' ? 'rgba(167,139,250,0.2)' : 'rgba(245,158,11,0.15)',
          color: item.badge === 'New' ? 'rgba(167,139,250,0.9)' : 'rgba(245,158,11,0.8)',
          textTransform: 'uppercase',
        }}>
          {item.badge}
        </span>
      )}
    </button>
  )
}

function SparkLogo() {
  return (
    <div style={{
      width: 24, height: 24, borderRadius: 6,
      background: 'linear-gradient(135deg, var(--accent), var(--accent-hover))',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0, boxShadow: '0 0 0 1px rgba(255,255,255,0.1)',
    }}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="white">
        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
      </svg>
    </div>
  )
}

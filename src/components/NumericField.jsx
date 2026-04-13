import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

function isScrollable(el) {
  if (!el || !(el instanceof Element)) return false
  const style = getComputedStyle(el)
  const oy = style.overflowY
  const scrollableY = oy === 'auto' || oy === 'scroll' || oy === 'overlay'
  if (!scrollableY) return false
  return el.scrollHeight > el.clientHeight + 1
}

export function findNearestScrollableAncestor(fromEl) {
  let el = fromEl instanceof Element ? fromEl : null
  while (el) {
    if (isScrollable(el)) return el
    el = el.parentElement
  }
  return document.scrollingElement || null
}

function parseNumeric(text, kind) {
  const raw = String(text ?? '').trim()
  if (!raw) return { ok: true, value: undefined }

  if (kind === 'int') {
    // Allow partial typing like "-" or "+" without committing.
    if (raw === '-' || raw === '+') return { ok: false, value: undefined }
    const n = Number.parseInt(raw, 10)
    if (!Number.isFinite(n)) return { ok: false, value: undefined }
    return { ok: true, value: n }
  }

  // float
  if (raw === '-' || raw === '+' || raw === '.' || raw === '-.' || raw === '+.') return { ok: false, value: undefined }
  const n = Number.parseFloat(raw)
  if (!Number.isFinite(n)) return { ok: false, value: undefined }
  return { ok: true, value: n }
}

function clamp(n, { min, max }) {
  if (!Number.isFinite(n)) return n
  if (Number.isFinite(min)) n = Math.max(min, n)
  if (Number.isFinite(max)) n = Math.min(max, n)
  return n
}

/**
 * NumericField
 * - Uses type="text" + inputMode to avoid native wheel increment/decrement
 * - Commits parsed numbers on blur / Enter (keeps typing stable)
 * - On wheel, scrolls the nearest scrollable ancestor so lists never “freeze”
 */
export default function NumericField({
  value,
  onCommit,
  kind = 'int', // 'int' | 'float'
  inputMode, // optional override
  placeholder,
  min,
  max,
  step,
  style,
  ...rest
}) {
  const inputRef = useRef(null)

  const valueString = useMemo(() => {
    if (value === undefined || value === null) return ''
    if (!Number.isFinite(+value)) return ''
    return String(value)
  }, [value])

  const [draft, setDraft] = useState(valueString)

  useEffect(() => {
    // Don’t stomp user typing mid-edit.
    const active = document.activeElement
    if (active && inputRef.current && active === inputRef.current) return
    setDraft(valueString)
  }, [valueString])

  const commit = useCallback(() => {
    const parsed = parseNumeric(draft, kind)
    if (!parsed.ok) {
      // Revert to last committed value.
      setDraft(valueString)
      return
    }
    if (parsed.value === undefined) {
      onCommit?.(undefined)
      setDraft('')
      return
    }
    const next = clamp(parsed.value, { min, max })
    onCommit?.(next)
    setDraft(String(next))
  }, [draft, kind, max, min, onCommit, valueString])

  const handleWheelCapture = useCallback((ev) => {
    if (ev.ctrlKey) return // pinch-to-zoom
    const scroller = findNearestScrollableAncestor(ev.target)
    if (!scroller) return
    // If there’s nowhere to scroll, let the event bubble normally.
    const canScrollY = scroller.scrollHeight > scroller.clientHeight + 1
    const canScrollX = scroller.scrollWidth > scroller.clientWidth + 1
    if (!canScrollY && !canScrollX) return

    // Guarantee the scroll goes to the list, not to input “value stepping”.
    if (ev.cancelable) ev.preventDefault()
    scroller.scrollBy({ top: ev.deltaY, left: ev.deltaX, behavior: 'auto' })
  }, [])

  const mode = inputMode || (kind === 'float' ? 'decimal' : 'numeric')
  const pattern = kind === 'float' ? '^-?\\d*(?:[\\.,]\\d*)?$' : '^-?\\d*$'

  return (
    <input
      ref={inputRef}
      type="text"
      inputMode={mode}
      pattern={pattern}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          commit()
          e.currentTarget.blur()
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          setDraft(valueString)
          e.currentTarget.blur()
        }
      }}
      onWheelCapture={handleWheelCapture}
      placeholder={placeholder}
      // “step” is retained for semantics / future, but does not affect text inputs.
      data-step={step}
      style={style}
      {...rest}
    />
  )
}


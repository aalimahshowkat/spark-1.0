// workingDays.js — calendar overrides (org/role/person) → per-person working days by month

function safeText(s) {
  return String(s || '').trim()
}

function toIsoDateOnly(d) {
  // YYYY-MM-DD
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function parseIsoDateOnly(iso) {
  const s = safeText(iso)
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3])
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null
  if (mo < 1 || mo > 12) return null
  if (d < 1 || d > 31) return null
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (!Number.isFinite(dt.getTime())) return null
  // validate no rollover
  if (dt.getUTCFullYear() !== y || (dt.getUTCMonth() + 1) !== mo || dt.getUTCDate() !== d) return null
  return dt
}

function clampRangeToYear({ startDate, endDate, year }) {
  const y = Number(year)
  if (!Number.isFinite(y)) return null
  const s = startDate instanceof Date ? startDate : parseIsoDateOnly(startDate)
  const e = endDate instanceof Date ? endDate : parseIsoDateOnly(endDate)
  if (!s || !e) return null
  const start = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate()))
  const end = new Date(Date.UTC(e.getUTCFullYear(), e.getUTCMonth(), e.getUTCDate()))
  if (end < start) return null

  const yearStart = new Date(Date.UTC(y, 0, 1))
  const yearEnd = new Date(Date.UTC(y, 11, 31))
  const cs = start < yearStart ? yearStart : start
  const ce = end > yearEnd ? yearEnd : end
  if (ce < cs) return null
  return { start: cs, end: ce }
}

function pushDateSetByMonth(mapOfSets, d) {
  const mi = d.getUTCMonth()
  if (!mapOfSets[mi]) mapOfSets[mi] = new Set()
  mapOfSets[mi].add(toIsoDateOnly(d))
}

function unionCountByMonth(...mapOfSetsList) {
  const out = new Array(12).fill(0)
  for (let i = 0; i < 12; i++) {
    const merged = new Set()
    for (const m of mapOfSetsList) {
      const set = m?.[i]
      if (!set) continue
      for (const v of set.values()) merged.add(v)
    }
    out[i] = merged.size
  }
  return out
}

function buildSetsForWeekdaysInRanges(ranges, year) {
  const out = new Array(12).fill(null)
  for (const r of Array.isArray(ranges) ? ranges : []) {
    const clamped = clampRangeToYear({ startDate: r?.startDate, endDate: r?.endDate, year })
    if (!clamped) continue
    let d = new Date(clamped.start)
    while (d <= clamped.end) {
      const wd = d.getUTCDay() // 0 Sun .. 6 Sat
      if (wd >= 1 && wd <= 5) pushDateSetByMonth(out, d)
      d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1))
    }
  }
  return out
}

function buildSetsForWeekendInRanges(ranges, year) {
  const out = new Array(12).fill(null)
  for (const r of Array.isArray(ranges) ? ranges : []) {
    const clamped = clampRangeToYear({ startDate: r?.startDate, endDate: r?.endDate, year })
    if (!clamped) continue
    let d = new Date(clamped.start)
    while (d <= clamped.end) {
      const wd = d.getUTCDay()
      if (wd === 0 || wd === 6) pushDateSetByMonth(out, d)
      d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1))
    }
  }
  return out
}

function normWorkingDays(workingDays) {
  const wd = workingDays && typeof workingDays === 'object' ? workingDays : null
  if (!wd) return { orgHolidays: [], roleCalendarsByRole: {}, personAdjustmentsByPerson: {} }
  return {
    orgHolidays: Array.isArray(wd.orgHolidays) ? wd.orgHolidays : [],
    roleCalendarsByRole: (wd.roleCalendarsByRole && typeof wd.roleCalendarsByRole === 'object') ? wd.roleCalendarsByRole : {},
    personAdjustmentsByPerson: (wd.personAdjustmentsByPerson && typeof wd.personAdjustmentsByPerson === 'object') ? wd.personAdjustmentsByPerson : {},
  }
}

/**
 * Compute person-level availability adjustments by month (independent of org/role holidays).
 * This is used for PTO/non-project logic that should unallocate demand without treating org/role
 * calendars as “unstaffed work”.
 */
export function computePersonAvailabilityAdjustmentsByMonth({
  year,
  personName,
  workingDays,
} = {}) {
  const wd = normWorkingDays(workingDays)
  const adj = wd.personAdjustmentsByPerson?.[personName] || []

  const ptoRanges = adj.filter(x => x?.kind === 'pto').map(x => ({ startDate: x?.startDate, endDate: x?.endDate }))
  const nonProjectRanges = adj.filter(x => x?.kind === 'non_project').map(x => ({ startDate: x?.startDate, endDate: x?.endDate }))
  const weekendRanges = adj.filter(x => x?.kind === 'weekend_work').map(x => ({ startDate: x?.startDate, endDate: x?.endDate }))

  const ptoRemovedSets = buildSetsForWeekdaysInRanges(ptoRanges, year)
  const nonProjectRemovedSets = buildSetsForWeekdaysInRanges(nonProjectRanges, year)
  const removedWeekdaysByMonth = unionCountByMonth(ptoRemovedSets, nonProjectRemovedSets)
  const removedByKind = {
    pto: unionCountByMonth(ptoRemovedSets),
    non_project: unionCountByMonth(nonProjectRemovedSets),
  }

  const addedWeekendDaysByMonth = unionCountByMonth(buildSetsForWeekendInRanges(weekendRanges, year))

  return {
    removedWeekdaysByMonth,
    removedByKind,
    addedWeekendDaysByMonth,
  }
}

export function computeRosterAvailabilityAdjustmentsByMonth({
  year,
  roster,
  workingDays,
} = {}) {
  const out = {}
  for (const p of Array.isArray(roster) ? roster : []) {
    const name = safeText(p?.name)
    if (!name) continue
    out[name] = computePersonAvailabilityAdjustmentsByMonth({ year, personName: name, workingDays })
  }
  return out
}

export function computePersonWorkingDaysByMonth({
  year,
  baseBusinessDaysByMonth,
  personName,
  personBaseRole,
  workingDays,
} = {}) {
  const base = Array.isArray(baseBusinessDaysByMonth) && baseBusinessDaysByMonth.length === 12
    ? baseBusinessDaysByMonth.map(v => (Number.isFinite(+v) ? +v : 0))
    : new Array(12).fill(0)

  const wd = normWorkingDays(workingDays)

  const orgRemoved = buildSetsForWeekdaysInRanges(
    wd.orgHolidays.map(h => ({ startDate: h?.startDate, endDate: h?.endDate })),
    year
  )

  const roleRanges = wd.roleCalendarsByRole?.[personBaseRole]?.holidays || []
  const roleRemoved = buildSetsForWeekdaysInRanges(
    roleRanges.map(h => ({ startDate: h?.startDate, endDate: h?.endDate })),
    year
  )

  const personAdj = wd.personAdjustmentsByPerson?.[personName] || []
  const personRemoved = buildSetsForWeekdaysInRanges(
    personAdj
      .filter(x => x?.kind === 'pto' || x?.kind === 'non_project')
      .map(x => ({ startDate: x?.startDate, endDate: x?.endDate })),
    year
  )

  const personAddedWeekend = buildSetsForWeekendInRanges(
    personAdj
      .filter(x => x?.kind === 'weekend_work')
      .map(x => ({ startDate: x?.startDate, endDate: x?.endDate })),
    year
  )

  const removedCounts = unionCountByMonth(orgRemoved, roleRemoved, personRemoved)
  const addedCounts = unionCountByMonth(personAddedWeekend)

  const out = base.map((v, i) => {
    const days = (v || 0) - (removedCounts[i] || 0) + (addedCounts[i] || 0)
    return Math.max(0, Math.round(days))
  })

  const delta = out.map((v, i) => (v || 0) - (base[i] || 0))
  return { daysByMonth: out, deltaByMonth: delta }
}

export function computeRosterWorkingDaysByMonth({
  year,
  baseBusinessDaysByMonth,
  roster,
  workingDays,
} = {}) {
  const out = {}
  const list = Array.isArray(roster) ? roster : []
  for (const p of list) {
    const name = safeText(p?.name)
    if (!name) continue
    const roleRaw = safeText(p?.role)
    const baseRole = roleRaw === 'Analyst' ? 'Analyst 1' : roleRaw
    const rec = computePersonWorkingDaysByMonth({
      year,
      baseBusinessDaysByMonth,
      personName: name,
      personBaseRole: baseRole,
      workingDays,
    })
    out[name] = rec
  }
  return out
}


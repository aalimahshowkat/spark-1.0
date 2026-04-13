import * as XLSX from 'xlsx'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const ROLE_MAP = { 'Analyst 1': 'Analyst', 'Analyst 2': 'Analyst2', 'CSM': 'CSM', 'PM': 'PM', 'SE': 'SE' }
const TRACKED_ROLES = ['CSM', 'PM', 'Analyst']
const SKIP_PEOPLE = ['Unassigned', 'Need to allocate', '?', '', null, undefined]

// Capacity constants (from model: FTE * 160 hrs/month)
const RAW_CAP = { CSM: 1120, PM: 1440, Analyst: 1920 }
const FTE_COUNT = { CSM: 7, PM: 9, Analyst: 12 }
const ATTRITION = 0.8
const HRS_PER_PERSON_MONTH = 160
const HRS_PER_PERSON_YEAR = 1920

function getMonthIndex(dateVal) {
  if (!dateVal) return -1
  const d = new Date(dateVal)
  if (isNaN(d.getTime())) return -1
  // Accept any year — use month only, assume single-year model
  return d.getMonth()
}

function isSkippedPerson(name) {
  return SKIP_PEOPLE.includes(name) || String(name).trim() === ''
}

export async function parseExcelFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'binary', cellDates: true })
        const result = buildDashboardData(wb)
        resolve(result)
      } catch (err) {
        reject(err)
      }
    }
    reader.onerror = reject
    reader.readAsBinaryString(file)
  })
}

function buildDashboardData(wb) {
  const cmData = readSheet(wb, 'Capacity Model')
  const plData = readSheet(wb, 'Project List (2)') || readSheet(wb, 'Project List')

  if (!cmData || cmData.length === 0) {
    throw new Error('Sheet "Capacity Model" not found or is empty. Please check your Excel file.')
  }

  // ── Demand by role × month ──
  const demand = {
    CSM:     new Array(12).fill(0),
    PM:      new Array(12).fill(0),
    Analyst: new Array(12).fill(0),
  }

  // ── VIBE demand × month ──
  const vibeMonthly = {
    Bond:      new Array(12).fill(0),
    Validate:  new Array(12).fill(0),
    Integrate: new Array(12).fill(0),
    Explore:   new Array(12).fill(0),
  }

  // ── People × role × month ──
  const peopleMap = {}

  // ── Unassigned / risk hours ──
  const unassigned = {
    CSM:     new Array(12).fill(0),
    PM:      new Array(12).fill(0),
    Analyst: new Array(12).fill(0),
  }

  // ── Project × person allocation ──
  const personProjectMap = {}

  cmData.forEach(row => {
    const rawRole  = String(row['Role'] || '').trim()
    const role     = ROLE_MAP[rawRole]
    const person   = String(row['People'] || '').trim()
    const vibe     = String(row['VIBE Tag'] || '').trim()
    const project  = String(row['Project Name'] || '').trim()
    const hrs      = parseFloat(row['Final Utilized Hour']) || 0
    const mi       = getMonthIndex(row['Month'])

    if (mi === -1 || hrs === 0) return

    // Demand by tracked role
    if (TRACKED_ROLES.includes(role)) {
      demand[role][mi] += hrs

      // Unassigned tracking
      if (isSkippedPerson(person)) {
        unassigned[role][mi] += hrs
      }
    }

    // VIBE monthly
    if (vibeMonthly[vibe] !== undefined) {
      vibeMonthly[vibe][mi] += hrs
    }

    // People heatmap (skip non-persons)
    if (!isSkippedPerson(person) && TRACKED_ROLES.includes(role)) {
      const key = `${role}__${person}`
      if (!peopleMap[key]) {
        peopleMap[key] = { role, name: person, monthly: new Array(12).fill(0) }
      }
      peopleMap[key].monthly[mi] += hrs
    }

    // Person → project allocation
    if (!isSkippedPerson(person) && project && TRACKED_ROLES.includes(role)) {
      const pkey = `${role}__${person}`
      if (!personProjectMap[pkey]) personProjectMap[pkey] = {}
      if (!personProjectMap[pkey][project]) personProjectMap[pkey][project] = 0
      personProjectMap[pkey][project] += hrs
    }
  })

  // Build people arrays per role, sorted by total hours desc
  const people = { CSM: [], PM: [], Analyst: [] }
  Object.values(peopleMap).forEach(p => {
    if (people[p.role]) {
      people[p.role].push({
        name: p.name,
        monthly: p.monthly.map(Math.round),
        total: p.monthly.reduce((a, b) => a + b, 0),
      })
    }
  })
  TRACKED_ROLES.forEach(r => {
    people[r].sort((a, b) => b.total - a.total)
  })

  // ── Projects ──
  let projects = []
  if (plData && plData.length > 0) {
    projects = plData
      .filter(p => p['Summary'] || p['Project Name'])
      .map(p => {
        const rawStart = p['Created Main'] || p['Created'] || p['Start Date']
        const rawEnd   = p['Delivery Date Main'] || p['Delivery Date'] || p['EDD']
        const start    = new Date(rawStart)
        const end      = new Date(rawEnd)
        const sm       = isNaN(start.getTime()) ? 0  : Math.max(0,  start.getMonth())
        const em       = isNaN(end.getTime())   ? 11 : Math.min(11, end.getMonth())
        const name     = (p['Summary'] || p['Project Name'] || '').replace(/\[.*?\]\s*/g, '').trim()
        return {
          name,
          type:    p['CS Type'] || p['VIBE Tag'] || 'Bond',
          cluster: p['CS&T Cluster'] || p['Cluster'] || 'Unknown',
          status:  p['Status'] || 'Open',
          start:   sm,
          end:     Math.max(sm, em),
          pm:      p['Assigned Project Manager.displayName'] || p['PM'] || '',
          csm:     p['Assigned Product Consultant.displayName'] || p['CSM'] || '',
          lms:     parseFloat(p['Total LMs']) || 0,
          multiplier: parseFloat(p['LM Multiplier']) || 1,
        }
      })
      .filter(p => p.name)
  }

  // ── Derived metrics ──
  const annualDemand = {}
  const monthsOver   = {}
  TRACKED_ROLES.forEach(r => {
    annualDemand[r] = demand[r].reduce((a, b) => a + b, 0)
    const ec = RAW_CAP[r] * ATTRITION
    monthsOver[r] = demand[r].filter(d => d > ec).length
  })

  // VIBE totals for LMs (from project list)
  const lmsByVibe = { Bond: 0, Validate: 0, Integrate: 0, Explore: 0 }
  const clusterCounts = {}
  const statusCounts  = {}
  const vibeProjectCounts = { Bond: 0, Validate: 0, Integrate: 0, Explore: 0 }

  projects.forEach(p => {
    if (lmsByVibe[p.type] !== undefined) {
      lmsByVibe[p.type]  += p.lms
      vibeProjectCounts[p.type]++
    }
    clusterCounts[p.cluster] = (clusterCounts[p.cluster] || 0) + 1
    statusCounts[p.status]   = (statusCounts[p.status]   || 0) + 1
  })

  // File metadata
  const meta = {
    totalRows:   cmData.length,
    totalProjects: projects.length,
    teamSize:    Object.keys(peopleMap).length,
    fileName:    '',
  }

  return {
    demand,
    vibeMonthly,
    people,
    projects,
    unassigned,
    annualDemand,
    monthsOver,
    lmsByVibe,
    vibeProjectCounts,
    clusterCounts,
    statusCounts,
    personProjectMap,
    meta,
    // constants exposed for charts
    RAW_CAP,
    FTE_COUNT,
    ATTRITION,
    HRS_PER_PERSON_MONTH,
    HRS_PER_PERSON_YEAR,
    MONTHS,
  }
}

function readSheet(wb, name) {
  const sheet = wb.Sheets[name]
  if (!sheet) return null
  return XLSX.utils.sheet_to_json(sheet, { defval: '' })
}

export { MONTHS, RAW_CAP, FTE_COUNT, ATTRITION, HRS_PER_PERSON_YEAR }

/**
 * schema.js — Canonical data schema for the Capacity Planning Engine
 *
 * This file is the single source of truth for:
 *   1. All entity shapes (Project, Assignment, DemandRow, etc.)
 *   2. All configuration constants (capacities, multipliers, phase labels)
 *   3. All data quality rule definitions
 *
 * Nothing in this file performs computation.
 * Change constants here and the entire engine picks them up automatically.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * HOW TO READ THIS FILE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * SECTION 1 — Constants:  immutable values that define the model
 * SECTION 2 — Lookup Tables: multiplier matrices read from Demand Base Matrix
 * SECTION 3 — Entity shapes: documented with JSDoc (no TypeScript required)
 * SECTION 4 — Data quality rules: each rule has an id, severity, description
 * SECTION 5 — Excel column maps: source column name → internal field name
 */

// ─────────────────────────────────────────────────────────────────────────
// SECTION 1 — CONSTANTS
// ─────────────────────────────────────────────────────────────────────────

/**
 * Working hours available per person per month.
 * This is the denominator for all utilization calculations.
 * Change here if the business moves to a different standard (e.g. 168 hrs).
 */
export const HRS_PER_PERSON_MONTH = 160

/**
 * Working hours available per person per year.
 * Derived from HRS_PER_PERSON_MONTH × 12.
 */
export const HRS_PER_PERSON_YEAR = HRS_PER_PERSON_MONTH * 12

/**
 * Attrition / availability factor applied to raw capacity.
 * Effective capacity = raw capacity × ATTRITION_FACTOR.
 * Source: hardcoded in Excel summary sheets (Analyst/CSM/PM tabs).
 */
export const ATTRITION_FACTOR = 0.8

/**
 * FTE headcount per role — drives raw capacity calculations.
 * Raw capacity (hrs/month) = FTE_COUNT[role] × HRS_PER_PERSON_MONTH
 * Configurable: update when headcount changes.
 */
export const FTE_COUNT = {
  CSM:      7,
  PM:       9,
  'Analyst 1': 12,
  'Analyst 2': 12,   // shares pool with Analyst 1 in most views
  SE:       6,       // SE tracked separately, not in primary capacity views
}

/**
 * Raw capacity (hrs/month) per role — computed from FTE_COUNT.
 * Do not edit directly. Change FTE_COUNT above.
 */
export const RAW_CAPACITY = Object.fromEntries(
  Object.entries(FTE_COUNT).map(([role, fte]) => [role, fte * HRS_PER_PERSON_MONTH])
)

/**
 * Effective capacity (hrs/month) per role — raw × attrition.
 * This is the threshold used for capacity breach alerts.
 */
export const EFFECTIVE_CAPACITY = Object.fromEntries(
  Object.entries(RAW_CAPACITY).map(([role, cap]) => [role, cap * ATTRITION_FACTOR])
)

/**
 * Roles tracked in the primary capacity views.
 * SE is excluded from main dashboard but tracked for completeness.
 */
export const PRIMARY_ROLES = ['CSM', 'PM', 'Analyst 1', 'Analyst 2']

/**
 * People names that represent unallocated demand (not real individuals).
 * Hours from these names are tracked as UNSTAFFED demand, not personal utilization.
 */
export const UNSTAFFED_PERSON_NAMES = [
  'Unassigned',
  'Need to allocate',
  '?',
  'TBD',
  'BA1',
  'BA2',
  'New PM1',
  'New PM2',
]

/**
 * Calendar months — index matches JavaScript Date.getMonth().
 */
export const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

/**
 * Phase labels used in the Capacity Model.
 * These are the exact strings from the Case 1/2/3/4 columns.
 * ORDER MATTERS — later phases have higher index.
 */
export const PHASE_LABELS = [
  'Project Start M0',
  'Project Start M1',
  'Project Mid',
  'Project End M-1',
  'Project End M0',
  'Project End M1',
  'Project End M1+',
]

/**
 * VIBE types (CS Type) — the four project engagement types.
 */
export const VIBE_TYPES = ['Bond', 'Validate', 'Integrate', 'Explore']

/**
 * Orbit tiers — project complexity/size classification.
 */
export const ORBIT_TIERS = ['A', 'B', 'C', 'D', '-']

/**
 * CS&T Cluster names.
 */
export const CLUSTERS = ['Castor', 'Pollux', 'Others']

// ─────────────────────────────────────────────────────────────────────────
// SECTION 2 — LOOKUP TABLES (extracted from Demand Base Matrix)
// ─────────────────────────────────────────────────────────────────────────

/**
 * LM Bucket → Multiplier
 * Source: Demand Base Matrix, columns "LM Bucket" / "Multiplier"
 * Thresholds are UPPER BOUNDS: LMs ≤ threshold → use this multiplier.
 * Sorted ascending — first match wins.
 *
 * Example: 9,500 LMs → 1.25 (≤10,000 tier)
 *          10,001 LMs → 1.5 (≤25,000 tier)
 */
export const LM_BUCKET_MULTIPLIERS = [
  { maxLMs: 1000,   multiplier: 0.75 },
  { maxLMs: 5000,   multiplier: 1.00 },
  { maxLMs: 10000,  multiplier: 1.25 },
  { maxLMs: 25000,  multiplier: 1.50 },
  { maxLMs: 100000, multiplier: 2.00 },
]

/**
 * Orbit × VIBE → Final Multiplier
 * Source: Demand Base Matrix, "Final Multiplier Chart" section
 *
 * Key: `${orbit}_${vibeType}` e.g. 'A_Validate' → 1.75
 */
export const ORBIT_VIBE_MULTIPLIERS = {
  'A_Validate':  1.750,
  'A_Integrate': 1.250,
  'A_Bond':      1.225,
  'A_Explore':   1.750,
  'B_Validate':  1.500,
  'B_Integrate': 1.000,
  'B_Bond':      1.050,
  'B_Explore':   1.500,
  'C_Validate':  1.000,
  'C_Integrate': 0.800,
  'C_Bond':      0.700,
  'C_Explore':   1.000,
  'D_Validate':  1.000,
  'D_Integrate': 0.800,
  'D_Bond':      0.700,
  'D_Explore':   1.000,
}

// Note: Orbit fallbacks/defaults are handled in ingest/calculate via DQ rules.

/**
 * Network type (Dx/Tx/Both) → Multiplier
 * Source: Demand Base Matrix, rightmost columns
 *
 * Note: 'Both' = max of Dx and Tx = 1.5 (Tx rate)
 * This is an ADDITIVE modifier not yet fully applied in current Excel.
 * Tracked here for future use — currently applied at project level via LM_MULTIPLIER.
 */
export const NETWORK_TYPE_MULTIPLIERS = {
  'Distribution (Dx)': 1.00,
  'Transmission (Tx)': 1.50,
  'Both (Dx & Tx)':    1.50,
}

/**
 * VIBE-specific total hours per phase per role.
 * Source: right-side lookup table in Demand Base Matrix (cols 13-21).
 * This is the TOTAL hours for the entire project at that phase,
 * not the per-task breakdown.
 *
 * Structure: VIBE_PHASE_HOURS[vibeType][role][phaseLabel] = baseHours
 *
 * These are the "Calculated Utilized Hours" BEFORE multiplier application.
 * After multiplier: finalHours = baseHours × lmMultiplier × orbitMultiplier
 */
export const VIBE_PHASE_HOURS = {
  Bond: {
    PM: {
      'Project Start M0': 10,
      'Project Start M1': 10,
      'Project Mid':      10,
      'Project End M-1':  60,
      'Project End M0':   28,
      'Project End M1':    8,
      'Project End M1+':   8,
    },
    CSM: {
      'Project Start M0':  5,
      'Project Start M1':  5,
      'Project Mid':       5,
      'Project End M-1':  10,
      'Project End M0':   19,
      'Project End M1':   11,
      'Project End M1+':   1,
    },
    'Analyst 1': {
      'Project Start M0': 15,
      'Project Start M1':  5,
      'Project Mid':       2,
      'Project End M-1':  89,
      'Project End M0':   52,
      'Project End M1':   16,
      'Project End M1+':  16,
    },
    'Analyst 2': {
      'Project Start M0': 15,
      'Project Start M1':  5,
      'Project Mid':       2,
      'Project End M-1':  89,
      'Project End M0':   52,
      'Project End M1':   16,
      'Project End M1+':  16,
    },
    SE: {
      'Project Start M0': 24,
      'Project Start M1': 23,
      'Project Mid':       0,
      'Project End M-1':  10,
      'Project End M0':   25,
      'Project End M1':    0,
      'Project End M1+':   0,
    },
  },
  Validate: {
    PM: {
      'Project Start M0': 15,
      'Project Start M1': 15,
      'Project Mid':       7,
      'Project End M-1':  40,
      'Project End M0':   60,
      'Project End M1':   10,
      'Project End M1+':   4,
    },
    CSM: {
      'Project Start M0': 16,
      'Project Start M1': 24,
      'Project Mid':      14,
      'Project End M-1':  15,
      'Project End M0':   37,
      'Project End M1':   19,
      'Project End M1+':   0,
    },
    'Analyst 1': {
      'Project Start M0': 39,
      'Project Start M1': 15,
      'Project Mid':       6,
      'Project End M-1':  28,
      'Project End M0':  112,
      'Project End M1':   16,
      'Project End M1+':  16,
    },
    'Analyst 2': {
      'Project Start M0': 39,
      'Project Start M1': 15,
      'Project Mid':       6,
      'Project End M-1':  28,
      'Project End M0':  112,
      'Project End M1':   16,
      'Project End M1+':  16,
    },
    SE: {
      'Project Start M0': 20,
      'Project Start M1': 23,
      'Project Mid':       8,
      'Project End M-1':   0,
      'Project End M0':   25,
      'Project End M1':    0,
      'Project End M1+':   0,
    },
  },
  Integrate: {
    PM: {
      'Project Start M0': 10,
      'Project Start M1': 20,
      'Project Mid':      10,
      'Project End M-1':  60,
      'Project End M0':   28,
      'Project End M1':    8,
      'Project End M1+':   8,
    },
    CSM: {
      'Project Start M0': 27,
      'Project Start M1': 30,
      'Project Mid':      36,
      'Project End M-1':  20,
      'Project End M0':   38,
      'Project End M1':   24,
      'Project End M1+':  24,
    },
    'Analyst 1': {
      'Project Start M0': 25,
      'Project Start M1': 12,
      'Project Mid':       4,
      'Project End M-1':  89,
      'Project End M0':   52,
      'Project End M1':   16,
      'Project End M1+':  16,
    },
    'Analyst 2': {
      'Project Start M0': 25,
      'Project Start M1': 12,
      'Project Mid':       4,
      'Project End M-1':  89,
      'Project End M0':   52,
      'Project End M1':   16,
      'Project End M1+':  16,
    },
    SE: {
      'Project Start M0': 24,
      'Project Start M1': 23,
      'Project Mid':       0,
      'Project End M-1':  10,
      'Project End M0':   25,
      'Project End M1':    0,
      'Project End M1+':   0,
    },
  },
  Explore: {
    PM: {
      'Project Start M0': 15,
      'Project Start M1': 15,
      'Project Mid':      10,
      'Project End M-1':  40,
      'Project End M0':   40,
      'Project End M1':   10,
      'Project End M1+':   5,
    },
    CSM: {
      'Project Start M0': 20,
      'Project Start M1': 10,
      'Project Mid':      20,
      'Project End M-1':   5,
      'Project End M0':   60,
      'Project End M1':   20,
      'Project End M1+':  10,
    },
    'Analyst 1': {
      'Project Start M0': 0,
      'Project Start M1': 0,
      'Project Mid':      0,
      'Project End M-1':  0,
      'Project End M0':   0,
      'Project End M1':   0,
      'Project End M1+':  0,
    },
    'Analyst 2': {
      'Project Start M0': 0,
      'Project Start M1': 0,
      'Project Mid':      0,
      'Project End M-1':  0,
      'Project End M0':   0,
      'Project End M1':   0,
      'Project End M1+':  0,
    },
    SE: {
      'Project Start M0': 0,
      'Project Start M1': 0,
      'Project Mid':      0,
      'Project End M-1':  0,
      'Project End M0':   0,
      'Project End M1':   0,
      'Project End M1+':  0,
    },
  },
}

// ─────────────────────────────────────────────────────────────────────────
// SECTION 3 — ENTITY SHAPES (JSDoc only — no runtime enforcement)
// ─────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} ProjectRecord
 * Parsed from "Project List" sheet. One row per project.
 *
 * @property {string|null}   id              - Jira key (e.g. IVMSP-17566), or generated UUID if missing
 * @property {string}   name            - Clean project name (brackets stripped)
 * @property {string}   rawName         - Full original Summary field
 * @property {string}   accountName     - SF Account Name
 * @property {string}   vibeType        - Bond | Validate | Integrate | Explore
 * @property {string}   cluster         - Castor | Pollux | Others
 * @property {string}   networkType     - Distribution (Dx) | Transmission (Tx) | Both (Dx & Tx) | null
 * @property {string}   status          - Open | In Progress | Done
 * @property {Date}     startDate       - Created Main (normalized to 1st of month)
 * @property {Date}     deliveryDate    - Delivery Date Main (normalized to 1st of month)
 * @property {Date|null} analyticsStartDate - When analytics work begins (may differ from start)
 * @property {number}   dxLMs           - Distribution line miles
 * @property {number}   txLMs           - Transmission line miles
 * @property {number}   totalLMs        - Dx + Tx
 * @property {number}   lmMultiplier    - Overall LM multiplier (0.75 | 1 | 1.25 | 1.5 | 2.0)
 * @property {string}   orbit           - A | B | C | D | - (unclassified)
 * @property {string}   assignedCSM     - Assigned Product Consultant display name
 * @property {string}   assignedPM      - Assigned Project Manager display name
 * @property {string}   assignedSE      - Assigned Solutions Engineer display name
 * @property {string}   assignedAnalyst1 - Assigned Business Analyst display name
 * @property {string|null} assignedAnalyst2 - Secondary analyst if present
 * @property {Object}   modules         - { cycletrim, risk, treeHealth, workType, others }
 * @property {string[]} qualityFlags    - Array of DQ rule IDs that fired on this record
 */

/**
 * @typedef {Object} DemandMatrixRow
 * One row from the Demand Base Matrix — a task within a journey stage.
 *
 * @property {string} vibeType           - Bond | Validate | Integrate | Explore
 * @property {string} stage              - Customer Journey Stage label
 * @property {string} role               - PM | CSM | Analyst | SE
 * @property {Object} phaseHours         - { 'Project Start M0': n, ... } base hours per phase
 */

/**
 * @typedef {Object} ComputedAssignment
 * One computed row — equivalent to a row in the Excel Capacity Model sheet.
 * Generated by the phase engine for each project × role × month combination.
 *
 * @property {string}   projectId        - Foreign key to ProjectRecord.id
 * @property {string}   projectName      - Denormalized for display
 * @property {string}   role             - PM | CSM | Analyst 1 | Analyst 2 | SE
 * @property {string}   person           - Assigned person name, or unstaffed label
 * @property {boolean}  isUnstaffed      - true if person is Unassigned/Need to allocate
 * @property {number}   monthIndex       - 0–11
 * @property {string}   phaseLabel       - The active phase for this month
 * @property {number}   baseHours        - Hours from VIBE_PHASE_HOURS before multipliers
 * @property {number}   lmMultiplier     - Applied LM bucket multiplier
 * @property {number}   orbitMultiplier  - Applied orbit × VIBE multiplier
 * @property {number}   calculatedHours  - baseHours × lmMultiplier × orbitMultiplier
 * @property {number}   finalHours       - calculatedHours (or manual override if set)
 * @property {boolean}  isManualOverride - true if finalHours came from manual input
 * @property {number}   usagePct         - 0 or 1 (Usage% column)
 * @property {string}   vibeType         - Bond | Validate | Integrate | Explore
 * @property {string}   orbit            - A | B | C | D | -
 */

/**
 * @typedef {Object} CapacityResult
 * The full computed output from the engine for one file upload.
 *
 * @property {ProjectRecord[]}     projects       - All parsed projects
 * @property {ComputedAssignment[]} assignments   - All computed rows
 * @property {Object}              demandByRole   - { role: [12 monthly totals] }
 * @property {Object}              demandByPerson - { 'role__name': [12 monthly totals] }
 * @property {Object}              demandByVibe   - { vibe: [12 monthly totals] }
 * @property {Object}              unstaffedHours - { role: [12 monthly totals] }
 * @property {DataQualityReport}   quality        - All flags across all records
 * @property {EngineMetadata}      meta           - Timing, counts, schema version
 */

/**
 * @typedef {Object} DataQualityFlag
 * @property {string} ruleId       - e.g. 'DQ-001'
 * @property {string} severity     - 'error' | 'warning' | 'info'
 * @property {string} entity       - 'project' | 'assignment' | 'matrix'
 * @property {string} entityId     - project id or row reference
 * @property {string} field        - The specific field that triggered the rule
 * @property {string} message      - Human-readable description
 * @property {*}      value        - The actual value that triggered the flag
 */

/**
 * @typedef {Object} DataQualityReport
 * @property {DataQualityFlag[]} errors    - Must-fix: will produce wrong calculations
 * @property {DataQualityFlag[]} warnings  - Should-fix: may produce unexpected results
 * @property {DataQualityFlag[]} info      - FYI: unusual but not necessarily wrong
 * @property {number}            errorCount
 * @property {number}            warningCount
 * @property {number}            infoCount
 * @property {number}            projectsWithIssues
 * @property {boolean}           isClean   - true if zero errors AND zero warnings
 */

// ─────────────────────────────────────────────────────────────────────────
// SECTION 4 — DATA QUALITY RULES
// ─────────────────────────────────────────────────────────────────────────

/**
 * Each rule defines:
 *   id:          unique identifier (for deduplication and UI filtering)
 *   severity:    error | warning | info
 *   entity:      what kind of record this applies to
 *   field:       the field being checked
 *   message:     template string (use {value} for the actual value)
 *   impact:      what goes wrong in calculations if this is not fixed
 */
export const DATA_QUALITY_RULES = {

  // ── ERRORS (will break calculations) ────────────────────────────────
  'DQ-E001': {
    id: 'DQ-E001',
    severity: 'error',
    entity: 'project',
    field: 'deliveryDate',
    message: 'Project has no Delivery Date — cannot assign project phases',
    impact: 'This project will be excluded from all capacity calculations',
  },
  'DQ-E002': {
    id: 'DQ-E002',
    severity: 'error',
    entity: 'project',
    field: 'vibeType',
    message: 'Project has unknown VIBE type "{value}" — no demand matrix entry exists',
    impact: 'Demand hours cannot be calculated for this project',
  },
  'DQ-E003': {
    id: 'DQ-E003',
    severity: 'error',
    entity: 'project',
    field: 'startDate',
    message: 'Project start date is after delivery date — phase logic cannot run',
    impact: 'Phase assignments will be inverted or empty for this project',
  },
  'DQ-E004': {
    id: 'DQ-E004',
    severity: 'error',
    entity: 'project',
    field: 'lmMultiplier',
    message: 'LM Multiplier is 0 or missing — all calculated hours will be zero',
    impact: 'All demand hours for this project will be zero',
  },

  // ── WARNINGS (may produce unexpected results) ────────────────────────
  'DQ-W001': {
    id: 'DQ-W001',
    severity: 'warning',
    entity: 'project',
    field: 'totalLMs',
    message: 'Project has 0 total LMs',
    impact: 'LM multiplier will default to (lowest tier) — may understate demand',
  },
  'DQ-W002': {
    id: 'DQ-W002',
    severity: 'warning',
    entity: 'project',
    field: 'orbit',
    message: 'Invalid Orbit values',
    impact: 'Orbit multipliers will not be applied (treated as 0) until fixed',
  },
  'DQ-W010': {
    id: 'DQ-W010',
    severity: 'warning',
    entity: 'project',
    field: 'orbit',
    message: 'Orbit values are missing (Orbit column present)',
    impact: 'Orbit will not be inferred; orbit multipliers will be treated as 0',
  },
  'DQ-W011': {
    id: 'DQ-W011',
    severity: 'warning',
    entity: 'project',
    field: 'orbit',
    message: 'Orbit column is absent',
    impact: 'Orbit will be auto-assigned based on total LMs (A: ≥25K, B: ≥5K, C: ≥1K, D: <1K)',
  },
  'DQ-W003': {
    id: 'DQ-W003',
    severity: 'warning',
    entity: 'project',
    field: 'cluster',
    message: 'Project has no CS&T Cluster assigned',
    impact: 'Cluster-level capacity views will be incomplete',
  },
  'DQ-W004': {
    id: 'DQ-W004',
    severity: 'warning',
    entity: 'project',
    field: 'networkType',
    message: 'Project has no Network Type (Dx/Tx/Both) — cannot apply network multiplier',
    impact: 'Network type multiplier defaults to 1.0 (Dx rate)',
  },
  'DQ-W005': {
    id: 'DQ-W005',
    severity: 'warning',
    entity: 'project',
    field: 'assignedPM',
    message: 'Project has no assigned PM',
    impact: 'PM demand will show as Unassigned — counts as unstaffed hours',
  },
  'DQ-W006': {
    id: 'DQ-W006',
    severity: 'warning',
    entity: 'project',
    field: 'assignedCSM',
    message: 'Project has no assigned CSM',
    impact: 'CSM demand will show as Unassigned — counts as unstaffed hours',
  },
  'DQ-W007': {
    id: 'DQ-W007',
    severity: 'warning',
    entity: 'project',
    field: 'deliveryDate',
    message: 'Delivery date is more than 18 months from start — unusually long project',
    impact: 'Phase End M1+ may accumulate disproportionate trailing hours',
  },
  'DQ-W008': {
    id: 'DQ-W008',
    severity: 'warning',
    entity: 'project',
    field: 'totalLMs',
    message: 'Project LMs exceed 100,000 — above highest multiplier tier',
    impact: 'Multiplier is capped at 2.0x; actual complexity may be higher',
  },
  // ── INFO (unusual but not necessarily wrong) ─────────────────────────
  'DQ-I001': {
    id: 'DQ-I001',
    severity: 'info',
    entity: 'project',
    field: 'status',
    message: 'Project status is "Done" — included in calculations but may inflate historical demand',
    impact: 'None if the project dates are in the past; may skew current month views',
  },
  'DQ-I002': {
    id: 'DQ-I002',
    severity: 'info',
    entity: 'project',
    field: 'assignedAnalyst1',
    message: 'Project uses "BA1" or "BA2" placeholder — not a named analyst',
    impact: 'Analyst hours will count as unstaffed demand',
  },
  'DQ-I003': {
    id: 'DQ-I003',
    severity: 'info',
    entity: 'project',
    field: 'totalLMs',
    message: 'Total LMs is 0',
    impact: 'LM multiplier defaults to lowest tier',
  },
}

// ─────────────────────────────────────────────────────────────────────────
// SECTION 5 — EXCEL COLUMN MAPS
// ─────────────────────────────────────────────────────────────────────────

/**
 * Maps Excel column names (from Project List (2)) to internal field names.
 * If your Excel renames a column, change the KEY here — not throughout the codebase.
 *
 * Format: { internalField: ['primary column name', 'fallback1', 'fallback2'] }
 * The parser tries each name in order and uses the first match found.
 */
export const PROJECT_LIST_COLUMN_MAP = {
  id:                   ['Key','Id','Key ID','Key ID (Jira)','Jira Key','ID'],
  displayId:            ['SNo.','S.No.','Serial No.','Serial Number','Serial Num'],
  rawName:              ['Summary', 'Project Name'],
  accountName:          ['SF Account Name'],
  cluster:              ['CS&T Cluster', 'Cluster'],
  vibeType:             ['CS Type', 'VIBE Tag', 'CS Type (VIBE)'],
  assignedCSM:          ['Assigned Product Consultant.displayName', 'CSM'],
  assignedPM:           ['Assigned Project Manager.displayName', 'PM'],
  assignedSE:           ['Assigned Solutions Engineer.displayName', 'SE'],
  assignedAnalyst1:     ['Assigned Business Analyst.displayName', 'Analyst 1', 'BA'],
  assignedAnalyst2:     ['Assigned Business Analyst 2.displayName', 'Assigned Business Analyst 2', 'Analyst 2', 'BA2'],
  analystUtilPct:       ['Analyst 1 Load% (1 to 100)', 'Analyst 1 utilization%', 'Analyst 1 utilization% (1 to 100)'],
  networkType:          ['Network Type (Dx | Tx | Both)', 'Network Type', 'Dx/Tx'],
  dxLMs:                ['Dx LMs'],
  txLMs:                ['Tx LMs'],
  nonStandardData:      ['Non-Standard Data'],
  nonStandardMetric:    ['Non-Standard Metric'],
  ivmsConfiguration:    ['IVMS Configuration'],
  orbit:                ['Orbit', 'orbit', 'ORBIT'],
  plannedDueDate:       ['Planned Due Date (PDD)'],
  edd:                  ['Estimated Delivery Date (EDD)', 'EDD'],
  status:               ['Status'],
  deliveryYear:         ['Delivery Year'],
  moduleCycleTrim:      ['Module - Cycle Trim'],
  moduleRisk:           ['Module - Risk'],
  moduleTreeHealth:     ['Module - Tree Health'],
  moduleWorkType:       ['Module - Work Type'],
  moduleOthers:         ['Module - Others'],
  createdRaw:           ['Created'],
  deliveryDateRaw:      ['Delivery Date'],
  // NOTE: Analytics Start Date is its own field (used by Case 3/4 timelines).
  // Do not include it as a fallback for startDate.
  startDate:            ['Created Main', 'Start Date'],
  analyticsStartDate:   ['Analytics Start Date', 'Analytics Start', 'Analytics Start Date Main'],
  deliveryDate:         ['Delivery Date Main'],
  totalLMs:             ['Total LMs'],
  lmMultiplier:         ['LM Multiplier'],

  // Phase hour inputs on Project List (used by Excel Q for PM)
  phaseStartM0:         ['Project Start M0'],
  phaseStartM1:         ['Project Start M1'],
  phaseMid:             ['Project Mid'],
  phaseEndMinus1:       ['Project End M-1'],
  phaseEndM0:           ['Project End M0'],
  phaseEndM1:           ['Project End M1'],
  phaseEndM1Plus:       ['Project End M1+'],
}

/**
 * Maps Excel column names (from Demand Base Matrix) to internal field names.
 */
export const DEMAND_MATRIX_COLUMN_MAP = {
  vibeType:         ['Customer Journey Stage', 'VIBE Tag'],
  stage:            ['Stage'],
  role:             ['Role'],
  phaseStartM0:     ['Project Start M0'],
  phaseStartM1:     ['Project Start M1'],
  phaseMid:         ['Project Mid'],
  phaseEndMinus1:   ['Project End M-1'],
  phaseEndM0:       ['Project End M0'],
  phaseEndM1:       ['Project End M1'],
  phaseEndM1Plus:   ['Project End M1+'],
}

/**
 * Schema version — bump this when VIBE_PHASE_HOURS or multiplier tables change.
 * Stored in EngineMetadata so outputs can be traced to a schema version.
 */

/**
 * Effort Equivalent rates per role.
 * Source: Excel column Final Effort Equivalent formula:
 *   IF(role="CSM",    finalHours * $AB$8,
 *   IF(role="PM",     finalHours * $AB$10,
 *   IF(role="Analyst 1", finalHours * $AB$2,
 *   finalHours)))
 *
 * The AB column values weren't accessible in the file but we know from the
 * model that CSM effort rate ≈ 1.0, PM ≈ 1.0, Analyst ≈ 1.0 (passthrough),
 * SE ≈ 1.0. Update these when the actual constants are confirmed.
 * For now all roles use 1:1 passthrough — effort equivalent = final hours.
 * These are configurable in schema.js only.
 */
export const EFFORT_RATES = {
  'CSM':       1.0,   // update when AB column constants confirmed
  'PM':        1.0,   // update when AB column constants confirmed
  'Analyst 1': 1.0,   // update when AB column constants confirmed
  'Analyst 2': 1.0,
  'SE':        1.0,
  'default':   1.0,
}

export const SCHEMA_VERSION = '1.0.0'

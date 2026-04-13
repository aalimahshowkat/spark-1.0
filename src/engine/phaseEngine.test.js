import { describe, expect, it } from 'vitest'

import {
  getPhaseCase1,
  getPhaseCase2,
  getPhaseCase3,
  getPhaseCase4,
  PHASE_NA,
} from './phaseEngine.js'

describe('phaseEngine — Case ordering + gating', () => {
  it('Case 2: Start M1 wins over End M-1 in collision month', () => {
    const start    = new Date(2026, 0, 1) // Jan
    const delivery = new Date(2026, 2, 1) // Mar
    const month    = new Date(2026, 1, 1) // Feb (start+1 AND delivery-1)

    expect(getPhaseCase2(month, start, delivery)).toBe('Project Start M1')
    expect(getPhaseCase1(month, start, delivery)).toBe('Project End M-1')
  })

  it('Case 3 is gated by Case 4 (no analytics start → both NA)', () => {
    const delivery = new Date(2026, 8, 1)
    const month    = new Date(2026, 7, 1)

    expect(getPhaseCase4(month, null, delivery)).toBe(PHASE_NA)
    expect(getPhaseCase3(month, null, delivery)).toBe(PHASE_NA)
  })
})


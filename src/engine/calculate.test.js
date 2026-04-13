import { describe, expect, it } from 'vitest'

import { runCalculations } from './calculate.js'

function makeDemandRow(vibeType, role, endM0Hours) {
  return {
    vibeType,
    role,
    phaseHours: {
      'Project Start M0': 0,
      'Project Start M1': 0,
      'Project Mid': 0,
      'Project End M-1': 0,
      'Project End M0': endM0Hours,
      'Project End M1': 0,
      'Project End M1+': 0,
    },
  }
}

describe('calculate — analyst End M-1/M0 proration (via EDD day)', () => {
  it('delivery day 1 → End M-1 gets all, End M0 gets 0', () => {
    const project = {
      id: 'p1',
      name: 'P1',
      accountName: 'A',
      vibeType: 'Bond',
      orbit: 'A',
      cluster: '',
      startDate: new Date(2026, 0, 1),
      analyticsStartDate: new Date(2026, 0, 1),
      deliveryDate: new Date(2026, 9, 1), // Oct
      deliveryDateExact: new Date(Date.UTC(2026, 9, 1)), // Oct 1
      lmMultiplier: 1,
      assignedAnalyst1: 'Alice',
      assignedAnalyst2: null,
      analystUtilPct: null,
      phaseHours: {},
    }

    const demandMatrix = [makeDemandRow('Bond', 'Analyst 1', 100)]
    const result = runCalculations([project], demandMatrix, {}, 2026)

    const aSep = result.assignments.find(a => a.projectId === 'p1' && a.role === 'Analyst 1' && a.monthIndex === 8)
    const aOct = result.assignments.find(a => a.projectId === 'p1' && a.role === 'Analyst 1' && a.monthIndex === 9)

    expect(aSep.phase).toBe('Project End M-1')
    expect(aOct.phase).toBe('Project End M0')
    expect(aSep.calculatedHours).toBe(100)
    expect(aOct.calculatedHours).toBe(0)
  })

  it('delivery day 30 → End M-1 gets 0, End M0 gets all', () => {
    const project = {
      id: 'p2',
      name: 'P2',
      accountName: 'A',
      vibeType: 'Bond',
      orbit: 'A',
      cluster: '',
      startDate: new Date(2026, 0, 1),
      analyticsStartDate: new Date(2026, 0, 1),
      deliveryDate: new Date(2026, 9, 1), // Oct
      deliveryDateExact: new Date(Date.UTC(2026, 9, 30)), // Oct 30
      lmMultiplier: 1,
      assignedAnalyst1: 'Alice',
      assignedAnalyst2: null,
      analystUtilPct: null,
      phaseHours: {},
    }

    const demandMatrix = [makeDemandRow('Bond', 'Analyst 1', 100)]
    const result = runCalculations([project], demandMatrix, {}, 2026)

    const aSep = result.assignments.find(a => a.projectId === 'p2' && a.role === 'Analyst 1' && a.monthIndex === 8)
    const aOct = result.assignments.find(a => a.projectId === 'p2' && a.role === 'Analyst 1' && a.monthIndex === 9)

    expect(aSep.phase).toBe('Project End M-1')
    expect(aOct.phase).toBe('Project End M0')
    expect(aSep.calculatedHours).toBe(0)
    expect(aOct.calculatedHours).toBe(100)
  })
})


import React, { useMemo } from 'react'
import { Card, CardHeader, CardBody, KpiStrip, KpiCard, Pill } from './ui'
import { useEngineCalc } from './useEngineCalc'

const SHOW_ADVANCED = import.meta.env.VITE_SHOW_ADVANCED === 'true'

function sum(obj) {
  if (!obj) return 0
  return Object.values(obj).reduce((a, b) => a + (Number(b) || 0), 0)
}

export default function EngineInsightsPanel({ uploadedFile, onNavigate, contextLabel = 'Insights' }) {
  const { calc, loading, error } = useEngineCalc(uploadedFile)

  const totals = useMemo(() => {
    if (!calc) return null
    const annualTotal = sum(calc.annualDemand)
    const csmOver = calc.monthsOverEffective?.CSM ?? 0
    const pmOver = calc.monthsOverEffective?.PM ?? 0
    const a1Over = calc.monthsOverEffective?.['Analyst 1'] ?? 0
    const a2Over = calc.monthsOverEffective?.['Analyst 2'] ?? 0
    const worstOver = Math.max(csmOver, pmOver, a1Over, a2Over)
    return {
      annualTotal,
      projectsCalculated: calc.meta?.projectsCalculated ?? 0,
      durationMs: calc.meta?.durationMs ?? 0,
      worstOver,
    }
  }, [calc])

  return (
    <div style={{ marginTop: 6 }}>
      <Card style={{ marginBottom: 16 }}>
        <CardHeader title={`${contextLabel} — SPARK Engine`} tag={uploadedFile?.name || 'No file'}>
          <Pill type="purple">System-generated</Pill>
        </CardHeader>
        <CardBody>
          <div style={{ fontSize: 12.5, color: 'var(--ink-muted)', lineHeight: 1.6 }}>
            This view reflects outputs computed by the SPARK Engine.
            {SHOW_ADVANCED && (
              <>
                {' '}For Spark 1.0, deeper engine tables and parity checks live in{' '}
                <button
                  onClick={() => onNavigate?.('logic')}
                  style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent)', fontWeight: 650 }}
                >
                  Logic Layer
                </button>
                {' '}and{' '}
                <button
                  onClick={() => onNavigate?.('validation')}
                  style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent)', fontWeight: 650 }}
                >
                  Validation (Temp)
                </button>
                .
              </>
            )}
          </div>
        </CardBody>
      </Card>

      {(!uploadedFile) && (
        <Card>
          <CardHeader title="SPARK Engine unavailable" tag="Upload required" />
          <CardBody>
            <div style={{ fontSize: 12.5, color: 'var(--ink-muted)' }}>
              Upload an Excel workbook to generate SPARK Engine outputs.
            </div>
          </CardBody>
        </Card>
      )}

      {uploadedFile && (
        <>
          {loading && (
            <Card>
              <CardHeader title="Generating engine snapshot" tag="Running…" />
              <CardBody>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--ink-muted)', fontSize: 12.5 }}>
                  <div style={{ width: 16, height: 16, border: '2px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                  Computing demand, capacity, and parity-ready aggregates…
                </div>
              </CardBody>
            </Card>
          )}

          {error && (
            <Card>
              <CardHeader title="Engine snapshot failed" tag="Error" />
              <CardBody>
                <div style={{ color: 'var(--red)', fontSize: 12.5, lineHeight: 1.6 }}>
                  {error}
                </div>
              </CardBody>
            </Card>
          )}

          {calc && totals && !loading && !error && (
            <KpiStrip cols={4}>
              <KpiCard label="Projects Calculated" value={totals.projectsCalculated} sub="engine-ingested" accent="teal" />
              <KpiCard label="Annual Demand" value={Math.round(totals.annualTotal).toLocaleString()} sub="hours (engine)" accent="purple" />
              <KpiCard label="Peak Over-Cap Months" value={totals.worstOver} sub="worst role (of 12)" accent={totals.worstOver >= 6 ? 'red' : totals.worstOver >= 3 ? 'amber' : 'green'} />
              <KpiCard label="Compute Time" value={`${totals.durationMs}ms`} sub="snapshot runtime" accent="blue" />
            </KpiStrip>
          )}
        </>
      )}
    </div>
  )
}


import React, { useCallback, useMemo, useState } from 'react'
import { Card, CardHeader, CardBody, Grid, Pill, ActionButton, Mono } from './ui'
import ProjectListManagerModal from './ProjectListManagerModal'

export default function UploadView({
  onFile,
  loading,
  data,
  base,
  baseSummary,
  baseLoading,
  datasetMode,
  onUseBase,
  onUseOverride,
  onPromoteOverrideToBase,
  onClearBase,
  onUpdateBaseProjects,
  hasOverride,
}) {
  const [dragging, setDragging] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)

  const baseTag = useMemo(() => {
    if (baseLoading) return 'Loading…'
    if (!base?.ingest) return 'Not set'
    return base?.sourceFileName || baseSummary?.fileName || 'Saved'
  }, [base, baseLoading, baseSummary])

  const baseStatus = useMemo(() => {
    if (baseLoading) return { type: 'amber', text: 'Loading' }
    if (!base?.ingest) return { type: 'amber', text: 'None' }
    return { type: datasetMode === 'base' ? 'green' : 'blue', text: datasetMode === 'base' ? 'Active' : 'Saved' }
  }, [base, baseLoading, datasetMode])

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file && (file.name.endsWith('.xlsx') || file.name.endsWith('.xls'))) {
      onFile(file)
    }
  }, [onFile])

  return (
    <div style={{ maxWidth: 1120, width: '100%', animation: 'fadeUp 0.25s ease both' }}>

      {/* Messaging hero */}
      <Card style={{
        marginBottom: 20,
        borderColor: 'rgba(167,139,250,0.35)',
        background: 'linear-gradient(135deg, rgba(167,139,250,0.10), rgba(255,255,255,0.82))',
      }}>
        <CardBody style={{ padding: '18px 18px 16px' }}>
          <div style={{ fontSize: 12.5, color: 'var(--ink-muted)', marginBottom: 6 }}>
            Connect your Excel planning inputs to SPARK
          </div>
          <div style={{
            fontSize: 18,
            fontWeight: 650,
            letterSpacing: '-0.02em',
            color: 'var(--ink)',
            marginBottom: 6,
          }}>
            Plan Capacity. Simulate Scenarios. Decide Proactively.
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-muted)', lineHeight: 1.6, maxWidth: 620 }}>
            SPARK transforms structured planning inputs into capacity, demand, and scenario-ready intelligence.
          </div>
        </CardBody>
      </Card>

      <div className="spark-data-layout" style={{ marginBottom: 14 }}>
        <div style={{ minWidth: 0 }}>
          <Grid cols="1fr 1fr" gap={14} style={{ marginBottom: 14 }}>
        <Card>
          <CardHeader title="Required Inputs" tag="Workbook" />
          <CardBody>
            <div style={{ fontSize: 12.5, color: 'var(--ink-muted)', lineHeight: 1.7 }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <span style={{ color: 'var(--green)', fontWeight: 700 }}>✓</span>
                <span><strong>Project List</strong> (planning metadata and dates)</span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <span style={{ color: 'var(--green)', fontWeight: 700 }}>✓</span>
                <span><strong>Demand Base Matrix</strong> (role × VIBE × phase base hours)</span>
              </div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Optional (Temporary)" tag="Validation" />
          <CardBody>
            <div style={{ fontSize: 12.5, color: 'var(--ink-muted)', lineHeight: 1.7 }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <span style={{ color: 'var(--amber)', fontWeight: 800 }}>●</span>
                <span><strong>Capacity Model</strong> — used only for parity checks in <strong>Validation Layer</strong></span>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--ink-faint)' }}>
                This keeps stakeholder trust while SPARK transitions from Excel-derived outputs to engine-native insights.
              </div>
            </div>
          </CardBody>
        </Card>
          </Grid>

      {/* Dataset mode controls */}
      <Grid cols="1fr 1fr" gap={14} style={{ marginBottom: 14 }}>
        <Card>
          <CardHeader title="Base Dataset (Persisted)" tag={baseTag}>
            <Pill type={baseStatus.type}>{baseStatus.text}</Pill>
          </CardHeader>
          <CardBody>
            <div style={{ fontSize: 12.5, color: 'var(--ink-muted)', lineHeight: 1.7, marginBottom: 12 }}>
              Stored Project List + Demand Matrix retained across sessions. Use this when you don’t want to re-upload each time.
            </div>

            {base?.ingest ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14, marginBottom: 12 }}>
                {[
                  ['Projects', baseSummary?.totalProjects ?? (base.ingest.projects?.length || 0)],
                  ['Matrix rows', baseSummary?.matrixRows ?? (base.ingest.demandMatrix?.length || 0)],
                  ['Saved at', base?.savedAt ? new Date(base.savedAt).toLocaleString() : '—'],
                ].map(([label, val]) => (
                  <div key={label}>
                    <div style={{ fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--ink-muted)', marginBottom: 4 }}>
                      {label}
                    </div>
                    <div style={{ fontFamily: 'var(--font-sans)', fontSize: 15, fontWeight: 800, color: 'var(--ink)' }}>
                      {val}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 12.5, color: 'var(--ink-muted)', marginBottom: 12 }}>
                No base dataset saved yet. Upload a file and choose “Save upload as base”.
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <ActionButton
                title={!base?.ingest ? 'No base dataset saved' : 'Switch to base dataset (engine)'}
                onClick={() => { if (base?.ingest) onUseBase?.() }}
              >
                Use base dataset
              </ActionButton>
              <ActionButton
                title={!base?.ingest ? 'No base dataset saved' : 'Edit persisted Project List'}
                onClick={() => { if (base?.ingest) setManageOpen(true) }}
              >
                Manage projects
              </ActionButton>
              <ActionButton
                title={!base?.ingest ? 'No base dataset to clear' : 'Clear persisted base dataset'}
                onClick={() => { if (base?.ingest) onClearBase?.() }}
              >
                Clear base
              </ActionButton>
            </div>

            <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--ink-faint)' }}>
              Note: Base dataset supports SPARK Engine views. Excel Model views still require uploading the workbook.
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Override Dataset (Uploaded)" tag={hasOverride ? 'Uploaded' : 'None'}>
            <Pill type={datasetMode === 'override' && hasOverride ? 'green' : hasOverride ? 'blue' : 'amber'}>
              {datasetMode === 'override' && hasOverride ? 'Active' : hasOverride ? 'Available' : 'Upload required'}
            </Pill>
          </CardHeader>
          <CardBody>
            <div style={{ fontSize: 12.5, color: 'var(--ink-muted)', lineHeight: 1.7, marginBottom: 12 }}>
              Upload a new workbook to override the base inputs. You can keep it temporary or promote it to become the new base.
            </div>

            {hasOverride ? (
              <div style={{ fontSize: 12.5, color: 'var(--ink-muted)', marginBottom: 12 }}>
                Current override: <Mono>uploaded workbook</Mono>
              </div>
            ) : (
              <div style={{ fontSize: 12.5, color: 'var(--ink-muted)', marginBottom: 12 }}>
                No override uploaded.
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <ActionButton
                title={!hasOverride ? 'Upload a workbook first' : 'Switch to uploaded override dataset'}
                onClick={() => { if (hasOverride) onUseOverride?.() }}
              >
                Use uploaded override
              </ActionButton>
              <ActionButton
                title={!hasOverride ? 'Upload a workbook first' : 'Persist current upload as base dataset'}
                onClick={() => { if (hasOverride) onPromoteOverrideToBase?.() }}
              >
                Save upload as base
              </ActionButton>
            </div>

            <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--ink-faint)' }}>
              Override affects SPARK Engine calculations immediately when active.
            </div>
          </CardBody>
        </Card>
      </Grid>

      <ProjectListManagerModal
        isOpen={manageOpen}
        onClose={() => setManageOpen(false)}
        projects={base?.ingest?.projects || []}
        roster={base?.ingest?.roster || []}
        baseLabel={base?.sourceFileName || baseSummary?.fileName || 'Base dataset'}
        onSaveProjects={async ({ projects, editorName, note }) => {
          await onUpdateBaseProjects?.({ projects, editorName, note })
        }}
      />

      {/* Drop zone */}
      <label
        htmlFor="spark-file-input"
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        style={{
          display: 'block',
          border: `2px dashed ${dragging ? 'var(--accent)' : 'var(--border-strong)'}`,
          borderRadius: 12,
          padding: '44px 40px',
          textAlign: 'center',
          background: dragging ? 'rgba(37,99,235,0.04)' : 'var(--surface-0)',
          cursor: 'pointer',
          transition: 'all 0.18s',
          marginBottom: 20,
          boxShadow: dragging ? '0 0 0 4px rgba(37,99,235,0.1)' : 'var(--shadow-sm)',
        }}
      >
        <input
          id="spark-file-input"
          type="file"
          accept=".xlsx,.xls"
          style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files[0]; if (f) onFile(f); e.target.value = '' }}
        />
        <div style={{
          width: 52, height: 52, borderRadius: 12,
          background: loading ? 'var(--surface-1)' : dragging ? 'var(--accent-dim)' : 'var(--surface-1)',
          border: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 16px',
        }}>
          {loading
            ? <div style={{ width: 20, height: 20, border: '2.5px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
            : <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={dragging ? 'var(--accent)' : 'var(--ink-muted)'} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
              </svg>
          }
        </div>

        <div style={{ fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 15.5, color: 'var(--ink)', marginBottom: 6 }}>
          {loading ? 'Parsing your file…' : dragging ? 'Drop to upload' : 'Drop your Excel file here'}
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--ink-muted)', marginBottom: 20 }}>
          or click to browse · Requires <strong>Project List</strong> and <strong>Demand Base Matrix</strong>
        </div>

        {!loading && (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 7,
            background: 'var(--accent)', color: 'white',
            padding: '8px 18px', borderRadius: 7,
            fontSize: 13, fontWeight: 600,
            boxShadow: '0 1px 3px rgba(37,99,235,0.35)',
          }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
            </svg>
            Choose File
          </div>
        )}
      </label>

      {/* Active data stats */}
      {data && (
        <Card style={{ marginBottom: 20, borderColor: '#bfdbfe', background: 'linear-gradient(to right, #eff6ff, #ffffff)' }}>
          <CardHeader title="Active Dataset" tag={data.meta.fileName} />
          <CardBody>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 20 }}>
              {[
                ['Rows', data.meta.totalRows.toLocaleString()],
                ['Projects', data.meta.totalProjects],
                ['Team Members', data.meta.teamSize],
                ['Period', 'Jan–Dec 2026'],
              ].map(([label, val]) => (
                <div key={label}>
                  <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.7px', color: 'var(--ink-muted)', marginBottom: 5 }}>
                    {label}
                  </div>
                  <div style={{
                    fontFamily: 'var(--font-sans)',
                    fontSize: label === 'Period' ? 18 : 22,
                    fontWeight: 800,
                    color: 'var(--ink)',
                    whiteSpace: label === 'Period' ? 'nowrap' : 'normal',
                    letterSpacing: '-0.02em',
                  }}>
                    {val}
                  </div>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      )}

      {/* Schema guide */}
      <Card>
        <CardHeader title="Expected Workbook Structure" />
        <CardBody style={{ padding: 0 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: 'var(--surface-1)' }}>
                {['Sheet Name', 'Key Columns', 'Purpose'].map(h => (
                  <th key={h} style={{
                    textAlign: 'left', padding: '10px 16px',
                    borderBottom: '1px solid var(--border)',
                    fontWeight: 700, fontSize: 10.5, textTransform: 'uppercase',
                    letterSpacing: '0.6px', color: 'var(--ink-muted)',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                ['Project List', 'Project dates, status, VIBE, LM and orbit fields', 'Primary planning input for SPARK ingestion and standardization'],
                ['Demand Base Matrix', 'Base hours by role × VIBE × phase', 'Demand reference table used to generate monthly demand'],
                ['Capacity Model (temporary, for validation only)', 'Role, people, month, final utilized hours', 'Optional: used only to validate SPARK Engine parity during the transition'],
              ].map(([sheet, cols, purpose], i) => (
                <tr key={sheet} style={{ borderBottom: i < 2 ? '1px solid var(--border)' : 'none', background: i % 2 === 0 ? 'var(--surface-0)' : 'var(--surface-1)' }}>
                  <td style={{ padding: '10px 16px', fontFamily: 'var(--font-mono)', fontSize: 11.5, fontWeight: 500, color: 'var(--ink-soft)' }}>{sheet}</td>
                  <td style={{ padding: '10px 16px', color: 'var(--ink-muted)', fontSize: 12 }}>{cols}</td>
                  <td style={{ padding: '10px 16px', color: 'var(--ink-muted)', fontSize: 12 }}>{purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>
        </div>

        {/* Right-side guidance panel */}
        <div style={{ minWidth: 0 }}>
          <Card style={{ position: 'sticky', top: 76 }}>
            <CardHeader title="How SPARK uses your workbook" tag="Spark 1.0" />
            <CardBody>
              <div style={{ fontSize: 12.5, color: 'var(--ink-muted)', lineHeight: 1.7 }}>
                <div style={{ marginBottom: 10 }}>
                  <strong style={{ color: 'var(--ink)' }}>1) Ingest & standardize</strong>
                  <div>Project List and Demand Base Matrix are parsed and normalized for consistent planning outputs.</div>
                </div>
                <div style={{ marginBottom: 10 }}>
                  <strong style={{ color: 'var(--ink)' }}>2) Generate insights</strong>
                  <div>SPARK produces demand and capacity views for stakeholder-ready planning decisions.</div>
                </div>
                <div style={{ marginBottom: 10 }}>
                  <strong style={{ color: 'var(--ink)' }}>3) Validate (temporary)</strong>
                  <div>Optional Capacity Model can be used to compare parity in <strong>Validation Layer</strong>.</div>
                </div>
                <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 11.5, color: 'var(--ink-faint)' }}>
                    Tip: keep sheet names exact and ensure date fields are consistent to avoid ingestion flags.
                  </div>
                </div>
              </div>
            </CardBody>
          </Card>
        </div>
      </div>

      {/* Bottom attribution (main content, not sidebar) */}
      <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ fontSize: 11, color: 'var(--ink-faint)' }}>
            © 2026 AiDash Inc. All rights reserved.
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end', textAlign: 'right' }}>
            <div style={{ fontSize: 11, color: 'var(--ink-faint)', letterSpacing: '0.02em' }}>
              Powered by
            </div>
            <div style={{
              fontSize: 18,
              fontWeight: 900,
              letterSpacing: '-0.04em',
              color: '#1E293B',
              fontStyle: 'italic',
              textShadow: '0 1px 0 rgba(30,41,59,0.10), 0 8px 22px rgba(30,41,59,0.12)',
              lineHeight: 1,
              textTransform: 'none',
            }}>
              AiDash
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

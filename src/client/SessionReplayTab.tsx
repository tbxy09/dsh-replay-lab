import { useEffect, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import {
  replayTurnKey, replayTurnTestId, type FrozenReplayCase, type ReplayExperiment,
  type ReplayHistoryEntry, type ReplayableTurnRecord, type RequestSurfaceEvidence,
  type RunEvidence, type Scorecard, type VariantDescriptor, type WorkspaceDriftProvenance,
} from '../types.ts'
import type { ReplayTabProps } from './slots.ts'

const statusLabel = {
  planned: 'Ready to run', approved: 'Approved', running: 'Running', completed: 'Completed',
  aborted: 'Aborted', failed: 'Failed',
} as const

const integerFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
const decimalFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 })
const percentageFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 })
const metricLabels = {
  freshInputTokens: 'Fresh input tokens', outputTokens: 'Output tokens',
  cacheReadTokens: 'Cache read tokens', durationMs: 'Duration',
  stepCount: 'Steps', toolCalls: 'Tool calls',
} as const

export function formatCount(value: number): string {
  return integerFormatter.format(value)
}

export function formatDuration(milliseconds: number): string {
  if (milliseconds < 1_000) return `${formatCount(milliseconds)} ms`
  if (milliseconds < 60_000) return `${decimalFormatter.format(milliseconds / 1_000)} s`
  const minutes = Math.floor(milliseconds / 60_000)
  const seconds = Math.round((milliseconds % 60_000) / 1_000)
  if (seconds === 60) return `${formatCount(minutes + 1)} min`
  return seconds === 0 ? `${formatCount(minutes)} min` : `${formatCount(minutes)} min ${seconds} s`
}

export function formatMetricValue(key: keyof typeof metricLabels, value: number): string {
  return key === 'durationMs' ? formatDuration(value) : formatCount(value)
}

export function formatMetricDelta(key: keyof typeof metricLabels, value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  return `${sign}${formatMetricValue(key, Math.abs(value))}`
}

export function metricDeltaChange(value: number): 'increase' | 'decrease' | 'unchanged' {
  return value > 0 ? 'increase' : value < 0 ? 'decrease' : 'unchanged'
}

export function formatMetricPercentDelta(baseline: number, delta: number): string | undefined {
  if (baseline === 0) return undefined
  const value = (delta / baseline) * 100
  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  return `${sign}${percentageFormatter.format(Math.abs(value))}%`
}

export function metricDeltaTone(
  key: keyof typeof metricLabels,
  value: number,
): 'increase' | 'decrease' | 'unchanged' | 'neutral' {
  if (key === 'stepCount' || key === 'toolCalls') return 'neutral'
  return metricDeltaChange(value)
}

export function formatRequestPhase(phase: string): string {
  const labels: Record<string, string> = {
    observed: 'Observed baseline', request: 'Request', bootstrap: 'Bootstrap',
    promoted: 'Promoted', 'dynamic-unlocks': 'Dynamic unlocks',
  }
  return labels[phase] ?? phase.replaceAll('-', ' ').replace(/^./, character => character.toUpperCase())
}

export function formatSurface(surface: string): string {
  const [scope, value] = surface.split(':', 2)
  const label = (value ?? scope ?? '').replaceAll('-', ' ').replace(/^./, character => character.toUpperCase())
  if (value === undefined) return label
  if (scope === 'preset') return `${label} preset`
  if (scope === 'agent-plugin') return `${label} plugin`
  if (scope === 'host-plane') return `${label.replaceAll('+', ' + ')} (host-level)`
  return label
}

export function compactIdentifier(value: string): string {
  return value.length <= 28 ? value : `${value.slice(0, 17)}…${value.slice(-8)}`
}

type ComparisonStatus = 'match' | 'mismatch' | 'unknown'

export interface RequestSurfaceComparison {
  baselineRoute: readonly string[]
  candidateRoute: readonly string[]
  routeStatus: ComparisonStatus
  baselinePhases: readonly string[]
  candidatePhases: readonly string[]
  phaseStatus: ComparisonStatus
  toolDiffStatus: 'known' | 'unknown'
  toolsAdded: readonly string[]
  toolsRemoved: readonly string[]
  baselineSystemHashes: readonly string[]
  candidateSystemHashes: readonly string[]
  systemHashStatus: ComparisonStatus
  baselineToolSchemaHashes: readonly string[]
  candidateToolSchemaHashes: readonly string[]
  toolSchemaHashStatus: ComparisonStatus
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter(value => value.length > 0))]
}

function requestSurfaces(evidence: RunEvidence | undefined): readonly RequestSurfaceEvidence[] {
  return evidence?.requestSurfaces ?? []
}

function sequenceStatus(left: readonly string[], right: readonly string[]): ComparisonStatus {
  if (left.length === 0 || right.length === 0) return 'unknown'
  return left.length === right.length && left.every((value, index) => value === right[index])
    ? 'match'
    : 'mismatch'
}

export function compareRequestSurfaces(
  baseline: RunEvidence | undefined,
  candidate: RunEvidence | undefined,
  baselineFallback?: Pick<FrozenReplayCase, 'provider' | 'model' | 'systemHash' | 'toolSchemaHash'>,
): RequestSurfaceComparison {
  const baselineSurfaces = requestSurfaces(baseline)
  const candidateSurfaces = requestSurfaces(candidate)
  const baselineRoute = baselineSurfaces.length > 0
    ? unique(baselineSurfaces.map(surface => `${surface.provider} / ${surface.model}`))
    : baselineFallback === undefined ? [] : [`${baselineFallback.provider} / ${baselineFallback.model}`]
  const candidateRoute = unique(candidateSurfaces.map(surface => `${surface.provider} / ${surface.model}`))
  const baselinePhases = unique(baseline?.requestPhases ?? baselineSurfaces.map(surface => surface.phase))
  const candidatePhases = unique(candidate?.requestPhases ?? candidateSurfaces.map(surface => surface.phase))
  const baselineTools = unique(baselineSurfaces.flatMap(surface => surface.toolNames))
  const candidateTools = unique(candidateSurfaces.flatMap(surface => surface.toolNames))
  const baselineToolSet = new Set(baselineTools)
  const candidateToolSet = new Set(candidateTools)
  const toolDiffKnown = baselineSurfaces.length > 0 && candidateSurfaces.length > 0
  const baselineSystemHashes = baselineSurfaces.length > 0
    ? unique(baselineSurfaces.map(surface => surface.systemHash))
    : baselineFallback === undefined ? [] : [baselineFallback.systemHash]
  const candidateSystemHashes = unique(candidateSurfaces.map(surface => surface.systemHash))
  const baselineToolSchemaHashes = baselineSurfaces.length > 0
    ? unique(baselineSurfaces.map(surface => surface.toolSchemaHash))
    : baselineFallback === undefined ? [] : [baselineFallback.toolSchemaHash]
  const candidateToolSchemaHashes = unique(candidateSurfaces.map(surface => surface.toolSchemaHash))
  return {
    baselineRoute,
    candidateRoute,
    routeStatus: sequenceStatus(baselineRoute, candidateRoute),
    baselinePhases,
    candidatePhases,
    phaseStatus: sequenceStatus(baselinePhases, candidatePhases),
    toolDiffStatus: toolDiffKnown ? 'known' : 'unknown',
    toolsAdded: toolDiffKnown ? candidateTools.filter(tool => !baselineToolSet.has(tool)) : [],
    toolsRemoved: toolDiffKnown ? baselineTools.filter(tool => !candidateToolSet.has(tool)) : [],
    baselineSystemHashes,
    candidateSystemHashes,
    systemHashStatus: sequenceStatus(baselineSystemHashes, candidateSystemHashes),
    baselineToolSchemaHashes,
    candidateToolSchemaHashes,
    toolSchemaHashStatus: sequenceStatus(baselineToolSchemaHashes, candidateToolSchemaHashes),
  }
}

function EvidenceSummary({ title, evidence }: { title: string; evidence?: RunEvidence }): ReactNode {
  return (
    <section className="rld-session-evidence">
      <header><h4>{title}</h4><strong data-status={evidence?.status}>{evidence === undefined ? 'Not run' : statusLabel[evidence.status]}</strong></header>
      {evidence === undefined
        ? <p className="rld-session-muted">No independent evidence yet.</p>
        : <>
          <dl>
            <div><dt>Session ID</dt><dd title={evidence.sessionId}>{compactIdentifier(evidence.sessionId)}</dd></div>
            <div><dt>Request phase</dt><dd>{evidence.requestPhases.map(formatRequestPhase).join(' → ') || '—'}</dd></div>
            {evidence.requestSurfaces?.map((surface, index) => <div key={`${surface.phase}-${index}`}>
              <dt>{formatRequestPhase(surface.phase)} tools</dt>
              <dd title={surface.toolNames.join(', ')}>{surface.toolNames.join(', ') || 'No tools'}</dd>
            </div>)}
            <div><dt>Events</dt><dd title={String(evidence.eventCount)}>{formatCount(evidence.eventCount)}</dd></div>
          </dl>
          {evidence.metrics === undefined
            ? <p className="rld-session-warning" role="status">Evidence unavailable: {evidence.missingReason ?? 'incomplete event stream'}</p>
            : <div className="rld-session-metrics">
              <span><small>Fresh input tokens</small><strong title={String(evidence.metrics.freshInputTokens)}>{formatCount(evidence.metrics.freshInputTokens)}</strong></span>
              <span><small>Output tokens</small><strong title={String(evidence.metrics.outputTokens)}>{formatCount(evidence.metrics.outputTokens)}</strong></span>
              <span><small>Cache read tokens</small><strong title={String(evidence.metrics.cacheReadTokens)}>{formatCount(evidence.metrics.cacheReadTokens)}</strong></span>
            </div>}
        </>}
    </section>
  )
}

export function workspaceDriftNotice(drift: WorkspaceDriftProvenance | undefined): string | undefined {
  return drift?.detected === true
    ? 'Workspace changed after this replay case was frozen. The candidate used the current workspace state, so this is not a strict controlled comparison.'
    : undefined
}

export function WorkspaceDriftNotice({ drift }: { drift?: WorkspaceDriftProvenance }): ReactNode {
  const notice = workspaceDriftNotice(drift)
  if (notice === undefined || drift === undefined) return null
  return <div className="rld-session-drift-notice" role="status">
    <strong>Workspace drift</strong>
    <span>{notice}</span>
    <code title={`Frozen: ${drift.frozenHash}\nCurrent: ${drift.currentHash}`}>
      {drift.frozenHash.slice(0, 12)} → {drift.currentHash.slice(0, 12)}
    </code>
  </div>
}

function comparisonLabel(status: ComparisonStatus): string {
  return status === 'match' ? 'Match' : status === 'mismatch' ? 'Changed' : 'Unknown'
}

function ReplayWorkflowGuide(): ReactNode {
  return <ol className="rld-replay-guide" aria-label="Replay workflow">
    <li><span>1</span><strong>Run setup</strong></li>
    <li><span>2</span><strong>Saved runs</strong></li>
    <li><span>3</span><strong>Inspect evidence</strong></li>
  </ol>
}

function TextSequence({ values, format = value => value }: {
  values: readonly string[]
  format?: (value: string) => string
}): ReactNode {
  return values.length === 0
    ? <span className="rld-result-empty">Unknown</span>
    : <span title={values.join(' → ')}>{values.map(format).join(' → ')}</span>
}

function HashSequence({ values }: { values: readonly string[] }): ReactNode {
  return values.length === 0
    ? <span className="rld-result-empty">Unknown</span>
    : <span className="rld-result-hashes" title={values.join(' → ')}>{values.map((value, index) => <code key={`${value}-${index}`}>{value.slice(0, 12)}</code>)}</span>
}

function ToolSequence({ values }: { values: readonly string[] }): ReactNode {
  return values.length === 0
    ? <span className="rld-result-empty">None</span>
    : <span className="rld-result-tools">{values.map(value => <code key={value}>{value}</code>)}</span>
}

function RequestSurfaceDiff({ baseline, candidate, baselineFallback }: {
  baseline?: RunEvidence
  candidate?: RunEvidence
  baselineFallback?: Pick<FrozenReplayCase, 'provider' | 'model' | 'systemHash' | 'toolSchemaHash'>
}): ReactNode {
  const comparison = compareRequestSurfaces(baseline, candidate, baselineFallback)
  return <section className="rld-result-section rld-result-surface">
    <header><h3>Request surface diff</h3><span>Durable request headers only</span></header>
    <div className="rld-result-table-scroll"><table>
      <thead><tr><th>Surface</th><th>Baseline (observed)</th><th>Candidate (isolated replay)</th><th>Difference</th></tr></thead>
      <tbody>
        <tr><th>Provider / model</th>
          <td><TextSequence values={comparison.baselineRoute} /></td>
          <td><TextSequence values={comparison.candidateRoute} /></td>
          <td data-status={comparison.routeStatus}>{comparisonLabel(comparison.routeStatus)}</td></tr>
        <tr><th>Request phases</th>
          <td><TextSequence values={comparison.baselinePhases} format={formatRequestPhase} /></td>
          <td><TextSequence values={comparison.candidatePhases} format={formatRequestPhase} /></td>
          <td data-status={comparison.phaseStatus}>{comparisonLabel(comparison.phaseStatus)}</td></tr>
        <tr><th>Tools added</th><td><span className="rld-result-empty">—</span></td>
          <td>{comparison.toolDiffStatus === 'known' ? <ToolSequence values={comparison.toolsAdded} /> : <span className="rld-result-empty">Unknown</span>}</td>
          <td data-status={comparison.toolDiffStatus === 'unknown' ? 'unknown' : comparison.toolsAdded.length === 0 ? 'match' : 'mismatch'}>{comparison.toolDiffStatus === 'unknown' ? 'Unknown' : comparison.toolsAdded.length === 0 ? 'None' : `${comparison.toolsAdded.length} added`}</td></tr>
        <tr><th>Tools removed</th><td>{comparison.toolDiffStatus === 'known' ? <ToolSequence values={comparison.toolsRemoved} /> : <span className="rld-result-empty">Unknown</span>}</td>
          <td><span className="rld-result-empty">—</span></td>
          <td data-status={comparison.toolDiffStatus === 'unknown' ? 'unknown' : comparison.toolsRemoved.length === 0 ? 'match' : 'mismatch'}>{comparison.toolDiffStatus === 'unknown' ? 'Unknown' : comparison.toolsRemoved.length === 0 ? 'None' : `${comparison.toolsRemoved.length} removed`}</td></tr>
        <tr><th>System hash</th>
          <td><HashSequence values={comparison.baselineSystemHashes} /></td>
          <td><HashSequence values={comparison.candidateSystemHashes} /></td>
          <td data-status={comparison.systemHashStatus}>{comparisonLabel(comparison.systemHashStatus)}</td></tr>
        <tr><th>Tool-schema hash</th>
          <td><HashSequence values={comparison.baselineToolSchemaHashes} /></td>
          <td><HashSequence values={comparison.candidateToolSchemaHashes} /></td>
          <td data-status={comparison.toolSchemaHashStatus}>{comparisonLabel(comparison.toolSchemaHashStatus)}</td></tr>
      </tbody>
    </table></div>
  </section>
}

function ExecutionDelta({ scorecard, missingReason }: {
  scorecard?: Scorecard
  missingReason?: string
}): ReactNode {
  return <section className="rld-result-section rld-result-execution">
    <header><h3>Execution delta</h3><span>Candidate − baseline</span></header>
    {scorecard === undefined
      ? <p className="rld-session-muted">{missingReason ?? 'Complete independent evidence is required.'}</p>
      : <>
        <div className="rld-result-table-scroll"><table>
          <thead><tr><th>Metric</th><th>Baseline</th><th>Candidate</th><th>Delta</th><th>Delta (%)</th></tr></thead>
          <tbody>{scorecard.rows.map(row => {
            const percent = formatMetricPercentDelta(row.baseline, row.delta)
            const tone = metricDeltaTone(row.key, row.delta)
            return <tr key={row.key} data-neutral={tone === 'neutral' || undefined}>
              <th title={row.label}>{metricLabels[row.key]}</th>
              <td title={String(row.baseline)}>{formatMetricValue(row.key, row.baseline)}</td>
              <td className="rld-result-candidate" title={String(row.candidate)}>{formatMetricValue(row.key, row.candidate)}</td>
              <td data-tone={tone} title={String(row.delta)}>{formatMetricDelta(row.key, row.delta)}</td>
              <td data-tone={tone}>{percent ?? '—'}</td>
            </tr>
          })}</tbody>
        </table></div>
        <p className="rld-result-neutral-note">Steps and tool calls describe execution activity, not outcome quality.</p>
      </>}
  </section>
}

function VariantRow({ variant, selected, onSelect }: {
  variant: VariantDescriptor
  selected: boolean
  onSelect: () => void
}): ReactNode {
  return (
    <button
      type="button"
      className="rld-session-variant"
      aria-pressed={selected}
      disabled={!variant.supported}
      title={!variant.supported ? variant.unsupportedReason : undefined}
      onClick={onSelect}
    >
      <span><strong>{variant.label}</strong></span>
      <code title={variant.pluginSurface}>{formatSurface(variant.pluginSurface)}</code>
      <span>{variant.requestPhases.map(formatRequestPhase).join(' → ') || '—'}</span>
      <em data-supported={variant.supported}>{variant.supported ? 'Supported' : 'Unavailable'}</em>
    </button>
  )
}

export function replayHistoryForTurn(
  history: readonly ReplayHistoryEntry[],
  sessionId: string,
  turn: number,
): readonly ReplayHistoryEntry[] {
  return history
    .filter(entry => entry.sourceSessionId === sessionId
      && entry.sourceTurn === turn
      && entry.replayCase?.sourceSessionId === sessionId
      && entry.replayCase.sourceTurn === turn
      && (entry.experiment.baseline === undefined || entry.experiment.baseline.sessionId === sessionId))
    .sort((left, right) => right.experiment.updatedAt.localeCompare(left.experiment.updatedAt))
}

function FrozenRequest({ replayCase }: {
  replayCase: FrozenReplayCase
}): ReactNode {
  return <section className="rld-session-frozen">
    <header><h3>Observed baseline request</h3><code>{replayCase.id}</code></header>
    <blockquote>{replayCase.prompt}</blockquote>
    <dl>
      <div><dt>Model</dt><dd>{replayCase.model}</dd></div>
      <div><dt>Reasoning</dt><dd>{replayCase.reasoning}</dd></div>
      <div><dt>Max tokens</dt><dd title={replayCase.maxTokens === undefined ? undefined : String(replayCase.maxTokens)}>{replayCase.maxTokens === undefined ? 'Default' : formatCount(replayCase.maxTokens)}</dd></div>
      <div><dt>Preset</dt><dd title={replayCase.presetSurface}>{formatSurface(replayCase.presetSurface)}</dd></div>
      <div><dt>Source workspace</dt><dd title={replayCase.sourceCwd}>{replayCase.sourceCwd}</dd></div>
    </dl>
  </section>
}

function CandidateVariants({ variants, selectedId, onSelect }: {
  variants: readonly VariantDescriptor[]
  selectedId?: string
  onSelect: (variantId: string) => void
}): ReactNode {
  return <section className="rld-session-variants">
    <header><h3>Candidate</h3><span>Choose one agent-scoped replay</span></header>
    <div className="rld-session-variant-head"><span>Variant</span><span>Surface</span><span>Request phase</span><span>Support</span></div>
    {variants.map(variant => <VariantRow
      key={variant.id}
      variant={variant}
      selected={selectedId === variant.id}
      onSelect={() => { onSelect(variant.id) }}
    />)}
  </section>
}

function SavedRuns({ history, variants, displayedId, onSelect }: {
  history: readonly ReplayHistoryEntry[]
  variants: readonly VariantDescriptor[]
  displayedId?: string
  onSelect: (experimentId: string) => void
}): ReactNode {
  return <div className="rld-result-history-list">{history.map(entry => {
    const variant = variants.find(item => item.id === entry.experiment.candidateVariantId)
    const drift = entry.experiment.scorecard?.workspaceDrift ?? entry.experiment.candidate?.workspace?.drift
    return <button
      key={entry.experiment.id}
      type="button"
      aria-pressed={displayedId === entry.experiment.id}
      onClick={() => { onSelect(entry.experiment.id) }}
    >
      <span><strong>{variant?.label ?? entry.experiment.candidateVariantId}</strong><small>{new Date(entry.experiment.updatedAt).toLocaleString()}</small></span>
      <span><em data-status={entry.experiment.status}>{statusLabel[entry.experiment.status]}</em>{drift?.detected === true && <em data-drift>Workspace drift</em>}</span>
    </button>
  })}</div>
}

export function rawEvidenceDownloadName(replayCase: FrozenReplayCase, experiment: ReplayExperiment): string {
  const experimentId = experiment.id.replace(/[^a-zA-Z0-9._-]+/g, '-')
  return `replay-evidence-turn-${replayCase.sourceTurn}-${experimentId}.json`
}

export function rawEvidenceArtifact(
  replayCase: FrozenReplayCase,
  experiment: ReplayExperiment,
  workspaceDrift?: WorkspaceDriftProvenance,
): object {
  return {
    schemaVersion: 1,
    source: {
      caseId: replayCase.id,
      sessionId: replayCase.sourceSessionId,
      turn: replayCase.sourceTurn,
      promptHash: replayCase.promptHash,
      workspaceHash: replayCase.sourceWorkspaceHash,
    },
    experiment: {
      id: experiment.id,
      candidateVariantId: experiment.candidateVariantId,
      status: experiment.status,
      createdAt: experiment.createdAt,
      updatedAt: experiment.updatedAt,
      approvedAt: experiment.approvedAt,
    },
    baseline: experiment.baseline ?? replayCase.observedBaseline ?? null,
    candidate: experiment.candidate ?? null,
    scorecard: experiment.scorecard ?? null,
    scorecardMissingReason: experiment.scorecardMissingReason ?? null,
    workspaceDrift: workspaceDrift ?? null,
  }
}

function rawEvidenceDownloadHref(
  replayCase: FrozenReplayCase,
  experiment: ReplayExperiment,
  workspaceDrift?: WorkspaceDriftProvenance,
): string {
  const json = `${JSON.stringify(rawEvidenceArtifact(replayCase, experiment, workspaceDrift), null, 2)}\n`
  return `data:application/json;charset=utf-8,${encodeURIComponent(json)}`
}

function CompletedResult({ replayCase, experiment, activeExperiment, variants, history, workspaceDrift, onPlan, onSelectHistory }: {
  replayCase: FrozenReplayCase
  experiment: ReplayExperiment
  activeExperiment?: ReplayExperiment
  variants: readonly VariantDescriptor[]
  history: readonly ReplayHistoryEntry[]
  workspaceDrift?: WorkspaceDriftProvenance
  onPlan: (variantId: string) => void
  onSelectHistory: (experimentId: string) => void
}): ReactNode {
  const rawEvidenceFilename = rawEvidenceDownloadName(replayCase, experiment)
  const rawEvidenceHref = rawEvidenceDownloadHref(replayCase, experiment, workspaceDrift)
  const viewedVariant = variants.find(variant => variant.id === experiment.candidateVariantId)
  return <main className="rld-result" data-testid="session-replay-result">
    {workspaceDrift?.detected === true && <WorkspaceDriftNotice drift={workspaceDrift} />}
    {history.length > 0 && <details className="rld-result-disclosure rld-result-saved-disclosure">
      <summary>
        <strong>Saved runs · {viewedVariant?.label ?? experiment.candidateVariantId}</strong>
        <span data-status={experiment.status}>{statusLabel[experiment.status]} · {history.length} retained</span>
      </summary>
      <SavedRuns history={history} variants={variants} displayedId={experiment.id} onSelect={onSelectHistory} />
    </details>}
    <details className="rld-result-disclosure rld-result-setup-disclosure">
      <summary><strong>Run setup</strong><span>Observed turn · isolated candidate · explicit approval</span></summary>
      <div className="rld-result-setup-grid">
        <FrozenRequest replayCase={replayCase} />
        <CandidateVariants variants={variants} selectedId={activeExperiment?.candidateVariantId} onSelect={onPlan} />
      </div>
    </details>
    <RequestSurfaceDiff baseline={experiment.baseline} candidate={experiment.candidate} baselineFallback={replayCase} />
    <ExecutionDelta scorecard={experiment.scorecard} missingReason={experiment.scorecardMissingReason} />
    <details className="rld-result-disclosure">
      <summary><strong>Raw evidence</strong><span>Downloadable JSON · session IDs, event counts, request headers, and metrics</span></summary>
      <div className="rld-result-download">
        <span><small>Artifact filename</small><code title={rawEvidenceFilename}>{rawEvidenceFilename}</code></span>
        <a href={rawEvidenceHref} download={rawEvidenceFilename}>Download JSON</a>
      </div>
      <div className="rld-session-evidence-grid">
        <EvidenceSummary title={`Baseline · Turn ${replayCase.sourceTurn}`} evidence={experiment.baseline ?? replayCase.observedBaseline} />
        <EvidenceSummary title="Candidate replay" evidence={experiment.candidate} />
      </div>
    </details>
  </main>
}

function ExperimentWorkbench({ controller, state, sessionId, onBack }: {
  controller: ReturnType<ReplayTabProps['controllerFor']>
  state: ReturnType<ReturnType<ReplayTabProps['controllerFor']>['getSnapshot']>
  sessionId: string
  onBack: () => void
}): ReactNode {
  const snapshot = state.snapshot
  const replayCase = snapshot?.replayCase
  const experiment = snapshot?.experiment
  const variants = snapshot?.variants ?? []
  const history = replayHistoryForTurn(snapshot?.history ?? [], sessionId, replayCase?.sourceTurn ?? -1)
  const [viewingId, setViewingId] = useState<string | undefined>(experiment?.id)
  useEffect(() => { setViewingId(experiment?.id) }, [experiment?.id])
  const displayedExperiment = history.find(entry => entry.experiment.id === viewingId)?.experiment ?? experiment
  const displayedDrift = displayedExperiment?.scorecard?.workspaceDrift ?? displayedExperiment?.candidate?.workspace?.drift
  if (replayCase === undefined || replayCase.sourceSessionId !== sessionId) return null

  const completedResult = displayedExperiment?.status === 'completed'
    && displayedExperiment.baseline !== undefined
    && displayedExperiment.candidate !== undefined

  return (
    <div className="rld-session-workbench" data-testid="session-replay-workbench">
      <header className="rld-session-workbench-header" data-result={completedResult || undefined}>
        <button type="button" onClick={onBack}>← Choose another turn</button>
        <div>
          <h2>{completedResult ? `Replay · Turn ${replayCase.sourceTurn}` : `Current session · Turn ${replayCase.sourceTurn}`}</h2>
          {completedResult
            ? <ReplayWorkflowGuide />
            : <p>This observed baseline is fixed. Choose one isolated candidate, then explicitly approve its run.</p>}
        </div>
        {displayedExperiment !== undefined && (!completedResult || history.length === 0)
          && <strong data-status={displayedExperiment.status}>{statusLabel[displayedExperiment.status]}</strong>}
      </header>

      {state.error !== undefined && <div className="rld-session-error" role="alert">{state.error}</div>}
      {completedResult
        ? <CompletedResult
          replayCase={replayCase}
          experiment={displayedExperiment}
          activeExperiment={experiment}
          variants={variants}
          history={history}
          workspaceDrift={displayedDrift}
          onPlan={variantId => { void controller.plan(variantId) }}
          onSelectHistory={setViewingId}
        />
        : <>
          <div className="rld-session-workbench-grid">
            <div className="rld-session-plan">
              <FrozenRequest replayCase={replayCase} />
              <CandidateVariants variants={variants} selectedId={experiment?.candidateVariantId} onSelect={variantId => { void controller.plan(variantId) }} />
            </div>
            <aside className="rld-session-run">
              <section className="rld-session-run-control">
                <div><h3>Approval gate</h3><p>The baseline is already observed; only the isolated candidate executes.</p></div>
                <button
                  type="button"
                  disabled={experiment?.status !== 'planned'}
                  onClick={() => { void controller.approveRun() }}
                >{experiment?.status === 'running' ? 'Candidate running…' : 'Approve and run candidate'}</button>
              </section>
              <EvidenceSummary title="Candidate replay" evidence={experiment?.candidate} />
            </aside>
          </div>
          {history.length > 0 && <details className="rld-result-disclosure rld-result-saved-setup">
            <summary><strong>Saved runs</strong><span>{history.length} retained for this turn</span></summary>
            <SavedRuns history={history} variants={variants} displayedId={displayedExperiment?.id} onSelect={setViewingId} />
          </details>}
        </>}
    </div>
  )
}

function TurnPicker({ turns, history, projectionAvailable, sessionId, submitting, error, onReplay }: {
  turns: readonly ReplayableTurnRecord[]
  history: readonly ReplayHistoryEntry[]
  projectionAvailable: boolean
  sessionId: string
  submitting?: number
  error?: string
  onReplay: (item: ReplayableTurnRecord) => void
}): ReactNode {
  const ready = turns.filter(turn => turn.replayable).length
  return (
    <div className="rld-tab" data-testid="session-replay-tab">
      <header className="rld-tab-header">
        <div><h2>Replay this session</h2><p>One row per completed turn, using its recorded prompt and request surface.</p></div>
        <div className="rld-tab-summary">
          <span><strong>{turns.length}</strong> completed</span>
          <span><strong>{ready}</strong> ready</span>
        </div>
      </header>
      {error !== undefined && <div className="rld-session-error" role="alert">{error}</div>}
      {!projectionAvailable
        ? <div className="rld-tab-empty"><h3>Replay metadata unavailable</h3><p>The host replay-turn projection is not installed for this session. Replay is disabled.</p></div>
        : turns.length === 0
        ? <div className="rld-tab-empty"><h3>No completed turns</h3><p>This session does not have a finalized turn yet.</p></div>
        : <ol className="rld-turn-list">
          {turns.map(item => {
            const saved = replayHistoryForTurn(history, sessionId, item.turn).length
            return <li key={replayTurnKey(sessionId, item.turn)} className="rld-turn-row" data-ready={item.replayable || undefined}>
            <div className="rld-turn-index"><span>Turn</span><strong>{item.turn}</strong><small>Completed</small></div>
            <div className="rld-turn-content">
              <div className="rld-turn-meta">
                <span><small>Model</small><strong>{item.model ?? 'Unavailable'}</strong></span>
                <span><small>Reasoning</small><strong>{item.reasoning}</strong></span>
                <span><small>Max tokens</small><strong title={item.maxTokens == null ? undefined : String(item.maxTokens)}>{item.maxTokens == null ? 'Unavailable' : formatCount(item.maxTokens)}</strong></span>
                <span><small>Steps</small><strong title={String(item.stepCount)}>{formatCount(item.stepCount)}</strong></span>
              </div>
              {item.prompt === null
                ? <p className="rld-turn-prompt rld-session-muted">The user prompt is outside the loaded history window.</p>
                : <p className="rld-turn-prompt">{item.prompt}</p>}
              {!item.replayable && <p className="rld-turn-missing" role="status">Needs more recorded data: {item.missingFields.join(', ')}.</p>}
            </div>
            <div className="rld-turn-action">
              <button
                type="button"
                data-testid={replayTurnTestId(sessionId, item.turn)}
                disabled={!item.replayable || submitting !== undefined}
                onClick={() => { onReplay(item) }}
              >{submitting === item.turn ? 'Opening…' : saved > 0 ? `Open Turn ${item.turn}` : `Replay Turn ${item.turn}`}</button>
              <small>{saved > 0 ? `${saved} saved run${saved === 1 ? '' : 's'}` : item.replayable ? 'Recorded request surface available' : 'Not replayable yet'}</small>
            </div>
          </li>})}
        </ol>}
    </div>
  )
}

export function SessionReplayTab({ useProjection, sessionId, controllerFor }: ReplayTabProps): ReactNode {
  const controller = controllerFor(String(sessionId))
  const projection = useProjection('replayLabTurns')
  const controllerState = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const [submitting, setSubmitting] = useState<number | undefined>()
  const [localError, setLocalError] = useState<string | undefined>()
  const turns = projection?.turns ?? []
  const activeCase = controllerState.snapshot?.replayCase?.sourceSessionId === String(sessionId)

  useEffect(() => { void controller.refresh() }, [controller])

  const replay = async (item: ReplayableTurnRecord): Promise<void> => {
    setSubmitting(item.turn)
    setLocalError(undefined)
    try {
      if (item.evidenceHash === null) throw new Error(`Turn ${item.turn} has incomplete replay evidence.`)
      await controller.admit({ sessionId: String(sessionId), turn: item.turn, expectedEvidenceHash: item.evidenceHash })
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error))
    } finally {
      setSubmitting(undefined)
    }
  }

  if (activeCase) {
    return <ExperimentWorkbench
      controller={controller}
      state={controllerState}
      sessionId={String(sessionId)}
      onBack={() => { void controller.reset() }}
    />
  }

  return <TurnPicker
    turns={turns}
    history={controllerState.snapshot?.history ?? []}
    projectionAvailable={projection !== undefined}
    sessionId={String(sessionId)}
    submitting={submitting}
    error={localError ?? controllerState.error}
    onReplay={item => { void replay(item) }}
  />
}

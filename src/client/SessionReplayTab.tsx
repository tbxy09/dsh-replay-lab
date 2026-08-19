import { useEffect, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import {
  replayTurnKey, replayTurnTestId, type ReplayHistoryEntry, type ReplayableTurnRecord,
  type RunEvidence, type Scorecard, type VariantDescriptor, type WorkspaceDriftProvenance,
} from '../types.ts'
import type { ReplayTabProps } from './slots.ts'

const statusLabel = {
  planned: 'Ready to run', approved: 'Approved', running: 'Running', completed: 'Completed',
  aborted: 'Aborted', failed: 'Failed',
} as const

const integerFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
const decimalFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 })
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

function ScorecardTable({ scorecard, missingReason, workspaceDrift }: {
  scorecard?: Scorecard
  missingReason?: string
  workspaceDrift?: WorkspaceDriftProvenance
}): ReactNode {
  const drift = scorecard?.workspaceDrift ?? workspaceDrift
  return (
    <section className="rld-session-scorecard">
      <header><h3>Scorecard</h3><span>{drift?.detected === true ? 'Workspace drift recorded' : 'Independent evidence only'}</span></header>
      <WorkspaceDriftNotice drift={drift} />
      {scorecard === undefined
        ? <p className="rld-session-muted">{missingReason ?? 'Generated after the candidate produces complete evidence.'}</p>
        : <table>
          <thead><tr><th>Metric</th><th>Baseline</th><th>Candidate</th><th>Delta</th></tr></thead>
          <tbody>{scorecard.rows.map(row => <tr key={row.key}>
            <th title={row.label}>{metricLabels[row.key]}</th>
            <td title={String(row.baseline)}>{formatMetricValue(row.key, row.baseline)}</td>
            <td title={String(row.candidate)}>{formatMetricValue(row.key, row.candidate)}</td>
            <td data-change={metricDeltaChange(row.delta)} title={String(row.delta)}>
              {formatMetricDelta(row.key, row.delta)}
            </td>
          </tr>)}</tbody>
        </table>}
    </section>
  )
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

  return (
    <div className="rld-session-workbench" data-testid="session-replay-workbench">
      <header className="rld-session-workbench-header">
        <button type="button" onClick={onBack}>← Choose another turn</button>
        <div>
          <h2>Current session · Turn {replayCase.sourceTurn}</h2>
          <p>This observed baseline is fixed. Choose one isolated candidate, then explicitly approve its run.</p>
        </div>
        {displayedExperiment !== undefined && <strong data-status={displayedExperiment.status}>{statusLabel[displayedExperiment.status]}</strong>}
      </header>

      {state.error !== undefined && <div className="rld-session-error" role="alert">{state.error}</div>}
      <div className="rld-session-workbench-grid">
        <div className="rld-session-plan">
          <section className="rld-session-frozen">
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

          <section className="rld-session-variants">
            <header><h3>Candidate</h3><span>Choose one agent-scoped replay</span></header>
            <div className="rld-session-variant-head"><span>Variant</span><span>Surface</span><span>Request phase</span><span>Support</span></div>
            {variants.map(variant => <VariantRow
              key={variant.id}
              variant={variant}
              selected={experiment?.candidateVariantId === variant.id}
              onSelect={() => { void controller.plan(variant.id) }}
            />)}
          </section>
        </div>

        <aside className="rld-session-run">
          <section className="rld-session-run-control">
            <div><h3>Run comparison</h3><p>The baseline is already observed; only the candidate executes.</p></div>
            <button
              type="button"
              disabled={experiment?.status !== 'planned'}
              onClick={() => { void controller.approveRun() }}
            >Approve candidate run</button>
          </section>
          {history.length > 0 && <section className="rld-session-history" aria-label="Saved replay runs">
            <header><h3>Saved runs</h3><span>{history.length} retained for this turn</span></header>
            <div>{history.map(entry => {
              const variant = variants.find(item => item.id === entry.experiment.candidateVariantId)
              return <button
                key={entry.experiment.id}
                type="button"
                aria-pressed={displayedExperiment?.id === entry.experiment.id}
                onClick={() => { setViewingId(entry.experiment.id) }}
              >
                <strong>{variant?.label ?? entry.experiment.candidateVariantId}</strong>
                <span>{statusLabel[entry.experiment.status]} · {new Date(entry.experiment.updatedAt).toLocaleString()}</span>
                {(entry.experiment.scorecard?.workspaceDrift?.detected === true
                  || entry.experiment.candidate?.workspace?.drift?.detected === true)
                  && <em>Workspace drift</em>}
              </button>
            })}</div>
          </section>}
          <div className="rld-session-evidence-grid">
            <EvidenceSummary title={`Current session · Turn ${replayCase.sourceTurn}`} evidence={displayedExperiment?.baseline ?? replayCase.observedBaseline} />
            <EvidenceSummary title="Candidate replay" evidence={displayedExperiment?.candidate} />
          </div>
          <ScorecardTable
            scorecard={displayedExperiment?.scorecard}
            missingReason={displayedExperiment?.scorecardMissingReason}
            workspaceDrift={displayedDrift}
          />
        </aside>
      </div>
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

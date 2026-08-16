import { useEffect, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import {
  replayTurnKey, replayTurnTestId, type ReplayHistoryEntry, type ReplayableTurnRecord,
  type RunEvidence, type Scorecard, type VariantDescriptor,
} from '../types.ts'
import type { ReplayTabProps } from './slots.ts'

const statusLabel = {
  planned: 'Ready to run', approved: 'Approved', running: 'Running', completed: 'Completed',
  aborted: 'Aborted', failed: 'Failed',
} as const

function EvidenceSummary({ title, evidence }: { title: string; evidence?: RunEvidence }): ReactNode {
  return (
    <section className="rld-session-evidence">
      <header><h4>{title}</h4><strong data-status={evidence?.status}>{evidence?.status ?? 'Not run'}</strong></header>
      {evidence === undefined
        ? <p className="rld-session-muted">No independent evidence yet.</p>
        : <>
          <dl>
            <div><dt>Session</dt><dd title={evidence.sessionId}>{evidence.sessionId}</dd></div>
            <div><dt>Request phase</dt><dd>{evidence.requestPhases.join(' → ') || '—'}</dd></div>
            {evidence.requestSurfaces?.map((surface, index) => <div key={`${surface.phase}-${index}`}>
              <dt>{surface.phase} tools</dt>
              <dd title={surface.toolNames.join(', ')}>{surface.toolNames.join(', ') || 'No tools'}</dd>
            </div>)}
            <div><dt>Events</dt><dd>{evidence.eventCount}</dd></div>
          </dl>
          {evidence.metrics === undefined
            ? <p className="rld-session-warning" role="status">Evidence unavailable: {evidence.missingReason ?? 'incomplete event stream'}</p>
            : <div className="rld-session-metrics">
              <span><small>Fresh input</small><strong>{evidence.metrics.freshInputTokens}</strong></span>
              <span><small>Output</small><strong>{evidence.metrics.outputTokens}</strong></span>
              <span><small>Cache read</small><strong>{evidence.metrics.cacheReadTokens}</strong></span>
            </div>}
        </>}
    </section>
  )
}

function ScorecardTable({ scorecard, missingReason }: { scorecard?: Scorecard; missingReason?: string }): ReactNode {
  return (
    <section className="rld-session-scorecard">
      <header><h3>Scorecard</h3><span>Independent evidence only</span></header>
      {scorecard === undefined
        ? <p className="rld-session-muted">{missingReason ?? 'Generated after the candidate produces complete evidence.'}</p>
        : <table>
          <thead><tr><th>Metric</th><th>Baseline</th><th>Candidate</th><th>Delta</th></tr></thead>
          <tbody>{scorecard.rows.map(row => <tr key={row.key}>
            <th>{row.label}</th><td>{row.baseline}</td><td>{row.candidate}</td>
            <td>{row.delta > 0 ? '+' : ''}{row.delta}</td>
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
      <code>{variant.pluginSurface}</code>
      <span>{variant.requestPhases.join(' → ') || '—'}</span>
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
              <div><dt>Max tokens</dt><dd>{replayCase.maxTokens}</dd></div>
              <div><dt>Preset</dt><dd>{replayCase.presetSurface}</dd></div>
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
              </button>
            })}</div>
          </section>}
          <div className="rld-session-evidence-grid">
            <EvidenceSummary title={`Current session · Turn ${replayCase.sourceTurn}`} evidence={displayedExperiment?.baseline ?? replayCase.observedBaseline} />
            <EvidenceSummary title="Candidate replay" evidence={displayedExperiment?.candidate} />
          </div>
          <ScorecardTable scorecard={displayedExperiment?.scorecard} missingReason={displayedExperiment?.scorecardMissingReason} />
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
                <span><small>Max tokens</small><strong>{item.maxTokens ?? 'Unavailable'}</strong></span>
                <span><small>Steps</small><strong>{item.stepCount}</strong></span>
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

import { randomUUID } from 'node:crypto'
import type { ArtifactStore, CaseSource, Oracle, ReplayHook, Runner } from './registries.ts'
import { ReplayLabRegistries } from './registries.ts'
import { compareCallEvidence } from './call-evidence.ts'
import type { EvidenceSummarizer } from './evidence-summary.ts'
import type { FrozenReplayCase, LabSnapshot, ReplayExperiment, ReplayHistoryEntry, ReplayableTurnRecord, ReplayTurnIdentifier, ReplayWorkspaceCheckpoint, RouteLineageEvidence, TransitionStage, VariantDescriptor } from './types.ts'
import { freezeReplayTurn } from './case-source.ts'

export interface ResolvedReplayTurn {
  record: ReplayableTurnRecord
  sourceCwd: string
  checkpoint?: ReplayWorkspaceCheckpoint
}

export type ReplayTurnResolver = (identifier: ReplayTurnIdentifier) => Promise<ResolvedReplayTurn>
export type RouteLineageResolver = (sessionId?: string) => Promise<readonly RouteLineageEvidence[]>

interface SessionDraft {
  replayCase: FrozenReplayCase
  experiment?: ReplayExperiment
}

function validHistoryEntry(entry: ReplayHistoryEntry): boolean {
  return entry.replayCase !== undefined
    && entry.replayCase.sourceSessionId === entry.sourceSessionId
    && entry.replayCase.sourceTurn === entry.sourceTurn
    && (entry.experiment.baseline === undefined || entry.experiment.baseline.sessionId === entry.sourceSessionId)
}

export class ReplayLabService {
  readonly registries = new ReplayLabRegistries()
  private readonly drafts = new Map<string, SessionDraft>()
  private history: ReplayHistoryEntry[] = []
  private readonly running = new Map<string, Promise<void>>()

  constructor(
    readonly routeBase: string,
    private readonly resolveTurn?: ReplayTurnResolver,
    private readonly resolveRouteLineage?: RouteLineageResolver,
    private readonly evidenceSummarizer?: EvidenceSummarizer,
  ) {}

  async restore(store: ArtifactStore): Promise<void> {
    const state = await store.load()
    this.history = state.history.filter(validHistoryEntry)

    // v2 once persisted one process-global active draft. Only retain a terminal,
    // internally consistent result; live drafts are intentionally session scoped.
    if (state.replayCase !== undefined && state.experiment !== undefined
      && ['completed', 'failed', 'aborted'].includes(state.experiment.status)) {
      const entry: ReplayHistoryEntry = {
        sourceSessionId: state.replayCase.sourceSessionId,
        sourceTurn: state.replayCase.sourceTurn,
        ...(state.replayCase.observedBaseline?.evidenceHash === undefined
          ? {}
          : { sourceEvidenceHash: state.replayCase.observedBaseline.evidenceHash }),
        replayCase: state.replayCase,
        experiment: state.experiment,
      }
      if (validHistoryEntry(entry)) this.upsertHistory(state.replayCase, state.experiment)
    }
    await this.persist()
  }

  private source(): CaseSource {
    const source = this.registries.caseSources.list()[0]
    if (source === undefined) throw new Error('没有 case source')
    return source
  }

  private store(): ArtifactStore {
    const store = this.registries.artifactStores.list()[0]
    if (store === undefined) throw new Error('没有 artifact store')
    return store
  }

  private runner(): Runner {
    const runner = this.registries.runners.list()[0]
    if (runner === undefined) throw new Error('没有 runner')
    return runner
  }

  private oracle(): Oracle {
    const oracle = this.registries.oracles.list()[0]
    if (oracle === undefined) throw new Error('没有 oracle')
    return oracle
  }

  private sessionId(requested?: string): string | undefined {
    if (requested !== undefined) return requested
    return this.drafts.size === 1 ? this.drafts.keys().next().value as string : undefined
  }

  private requireDraft(requested?: string): [string, SessionDraft] {
    const sessionId = this.sessionId(requested)
    const draft = sessionId === undefined ? undefined : this.drafts.get(sessionId)
    if (sessionId === undefined || draft === undefined) throw new Error('请先创建冻结 replay case')
    return [sessionId, draft]
  }

  async snapshot(requestedSessionId?: string): Promise<LabSnapshot> {
    const sessionId = this.sessionId(requestedSessionId)
    const draft = sessionId === undefined ? undefined : this.drafts.get(sessionId)
    const routeLineage = this.resolveRouteLineage === undefined
      ? undefined
      : await this.resolveRouteLineage(requestedSessionId)
    return {
      sources: await this.source().list(),
      variants: this.registries.variants.list(),
      history: this.history,
      ...(routeLineage === undefined ? {} : { routeLineage }),
      ...(draft === undefined ? {} : { replayCase: draft.replayCase }),
      ...(draft?.experiment === undefined ? {} : { experiment: draft.experiment }),
    }
  }

  async freeze(sourceId: string): Promise<LabSnapshot> {
    const replayCase = await this.source().freeze(sourceId)
    this.drafts.set(replayCase.sourceSessionId, { replayCase })
    return this.snapshot(replayCase.sourceSessionId)
  }

  /** Resolve an identifier against the authoritative host projection, then freeze it. */
  async admit(identifier: ReplayTurnIdentifier): Promise<LabSnapshot> {
    if (this.resolveTurn === undefined) throw new Error('session replay resolver is unavailable')
    const resolved = await this.resolveTurn(identifier)
    const replayCase = await freezeReplayTurn(identifier.sessionId, resolved.record, resolved.sourceCwd, resolved.checkpoint)
    const current = this.drafts.get(identifier.sessionId)
    const retained = current !== undefined
      && current.replayCase.sourceTurn === identifier.turn
      && current.replayCase.observedBaseline?.evidenceHash === replayCase.observedBaseline?.evidenceHash
      && current.replayCase.sourceCwd === replayCase.sourceCwd
      ? current.experiment
      : undefined
    const prior = retained ?? this.history.slice().reverse().find(entry =>
      validHistoryEntry(entry)
      && entry.sourceSessionId === identifier.sessionId
      && entry.sourceTurn === identifier.turn
      && entry.sourceEvidenceHash === replayCase.observedBaseline?.evidenceHash
      && entry.replayCase?.sourceCwd === replayCase.sourceCwd
    )?.experiment
    this.drafts.set(identifier.sessionId, { replayCase, ...(prior === undefined ? {} : { experiment: prior }) })
    return this.snapshot(identifier.sessionId)
  }

  async plan(candidateVariantId: string, requestedSessionId?: string): Promise<LabSnapshot> {
    const [sessionId, draft] = this.requireDraft(requestedSessionId)
    if (draft.replayCase.observedBaseline === undefined || !draft.replayCase.observedBaseline.complete) {
      throw new Error('current session turn has no complete observed baseline evidence')
    }
    const candidate = this.requireVariant(candidateVariantId)
    if (!candidate.supported) throw new Error(candidate.unsupportedReason ?? 'candidate variant 不支持')
    const now = new Date().toISOString()
    const experiment: ReplayExperiment = {
      id: `exp-${randomUUID()}`,
      caseId: draft.replayCase.id,
      baselineMode: 'observed-current-session',
      candidateVariantId,
      status: 'planned',
      createdAt: now,
      updatedAt: now,
    }
    this.drafts.set(sessionId, { ...draft, experiment })
    await this.transition('planned', experiment)
    return this.snapshot(sessionId)
  }

  async approveAndRun(requestedSessionId?: string): Promise<LabSnapshot> {
    const [sessionId, draft] = this.requireDraft(requestedSessionId)
    if (draft.experiment === undefined) throw new Error('没有可批准的实验计划')
    if (draft.experiment.status !== 'planned') throw new Error(`实验状态 ${draft.experiment.status} 不能批准`)
    const experiment = { ...draft.experiment, status: 'approved' as const, approvedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    this.drafts.set(sessionId, { ...draft, experiment })
    await this.transition('approved', experiment)
    const running = this.execute(sessionId, experiment.id)
    this.running.set(sessionId, running)
    void running.finally(() => { if (this.running.get(sessionId) === running) this.running.delete(sessionId) }).catch(() => undefined)
    return this.snapshot(sessionId)
  }

  async abort(requestedSessionId?: string): Promise<LabSnapshot> {
    const [sessionId, draft] = this.requireDraft(requestedSessionId)
    if (draft.experiment === undefined) throw new Error('没有实验')
    if (!['planned', 'approved', 'running'].includes(draft.experiment.status)) throw new Error('当前实验不可中止')
    let experiment: ReplayExperiment = { ...draft.experiment, status: 'aborted', updatedAt: new Date().toISOString() }
    this.drafts.set(sessionId, { ...draft, experiment })
    if (draft.experiment.status === 'running') {
      const candidate = await this.runner().abort?.(draft.experiment.id)
      const baseline = draft.replayCase.observedBaseline
      const callEvidenceComparison = candidate === undefined || baseline === undefined
        ? undefined
        : compareCallEvidence(draft.replayCase.id, baseline, candidate)
      experiment = {
        ...experiment,
        ...(baseline === undefined ? {} : { baseline }),
        ...(candidate === undefined ? {} : { candidate }),
        ...(callEvidenceComparison === undefined ? {} : { callEvidenceComparison }),
      }
      this.drafts.set(sessionId, { ...draft, experiment })
    }
    this.upsertHistory(draft.replayCase, experiment)
    await this.transition('aborted', experiment)
    return this.snapshot(sessionId)
  }

  async reset(requestedSessionId?: string): Promise<LabSnapshot> {
    const sessionId = this.sessionId(requestedSessionId)
    if (sessionId !== undefined) this.drafts.delete(sessionId)
    await this.persist()
    return this.snapshot(requestedSessionId)
  }

  /** Explicitly spend one direct model-runtime call to narrate retained raw evidence. */
  async summarize(experimentId: string, requestedSessionId?: string): Promise<LabSnapshot> {
    const [sessionId, draft] = this.requireDraft(requestedSessionId)
    const historyEntry = this.history.find(entry => entry.experiment.id === experimentId && entry.sourceSessionId === sessionId)
    const experiment = draft.experiment?.id === experimentId ? draft.experiment : historyEntry?.experiment
    const replayCase = draft.experiment?.id === experimentId ? draft.replayCase : historyEntry?.replayCase
    if (experiment === undefined || replayCase === undefined) throw new Error(`experiment ${experimentId} is unavailable for this session`)
    if (experiment.status !== 'completed' || experiment.baseline === undefined || experiment.candidate === undefined) {
      throw new Error('only a completed replay with baseline/candidate evidence can be summarized')
    }
    if (experiment.callEvidenceComparison === undefined) throw new Error('call-level evidence comparison is unavailable')
    if (this.evidenceSummarizer === undefined) throw new Error('direct model-runtime evidence summarizer is unavailable')
    let evidenceNarrative: NonNullable<ReplayExperiment['evidenceNarrative']>
    try {
      evidenceNarrative = await this.evidenceSummarizer.summarize({
        replayCase,
        baseline: experiment.baseline,
        candidate: experiment.candidate,
        comparison: experiment.callEvidenceComparison,
      })
    } catch (error) {
      evidenceNarrative = {
        schemaVersion: 'evidence-narrative/v1', status: 'failed', promptVersion: 'raw-evidence-summary/v1',
        provider: replayCase.provider, model: replayCase.model, citedEvidenceIds: [],
        error: error instanceof Error ? error.message : String(error),
      }
    }
    const updated: ReplayExperiment = { ...experiment, updatedAt: new Date().toISOString(), evidenceNarrative }
    if (draft.experiment?.id === experimentId) this.drafts.set(sessionId, { ...draft, experiment: updated })
    this.upsertHistory(replayCase, updated)
    await this.store().put('summary', experimentId, { experimentId, evidenceNarrative })
    await this.persist()
    return this.snapshot(sessionId)
  }

  private async execute(sessionId: string, experimentId: string): Promise<void> {
    const draft = this.drafts.get(sessionId)
    if (draft?.experiment?.id !== experimentId) return
    let experiment: ReplayExperiment = { ...draft.experiment, status: 'running', updatedAt: new Date().toISOString() }
    this.drafts.set(sessionId, { ...draft, experiment })
    await this.transition('running', experiment)
    try {
      const candidateVariant = this.requireVariant(experiment.candidateVariantId)
      const baseline = draft.replayCase.observedBaseline
      if (baseline === undefined) throw new Error('current session turn has no observed baseline evidence')
      const candidate = await this.runner().run({ replayCase: draft.replayCase, experimentId, variant: candidateVariant })
      const current = this.drafts.get(sessionId)
      if (current?.experiment?.id !== experimentId || current.experiment.status === 'aborted') return
      const scorecard = this.oracle().score(baseline, candidate)
      const callEvidenceComparison = compareCallEvidence(draft.replayCase.id, baseline, candidate)
      const evidenceNarrative = {
        schemaVersion: 'evidence-narrative/v1' as const,
        status: 'unavailable' as const,
        promptVersion: 'raw-evidence-summary/v1' as const,
        provider: draft.replayCase.provider,
        model: draft.replayCase.model,
        citedEvidenceIds: [],
        error: callEvidenceComparison === undefined
          ? 'baseline/candidate call-level evidence is incomplete'
          : 'summary not requested; use the explicit summarize action',
      }
      const scorecardMissingReason = scorecard === undefined
        ? !baseline.complete ? `baseline evidence 缺失：${baseline.missingReason ?? '未知原因'}`
          : !candidate.complete ? `candidate evidence 缺失：${candidate.missingReason ?? '未知原因'}`
            : 'baseline/candidate evidence 不独立'
        : undefined
      experiment = {
        ...experiment,
        status: 'completed',
        updatedAt: new Date().toISOString(),
        baseline,
        candidate,
        ...(scorecard === undefined ? { scorecardMissingReason } : { scorecard }),
        ...(callEvidenceComparison === undefined ? {} : { callEvidenceComparison }),
        evidenceNarrative,
      }
      this.drafts.set(sessionId, { ...current, experiment })
      this.upsertHistory(draft.replayCase, experiment)
      await this.store().put('experiment', experimentId, experiment)
      await this.transition('completed', experiment)
    } catch (error) {
      const current = this.drafts.get(sessionId)
      if (current?.experiment?.id !== experimentId || current.experiment.status === 'aborted') return
      experiment = { ...current.experiment, status: 'failed', updatedAt: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) }
      this.drafts.set(sessionId, { ...current, experiment })
      this.upsertHistory(draft.replayCase, experiment)
      await this.transition('failed', experiment)
    }
  }

  private requireVariant(id: string): VariantDescriptor {
    const variant = this.registries.variants.get(id)
    if (variant === undefined) throw new Error(`找不到 variant ${id}`)
    return variant
  }

  private async transition(stage: TransitionStage, experiment: ReplayExperiment): Promise<void> {
    await Promise.all(this.registries.hooks.list().map((hook: ReplayHook) => hook.onTransition(stage, experiment)))
    await this.persist()
  }

  private async persist(): Promise<void> {
    // Active workbenches are process-local and keyed by source session. Durable
    // results live in history/artifacts and can be reopened without global state.
    await this.store().save({ history: this.history })
  }

  private upsertHistory(replayCase: FrozenReplayCase, experiment: ReplayExperiment): void {
    const entry: ReplayHistoryEntry = {
      sourceSessionId: replayCase.sourceSessionId,
      sourceTurn: replayCase.sourceTurn,
      ...(replayCase.observedBaseline?.evidenceHash === undefined
        ? {}
        : { sourceEvidenceHash: replayCase.observedBaseline.evidenceHash }),
      replayCase,
      experiment,
    }
    const existing = this.history.findIndex(item => item.experiment.id === experiment.id)
    if (existing === -1) this.history = [...this.history, entry]
    else this.history = this.history.map((item, index) => index === existing ? entry : item)
  }
}

import type { Context } from '@deepseek-ai/cordis'
import type {
  FrozenReplayCase, HistoryTurnSource, ReplayExperiment, RunEvidence, RunMetrics,
  ReplayHistoryEntry, Scorecard, TransitionStage, VariantDescriptor,
} from './types.ts'

interface Identified { id: string }

export class ContributionRegistry<T extends Identified> {
  private readonly entries = new Map<string, T>()

  register(value: T): () => void {
    if (this.entries.has(value.id)) throw new Error(`重复 contribution id: ${value.id}`)
    this.entries.set(value.id, value)
    return () => { this.entries.delete(value.id) }
  }

  get(id: string): T | undefined { return this.entries.get(id) }
  list(): T[] { return [...this.entries.values()] }
}

export interface CaseSource extends Identified {
  /** 列出可冻结的历史 turn（fixture / bookmark）。 */
  list(): Promise<readonly HistoryTurnSource[]>
  /** 从 fixture 来源冻结一个 case。 */
  freeze(sourceId: string): Promise<FrozenReplayCase>
}

export interface Runner extends Identified {
  run(input: { replayCase: FrozenReplayCase; experimentId: string; variant: VariantDescriptor }): Promise<RunEvidence>
}

export interface MetricsExtractor extends Identified {
  extract(events: readonly unknown[]): RunMetrics | undefined
}

export interface Oracle extends Identified {
  score(baseline: RunEvidence | undefined, candidate: RunEvidence | undefined): Scorecard | undefined
}

export interface ArtifactStore extends Identified {
  load(): Promise<{ replayCase?: FrozenReplayCase; experiment?: ReplayExperiment; history: readonly ReplayHistoryEntry[] }>
  save(value: { replayCase?: FrozenReplayCase; experiment?: ReplayExperiment; history: readonly ReplayHistoryEntry[] }): Promise<void>
  put(kind: string, id: string, value: unknown): Promise<string>
}

export interface ReplayHook extends Identified {
  onTransition(stage: TransitionStage, experiment: ReplayExperiment): void | Promise<void>
}

export interface VariantContributor extends VariantDescriptor {
  install?: (agentCtx: Context, phases: string[]) => void
}

export class ReplayLabRegistries {
  readonly caseSources = new ContributionRegistry<CaseSource>()
  readonly variants = new ContributionRegistry<VariantContributor>()
  readonly runners = new ContributionRegistry<Runner>()
  readonly metricsExtractors = new ContributionRegistry<MetricsExtractor>()
  readonly oracles = new ContributionRegistry<Oracle>()
  readonly artifactStores = new ContributionRegistry<ArtifactStore>()
  readonly hooks = new ContributionRegistry<ReplayHook>()
}

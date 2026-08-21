import type { Context } from '@deepseek-ai/cordis';
import type { FrozenReplayCase, HistoryTurnSource, ReplayExperiment, RunEvidence, RunMetrics, ReplayHistoryEntry, Scorecard, TransitionStage, VariantDescriptor } from './types.ts';
interface Identified {
    id: string;
}
export declare class ContributionRegistry<T extends Identified> {
    private readonly entries;
    register(value: T): () => void;
    get(id: string): T | undefined;
    list(): T[];
}
export interface CaseSource extends Identified {
    /** 列出可冻结的历史 turn（fixture / bookmark）。 */
    list(): Promise<readonly HistoryTurnSource[]>;
    /** 从 fixture 来源冻结一个 case。 */
    freeze(sourceId: string): Promise<FrozenReplayCase>;
}
export interface Runner extends Identified {
    run(input: {
        replayCase: FrozenReplayCase;
        experimentId: string;
        variant: VariantDescriptor;
    }): Promise<RunEvidence>;
    /** Best-effort cancellation for an active candidate; terminal cleanup remains runner-owned. */
    abort?(experimentId: string): Promise<RunEvidence | undefined>;
}
export interface MetricsExtractor extends Identified {
    extract(events: readonly unknown[]): RunMetrics | undefined;
}
export interface Oracle extends Identified {
    score(baseline: RunEvidence | undefined, candidate: RunEvidence | undefined): Scorecard | undefined;
}
export interface ArtifactStore extends Identified {
    load(): Promise<{
        replayCase?: FrozenReplayCase;
        experiment?: ReplayExperiment;
        history: readonly ReplayHistoryEntry[];
    }>;
    save(value: {
        replayCase?: FrozenReplayCase;
        experiment?: ReplayExperiment;
        history: readonly ReplayHistoryEntry[];
    }): Promise<void>;
    put(kind: string, id: string, value: unknown): Promise<string>;
}
export interface ReplayHook extends Identified {
    onTransition(stage: TransitionStage, experiment: ReplayExperiment): void | Promise<void>;
}
export interface VariantContributor extends VariantDescriptor {
    install?: (agentCtx: Context, phases: string[]) => void;
}
export declare class ReplayLabRegistries {
    readonly caseSources: ContributionRegistry<CaseSource>;
    readonly variants: ContributionRegistry<VariantContributor>;
    readonly runners: ContributionRegistry<Runner>;
    readonly metricsExtractors: ContributionRegistry<MetricsExtractor>;
    readonly oracles: ContributionRegistry<Oracle>;
    readonly artifactStores: ContributionRegistry<ArtifactStore>;
    readonly hooks: ContributionRegistry<ReplayHook>;
}
export {};

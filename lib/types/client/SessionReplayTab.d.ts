import type { ReactNode } from 'react';
import { type FrozenReplayCase, type ReplayExperiment, type ReplayHistoryEntry, type RunEvidence, type RunMetrics, type VariantDescriptor, type WorkspaceDriftProvenance } from '../types.ts';
import type { ReplayTabProps } from './slots.ts';
declare const metricLabels: {
    readonly freshInputTokens: "Fresh input tokens";
    readonly outputTokens: "Output tokens";
    readonly cacheReadTokens: "Cache read tokens";
    readonly durationMs: "Duration";
    readonly stepCount: "Steps";
    readonly toolCalls: "Tool calls";
};
export declare function formatCount(value: number): string;
export declare function formatDuration(milliseconds: number): string;
export declare function formatMetricValue(key: keyof typeof metricLabels, value: number): string;
export declare function formatMetricDelta(key: keyof typeof metricLabels, value: number): string;
export declare function metricDeltaChange(value: number): 'increase' | 'decrease' | 'unchanged';
export declare function formatMetricPercentDelta(baseline: number, delta: number): string | undefined;
export declare function metricDeltaTone(key: keyof typeof metricLabels, value: number): 'increase' | 'decrease' | 'unchanged' | 'neutral';
export declare function formatRequestPhase(phase: string): string;
export declare function formatSurface(surface: string): string;
export declare function compactIdentifier(value: string): string;
type ComparisonStatus = 'match' | 'mismatch' | 'unknown';
export interface RequestSurfaceComparison {
    baselineRoute: readonly string[];
    candidateRoute: readonly string[];
    routeStatus: ComparisonStatus;
    baselinePhases: readonly string[];
    candidatePhases: readonly string[];
    phaseStatus: ComparisonStatus;
    toolDiffStatus: 'known' | 'unknown';
    toolsAdded: readonly string[];
    toolsRemoved: readonly string[];
    baselineSystemHashes: readonly string[];
    candidateSystemHashes: readonly string[];
    systemHashStatus: ComparisonStatus;
    baselineToolSchemaHashes: readonly string[];
    candidateToolSchemaHashes: readonly string[];
    toolSchemaHashStatus: ComparisonStatus;
}
export declare function compareRequestSurfaces(baseline: RunEvidence | undefined, candidate: RunEvidence | undefined, baselineFallback?: Pick<FrozenReplayCase, 'provider' | 'model' | 'systemHash' | 'toolSchemaHash'>): RequestSurfaceComparison;
export declare function workspaceDriftNotice(drift: WorkspaceDriftProvenance | undefined): string | undefined;
export declare function WorkspaceDriftNotice({ drift }: {
    drift?: WorkspaceDriftProvenance;
}): ReactNode;
export declare function replayHistoryForTurn(history: readonly ReplayHistoryEntry[], sessionId: string, turn: number): readonly ReplayHistoryEntry[];
interface EvidenceRunColumn {
    id: string;
    label: string;
    detail: string;
    kind: 'baseline' | 'candidate';
    metrics?: RunMetrics;
}
export declare function allRunEvidenceColumns(replayCase: FrozenReplayCase, experiment: ReplayExperiment, history: readonly ReplayHistoryEntry[], variants: readonly VariantDescriptor[]): readonly EvidenceRunColumn[];
export declare function metricBarPercent(value: number, maximum: number): number;
export declare function rawEvidenceDownloadName(replayCase: FrozenReplayCase, experiment: ReplayExperiment): string;
export declare function rawEvidenceArtifact(replayCase: FrozenReplayCase, experiment: ReplayExperiment, workspaceDrift?: WorkspaceDriftProvenance): object;
export declare function SessionReplayTab({ useProjection, sessionId, controllerFor }: ReplayTabProps): ReactNode;
export {};

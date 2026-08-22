import type { FrozenReplayCase, ReplayExperiment, ReplayHistoryEntry, RunMetrics, ScorecardRow, VariantDescriptor } from './types.ts';
export interface DashboardRunSlice {
    id: string;
    kind: 'baseline' | 'candidate';
    label: string;
    phases: readonly string[];
    route: string | null;
    tools: readonly string[];
    systemHashes: readonly string[];
    toolSchemaHashes: readonly string[];
    metrics?: RunMetrics;
    callMetrics?: {
        toolCallCount: number;
        toolRetryCount: number;
        toolRetryRatePercent: number;
        maxProgresslessSpan: number;
        firstEffectiveActionLatencyMs: number | null;
    };
}
export interface DashboardPayload {
    schemaVersion: 'replay-dashboard-payload/v1';
    fixtureId: string;
    turn: number;
    variantId: string;
    activeRunId: string;
    baseline: DashboardRunSlice;
    candidate: DashboardRunSlice;
    runs: readonly DashboardRunSlice[];
    scorecard?: {
        rows: readonly ScorecardRow[];
    };
    facts: readonly {
        evidenceId: string;
        metric: string;
        unit: string;
        baseline: number;
        candidate: number;
        delta: number;
        relativeDeltaPercent: number | null;
    }[];
}
export interface DashboardCohort {
    history?: readonly ReplayHistoryEntry[];
    variants?: readonly VariantDescriptor[];
}
/** Host-owned dashboard JSON. The model may visualize this object; it may not invent replacements. */
export declare function buildDashboardPayload(replayCase: FrozenReplayCase, experiment: ReplayExperiment, cohort?: DashboardCohort): DashboardPayload;

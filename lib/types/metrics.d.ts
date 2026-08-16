import type { MetricsExtractor, Oracle } from './registries.ts';
import type { RunEvidence, RunMetrics, Scorecard } from './types.ts';
export declare class SessionMetricsExtractor implements MetricsExtractor {
    readonly id = "session-events-v1";
    extract(events: readonly unknown[]): RunMetrics | undefined;
}
export declare class IndependentEvidenceOracle implements Oracle {
    readonly id = "independent-evidence-v1";
    score(baseline: RunEvidence | undefined, candidate: RunEvidence | undefined): Scorecard | undefined;
}
export declare function evidenceDigest(sessionId: string, events: readonly unknown[]): string;

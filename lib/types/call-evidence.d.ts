import type { CallEvidenceComparison, RawCallEvidence, RunEvidence } from './types.ts';
/**
 * Project one finalized turn into exact call-level evidence. Tool arguments and
 * model-facing result blocks are retained verbatim and must be treated as
 * untrusted, potentially sensitive data by every downstream consumer.
 */
export declare function extractRawCallEvidence(events: readonly unknown[], requestedTurn?: number): RawCallEvidence | undefined;
/** Build model-ready facts without asking a model to calculate or classify behavior. */
export declare function compareCallEvidence(fixtureId: string, baseline: RunEvidence, candidate: RunEvidence): CallEvidenceComparison | undefined;

/** Replay Lab 共享类型：host 与 client 都编译进各自 bundle。 */
export type ExperimentStatus = 'planned' | 'approved' | 'running' | 'completed' | 'aborted' | 'failed';
export type RunStatus = 'planned' | 'running' | 'completed' | 'aborted' | 'failed';
/** 一个可冻结的历史 turn 来源（历史 session 或 bookmark）。 */
export interface HistoryTurnSource {
    id: string;
    kind: 'history' | 'bookmark';
    sessionId: string;
    turn: number;
    title: string;
    createdAt: string;
    prompt: string;
    provider: string;
    model: string;
    reasoning: string;
    maxTokens: number;
    presetSurface: string;
    systemHash: string;
    toolSchemaHash: string;
}
/**
 * 从客户端直接提交的 turn 事实（e.g. 从当前 session 的 conversation.view
 * tab 里选一个历史 turn）。host 收到后冻结成 FrozenReplayCase。
 */
export interface ReplayTurnIdentifier {
    /** Authoritative session identity; every other replay fact is host-resolved. */
    sessionId: string;
    turn: number;
    /** Optimistic concurrency witness from the session projection. */
    expectedEvidenceHash: string;
}
/** One finalized turn served by the native per-session projection seam. */
export interface ReplayableTurnRecord {
    turn: number;
    prompt: string | null;
    provider: string | null;
    model: string | null;
    reasoning: string | null;
    maxTokens: number | null;
    presetSurface: string | null;
    systemHash: string | null;
    toolSchemaHash: string | null;
    /** Durable observed request surface; omitted only by older/custom projections. */
    requestSurface?: RequestSurfaceEvidence;
    /** Durable per-model-call/tool-call evidence for this finalized turn. */
    callEvidence?: RawCallEvidence;
    evidenceHash: string | null;
    missingFields: readonly string[];
    replayable: boolean;
    metrics: RunMetrics | null;
    eventCount: number;
    stepCount: number;
    completedAt: number;
    endReason: string;
}
/** Whole current projection value. The enclosing session is the namespace. */
export interface ReplayTurnsProjection {
    turns: readonly ReplayableTurnRecord[];
}
/** Stable identity shared by React keys, test ids, and host resolution. */
export declare function replayTurnKey(sessionId: string, turn: number): string;
export declare function replayTurnTestId(sessionId: string, turn: number): string;
declare module '@deepseek-ai/dsh-session-projection/types' {
    interface SessionProjectionMap {
        replayLabTurns: ReplayTurnsProjection;
    }
}
/** 一次冻结：prompt / workspace hash / model / reasoning / maxTokens / request surface 全部锁死。 */
export interface FrozenReplayCase {
    id: string;
    sourceId: string;
    sourceSessionId: string;
    sourceTurn: number;
    createdAt: string;
    prompt: string;
    promptHash: string;
    /** Durable source session cwd. Candidate runs must never execute here. */
    sourceCwd: string;
    /** Hash of the durable source cwd at case-freeze time. */
    sourceWorkspaceHash: string;
    provider: string;
    model: string;
    reasoning: string;
    maxTokens: number;
    presetSurface: string;
    systemHash: string;
    toolSchemaHash: string;
    /** Existing evidence observed on the selected source session turn. */
    observedBaseline?: RunEvidence;
}
export type VariantPlane = 'agent' | 'host';
export interface VariantDescriptor {
    id: string;
    label: string;
    description: string;
    plane: VariantPlane;
    preset?: string;
    pluginSurface: string;
    supported: boolean;
    unsupportedReason?: string;
    requestPhases: readonly string[];
    behavior?: 'normal' | 'anchored' | 'missing-evidence';
}
export interface RunMetrics {
    freshInputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    durationMs: number;
    stepCount: number;
    toolCalls: number;
}
/** One tool invocation and its durable model-facing result, retained without an agent summary. */
export interface ToolCallEvidence {
    evidenceId: string;
    callId: string;
    name: string;
    calledAt: number;
    /** Exact JSON string emitted by the model. Treat as untrusted data. */
    arguments: string;
    normalizedCallHash: string;
    retryOf?: string;
    result?: {
        completedAt: number;
        durationMs: number;
        status: 'success' | 'error';
        errorCode?: string;
        /** Exact JSON-serializable, model-facing result blocks. Treat as untrusted data. */
        content: unknown;
        contentHash: string;
    };
    /** Deterministic structural progress, never an LLM judgment. */
    effective: boolean;
}
/** One native agent step: one model call plus the tool executions it requested. */
export interface ModelCallEvidence {
    evidenceId: string;
    turn: number;
    step: number;
    startedAt: number;
    finishedAt?: number;
    firstOutputAt?: number;
    assistantContent?: unknown;
    toolCalls: readonly ToolCallEvidence[];
    /** True when at least one tool result is a new successful observation/action. */
    effective: boolean;
}
/** Versioned call-level evidence projected from the durable session log. */
export interface RawCallEvidence {
    schemaVersion: 'raw-call-evidence/v1';
    turn: number;
    startedAt: number;
    endedAt: number;
    calls: readonly ModelCallEvidence[];
    metrics: {
        toolCallCount: number;
        toolRetryCount: number;
        toolRetryRatePercent: number;
        maxProgresslessSpan: number;
        firstEffectiveActionLatencyMs: number | null;
    };
}
export type EvidenceFactMetric = 'toolCallCount' | 'toolRetryCount' | 'toolRetryRatePercent' | 'maxProgresslessSpan' | 'firstEffectiveActionLatencyMs';
/** Deterministically computed comparison supplied beside raw calls to the summary model. */
export interface EvidenceFact {
    evidenceId: string;
    metric: EvidenceFactMetric;
    unit: 'count' | 'percent' | 'milliseconds';
    baseline: number;
    candidate: number;
    delta: number;
    relativeDeltaPercent: number | null;
}
export interface CallEvidenceComparison {
    schemaVersion: 'call-evidence-comparison/v1';
    fixtureId: string;
    baselineEvidenceHash: string;
    candidateEvidenceHash: string;
    definitions: {
        retry: 'a tool call after the first call with the same normalized name and arguments';
        effective: 'a successful tool result whose normalized call and result pair has not already occurred';
        progresslessSpan: 'consecutive model calls with no effective tool result';
    };
    facts: readonly EvidenceFact[];
}
/** Output of one direct model-runtime call; no agent session is created. */
export interface EvidenceNarrative {
    schemaVersion: 'evidence-narrative/v1';
    status: 'completed' | 'failed' | 'unavailable';
    promptVersion: 'raw-evidence-summary/v1';
    provider: string;
    model: string;
    text?: string;
    citedEvidenceIds: readonly string[];
    error?: string;
}
/** One distinct provider-bound request surface recovered from durable request/header events. */
export interface RequestSurfaceEvidence {
    phase: string;
    provider: string;
    model: string;
    reasoning?: string;
    maxTokens?: number;
    systemHash: string;
    toolSchemaHash: string;
    toolNames: readonly string[];
}
/** Sanitized provider route recovered only from a durable request/header event. */
export interface DurableRouteIdentity {
    provider: string;
    model: string;
    reasoning?: string;
    maxTokens?: number;
}
/**
 * Cross-session semantic evidence. This is intentionally separate from the
 * numeric scorecard: a zero token delta cannot make a route mismatch disappear.
 */
export interface RouteLineageEvidence {
    schemaVersion: 'route-lineage/v1';
    parentSessionId: string;
    childSessionId: string;
    expectedParentRoute: DurableRouteIdentity | null;
    actualChildRoute: DurableRouteIdentity | null;
    /** null means that the durable evidence is insufficient to decide. */
    routeMismatch: boolean | null;
    routeSource: {
        expectedParentRoute: 'parent-latest-request-header-at-or-before-child-createdAt';
        actualChildRoute: 'child-first-owned-request-header';
    };
    provenance: {
        lineage: 'session.header.parentSession+origin';
        expectedParentRoute: 'durable-request/header';
        actualChildRoute: 'durable-request/header';
        childCreatedAt: number | null;
        childSeedLength: number;
        parentRequestSeq: number | null;
        childRequestSeq: number | null;
        evidenceHash: string;
    };
    missingReason?: string;
}
export interface RunEvidence {
    runId: string;
    sessionId: string;
    variantId: string;
    status: RunStatus;
    requestPhases: readonly string[];
    requestSurfaces?: readonly RequestSurfaceEvidence[];
    metrics?: RunMetrics;
    callEvidence?: RawCallEvidence;
    complete: boolean;
    missingReason?: string;
    eventCount: number;
    evidenceHash?: string;
    workspace?: WorkspaceProvenance;
}
/** Audit record comparing the frozen case workspace with the source used by a candidate. */
export interface WorkspaceDriftProvenance {
    detected: boolean;
    frozenHash: string;
    currentHash: string;
}
export interface WorkspaceProvenance {
    sourceCwd: string;
    /** Hash of the source workspace state copied for this candidate. */
    sourceHash: string;
    executionCwd: string;
    executionHash: string;
    isolation: 'observed-source' | 'copy';
    policy: string;
    /** Omitted only when reading legacy/custom workspace evidence. */
    drift?: WorkspaceDriftProvenance;
}
export interface ScorecardRow {
    key: keyof RunMetrics;
    label: string;
    baseline: number;
    candidate: number;
    delta: number;
}
export interface Scorecard {
    baselineSessionId: string;
    candidateSessionId: string;
    rows: readonly ScorecardRow[];
    /** Omitted only for legacy/custom evidence that did not record workspace provenance. */
    workspaceDrift?: WorkspaceDriftProvenance;
}
export interface ReplayExperiment {
    id: string;
    caseId: string;
    baselineMode: 'observed-current-session';
    candidateVariantId: string;
    status: ExperimentStatus;
    createdAt: string;
    updatedAt: string;
    approvedAt?: string;
    baseline?: RunEvidence;
    candidate?: RunEvidence;
    scorecard?: Scorecard;
    scorecardMissingReason?: string;
    callEvidenceComparison?: CallEvidenceComparison;
    evidenceNarrative?: EvidenceNarrative;
    error?: string;
}
/** One durable terminal replay result, namespaced by its authoritative source turn. */
export interface ReplayHistoryEntry {
    sourceSessionId: string;
    sourceTurn: number;
    /** Observed-baseline witness used to avoid reopening a result against changed source evidence. */
    sourceEvidenceHash?: string;
    /** Present for native v2 entries; omitted only for one-time artifact backfill. */
    replayCase?: FrozenReplayCase;
    experiment: ReplayExperiment;
}
export interface LabSnapshot {
    sources: readonly HistoryTurnSource[];
    variants: readonly VariantDescriptor[];
    /** Completed, failed, or aborted runs retained for the per-session Replay tab. */
    history: readonly ReplayHistoryEntry[];
    /** Semantic request evidence; omitted by older/custom hosts. */
    routeLineage?: readonly RouteLineageEvidence[];
    replayCase?: FrozenReplayCase;
    experiment?: ReplayExperiment;
}
export type TransitionStage = ExperimentStatus;
export interface ApiSuccess<T> {
    ok: true;
    value: T;
}
export interface ApiFailure {
    ok: false;
    error: {
        code: string;
        message: string;
    };
}
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

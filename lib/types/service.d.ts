import type { ArtifactStore } from './registries.ts';
import { ReplayLabRegistries } from './registries.ts';
import type { LabSnapshot, ReplayableTurnRecord, ReplayTurnIdentifier } from './types.ts';
export interface ResolvedReplayTurn {
    record: ReplayableTurnRecord;
    sourceCwd: string;
}
export type ReplayTurnResolver = (identifier: ReplayTurnIdentifier) => Promise<ResolvedReplayTurn>;
export declare class ReplayLabService {
    readonly routeBase: string;
    private readonly resolveTurn?;
    readonly registries: ReplayLabRegistries;
    private readonly drafts;
    private history;
    private readonly running;
    constructor(routeBase: string, resolveTurn?: ReplayTurnResolver | undefined);
    restore(store: ArtifactStore): Promise<void>;
    private source;
    private store;
    private runner;
    private oracle;
    private sessionId;
    private requireDraft;
    snapshot(requestedSessionId?: string): Promise<LabSnapshot>;
    freeze(sourceId: string): Promise<LabSnapshot>;
    /** Resolve an identifier against the authoritative host projection, then freeze it. */
    admit(identifier: ReplayTurnIdentifier): Promise<LabSnapshot>;
    plan(candidateVariantId: string, requestedSessionId?: string): Promise<LabSnapshot>;
    approveAndRun(requestedSessionId?: string): Promise<LabSnapshot>;
    abort(requestedSessionId?: string): Promise<LabSnapshot>;
    reset(requestedSessionId?: string): Promise<LabSnapshot>;
    private execute;
    private requireVariant;
    private transition;
    private persist;
    private upsertHistory;
}

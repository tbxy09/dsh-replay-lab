import type { LabSnapshot, ReplayTurnIdentifier } from '../types.ts';
export interface ClientState {
    open: boolean;
    status: 'cold' | 'loading' | 'ready' | 'error';
    snapshot?: LabSnapshot;
    error?: string;
    unsupported?: string;
}
export declare class ReplayLabController {
    private readonly apiBase;
    private readonly sessionId?;
    private listeners;
    private state;
    private poll?;
    constructor(apiBase?: string, sessionId?: string | undefined);
    readonly subscribe: (listener: () => void) => (() => void);
    readonly getSnapshot: () => ClientState;
    open(): void;
    close(): void;
    refresh(): Promise<void>;
    freeze(sourceId: string): Promise<void>;
    admit(identifier: ReplayTurnIdentifier): Promise<void>;
    plan(candidateVariantId: string): Promise<void>;
    approveRun(): Promise<void>;
    summarize(experimentId: string, prompt?: string): Promise<void>;
    renderDashboard(experimentId: string, promptId: string, prompt: string): Promise<void>;
    reset(): Promise<void>;
    abort(): Promise<void>;
    private requireSessionId;
    private request;
    private startPolling;
    private stopPolling;
    private patch;
}

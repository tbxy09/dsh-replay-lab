import type { ReplayWorkspaceCheckpoint, WorkspaceProvenance } from './types.ts';
export interface IsolatedWorkspace {
    root: string;
    durable: boolean;
    provenance: WorkspaceProvenance;
    worktreeCwd?: string;
}
export interface WorkspaceSnapshotOptions {
    parentDirectory?: string;
    executionName?: string;
    capturedAt?: ReplayWorkspaceCheckpoint['capturedAt'];
}
export interface CandidateWorkspace extends IsolatedWorkspace {
    checkpoint: ReplayWorkspaceCheckpoint;
}
export interface ReplayWorkspaceProvider {
    checkpoint(sourceCwd: string, capturedAt?: ReplayWorkspaceCheckpoint['capturedAt']): Promise<ReplayWorkspaceCheckpoint>;
    materialize(checkpoint: ReplayWorkspaceCheckpoint, expectedHash?: string, options?: WorkspaceSnapshotOptions): Promise<CandidateWorkspace>;
    restore(workspace: CandidateWorkspace | IsolatedWorkspace, expectedHash?: string): Promise<void>;
    dispose(workspace: CandidateWorkspace | IsolatedWorkspace): Promise<void>;
}
declare function realTarget(path: string): string;
declare function inside(root: string, target: string): boolean;
declare function disjoint(root: string, sourceCwd: string): boolean;
declare function safePathSegment(value: string): string;
export declare function assertWorkspaceBoundary(workspace: IsolatedWorkspace): {
    root: string;
    executionCwd: string;
    checkpointCwd?: string;
};
export declare class DefaultReplayWorkspaceProvider implements ReplayWorkspaceProvider {
    private readonly snapshotDirectory?;
    constructor(snapshotDirectory?: string | undefined);
    checkpoint(sourceCwd: string, capturedAt?: ReplayWorkspaceCheckpoint['capturedAt']): Promise<ReplayWorkspaceCheckpoint>;
    materialize(checkpoint: ReplayWorkspaceCheckpoint, expectedHash?: string, options?: WorkspaceSnapshotOptions): Promise<CandidateWorkspace>;
    restore(workspace: CandidateWorkspace | IsolatedWorkspace, expectedHash?: string): Promise<void>;
    dispose(workspace: CandidateWorkspace | IsolatedWorkspace): Promise<void>;
}
/** Copy current source state into an isolated candidate. Prefer a stored S0 checkpoint at replay time. */
export declare function copyWorkspaceSnapshot(sourceCwd: string, expectedHash: string, options?: WorkspaceSnapshotOptions): Promise<IsolatedWorkspace>;
export declare function materializeWorkspaceCheckpoint(checkpoint: ReplayWorkspaceCheckpoint, expectedHash: string, options?: WorkspaceSnapshotOptions): Promise<IsolatedWorkspace>;
export declare function rollbackWorkspaceSnapshot(workspace: IsolatedWorkspace, expectedHash?: string): Promise<void>;
export declare function discardWorkspaceSnapshot(workspace: IsolatedWorkspace): Promise<void>;
export declare function recoverManagedWorkspaceSnapshots(parentDirectory: string): Promise<number>;
export declare class TurnCheckpointStore {
    private readonly checkpoints;
    static key(sessionId: string, turn: number): string;
    get(sessionId: string, turn: number): ReplayWorkspaceCheckpoint | undefined;
    set(sessionId: string, turn: number, checkpoint: ReplayWorkspaceCheckpoint): void;
    remember(checkpoint: ReplayWorkspaceCheckpoint, sessionId: string, turn: number): ReplayWorkspaceCheckpoint;
}
export declare function currentSourceHash(sourceCwd: string): Promise<string>;
export { realTarget, inside, disjoint, safePathSegment };

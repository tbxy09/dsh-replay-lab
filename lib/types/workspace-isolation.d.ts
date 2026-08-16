import type { WorkspaceProvenance } from './types.ts';
export declare const WORKSPACE_COPY_POLICY = "copy-v1:exclude-.git,node_modules";
/** Hash exactly the files copied by the candidate workspace policy. */
export declare function hashReplayWorkspace(root: string): Promise<string>;
export interface IsolatedWorkspace {
    cwd: string;
    provenance: WorkspaceProvenance;
    cleanup(): Promise<void>;
}
export interface WorkspaceIsolator {
    isolate(sourceCwd: string, expectedSourceHash: string): Promise<IsolatedWorkspace>;
}
/**
 * Candidate runs receive a disposable copy. The source is hashed again before
 * copying, frozen-case drift is recorded, and the copy must match that current
 * source snapshot.
 */
export declare class CopyWorkspaceIsolator implements WorkspaceIsolator {
    isolate(sourceCwd: string, expectedSourceHash: string): Promise<IsolatedWorkspace>;
}

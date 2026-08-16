import type { Context } from '@deepseek-ai/cordis';
import { LlmAdapter } from '@deepseek-ai/dsh-llm';
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm';
import type { MetricsExtractor, Runner, VariantContributor } from './registries.ts';
import type { FrozenReplayCase, RequestSurfaceEvidence, RunEvidence, VariantDescriptor, WorkspaceProvenance } from './types.ts';
export interface IsolatedWorkspace {
    root: string;
    durable: boolean;
    provenance: WorkspaceProvenance;
}
export interface WorkspaceSnapshotOptions {
    /** Persistent parent used by approved candidate sessions so sidebar membership survives restart. */
    parentDirectory?: string;
    /** Human-derived leaf name; only filesystem-safe characters are retained. */
    executionName?: string;
}
/** Monotonic guard for structured file arguments used by replay agents and descendants. */
export declare function candidatePathGuard(argumentsValue: unknown, executionCwd: string): string | undefined;
/** Recover every distinct, durable provider-bound request surface in log order. */
export declare function requestSurfaceEvidence(events: readonly unknown[], behavior: VariantDescriptor['behavior']): RequestSurfaceEvidence[];
export declare function replayDisplayNames(replayCase: Pick<FrozenReplayCase, 'sourceCwd' | 'sourceTurn'>, variant: Pick<VariantDescriptor, 'id' | 'label'>): {
    workspaceTitle: string;
    sessionTitle: string;
    executionName: string;
};
/** Copy the current source workspace and retain its comparison with the frozen case hash. */
export declare function copyWorkspaceSnapshot(sourceCwd: string, expectedHash: string, options?: WorkspaceSnapshotOptions): Promise<IsolatedWorkspace>;
export declare class DeterministicReplayAdapter extends LlmAdapter {
    stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
}
export declare class CordisAgentRunner implements Runner {
    private readonly ctx;
    private readonly metrics;
    private readonly variantLookup;
    private readonly managedWorkspaceDirectory?;
    readonly id = "cordis-agent-runner";
    private readonly handles;
    private readonly isolatedRoots;
    constructor(ctx: Context, metrics: MetricsExtractor, variantLookup: (id: string) => VariantContributor | undefined, managedWorkspaceDirectory?: string | undefined);
    run(input: {
        replayCase: FrozenReplayCase;
        experimentId: string;
        variant: VariantDescriptor;
    }): Promise<RunEvidence>;
    dispose(): Promise<void>;
}

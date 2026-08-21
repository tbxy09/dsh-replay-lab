import type { Context } from '@deepseek-ai/cordis';
import { LlmAdapter, ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm';
import type { MetricsExtractor, Runner, VariantContributor } from './registries.ts';
import { copyWorkspaceSnapshot, discardWorkspaceSnapshot, materializeWorkspaceCheckpoint, recoverManagedWorkspaceSnapshots, rollbackWorkspaceSnapshot } from './replay-workspace.ts';
import type { FrozenReplayCase, RequestSurfaceEvidence, RunEvidence, VariantDescriptor } from './types.ts';
export type { IsolatedWorkspace, WorkspaceSnapshotOptions } from './replay-workspace.ts';
export { copyWorkspaceSnapshot, discardWorkspaceSnapshot, materializeWorkspaceCheckpoint, recoverManagedWorkspaceSnapshots, rollbackWorkspaceSnapshot, };
/** Monotonic guard for structured file arguments used by replay agents and descendants. */
export declare function candidatePathGuard(argumentsValue: unknown, executionCwd: string): string | undefined;
/** Recover every distinct, durable provider-bound request surface in log order. */
export declare function requestSurfaceEvidence(events: readonly unknown[], behavior: VariantDescriptor['behavior']): RequestSurfaceEvidence[];
export declare function replayDisplayNames(replayCase: Pick<FrozenReplayCase, 'sourceCwd' | 'sourceTurn'>, variant: Pick<VariantDescriptor, 'id' | 'label'>): {
    workspaceTitle: string;
    sessionTitle: string;
    executionName: string;
};
export declare class DeterministicReplayAdapter extends LlmAdapter {
    providerInfo(provider: string): {
        id: string;
        name: string;
    };
    listModels(provider: string): Promise<{
        provider: string;
        id: string;
        name: string;
        inputModalities: "text"[];
    }[]>;
    resolveModel(provider: string, model: string): Promise<{
        provider: string;
        id: string;
        name: string;
        inputModalities: "text"[];
        context: {
            contextWindow: number;
        };
        defaultMaxTokens: number;
        reasoning: {
            efforts: {
                id: ReasoningEffortId;
                name: string;
                description: string;
            }[];
            defaultEffort: ReasoningEffortId;
        };
    }>;
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
    private readonly activeCandidates;
    constructor(ctx: Context, metrics: MetricsExtractor, variantLookup: (id: string) => VariantContributor | undefined, managedWorkspaceDirectory?: string | undefined);
    recoverManagedWorkspaces(): Promise<number>;
    /** Candidate and descendant tool access is writable only during the owned replay run. */
    isActiveCandidateSession(sessionId: string): boolean;
    run(input: {
        replayCase: FrozenReplayCase;
        experimentId: string;
        variant: VariantDescriptor;
    }): Promise<RunEvidence>;
    private runCandidate;
    abort(experimentId: string): Promise<RunEvidence | undefined>;
    dispose(): Promise<void>;
}

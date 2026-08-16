import type { CaseSource } from './registries.ts';
import type { FrozenReplayCase, HistoryTurnSource, ReplayableTurnRecord } from './types.ts';
export declare function buildCase(source: {
    id: string;
    sessionId: string;
    turn: number;
    prompt: string;
    provider: string;
    model: string;
    reasoning: string;
    maxTokens: number;
    presetSurface: string;
    systemHash: string;
    toolSchemaHash: string;
}, sourceCwd: string, sourceWorkspaceHash: string): FrozenReplayCase;
/** Freeze a host-resolved authoritative session projection record. */
export declare function freezeReplayTurn(sessionId: string, record: ReplayableTurnRecord, sourceCwd: string): Promise<FrozenReplayCase>;
export declare class FixtureCaseSource implements CaseSource {
    private readonly file;
    private readonly workspaceFixture;
    readonly id = "fixture-history";
    private cache?;
    constructor(file: string, workspaceFixture: string);
    private workspaceHash;
    list(): Promise<readonly HistoryTurnSource[]>;
    freeze(sourceId: string): Promise<FrozenReplayCase>;
}

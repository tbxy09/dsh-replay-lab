import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection';
import type { ReplayableTurnRecord } from './types.ts';
interface RequestEvidence {
    provider: string | null;
    model: string | null;
    reasoning: string | null;
    maxTokens: number | null;
    systemHash: string;
    toolSchemaHash: string;
    toolNames: readonly string[];
}
interface OpenTurn {
    turn: number;
    startedAt: number;
    promptParts: string[];
    freshInputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    stepCount: number;
    toolCalls: number;
    eventCount: number;
    outputEvidence: string[];
    callEvents: unknown[];
}
interface ReplayTurnsState {
    presetSurface: string | null;
    request: RequestEvidence | null;
    openTurn: OpenTurn | null;
    turns: ReplayableTurnRecord[];
}
/** Native whole-log projection serving live updates and cache-backed historical backfill. */
export declare const replayTurnsProjectionDefinition: ProjectionDefinition<'replayLabTurns', ReplayTurnsState>;
export {};

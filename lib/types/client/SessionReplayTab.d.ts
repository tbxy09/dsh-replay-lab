import type { ReactNode } from 'react';
import { type ReplayHistoryEntry, type WorkspaceDriftProvenance } from '../types.ts';
import type { ReplayTabProps } from './slots.ts';
declare const metricLabels: {
    readonly freshInputTokens: "Fresh input tokens";
    readonly outputTokens: "Output tokens";
    readonly cacheReadTokens: "Cache read tokens";
    readonly durationMs: "Duration";
    readonly stepCount: "Steps";
    readonly toolCalls: "Tool calls";
};
export declare function formatCount(value: number): string;
export declare function formatDuration(milliseconds: number): string;
export declare function formatMetricValue(key: keyof typeof metricLabels, value: number): string;
export declare function formatMetricDelta(key: keyof typeof metricLabels, value: number): string;
export declare function formatRequestPhase(phase: string): string;
export declare function formatSurface(surface: string): string;
export declare function compactIdentifier(value: string): string;
export declare function workspaceDriftNotice(drift: WorkspaceDriftProvenance | undefined): string | undefined;
export declare function WorkspaceDriftNotice({ drift }: {
    drift?: WorkspaceDriftProvenance;
}): ReactNode;
export declare function replayHistoryForTurn(history: readonly ReplayHistoryEntry[], sessionId: string, turn: number): readonly ReplayHistoryEntry[];
export declare function SessionReplayTab({ useProjection, sessionId, controllerFor }: ReplayTabProps): ReactNode;
export {};

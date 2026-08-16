import type { ReactNode } from 'react';
import { type ReplayHistoryEntry, type WorkspaceDriftProvenance } from '../types.ts';
import type { ReplayTabProps } from './slots.ts';
export declare function workspaceDriftNotice(drift: WorkspaceDriftProvenance | undefined): string | undefined;
export declare function WorkspaceDriftNotice({ drift }: {
    drift?: WorkspaceDriftProvenance;
}): ReactNode;
export declare function replayHistoryForTurn(history: readonly ReplayHistoryEntry[], sessionId: string, turn: number): readonly ReplayHistoryEntry[];
export declare function SessionReplayTab({ useProjection, sessionId, controllerFor }: ReplayTabProps): ReactNode;

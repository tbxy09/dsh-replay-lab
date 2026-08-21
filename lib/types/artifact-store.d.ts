import type { ArtifactStore } from './registries.ts';
import type { FrozenReplayCase, ReplayExperiment, ReplayHistoryEntry } from './types.ts';
import type { RouteLineageEvidence } from './types.ts';
export declare class JsonArtifactStore implements ArtifactStore {
    readonly file: string;
    readonly artifactDirectory: string;
    readonly id = "json-artifacts";
    constructor(file: string, artifactDirectory: string);
    private artifactHistory;
    loadRouteLineageEvidence(): Promise<RouteLineageEvidence[]>;
    load(): Promise<{
        replayCase?: FrozenReplayCase;
        experiment?: ReplayExperiment;
        history: readonly ReplayHistoryEntry[];
    }>;
    save(value: {
        replayCase?: FrozenReplayCase;
        experiment?: ReplayExperiment;
        history: readonly ReplayHistoryEntry[];
    }): Promise<void>;
    put(kind: string, id: string, value: unknown): Promise<string>;
}

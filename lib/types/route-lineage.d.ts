import type { RouteLineageEvidence } from './types.ts';
interface SessionHeaderLike {
    id?: unknown;
    createdAt?: unknown;
    parentSession?: unknown;
    origin?: unknown;
    seedLength?: unknown;
}
export interface DurableSessionRouteLog {
    sessionId: string;
    header: SessionHeaderLike;
    events: readonly unknown[];
}
/** Match only a native subagent lineage. Generic forks are not child-agent evidence. */
export declare function matchRouteLineage(parent: DurableSessionRouteLog | undefined, child: DurableSessionRouteLog): RouteLineageEvidence | undefined;
export declare function collectRouteLineageEvidence(logs: readonly DurableSessionRouteLog[]): RouteLineageEvidence[];
export declare function isRouteLineageEvidence(value: unknown): value is RouteLineageEvidence;
export declare class RouteLineageMonitor {
    private readonly logs;
    private readonly persist?;
    private readonly evidence;
    private pending;
    constructor(logs: () => readonly DurableSessionRouteLog[], persist?: ((evidence: RouteLineageEvidence) => Promise<void>) | undefined);
    restore(values: readonly unknown[]): void;
    refresh(): Promise<void>;
    private refreshNow;
    list(sessionId?: string): readonly RouteLineageEvidence[];
}
export {};

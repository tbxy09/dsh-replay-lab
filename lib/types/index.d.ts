import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { ReplayLabService } from './service.ts';
export * from './types.ts';
export * from './registries.ts';
export { ReplayLabService } from './service.ts';
export { FixtureCaseSource } from './case-source.ts';
export { JsonArtifactStore } from './artifact-store.ts';
export { SessionMetricsExtractor, IndependentEvidenceOracle } from './metrics.ts';
export { CordisAgentRunner, DeterministicReplayAdapter } from './runner.ts';
export { builtInVariants } from './variants.ts';
export * from './route-lineage.ts';
export * from './call-evidence.ts';
export * from './evidence-summary.ts';
declare module '@deepseek-ai/cordis' {
    interface Context {
        replayLabDsh: ReplayLabService;
    }
}
export declare const name = "replay-lab-dsh";
export declare const inject: string[];
export interface Config {
    routeBase: string;
    historyFixture: string;
    workspaceFixture: string;
    stateFile: string;
    artifactDirectory: string;
    provider: string;
    fakeAdapter: boolean;
}
export declare const Config: z<Config>;
export declare function apply(ctx: Context, config: Config): Promise<void>;

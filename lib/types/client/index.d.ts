import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
export declare const inject: string[];
export declare function apply(ctx: ClientContext): void;
export { ReplayLabController } from './controller.ts';
export { SessionReplayTab } from './SessionReplayTab.tsx';

import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { ReplayLabController } from './controller.ts';
/** conversation.view tab injection face. Each source session owns one controller. */
export interface ReplayTabInjected {
    controllerFor(sessionId: string): ReplayLabController;
}
export type ReplayTabProps = PropsRuntime<'conversation.view'> & InjectFace<ReplayTabInjected>;

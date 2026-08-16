import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ReplayLabController } from './controller.ts'
import { SessionReplayTab } from './SessionReplayTab.tsx'
import type { ReplayTabInjected } from './slots.ts'
import { injectStyles } from './styles.ts'

export const inject = ['slots', 'sessions']

export function apply(ctx: ClientContext): void {
  ctx.effect(injectStyles, 'replay-lab-dsh: styles')
  const controllers = new Map<string, ReplayLabController>()
  const controllerFor = (sessionId: string): ReplayLabController => {
    const existing = controllers.get(sessionId)
    if (existing !== undefined) return existing
    const controller = new ReplayLabController('/replay-lab-dsh', sessionId)
    controllers.set(sessionId, controller)
    return controller
  }

  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view', id: 'replay-lab-dsh', order: 50,
    label: 'Replay',
    inject: (): ReplayTabInjected => ({ controllerFor }),
  }, SessionReplayTab))
}

export { ReplayLabController } from './controller.ts'
export { SessionReplayTab } from './SessionReplayTab.tsx'

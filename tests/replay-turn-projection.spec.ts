import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { replayTurnsProjectionDefinition as unit } from '../src/replay-turn-projection.ts'
import { replayTurnKey, replayTurnTestId } from '../src/types.ts'

let seq = 0
function event(type: string, data: unknown): SessionEvent {
  return { type, data, seq: seq++, time: seq * 10 } as SessionEvent
}

function header(model = 'deepseek-v4', complete = true): SessionEvent {
  return event('request/header', {
    reason: 'initial',
    header: {
      config: { provider: 'deepseek', model, reasoningEffort: 'high', ...(complete ? { maxTokens: 4096 } : {}) },
      system: 'authoritative system',
      tools: [{ name: 'read', description: 'Read', inputSchema: { type: 'object' } }],
    },
  })
}

function prompt(text: string): SessionEvent {
  return event('user/message', {
    id: `m-${seq}`, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }],
  })
}

function assistant(turn: number, inputTokens: number, outputTokens: number, cacheReadTokens: number): SessionEvent {
  return event('assistant/message', {
    turn, id: `a-${seq}`, role: 'assistant', content: [{ type: 'text', text: `answer ${turn}` }],
    usage: { inputTokens, outputTokens, cacheReadTokens },
  })
}

function fold(events: readonly SessionEvent[]) {
  let state = unit.init()
  for (const item of events) state = unit.apply(state, item)
  return unit.view(state)
}

describe('replay turn session projection', () => {
  it('publishes one row per turn across multi-step and multi-turn logs', () => {
    seq = 0
    const projection = fold([
      event('agent-preset/selected', { agentPreset: 'standard' }),
      event('turn/start', { turn: 1 }), prompt('one'), header(),
      event('step/start', { turn: 1, step: 1 }), event('step/start', { turn: 1, step: 2 }), assistant(1, 10, 4, 3),
      event('turn/end', { turn: 1, reason: { kind: 'completed' } }),
      event('turn/start', { turn: 2 }), prompt('two'),
      event('step/start', { turn: 2, step: 1 }), assistant(2, 20, 5, 6), event('turn/end', { turn: 2, reason: { kind: 'completed' } }),
    ])
    expect(projection.turns.map(turn => turn.turn)).toEqual([1, 2])
    expect(projection.turns[0]).toMatchObject({ prompt: 'one', stepCount: 2, replayable: true })
    expect(projection.turns[1]).toMatchObject({ prompt: 'two', stepCount: 1, model: 'deepseek-v4', replayable: true })
    expect(projection.turns[0]?.metrics).toMatchObject({ freshInputTokens: 10, outputTokens: 4, cacheReadTokens: 3 })
    expect(projection.turns[1]?.metrics).toMatchObject({ freshInputTokens: 20, outputTokens: 5, cacheReadTokens: 6 })
  })

  it('backfills the complete durable log independently of a paged client window', () => {
    seq = 0
    const durable: SessionEvent[] = [event('agent-preset/selected', { agentPreset: 'standard' }), header()]
    for (let turn = 1; turn <= 5; turn += 1) {
      durable.push(event('turn/start', { turn }), prompt(`prompt ${turn}`), event('step/start', { turn, step: 1 }), event('turn/end', { turn, reason: { kind: 'completed' } }))
    }
    const clientTail = durable.slice(-4)
    expect(clientTail.some(item => item.type === 'turn/end' && item.data.turn === 1)).toBe(false)
    expect(fold(durable).turns.map(turn => turn.turn)).toEqual([1, 2, 3, 4, 5])
  })

  it('fails closed when authoritative request metadata is incomplete', () => {
    seq = 0
    const [record] = fold([
      event('agent-preset/selected', { agentPreset: 'standard' }),
      event('turn/start', { turn: 1 }), prompt('one'), header('model', false),
      event('turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ]).turns
    expect(record?.replayable).toBe(false)
    expect(record?.evidenceHash).toBeNull()
    expect(record?.missingFields).toContain('maxTokens')
  })

  it('updates live only when a turn finalizes and uses session-scoped identities', () => {
    seq = 0
    let state = unit.init()
    for (const item of [event('agent-preset/selected', { agentPreset: 'standard' }), event('turn/start', { turn: 1 }), prompt('live'), header(), event('step/start', { turn: 1, step: 1 })]) {
      state = unit.apply(state, item)
    }
    expect(unit.view(state).turns).toEqual([])
    state = unit.apply(state, event('turn/end', { turn: 1, reason: { kind: 'completed' } }))
    expect(unit.view(state).turns).toHaveLength(1)
    expect(replayTurnKey('session-a', 1)).toBe('session-a:1')
    expect(replayTurnKey('session-b', 1)).not.toBe(replayTurnKey('session-a', 1))
    expect(replayTurnTestId('session-a', 1)).toBe('replay-turn-session-a:1')
  })
})

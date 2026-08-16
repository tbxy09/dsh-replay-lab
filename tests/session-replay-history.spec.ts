import { describe, expect, it } from 'vitest'
import { replayHistoryForTurn } from '../src/client/SessionReplayTab.tsx'
import type { ReplayHistoryEntry } from '../src/types.ts'

function entry(sessionId: string, turn: number, id: string, updatedAt: string): ReplayHistoryEntry {
  return {
    sourceSessionId: sessionId,
    sourceTurn: turn,
    replayCase: {
      id: `case-${id}`, sourceId: `${sessionId}:${turn}`, sourceSessionId: sessionId, sourceTurn: turn,
      createdAt: updatedAt, prompt: 'prompt', promptHash: 'p', sourceCwd: '/workspace', sourceWorkspaceHash: 'w',
      provider: 'provider', model: 'model', reasoning: 'high', maxTokens: 256, presetSurface: 'standard',
      systemHash: 's', toolSchemaHash: 't',
    },
    experiment: {
      id, caseId: `case-${id}`, baselineMode: 'observed-current-session', candidateVariantId: 'standard',
      status: 'completed', createdAt: updatedAt, updatedAt,
    },
  }
}

describe('per-turn replay history', () => {
  it('filters by source session and turn and orders newest first', () => {
    const history = [
      entry('fish', 1, 'older', '2026-08-15T00:00:00.000Z'),
      entry('other', 1, 'other', '2026-08-15T03:00:00.000Z'),
      entry('fish', 2, 'turn-2', '2026-08-15T02:00:00.000Z'),
      entry('fish', 1, 'newer', '2026-08-15T01:00:00.000Z'),
    ]
    expect(replayHistoryForTurn(history, 'fish', 1).map(item => item.experiment.id)).toEqual(['newer', 'older'])
  })

  it('hides a legacy entry whose observed baseline belongs to another session', () => {
    const corrupt = entry('fish', 1, 'corrupt', '2026-08-15T04:00:00.000Z')
    corrupt.experiment.baseline = {
      runId: 'observed', sessionId: 'bookmark', variantId: 'observed-current-session', status: 'completed',
      requestPhases: ['observed'], metrics: { freshInputTokens: 1, outputTokens: 1, cacheReadTokens: 0, durationMs: 1, stepCount: 1, toolCalls: 0 },
      complete: true, eventCount: 1, evidenceHash: 'hash',
    }
    expect(replayHistoryForTurn([corrupt], 'fish', 1)).toEqual([])
  })
})

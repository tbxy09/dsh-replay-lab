import { describe, expect, it } from 'vitest'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import {
  compactIdentifier, formatCount, formatDuration, formatMetricDelta, formatMetricValue,
  formatRequestPhase, formatSurface, metricDeltaChange, replayHistoryForTurn,
  WorkspaceDriftNotice, workspaceDriftNotice,
} from '../src/client/SessionReplayTab.tsx'
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
  it('formats dense replay evidence for people while preserving exact values elsewhere', () => {
    expect(formatCount(326696)).toBe('326,696')
    expect(formatDuration(458288)).toBe('7 min 38 s')
    expect(formatDuration(850)).toBe('850 ms')
    expect(formatMetricValue('durationMs', 101602)).toBe('1 min 42 s')
    expect(formatMetricDelta('freshInputTokens', 88813)).toBe('+88,813')
    expect(formatMetricDelta('durationMs', -1500)).toBe('−1.5 s')
    expect(metricDeltaChange(1)).toBe('increase')
    expect(metricDeltaChange(-1)).toBe('decrease')
    expect(metricDeltaChange(0)).toBe('unchanged')
    expect(formatRequestPhase('dynamic-unlocks')).toBe('Dynamic unlocks')
    expect(formatSurface('preset:anchored-standard')).toBe('Anchored standard preset')
    expect(formatSurface('host-plane:provider+sandbox')).toBe('Provider + sandbox (host-level)')
    expect(compactIdentifier('replay-exp-c04721c-very-long-identifier-b2d')).toBe('replay-exp-c04721…fier-b2d')
  })

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

  it('renders drift as a non-blocking status with frozen and current hashes', () => {
    const drift = { detected: true, frozenHash: 'a'.repeat(64), currentHash: 'b'.repeat(64) }
    const notice = WorkspaceDriftNotice({ drift })
    expect(workspaceDriftNotice(drift)).toMatch(/current workspace state/)
    expect(isValidElement(notice)).toBe(true)
    const element = notice as ReactElement<{ role: string; children: ReactNode }>
    expect(element.props.role).toBe('status')
    expect(JSON.stringify(element.props.children)).toContain('Workspace drift')
    expect(JSON.stringify(element.props.children)).toContain('aaaaaaaaaaaa')
    expect(JSON.stringify(element.props.children)).toContain('bbbbbbbbbbbb')
    expect(workspaceDriftNotice({ ...drift, detected: false })).toBeUndefined()
    expect(WorkspaceDriftNotice({ drift: { ...drift, detected: false } })).toBeNull()
  })
})

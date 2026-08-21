import { describe, expect, it } from 'vitest'
import { compareCallEvidence, extractRawCallEvidence } from '../src/call-evidence.ts'
import type { RunEvidence } from '../src/types.ts'

function toolResult(turn: number, step: number, callId: string, time: number, text: string, isError = false) {
  return {
    type: 'tool/result', time,
    data: {
      turn, step,
      message: {
        source: { kind: 'tool', callId },
        content: [{ type: 'tool-result', toolCallId: callId, isError, content: [{ type: 'text', text }] }],
      },
      ...(isError ? { error: { name: 'FixtureError', code: 'FIXTURE_ERROR' } } : {}),
    },
  }
}

describe('raw call evidence', () => {
  it('retains exact calls/results and derives retries, no-progress spans, and effective-action latency', () => {
    const evidence = extractRawCallEvidence([
      { type: 'turn/start', time: 0, data: { turn: 1 } },
      { type: 'step/start', time: 10, data: { turn: 1, step: 1 } },
      { type: 'tool/call', time: 20, data: { turn: 1, step: 1, callId: 'a', name: 'bash', arguments: '{"cmd":"fixture"}' } },
      toolResult(1, 1, 'a', 30, 'denied', true),
      { type: 'step/end', time: 40, data: { turn: 1, step: 1 } },
      { type: 'step/start', time: 50, data: { turn: 1, step: 2 } },
      { type: 'tool/call', time: 60, data: { turn: 1, step: 2, callId: 'b', name: 'bash', arguments: '{ "cmd": "fixture" }' } },
      toolResult(1, 2, 'b', 70, 'denied again', true),
      { type: 'step/end', time: 80, data: { turn: 1, step: 2 } },
      { type: 'step/start', time: 90, data: { turn: 1, step: 3 } },
      { type: 'tool/call', time: 100, data: { turn: 1, step: 3, callId: 'c', name: 'bash', arguments: '{"cmd":"corrected"}' } },
      toolResult(1, 3, 'c', 120, 'fixture-ok'),
      { type: 'step/end', time: 130, data: { turn: 1, step: 3 } },
      { type: 'turn/end', time: 140, data: { turn: 1, reason: { kind: 'completed' } } },
    ])

    expect(evidence?.calls).toHaveLength(3)
    expect(evidence?.calls[0]?.toolCalls[0]).toMatchObject({
      evidenceId: 'C1.T1', arguments: '{"cmd":"fixture"}', effective: false,
      result: { status: 'error', errorCode: 'FIXTURE_ERROR', contentHash: expect.stringMatching(/^[a-f0-9]{64}$/) },
    })
    expect(evidence?.calls[1]?.toolCalls[0]).toMatchObject({ retryOf: 'C1.T1', effective: false })
    expect(evidence?.calls[2]?.toolCalls[0]).toMatchObject({ effective: true, result: { status: 'success' } })
    expect(evidence?.metrics).toMatchObject({
      toolCallCount: 3,
      toolRetryCount: 1,
      maxProgresslessSpan: 2,
      firstEffectiveActionLatencyMs: 120,
    })
    expect(evidence?.metrics.toolRetryRatePercent).toBeCloseTo(100 / 3)
  })

  it('does not treat an identical successful observation as new progress', () => {
    const evidence = extractRawCallEvidence([
      { type: 'turn/start', time: 0, data: { turn: 1 } },
      { type: 'step/start', time: 1, data: { turn: 1, step: 1 } },
      { type: 'tool/call', time: 2, data: { turn: 1, step: 1, callId: 'a', name: 'read', arguments: '{"path":"x"}' } },
      toolResult(1, 1, 'a', 3, 'same'),
      { type: 'step/end', time: 4, data: { turn: 1, step: 1 } },
      { type: 'step/start', time: 5, data: { turn: 1, step: 2 } },
      { type: 'tool/call', time: 6, data: { turn: 1, step: 2, callId: 'b', name: 'read', arguments: '{"path":"x"}' } },
      toolResult(1, 2, 'b', 7, 'same'),
      { type: 'step/end', time: 8, data: { turn: 1, step: 2 } },
      { type: 'turn/end', time: 9, data: { turn: 1, reason: { kind: 'completed' } } },
    ])
    expect(evidence?.calls.map(call => call.effective)).toEqual([true, false])
    expect(evidence?.metrics.maxProgresslessSpan).toBe(1)
  })
})

describe('call evidence comparison', () => {
  it('emits deterministic cited facts and preserves percentage semantics', () => {
    const makeRun = (sessionId: string, evidenceHash: string, retryCount: number, progressless: number): RunEvidence => ({
      runId: sessionId, sessionId, variantId: sessionId, status: 'completed', requestPhases: ['request'], complete: true,
      eventCount: 1, evidenceHash,
      callEvidence: {
        schemaVersion: 'raw-call-evidence/v1', turn: 1, startedAt: 0, endedAt: 10, calls: [],
        metrics: {
          toolCallCount: 10, toolRetryCount: retryCount, toolRetryRatePercent: retryCount * 10,
          maxProgresslessSpan: progressless, firstEffectiveActionLatencyMs: 10,
        },
      },
    })
    const comparison = compareCallEvidence('fixture', makeRun('a', 'ha', 7, 3), makeRun('b', 'hb', 10, 11))
    expect(comparison?.facts.find(item => item.metric === 'toolRetryCount')).toMatchObject({
      evidenceId: 'F2', baseline: 7, candidate: 10, delta: 3, relativeDeltaPercent: 300 / 7,
    })
    expect(comparison?.facts.find(item => item.metric === 'maxProgresslessSpan')).toMatchObject({ baseline: 3, candidate: 11 })
  })
})

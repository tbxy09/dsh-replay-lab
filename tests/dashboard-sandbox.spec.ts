import { describe, expect, it } from 'vitest'
import { buildDashboardPayload } from '../src/dashboard-payload.ts'
import {
  assembleDashboardDocument, DASHBOARD_CSP, DEFAULT_DASHBOARD_FRAGMENT, jsonForScript,
} from '../src/dashboard-sandbox.ts'
import type { FrozenReplayCase, ReplayExperiment } from '../src/types.ts'

const replayCase: FrozenReplayCase = {
  id: 'fixture', sourceId: 'source', sourceSessionId: 'source-session', sourceTurn: 1,
  createdAt: '2026-08-19T00:00:00.000Z', prompt: 'task', promptHash: 'p', sourceCwd: '/tmp/source', sourceWorkspaceHash: 'w',
  provider: 'deepseek', model: 'v4pro', reasoning: 'high', maxTokens: 4096, presetSurface: 'standard', systemHash: 's', toolSchemaHash: 't',
}

const experiment: ReplayExperiment = {
  id: 'exp', caseId: 'fixture', baselineMode: 'observed-current-session', candidateVariantId: 'standard',
  status: 'completed', createdAt: replayCase.createdAt, updatedAt: replayCase.createdAt,
  baseline: {
    runId: 'baseline', sessionId: 'baseline', variantId: 'observed', status: 'completed',
    requestPhases: ['observed'], requestSurfaces: [{
      phase: 'observed', provider: 'deepseek', model: 'v4pro', systemHash: 's', toolSchemaHash: 't',
      toolNames: ['bash', 'read'],
    }],
    metrics: { freshInputTokens: 10, outputTokens: 4, cacheReadTokens: 0, durationMs: 20, stepCount: 2, toolCalls: 1 },
    complete: true, eventCount: 3, evidenceHash: 'b',
  },
  candidate: {
    runId: 'candidate', sessionId: 'candidate', variantId: 'standard', status: 'completed',
    requestPhases: ['request'], requestSurfaces: [{
      phase: 'request', provider: 'deepseek', model: 'v4pro', systemHash: 's', toolSchemaHash: 't',
      toolNames: ['bash'],
    }],
    metrics: { freshInputTokens: 12, outputTokens: 3, cacheReadTokens: 0, durationMs: 30, stepCount: 2, toolCalls: 2 },
    complete: true, eventCount: 4, evidenceHash: 'c',
  },
  scorecard: {
    baselineSessionId: 'baseline', candidateSessionId: 'candidate',
    rows: [{ key: 'freshInputTokens', label: 'Fresh input tokens', baseline: 10, candidate: 12, delta: 2 }],
  },
}

describe('sandboxed evidence dashboard', () => {
  it('builds a host-owned payload without raw tool arguments', () => {
    const payload = buildDashboardPayload(replayCase, experiment)
    expect(payload).toMatchObject({
      schemaVersion: 'replay-dashboard-payload/v1',
      fixtureId: 'fixture',
      turn: 1,
      variantId: 'standard',
      activeRunId: 'exp',
      baseline: { id: 'observed-source-session-1', kind: 'baseline', tools: ['bash', 'read'], systemHashes: ['s'], toolSchemaHashes: ['t'], metrics: { freshInputTokens: 10 } },
      candidate: { id: 'exp', kind: 'candidate', tools: ['bash'], systemHashes: ['s'], toolSchemaHashes: ['t'], metrics: { freshInputTokens: 12 } },
      runs: [
        { id: 'observed-source-session-1', kind: 'baseline' },
        { id: 'exp', kind: 'candidate' },
      ],
    })
    expect(JSON.stringify(payload)).not.toContain('arguments')
  })

  it('injects the payload into a null-capability document and keeps the host default renderable', () => {
    const payload = buildDashboardPayload(replayCase, experiment)
    const document = assembleDashboardDocument(payload, DEFAULT_DASHBOARD_FRAGMENT)
    expect(document).toContain("default-src 'none'")
    expect(document).toContain('window.__EVIDENCE__')
  })

  it('does not regex-validate model HTML/CSS/JS before placing it inside the sandbox document', () => {
    const fragment = '<style>.chart{position:absolute;top:0}</style><script>window.__EVIDENCE__</script>'
    const document = assembleDashboardDocument(buildDashboardPayload(replayCase, experiment), fragment)
    expect(document).toContain(fragment)
    expect(DASHBOARD_CSP).toContain("connect-src 'none'")
    expect(DASHBOARD_CSP).toContain("object-src 'none'")
  })

  it('escapes HTML in the injected JSON script', () => {
    expect(jsonForScript({ note: '</script><img src=x>' })).toContain('\\u003c/script\\u003e')
  })

  it('keeps every retained candidate in one payload and highlights the displayed run', () => {
    const other: ReplayExperiment = { ...experiment, id: 'exp-2', candidateVariantId: 'anchored' }
    const payload = buildDashboardPayload(replayCase, experiment, {
      history: [
        { sourceSessionId: 'source-session', sourceTurn: 1, replayCase, experiment },
        { sourceSessionId: 'source-session', sourceTurn: 1, replayCase, experiment: other },
      ],
    })
    expect(payload.activeRunId).toBe('exp')
    expect(payload.runs.map(run => run.id)).toEqual(['observed-source-session-1', 'exp', 'exp-2'])
    const document = assembleDashboardDocument(payload, DEFAULT_DASHBOARD_FRAGMENT)
    expect(document).toContain('activeRunId')
    expect(document).toContain('exp-2')
  })
})

import { describe, expect, it } from 'vitest'
import { ReasoningEffortId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import {
  DirectRuntimeEvidenceSummarizer, EVIDENCE_DASHBOARD_REPAIR_SYSTEM_PROMPT,
  EVIDENCE_DASHBOARD_SYSTEM_PROMPT, parseDashboardResponse, RAW_EVIDENCE_SUMMARY_SYSTEM_PROMPT,
} from '../src/evidence-summary.ts'
import type { CallEvidenceComparison, FrozenReplayCase, RunEvidence } from '../src/types.ts'

const replayCase: FrozenReplayCase = {
  id: 'fixture', sourceId: 'source', sourceSessionId: 'source-session', sourceTurn: 1,
  createdAt: '2026-08-19T00:00:00.000Z', prompt: 'task', promptHash: 'p', sourceCwd: '/tmp/source', sourceWorkspaceHash: 'w',
  provider: 'deepseek', model: 'v4pro', reasoning: 'high', maxTokens: 4096, presetSurface: 'standard', systemHash: 's', toolSchemaHash: 't',
}

const callEvidence = {
  schemaVersion: 'raw-call-evidence/v1' as const,
  turn: 1, startedAt: 0, endedAt: 100, calls: [],
  metrics: { toolCallCount: 10, toolRetryCount: 7, toolRetryRatePercent: 70, maxProgresslessSpan: 3, firstEffectiveActionLatencyMs: 10 },
}

const baseline: RunEvidence = {
  runId: 'baseline', sessionId: 'baseline', variantId: 'observed', status: 'completed', requestPhases: ['observed'],
  complete: true, eventCount: 1, evidenceHash: 'baseline-hash', callEvidence,
}

const candidate: RunEvidence = {
  ...baseline, runId: 'candidate', sessionId: 'candidate', variantId: 'standard', evidenceHash: 'candidate-hash',
  callEvidence: { ...callEvidence, metrics: { ...callEvidence.metrics, toolRetryCount: 10, maxProgresslessSpan: 11 } },
}

const comparison: CallEvidenceComparison = {
  schemaVersion: 'call-evidence-comparison/v1', fixtureId: 'fixture', baselineEvidenceHash: 'baseline-hash', candidateEvidenceHash: 'candidate-hash',
  definitions: {
    retry: 'a tool call after the first call with the same normalized name and arguments',
    effective: 'a successful tool result whose normalized call and result pair has not already occurred',
    progresslessSpan: 'consecutive model calls with no effective tool result',
  },
  facts: [{ evidenceId: 'F1', metric: 'toolRetryCount', unit: 'count', baseline: 7, candidate: 10, delta: 3, relativeDeltaPercent: 300 / 7 }],
}

describe('direct runtime evidence summary', () => {
  it('makes one model-runtime call with raw evidence and accepts cited Chinese prose', async () => {
    const seen: GenerateOptions[] = []
    const runtime = {
      async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        seen.push(options)
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: '在相同 fixture 下，tool retry 从 7 次增至 10 次（+42.9%）[F1]。' }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: '在相同 fixture 下，tool retry 从 7 次增至 10 次（+42.9%）[F1]。' } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    }
    const result = await new DirectRuntimeEvidenceSummarizer(runtime).summarize({ replayCase, baseline, candidate, comparison })
    expect(result).toMatchObject({
      status: 'completed', provider: 'deepseek-official', model: 'deepseek-v4-pro', citedEvidenceIds: ['F1'],
    })
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({
      provider: 'deepseek-official', model: 'deepseek-v4-pro',
      system: RAW_EVIDENCE_SUMMARY_SYSTEM_PROMPT, maxTokens: 4_096,
    })
    expect(seen[0]?.reasoningEffort).toBe(ReasoningEffortId('off'))
    expect(seen[0]?.tools).toBeUndefined()
    expect(JSON.stringify(seen[0]?.messages)).toContain('<raw_evidence>')
    expect(JSON.stringify(seen[0]?.messages)).toContain('<derived_facts>')
  })

  it('fails closed when the model supplies prose without an evidence citation', async () => {
    const runtime = {
      async * stream(): AsyncIterable<StreamChunk> {
        yield { type: 'block-end', index: 0, block: { type: 'text', text: '看起来更差。' } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    }
    await expect(new DirectRuntimeEvidenceSummarizer(runtime).summarize({ replayCase, baseline, candidate, comparison }))
      .resolves.toMatchObject({ status: 'failed', error: 'summary cited no supplied evidence facts' })
  })

  it('refuses oversized raw evidence instead of silently truncating it', async () => {
    let called = false
    const runtime = {
      async * stream(): AsyncIterable<StreamChunk> {
        called = true
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    }
    await expect(new DirectRuntimeEvidenceSummarizer(runtime, 10).summarize({ replayCase, baseline, candidate, comparison }))
      .resolves.toMatchObject({ status: 'failed', error: 'model-bound evidence exceeds 10 characters' })
    expect(called).toBe(false)
  })

  it('accepts only the final text block XML envelope and disables reasoning when the route advertises off', async () => {
    const { buildDashboardPayload } = await import('../src/dashboard-payload.ts')
    const payload = buildDashboardPayload(replayCase, {
      id: 'exp', caseId: replayCase.id, baselineMode: 'observed-current-session', candidateVariantId: 'standard',
      status: 'completed', createdAt: replayCase.createdAt, updatedAt: replayCase.createdAt, baseline, candidate, callEvidenceComparison: comparison,
    })
    const seen: GenerateOptions[] = []
    const runtime = {
      async resolveModelInfo() {
        return {
          provider: 'deepseek', id: 'v4pro', name: 'v4pro',
          reasoning: { efforts: [{ id: ReasoningEffortId('off'), name: 'Off' }] },
        }
      },
      async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        seen.push(options)
        yield { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'Do not use this as output.' } }
        yield { type: 'block-end', index: 1, block: { type: 'text', text: 'discard this earlier text block' } }
        yield { type: 'block-end', index: 2, block: { type: 'text', text: '<dashboard_response><status>success</status><fragment><![CDATA[<div id="root"></div><script>document.getElementById("root").textContent=String(window.__EVIDENCE__.turn)</script>]]></fragment></dashboard_response>' } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    }
    const editablePrompt = 'Plot every run and use a compact legend chosen by the user.'
    const result = await new DirectRuntimeEvidenceSummarizer(runtime).renderDashboard({
      replayCase, payload, promptId: 'delta-callouts', prompt: editablePrompt,
    })
    expect(result).toMatchObject({
      status: 'completed', promptVersion: 'evidence-dashboard-html/v2',
      promptId: 'delta-callouts', prompt: editablePrompt,
      provider: 'deepseek-official', model: 'deepseek-v4-pro',
    })
    expect(result.fragment).toContain('window.__EVIDENCE__')
    expect(seen[0]?.provider).toBe('deepseek-official')
    expect(seen[0]?.model).toBe('deepseek-v4-pro')
    expect(seen[0]?.system).toBe(EVIDENCE_DASHBOARD_SYSTEM_PROMPT)
    expect(seen[0]?.reasoningEffort).toBe(ReasoningEffortId('off'))
    expect(seen[0]?.tools).toBeUndefined()
    expect(JSON.stringify(seen[0]?.messages)).toContain('<visualization_prompt>')
    expect(JSON.stringify(seen[0]?.messages)).toContain(editablePrompt)
  })

  it('performs one contract repair retry for malformed XML output', async () => {
    const { buildDashboardPayload } = await import('../src/dashboard-payload.ts')
    const payload = buildDashboardPayload(replayCase, {
      id: 'exp', caseId: replayCase.id, baselineMode: 'observed-current-session', candidateVariantId: 'standard',
      status: 'completed', createdAt: replayCase.createdAt, updatedAt: replayCase.createdAt, baseline, candidate,
    })
    const seen: GenerateOptions[] = []
    const runtime = {
      async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        seen.push(options)
        const text = seen.length === 1
          ? '<div id="chart">not wrapped in XML</div>'
          : '<dashboard_response><status>success</status><fragment><![CDATA[<div id="chart"></div><script>document.getElementById("chart").textContent=String(window.__EVIDENCE__.turn)</script>]]></fragment></dashboard_response>'
        yield { type: 'block-end', index: 0, block: { type: 'text', text } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    }
    await expect(new DirectRuntimeEvidenceSummarizer(runtime).renderDashboard({ replayCase, payload }))
      .resolves.toMatchObject({ status: 'completed', promptVersion: 'evidence-dashboard-html/v2' })
    expect(seen).toHaveLength(2)
    expect(seen[0]?.model).toBe('deepseek-v4-pro')
    expect(seen[0]?.reasoningEffort).toBe(ReasoningEffortId('off'))
    expect(seen[1]?.system).toBe(EVIDENCE_DASHBOARD_REPAIR_SYSTEM_PROMPT)
    expect(JSON.stringify(seen[1]?.messages)).toContain('not a valid dashboard_response XML envelope')
  })

  it('preserves an explicit model failure and does not mislabel it as success', async () => {
    const { buildDashboardPayload } = await import('../src/dashboard-payload.ts')
    const payload = buildDashboardPayload(replayCase, {
      id: 'exp', caseId: replayCase.id, baselineMode: 'observed-current-session', candidateVariantId: 'standard',
      status: 'completed', createdAt: replayCase.createdAt, updatedAt: replayCase.createdAt, baseline, candidate,
    })
    let calls = 0
    const runtime = {
      async * stream(): AsyncIterable<StreamChunk> {
        calls += 1
        yield { type: 'block-end', index: 0, block: { type: 'text', text: '<dashboard_response><status>failure</status><error_code>INSUFFICIENT_EVIDENCE</error_code><message>missing metric series</message></dashboard_response>' } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    }
    await expect(new DirectRuntimeEvidenceSummarizer(runtime).renderDashboard({ replayCase, payload }))
      .resolves.toMatchObject({ status: 'failed', error: 'INSUFFICIENT_EVIDENCE: missing metric series' })
    expect(calls).toBe(1)
  })

  it('fails after exactly one repair attempt when both envelopes are invalid', async () => {
    const { buildDashboardPayload } = await import('../src/dashboard-payload.ts')
    const payload = buildDashboardPayload(replayCase, {
      id: 'exp', caseId: replayCase.id, baselineMode: 'observed-current-session', candidateVariantId: 'standard',
      status: 'completed', createdAt: replayCase.createdAt, updatedAt: replayCase.createdAt, baseline, candidate,
    })
    let calls = 0
    const runtime = {
      async * stream(): AsyncIterable<StreamChunk> {
        calls += 1
        yield { type: 'block-end', index: 0, block: { type: 'text', text: calls === 1 ? '' : '<div>still not XML</div>' } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    }
    await expect(new DirectRuntimeEvidenceSummarizer(runtime).renderDashboard({ replayCase, payload }))
      .resolves.toMatchObject({ status: 'failed', error: expect.stringMatching(/contract repair failed/) })
    expect(calls).toBe(2)
  })

  it('strictly rejects extra prose, empty fragments, and malformed failure envelopes', () => {
    expect(() => parseDashboardResponse('before <dashboard_response><status>failure</status><error_code>NO_DATA</error_code><message>x</message></dashboard_response>'))
      .toThrow(/not a valid/)
    expect(() => parseDashboardResponse('<dashboard_response><status>success</status><fragment><![CDATA[ ]]></fragment></dashboard_response>'))
      .toThrow(/empty/)
    expect(() => parseDashboardResponse('<dashboard_response><status>failure</status><message>x</message></dashboard_response>'))
      .toThrow(/not a valid/)
  })
})

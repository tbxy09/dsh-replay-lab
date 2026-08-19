import { describe, expect, it } from 'vitest'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { DirectRuntimeEvidenceSummarizer, RAW_EVIDENCE_SUMMARY_SYSTEM_PROMPT } from '../src/evidence-summary.ts'
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
    expect(result).toMatchObject({ status: 'completed', provider: 'deepseek', model: 'v4pro', citedEvidenceIds: ['F1'] })
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({
      provider: 'deepseek', model: 'v4pro',
      system: RAW_EVIDENCE_SUMMARY_SYSTEM_PROMPT, maxTokens: 4_096,
    })
    expect(seen[0]?.reasoningEffort).toBeUndefined()
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
})

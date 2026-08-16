import { sha256, canonicalJson } from './hash.ts'
import type { MetricsExtractor, Oracle } from './registries.ts'
import type { RunEvidence, RunMetrics, Scorecard, ScorecardRow } from './types.ts'

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function number(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

export class SessionMetricsExtractor implements MetricsExtractor {
  readonly id = 'session-events-v1'

  extract(events: readonly unknown[]): RunMetrics | undefined {
    const records = events.filter((event): event is Record<string, unknown> => event !== null && typeof event === 'object')
    const types = records.map(event => event.type)
    if (!types.includes('turn/end')) return undefined
    const usages = records
      .filter(event => event.type === 'assistant/message')
      .map(event => record(record(event.data).usage))
    const sumUsage = (key: string): number => usages.reduce((total, usage) => total + number(usage[key]), 0)
    const started = records.find(event => event.type === 'turn/start')?.time
    const ended = [...records].reverse().find(event => event.type === 'turn/end')?.time
    return {
      freshInputTokens: sumUsage('inputTokens'),
      outputTokens: sumUsage('outputTokens'),
      cacheReadTokens: sumUsage('cacheReadTokens'),
      durationMs: typeof started === 'number' && typeof ended === 'number' ? Math.max(0, ended - started) : 0,
      stepCount: types.filter(type => type === 'step/start').length,
      toolCalls: types.filter(type => type === 'tool/call').length,
    }
  }
}

const labels: Record<keyof RunMetrics, string> = {
  freshInputTokens: 'Fresh 输入',
  outputTokens: '输出',
  cacheReadTokens: '缓存命中',
  durationMs: '耗时',
  stepCount: '步骤数',
  toolCalls: '工具调用',
}

export class IndependentEvidenceOracle implements Oracle {
  readonly id = 'independent-evidence-v1'

  score(baseline: RunEvidence | undefined, candidate: RunEvidence | undefined): Scorecard | undefined {
    if (baseline?.complete !== true || baseline.metrics === undefined) return undefined
    if (candidate?.complete !== true || candidate.metrics === undefined) return undefined
    if (baseline.sessionId === candidate.sessionId || baseline.evidenceHash === candidate.evidenceHash) return undefined
    const rows = (Object.keys(labels) as Array<keyof RunMetrics>).map((key): ScorecardRow => ({
      key,
      label: labels[key],
      baseline: baseline.metrics![key],
      candidate: candidate.metrics![key],
      delta: candidate.metrics![key] - baseline.metrics![key],
    }))
    return { baselineSessionId: baseline.sessionId, candidateSessionId: candidate.sessionId, rows }
  }
}

export function evidenceDigest(sessionId: string, events: readonly unknown[]): string {
  return sha256(canonicalJson({ sessionId, events }))
}

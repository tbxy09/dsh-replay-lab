import { canonicalJson, sha256 } from './hash.ts'
import type {
  CallEvidenceComparison, EvidenceFact, EvidenceFactMetric, ModelCallEvidence,
  RawCallEvidence, RunEvidence, ToolCallEvidence,
} from './types.ts'

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function integer(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : undefined
}

function normalizedArguments(value: string): string {
  try { return canonicalJson(JSON.parse(value) as unknown) } catch { return value.trim() }
}

function normalizedResultContent(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizedResultContent)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => key !== 'callId' && key !== 'toolCallId')
    .map(([key, child]) => [key, normalizedResultContent(child)]))
}

function resultError(data: Record<string, unknown>): { status: 'success' | 'error'; errorCode?: string } {
  const error = object(data.error)
  const message = object(data.message)
  const content = Array.isArray(message.content) ? message.content : []
  const failed = typeof error.code === 'string' || content.some(block => object(block).isError === true)
  return {
    status: failed ? 'error' : 'success',
    ...(typeof error.code === 'string' && error.code.length > 0 ? { errorCode: error.code } : {}),
  }
}

function visibleChunk(chunk: Record<string, unknown>): boolean {
  if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') {
    return typeof chunk.text === 'string' && chunk.text.length > 0
  }
  return chunk.type === 'tool-call-delta'
    && ((typeof chunk.name === 'string' && chunk.name.length > 0)
      || (typeof chunk.argumentsDelta === 'string' && chunk.argumentsDelta.length > 0))
}

interface MutableToolCall {
  evidenceId: string
  callId: string
  name: string
  calledAt: number
  arguments: string
  normalizedCallHash: string
  retryOf?: string
  result?: ToolCallEvidence['result']
  effective: boolean
}

interface MutableModelCall {
  evidenceId: string
  turn: number
  step: number
  startedAt: number
  finishedAt?: number
  firstOutputAt?: number
  assistantContent?: unknown
  toolCalls: MutableToolCall[]
  effective: boolean
}

/**
 * Project one finalized turn into exact call-level evidence. Tool arguments and
 * model-facing result blocks are retained verbatim and must be treated as
 * untrusted, potentially sensitive data by every downstream consumer.
 */
export function extractRawCallEvidence(events: readonly unknown[], requestedTurn?: number): RawCallEvidence | undefined {
  const records = events.filter((event): event is Record<string, unknown> => event !== null && typeof event === 'object')
  const endRecords = records.filter(event => event.type === 'turn/end')
  const selectedEnd = requestedTurn === undefined
    ? endRecords.at(-1)
    : [...endRecords].reverse().find(event => integer(object(event.data).turn) === requestedTurn)
  const turn = integer(object(selectedEnd?.data).turn)
  const endedAt = finite(selectedEnd?.time)
  if (turn === undefined || endedAt === undefined) return undefined

  const selected = records.filter(event => {
    const data = object(event.data)
    return integer(data.turn) === turn || (event.type === 'turn/start' && integer(data.turn) === turn)
  })
  const start = selected.find(event => event.type === 'turn/start')
  const startedAt = finite(start?.time)
  if (startedAt === undefined) return undefined

  const calls = new Map<number, MutableModelCall>()
  const toolCalls = new Map<string, MutableToolCall>()
  const firstBySignature = new Map<string, string>()

  const ensureCall = (step: number, at: number): MutableModelCall => {
    const existing = calls.get(step)
    if (existing !== undefined) return existing
    const call: MutableModelCall = {
      evidenceId: `C${calls.size + 1}`, turn, step, startedAt: at, toolCalls: [], effective: false,
    }
    calls.set(step, call)
    return call
  }

  for (const event of selected) {
    const data = object(event.data)
    const step = integer(data.step)
    const at = finite(event.time)
    if (event.type === 'step/start' && step !== undefined && at !== undefined) {
      ensureCall(step, at)
      continue
    }
    if (step === undefined || at === undefined) continue
    const call = ensureCall(step, at)
    if (event.type === 'assistant/chunk' && call.firstOutputAt === undefined && visibleChunk(object(data.chunk))) {
      call.firstOutputAt = at
    }
    if (event.type === 'assistant/message') {
      call.assistantContent = object(data.message).content ?? null
    }
    if (event.type === 'tool/call') {
      const callId = typeof data.callId === 'string' ? data.callId : ''
      const name = typeof data.name === 'string' ? data.name : ''
      const argumentsValue = typeof data.arguments === 'string' ? data.arguments : ''
      if (callId.length === 0 || name.length === 0) continue
      const normalizedCallHash = sha256(canonicalJson({ name, arguments: normalizedArguments(argumentsValue) }))
      const first = firstBySignature.get(normalizedCallHash)
      const tool: MutableToolCall = {
        evidenceId: `${call.evidenceId}.T${call.toolCalls.length + 1}`,
        callId, name, calledAt: at, arguments: argumentsValue, normalizedCallHash,
        ...(first === undefined ? {} : { retryOf: first }), effective: false,
      }
      if (first === undefined) firstBySignature.set(normalizedCallHash, tool.evidenceId)
      call.toolCalls.push(tool)
      toolCalls.set(callId, tool)
    }
    if (event.type === 'tool/result') {
      const message = object(data.message)
      const callId = typeof object(message.source).callId === 'string' ? String(object(message.source).callId) : ''
      const tool = toolCalls.get(callId)
      if (tool === undefined) continue
      const content = Array.isArray(message.content) ? message.content : []
      const outcome = resultError(data)
      tool.result = {
        completedAt: at,
        durationMs: Math.max(0, at - tool.calledAt),
        ...outcome,
        content,
        contentHash: sha256(canonicalJson(content)),
      }
    }
    if (event.type === 'step/end') call.finishedAt = at
  }

  const successfulPairs = new Set<string>()
  const ordered = [...calls.values()].sort((left, right) => left.step - right.step)
  for (const call of ordered) {
    for (const tool of call.toolCalls) {
      if (tool.result?.status !== 'success') continue
      const semanticResultHash = sha256(canonicalJson(normalizedResultContent(tool.result.content)))
      const pair = `${tool.normalizedCallHash}:${semanticResultHash}`
      if (!successfulPairs.has(pair)) {
        successfulPairs.add(pair)
        tool.effective = true
        call.effective = true
      }
    }
  }

  const flattened = ordered.flatMap(call => call.toolCalls)
  const retryCount = flattened.filter(call => call.retryOf !== undefined).length
  let maxProgresslessSpan = 0
  let currentProgresslessSpan = 0
  for (const call of ordered) {
    currentProgresslessSpan = call.effective ? 0 : currentProgresslessSpan + 1
    maxProgresslessSpan = Math.max(maxProgresslessSpan, currentProgresslessSpan)
  }
  const firstEffective = flattened
    .filter(call => call.effective && call.result !== undefined)
    .map(call => call.result!.completedAt)
    .sort((left, right) => left - right)[0]

  return Object.freeze({
    schemaVersion: 'raw-call-evidence/v1',
    turn,
    startedAt,
    endedAt,
    calls: Object.freeze(ordered.map(call => Object.freeze({
      ...call,
      toolCalls: Object.freeze(call.toolCalls.map(tool => Object.freeze({
        ...tool,
        ...(tool.result === undefined ? {} : { result: Object.freeze(tool.result) }),
      }))),
    } as ModelCallEvidence))),
    metrics: Object.freeze({
      toolCallCount: flattened.length,
      toolRetryCount: retryCount,
      toolRetryRatePercent: flattened.length === 0 ? 0 : (retryCount / flattened.length) * 100,
      maxProgresslessSpan,
      firstEffectiveActionLatencyMs: firstEffective === undefined ? null : Math.max(0, firstEffective - startedAt),
    }),
  })
}

const metricUnits: Record<EvidenceFactMetric, EvidenceFact['unit']> = {
  toolCallCount: 'count',
  toolRetryCount: 'count',
  toolRetryRatePercent: 'percent',
  maxProgresslessSpan: 'count',
  firstEffectiveActionLatencyMs: 'milliseconds',
}

function fact(id: string, metric: EvidenceFactMetric, baseline: number, candidate: number): EvidenceFact {
  return {
    evidenceId: id,
    metric,
    unit: metricUnits[metric],
    baseline,
    candidate,
    delta: candidate - baseline,
    relativeDeltaPercent: baseline === 0 ? null : ((candidate - baseline) / baseline) * 100,
  }
}

/** Build model-ready facts without asking a model to calculate or classify behavior. */
export function compareCallEvidence(
  fixtureId: string,
  baseline: RunEvidence,
  candidate: RunEvidence,
): CallEvidenceComparison | undefined {
  const left = baseline.callEvidence
  const right = candidate.callEvidence
  if (left === undefined || right === undefined || baseline.evidenceHash === undefined || candidate.evidenceHash === undefined) return undefined
  const facts: EvidenceFact[] = []
  const append = (metric: EvidenceFactMetric, baselineValue: number, candidateValue: number): void => {
    facts.push(fact(`F${facts.length + 1}`, metric, baselineValue, candidateValue))
  }
  append('toolCallCount', left.metrics.toolCallCount, right.metrics.toolCallCount)
  append('toolRetryCount', left.metrics.toolRetryCount, right.metrics.toolRetryCount)
  append('toolRetryRatePercent', left.metrics.toolRetryRatePercent, right.metrics.toolRetryRatePercent)
  append('maxProgresslessSpan', left.metrics.maxProgresslessSpan, right.metrics.maxProgresslessSpan)
  if (left.metrics.firstEffectiveActionLatencyMs !== null && right.metrics.firstEffectiveActionLatencyMs !== null) {
    append('firstEffectiveActionLatencyMs', left.metrics.firstEffectiveActionLatencyMs, right.metrics.firstEffectiveActionLatencyMs)
  }
  return Object.freeze({
    schemaVersion: 'call-evidence-comparison/v1',
    fixtureId,
    baselineEvidenceHash: baseline.evidenceHash,
    candidateEvidenceHash: candidate.evidenceHash,
    definitions: Object.freeze({
      retry: 'a tool call after the first call with the same normalized name and arguments',
      effective: 'a successful tool result whose normalized call and result pair has not already occurred',
      progresslessSpan: 'consecutive model calls with no effective tool result',
    }),
    facts: Object.freeze(facts),
  })
}

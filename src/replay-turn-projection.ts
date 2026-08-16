import { z } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { canonicalJson, sha256 } from './hash.ts'
import type { ReplayableTurnRecord, ReplayTurnsProjection, RunMetrics } from './types.ts'

interface RequestEvidence {
  provider: string | null
  model: string | null
  reasoning: string | null
  maxTokens: number | null
  systemHash: string
  toolSchemaHash: string
}

interface OpenTurn {
  turn: number
  startedAt: number
  promptParts: string[]
  freshInputTokens: number
  outputTokens: number
  cacheReadTokens: number
  stepCount: number
  toolCalls: number
  eventCount: number
  outputEvidence: string[]
}

interface ReplayTurnsState {
  presetSurface: string | null
  request: RequestEvidence | null
  openTurn: OpenTurn | null
  turns: ReplayableTurnRecord[]
}

const nullableString = z.string().min(1).nullable()
const metricsSchema = z.object({
  freshInputTokens: z.number().nonnegative(), outputTokens: z.number().nonnegative(),
  cacheReadTokens: z.number().nonnegative(), durationMs: z.number().nonnegative(),
  stepCount: z.number().int().nonnegative(), toolCalls: z.number().int().nonnegative(),
}).strict()
const recordSchema = z.object({
  turn: z.number().int().positive(), prompt: nullableString, provider: nullableString,
  model: nullableString, reasoning: nullableString, maxTokens: z.number().int().positive().nullable(),
  presetSurface: nullableString, systemHash: nullableString, toolSchemaHash: nullableString,
  evidenceHash: nullableString, missingFields: z.array(z.string()), replayable: z.boolean(),
  metrics: metricsSchema.nullable(), eventCount: z.number().int().nonnegative(),
  stepCount: z.number().int().nonnegative(), completedAt: z.number().nonnegative(), endReason: z.string().min(1),
}).strict()
const projectionSchema = z.object({ turns: z.array(recordSchema) }).strict()

function finite(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

function textOfUser(event: Extract<SessionEvent, { type: 'user/message' }>): string | null {
  if (event.data.source.kind !== 'user') return null
  const text = event.data.content
    .filter((block): block is Extract<(typeof event.data.content)[number], { type: 'text' }> => block.type === 'text')
    .map(block => block.text).join('\n').trim()
  return text.length === 0 ? null : text
}

function requestEvidence(event: Extract<SessionEvent, { type: 'request/header' }>): RequestEvidence {
  const { header } = event.data
  return {
    provider: header.config.provider || null,
    model: header.config.model || null,
    reasoning: header.config.reasoningEffort ?? null,
    maxTokens: Number.isSafeInteger(header.config.maxTokens) && (header.config.maxTokens ?? 0) > 0
      ? header.config.maxTokens ?? null : null,
    systemHash: sha256(canonicalJson(header.system ?? null)),
    toolSchemaHash: sha256(canonicalJson(header.tools ?? [])),
  }
}

function observe(state: ReplayTurnsState, event: SessionEvent): ReplayTurnsState {
  const open = state.openTurn
  if (open === null || event.type === 'turn/start') return state
  let next: OpenTurn = { ...open, eventCount: open.eventCount + 1 }
  if (event.type === 'step/start' && event.data.turn === open.turn) next.stepCount += 1
  if (event.type === 'tool/call' && event.data.turn === open.turn) {
    next.toolCalls += 1
    next.outputEvidence = [...next.outputEvidence, sha256(canonicalJson(event.data))]
  }
  if (event.type === 'tool/result' && event.data.turn === open.turn) {
    next.outputEvidence = [...next.outputEvidence, sha256(canonicalJson(event.data))]
  }
  if (event.type === 'assistant/message' && event.data.turn === open.turn) {
    next.freshInputTokens += finite(event.data.usage?.inputTokens)
    next.outputTokens += finite(event.data.usage?.outputTokens)
    next.cacheReadTokens += finite(event.data.usage?.cacheReadTokens)
    next.outputEvidence = [...next.outputEvidence, sha256(canonicalJson(event.data))]
  }
  return { ...state, openTurn: next }
}

function finalized(state: ReplayTurnsState, event: Extract<SessionEvent, { type: 'turn/end' }>): ReplayableTurnRecord {
  const open = state.openTurn?.turn === event.data.turn ? state.openTurn : null
  const prompt = open === null ? null : open.promptParts.join('\n\n').trim() || null
  const request = state.request
  const metrics: RunMetrics | null = open === null ? null : {
    freshInputTokens: open.freshInputTokens, outputTokens: open.outputTokens,
    cacheReadTokens: open.cacheReadTokens, durationMs: Math.max(0, event.time - open.startedAt),
    stepCount: open.stepCount, toolCalls: open.toolCalls,
  }
  const missingFields: string[] = []
  if (prompt === null) missingFields.push('original user prompt')
  if (request?.provider == null) missingFields.push('provider')
  if (request?.model == null) missingFields.push('model')
  if (request?.reasoning == null) missingFields.push('reasoning')
  if (request?.maxTokens == null) missingFields.push('maxTokens')
  if (request === null) missingFields.push('request header')
  if (metrics === null) missingFields.push('observed turn metrics')

  const facts = missingFields.length === 0 && prompt !== null && request !== null && metrics !== null
    ? { prompt, provider: request.provider, model: request.model, reasoning: request.reasoning,
        maxTokens: request.maxTokens, systemHash: request.systemHash, toolSchemaHash: request.toolSchemaHash,
        metrics, outputEvidence: open?.outputEvidence ?? [], endReason: event.data.reason.kind }
    : null
  return {
    turn: event.data.turn, prompt, provider: request?.provider ?? null, model: request?.model ?? null,
    reasoning: request?.reasoning ?? null, maxTokens: request?.maxTokens ?? null,
    presetSurface: state.presetSurface, systemHash: request?.systemHash ?? null,
    toolSchemaHash: request?.toolSchemaHash ?? null,
    evidenceHash: facts === null ? null : sha256(canonicalJson(facts)), missingFields,
    replayable: facts !== null, metrics, eventCount: open?.eventCount ?? 0,
    stepCount: metrics?.stepCount ?? 0, completedAt: event.time, endReason: event.data.reason.kind,
  }
}

/** Native whole-log projection serving live updates and cache-backed historical backfill. */
export const replayTurnsProjectionDefinition: ProjectionDefinition<'replayLabTurns', ReplayTurnsState> = {
  key: 'replayLabTurns', schema: projectionSchema, stateVersion: 2,
  init: () => ({ presetSurface: null, request: null, openTurn: null, turns: [] }),
  apply: (prior, event) => {
    const state = observe(prior, event)
    switch (event.type) {
      case 'agent-preset/selected': return { ...state, presetSurface: event.data.agentPreset }
      case 'request/header': return { ...state, request: requestEvidence(event) }
      case 'turn/start': return { ...state, openTurn: {
        turn: event.data.turn, startedAt: event.time, promptParts: [], freshInputTokens: 0,
        outputTokens: 0, cacheReadTokens: 0, stepCount: 0, toolCalls: 0, eventCount: 1, outputEvidence: [],
      } }
      case 'user/message': {
        if (state.openTurn === null) return state
        const text = textOfUser(event)
        return text === null ? state : { ...state, openTurn: {
          ...state.openTurn, promptParts: [...state.openTurn.promptParts, text],
        } }
      }
      case 'turn/end': {
        const record = finalized(state, event)
        const priorIndex = state.turns.findIndex(turn => turn.turn === record.turn)
        const turns = priorIndex < 0 ? [...state.turns, record]
          : state.turns.map((turn, index) => index === priorIndex ? record : turn)
        return { ...state, openTurn: null, turns }
      }
      default: return state
    }
  },
  view: (state): ReplayTurnsProjection => ({ turns: state.turns }),
}

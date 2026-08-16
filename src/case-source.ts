import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { CaseSource } from './registries.ts'
import { canonicalJson, hashDirectory, sha256 } from './hash.ts'
import type { FrozenReplayCase, HistoryTurnSource, ReplayableTurnRecord } from './types.ts'

function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  if (typeof value !== 'string' || value.length === 0) throw new Error(`history source 缺少 ${key}`)
  return value
}

function validateSource(value: unknown): HistoryTurnSource {
  if (value === null || typeof value !== 'object') throw new Error('history source 必须是对象')
  const row = value as Record<string, unknown>
  const kind = requireString(row, 'kind')
  if (kind !== 'history' && kind !== 'bookmark') throw new Error('history source kind 无效')
  for (const key of ['id', 'sessionId', 'prompt', 'provider', 'model', 'reasoning', 'presetSurface', 'systemHash', 'toolSchemaHash']) {
    requireString(row, key)
  }
  if (!Number.isSafeInteger(row.turn) || Number(row.turn) < 1) throw new Error('history source turn 无效')
  if (!Number.isSafeInteger(row.maxTokens) || Number(row.maxTokens) < 1) throw new Error('history source maxTokens 无效')
  return row as unknown as HistoryTurnSource
}

export function buildCase(
  source: { id: string; sessionId: string; turn: number; prompt: string; provider: string; model: string; reasoning: string; maxTokens: number; presetSurface: string; systemHash: string; toolSchemaHash: string },
  sourceCwd: string,
  sourceWorkspaceHash: string,
): FrozenReplayCase {
  const body = `${source.sessionId}\0${String(source.turn)}\0${source.prompt}\0${sourceWorkspaceHash}`
  return Object.freeze({
    id: `case-${sha256(body).slice(0, 20)}`,
    sourceId: source.id,
    sourceSessionId: source.sessionId,
    sourceTurn: source.turn,
    createdAt: new Date().toISOString(),
    prompt: source.prompt,
    promptHash: sha256(source.prompt),
    sourceCwd,
    sourceWorkspaceHash,
    provider: source.provider,
    model: source.model,
    reasoning: source.reasoning,
    maxTokens: source.maxTokens,
    presetSurface: source.presetSurface,
    systemHash: source.systemHash,
    toolSchemaHash: source.toolSchemaHash,
  })
}

/** Freeze a host-resolved authoritative session projection record. */
export async function freezeReplayTurn(
  sessionId: string,
  record: ReplayableTurnRecord,
  sourceCwd: string,
): Promise<FrozenReplayCase> {
  if (!record.replayable || record.evidenceHash === null) {
    throw new Error(`turn ${record.turn} is not replayable: ${record.missingFields.join(', ') || 'incomplete evidence'}`)
  }
  if (record.prompt === null || record.provider === null || record.model === null || record.reasoning === null
    || record.maxTokens === null || record.presetSurface === null || record.systemHash === null
    || record.toolSchemaHash === null || record.metrics === null) {
    throw new Error(`turn ${record.turn} has inconsistent replay evidence`)
  }
  const sourceWorkspaceHash = await hashDirectory(resolve(sourceCwd))
  const frozen = buildCase({
    id: `${sessionId}:${record.turn}`,
    sessionId,
    turn: record.turn,
    prompt: record.prompt,
    provider: record.provider,
    model: record.model,
    reasoning: record.reasoning,
    maxTokens: record.maxTokens,
    presetSurface: record.presetSurface,
    systemHash: record.systemHash,
    toolSchemaHash: record.toolSchemaHash,
  }, resolve(sourceCwd), sourceWorkspaceHash)
  const observedBaseline: NonNullable<FrozenReplayCase['observedBaseline']> = {
    runId: `observed-${sessionId}-${record.turn}`,
    sessionId,
    variantId: 'observed-current-session',
    status: 'completed',
    requestPhases: ['observed'],
    metrics: record.metrics,
    complete: true,
    eventCount: record.eventCount,
    evidenceHash: sha256(canonicalJson({ sessionId, turn: record.turn, evidenceHash: record.evidenceHash })),
    workspace: {
      sourceCwd: resolve(sourceCwd), sourceHash: sourceWorkspaceHash,
      executionCwd: resolve(sourceCwd), executionHash: sourceWorkspaceHash,
      isolation: 'observed-source', policy: 'durable current-session turn; no replay executed',
      drift: { detected: false, frozenHash: sourceWorkspaceHash, currentHash: sourceWorkspaceHash },
    },
  }
  return Object.freeze({
    ...frozen,
    observedBaseline,
  })
}

export class FixtureCaseSource implements CaseSource {
  readonly id = 'fixture-history'
  private cache?: readonly HistoryTurnSource[]

  constructor(private readonly file: string, private readonly workspaceFixture: string) {}

  private async workspaceHash(): Promise<string> {
    return hashDirectory(resolve(this.workspaceFixture))
  }

  async list(): Promise<readonly HistoryTurnSource[]> {
    if (this.cache !== undefined) return this.cache
    const parsed: unknown = JSON.parse(await readFile(resolve(this.file), 'utf8'))
    if (!Array.isArray(parsed)) throw new Error('history fixture 顶层必须是数组')
    this.cache = Object.freeze(parsed.map(validateSource))
    return this.cache
  }

  async freeze(sourceId: string): Promise<FrozenReplayCase> {
    const source = (await this.list()).find(item => item.id === sourceId)
    if (source === undefined) throw new Error(`找不到 source ${sourceId}`)
    return buildCase(source, resolve(this.workspaceFixture), await this.workspaceHash())
  }

}

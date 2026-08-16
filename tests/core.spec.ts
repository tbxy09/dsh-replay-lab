import { describe, expect, it } from 'vitest'
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { canonicalJson, hashDirectory, sha256 } from '../src/hash.ts'
import { FixtureCaseSource, freezeReplayTurn } from '../src/case-source.ts'
import { SessionMetricsExtractor, IndependentEvidenceOracle } from '../src/metrics.ts'

describe('hash', () => {
  it('sha256 与 canonicalJson 稳定', () => {
    expect(sha256('abc')).toBe(sha256('abc'))
    expect(canonicalJson({ b: 2, a: 1 })).toBe(canonicalJson({ a: 1, b: 2 }))
  })

  it('hashDirectory 对目录内容稳定且内容敏感', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rld-hash-'))
    try {
      await writeFile(join(dir, 'a.txt'), 'one', 'utf8')
      const first = await hashDirectory(dir)
      expect(first).toBe(await hashDirectory(dir))
      await writeFile(join(dir, 'b.txt'), 'two', 'utf8')
      expect(await hashDirectory(dir)).not.toBe(first)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('hashes a dangling symlink by link text without following it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rld-link-hash-'))
    try {
      await symlink('../missing-package/bin.js', join(dir, 'dangling-bin'))
      const first = await hashDirectory(dir)
      expect(first).toHaveLength(64)
      expect(await hashDirectory(dir)).toBe(first)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('FixtureCaseSource', () => {
  it('freeze 冻结 fixture source 并产出稳定 workspace hash', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rld-ws-'))
    const fixture = join(dir, 'history.json')
    try {
      await writeFile(fixture, JSON.stringify([{
        id: 'h1', kind: 'history', sessionId: 's1', turn: 1, title: 'T', createdAt: '2026-08-15T00:00:00.000Z',
        prompt: 'p', provider: 'fake', model: 'm', reasoning: 'high', maxTokens: 512, presetSurface: 'standard',
        systemHash: 's', toolSchemaHash: 't',
      }]), 'utf8')
      const source = new FixtureCaseSource(fixture, dir)
      const frozen = await source.freeze('h1')
      expect(frozen.sourceId).toBe('h1')
      expect(frozen.promptHash).toBe(sha256('p'))
      expect(frozen.sourceWorkspaceHash).toHaveLength(64)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('freezes a host-resolved replay turn without client-authored facts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rld-ws2-'))
    try {
      await writeFile(join(dir, 'task.txt'), 'x', 'utf8')
      const record = {
        prompt: 'p', provider: 'fake', model: 'm', reasoning: 'high', maxTokens: 128, presetSurface: 'standard',
        systemHash: 's', toolSchemaHash: 't', evidenceHash: 'e'.repeat(64), missingFields: [],
        replayable: true, metrics: { freshInputTokens: 3, outputTokens: 2, cacheReadTokens: 1, durationMs: 10, stepCount: 1, toolCalls: 0 },
        eventCount: 8, stepCount: 1, completedAt: 1, endReason: 'completed',
      }
      const a = await freezeReplayTurn('s', { ...record, turn: 1 }, dir)
      const b = await freezeReplayTurn('s', { ...record, turn: 2 }, dir)
      expect(a.id).not.toBe(b.id)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('metrics', () => {
  it('extractor 只在有 turn/end 时产出 metrics', () => {
    const extractor = new SessionMetricsExtractor()
    expect(extractor.extract([])).toBeUndefined()
    const metrics = extractor.extract([
      { type: 'turn/start', time: 0 },
      { type: 'assistant/message', data: { usage: { inputTokens: 10, outputTokens: 3, cacheReadTokens: 5 } } },
      { type: 'turn/end', time: 100 },
    ])
    expect(metrics).toMatchObject({ freshInputTokens: 10, outputTokens: 3, cacheReadTokens: 5 })
  })

  it('oracle 拒绝缺 evidence 或非独立 run', () => {
    const oracle = new IndependentEvidenceOracle()
    const complete = (sessionId: string, hash: string) => ({
      runId: 'r', sessionId, variantId: 'v', status: 'completed' as const, requestPhases: ['request'],
      evidenceHash: hash, complete: true, eventCount: 8,
      metrics: { freshInputTokens: 1, outputTokens: 1, cacheReadTokens: 1, durationMs: 1, stepCount: 1, toolCalls: 0 },
    })
    expect(oracle.score(undefined, undefined)).toBeUndefined()
    expect(oracle.score(complete('s', 'h'), complete('s', 'h'))).toBeUndefined()
    expect(oracle.score(complete('s1', 'h1'), complete('s2', 'h2'))).toBeDefined()
  })
})

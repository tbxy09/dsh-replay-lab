import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ReplayLabService, type ReplayTurnResolver } from '../src/service.ts'
import type { ArtifactStore, CaseSource, Runner } from '../src/registries.ts'
import type { FrozenReplayCase, HistoryTurnSource, LabSnapshot, ReplayableTurnRecord, RunEvidence } from '../src/types.ts'
import { IndependentEvidenceOracle } from '../src/metrics.ts'
import { builtInVariants } from '../src/variants.ts'
import { hashDirectory } from '../src/hash.ts'
import { copyWorkspaceSnapshot } from '../src/runner.ts'
import type { EvidenceSummarizer } from '../src/evidence-summary.ts'

const baselineMetrics = { freshInputTokens: 11, outputTokens: 7, cacheReadTokens: 3, durationMs: 90, stepCount: 2, toolCalls: 1 }
const rawCallEvidence = {
  schemaVersion: 'raw-call-evidence/v1' as const,
  turn: 1, startedAt: 0, endedAt: 90, calls: [],
  metrics: { toolCallCount: 1, toolRetryCount: 0, toolRetryRatePercent: 0, maxProgresslessSpan: 1, firstEffectiveActionLatencyMs: 30 },
}
const sourceRow: HistoryTurnSource = {
  id: 'source', kind: 'history', sessionId: 'source-session', turn: 1, title: 'Fixture', createdAt: '2026-08-15T00:00:00.000Z',
  prompt: 'fixture', provider: 'fake', model: 'fixture', reasoning: 'high', maxTokens: 256,
  presetSurface: 'standard', systemHash: 'a'.repeat(64), toolSchemaHash: 'b'.repeat(64),
}
const replayCase: FrozenReplayCase = {
  id: 'case', sourceId: 'source', sourceSessionId: 'source-session', sourceTurn: 1, createdAt: sourceRow.createdAt,
  prompt: sourceRow.prompt, promptHash: 'c'.repeat(64), sourceCwd: '/source/workspace', sourceWorkspaceHash: 'd'.repeat(64),
  provider: sourceRow.provider, model: 'fixture', reasoning: 'high', maxTokens: 256,
  presetSurface: 'standard', systemHash: sourceRow.systemHash, toolSchemaHash: sourceRow.toolSchemaHash,
  observedBaseline: {
    runId: 'observed-source-session-1', sessionId: 'source-session', variantId: 'observed-current-session',
    status: 'completed', requestPhases: ['observed'], metrics: baselineMetrics, complete: true, eventCount: 12,
    evidenceHash: 'observed-hash', callEvidence: rawCallEvidence,
  },
}

class MemoryStore implements ArtifactStore {
  id = 'memory'
  value: Pick<LabSnapshot, 'replayCase' | 'experiment' | 'history'> = { history: [] }
  async load() { return this.value }
  async save(value: Pick<LabSnapshot, 'replayCase' | 'experiment' | 'history'>) { this.value = value }
  async put() { return 'memory://artifact' }
}

function caseSource(): CaseSource {
  return { id: 'source', list: async () => [sourceRow], freeze: async () => replayCase }
}

function makeService(
  caseSourceImpl: CaseSource,
  runner: Runner,
  resolveTurn?: ReplayTurnResolver,
  store: MemoryStore = new MemoryStore(),
  evidenceSummarizer?: EvidenceSummarizer,
): ReplayLabService {
  const service = new ReplayLabService('/replay-lab-dsh', resolveTurn, undefined, evidenceSummarizer)
  service.registries.caseSources.register(caseSourceImpl)
  service.registries.artifactStores.register(store)
  service.registries.runners.register(runner)
  service.registries.oracles.register(new IndependentEvidenceOracle())
  for (const variant of builtInVariants()) service.registries.variants.register(variant)
  return service
}

describe('ReplayLabService', () => {
  it('uses the native anchored-standard preset and fails closed when it is absent', () => {
    const available = builtInVariants().find(variant => variant.id === 'anchored')
    expect(available).toMatchObject({
      preset: 'anchored-standard', pluginSurface: 'preset:anchored-standard', supported: true,
    })
    expect(available?.install).toBeUndefined()

    const unavailable = builtInVariants({
      anchoredStandard: { available: false, reason: 'not installed' },
    }).find(variant => variant.id === 'anchored')
    expect(unavailable).toMatchObject({ supported: false, unsupportedReason: 'not installed' })
  })

  it('keeps the observed turn fixed and runs only the approved candidate', async () => {
    let runs = 0
    let summaries = 0
    const runner: Runner = {
      id: 'runner',
      async run({ variant }): Promise<RunEvidence> {
        runs += 1
        return {
          runId: 'candidate-run', sessionId: 'candidate-session', variantId: variant.id, status: 'completed',
          requestPhases: variant.requestPhases, complete: true, eventCount: 8, evidenceHash: 'candidate-hash',
          metrics: { freshInputTokens: 5, outputTokens: 2, cacheReadTokens: 1, durationMs: 30, stepCount: 1, toolCalls: 0 },
          callEvidence: { ...rawCallEvidence, metrics: { ...rawCallEvidence.metrics, toolCallCount: 2, toolRetryCount: 1, toolRetryRatePercent: 50 } },
        }
      },
    }
    const summarizer: EvidenceSummarizer = {
      async summarize(input) {
        summaries += 1
        return {
          schemaVersion: 'evidence-narrative/v1', status: 'completed', promptVersion: 'raw-evidence-summary/v1',
          provider: input.replayCase.provider, model: input.replayCase.model,
          text: 'candidate retry increased [F2].', citedEvidenceIds: ['F2'],
        }
      },
    }
    const service = makeService(caseSource(), runner, undefined, new MemoryStore(), summarizer)
    await service.freeze('source')
    await service.plan('anchored')
    expect(runs).toBe(0)
    expect((await service.snapshot()).experiment).toMatchObject({ status: 'planned', baselineMode: 'observed-current-session', candidateVariantId: 'anchored' })

    await service.approveAndRun()
    await expect.poll(async () => (await service.snapshot()).experiment?.status).toBe('completed')
    const experiment = (await service.snapshot()).experiment!
    expect(runs).toBe(1)
    expect(experiment.baseline).toEqual(replayCase.observedBaseline)
    expect(experiment.baseline?.sessionId).toBe('source-session')
    expect(experiment.candidate?.sessionId).toBe('candidate-session')
    expect(experiment.scorecard?.rows.find(row => row.key === 'freshInputTokens')).toMatchObject({ baseline: 11, candidate: 5, delta: -6 })
    expect(experiment.callEvidenceComparison).toBeDefined()
    expect(experiment.evidenceNarrative).toMatchObject({ status: 'unavailable', error: expect.stringMatching(/not requested/) })
    expect(summaries).toBe(0)
    await service.summarize(experiment.id)
    const summarized = (await service.snapshot()).experiment!
    expect(summarized.evidenceNarrative).toMatchObject({ status: 'completed', citedEvidenceIds: ['F2'] })
    expect(summaries).toBe(1)
    expect((await service.snapshot()).history).toEqual([expect.objectContaining({
      sourceSessionId: 'source-session', sourceTurn: 1, replayCase, experiment: summarized,
    })])

    const afterBack = await service.reset()
    expect(afterBack.experiment).toBeUndefined()
    expect(afterBack.replayCase).toBeUndefined()
    expect(afterBack.history).toEqual([expect.objectContaining({
      sourceSessionId: 'source-session', sourceTurn: 1, replayCase, experiment: summarized,
    })])
  })

  it('completes and persists a drifted candidate against the current isolated workspace', async () => {
    const sourceCwd = await mkdtemp(join(tmpdir(), 'rld-drift-service-'))
    let isolatedRoot: string | undefined
    try {
      await writeFile(join(sourceCwd, 'task.txt'), 'frozen source', 'utf8')
      const frozenHash = await hashDirectory(sourceCwd)
      const frozenCase: FrozenReplayCase = {
        ...replayCase,
        sourceCwd,
        sourceWorkspaceHash: frozenHash,
      }
      const store = new MemoryStore()
      const runner: Runner = {
        id: 'runner',
        async run({ replayCase: candidateCase, variant }): Promise<RunEvidence> {
          const isolated = await copyWorkspaceSnapshot(candidateCase.sourceCwd, candidateCase.sourceWorkspaceHash)
          isolatedRoot = isolated.root
          expect(await readFile(join(isolated.provenance.executionCwd, 'task.txt'), 'utf8')).toBe('current source')
          return {
            runId: 'drifted-run', sessionId: 'drifted-candidate-session', variantId: variant.id,
            status: 'completed', requestPhases: ['request'], metrics: baselineMetrics,
            complete: true, eventCount: 8, evidenceHash: 'drifted-candidate-hash', workspace: isolated.provenance,
          }
        },
      }
      const service = makeService({
        id: 'source', list: async () => [sourceRow], freeze: async () => frozenCase,
      }, runner, undefined, store)

      await service.freeze('source')
      await writeFile(join(sourceCwd, 'task.txt'), 'current source', 'utf8')
      await service.plan('standard')
      await service.approveAndRun()
      await expect.poll(async () => (await service.snapshot()).experiment?.status).toBe('completed')

      const experiment = (await service.snapshot()).experiment
      expect(experiment?.candidate).toMatchObject({
        status: 'completed', complete: true,
        workspace: {
          drift: { detected: true, frozenHash, currentHash: expect.stringMatching(/^[a-f0-9]{64}$/) },
        },
      })
      expect(experiment?.scorecard?.workspaceDrift).toEqual(experiment?.candidate?.workspace?.drift)
      expect(store.value.history[0]?.experiment.scorecard?.workspaceDrift?.detected).toBe(true)
    } finally {
      if (isolatedRoot !== undefined) await rm(isolatedRoot, { recursive: true, force: true })
      await rm(sourceCwd, { recursive: true, force: true })
    }
  })

  it('resolves source cwd from the host and freezes observed evidence against it', async () => {
    const sourceCwd = await mkdtemp(join(tmpdir(), 'rld-source-cwd-'))
    try {
      await writeFile(join(sourceCwd, 'source.txt'), 'durable source', 'utf8')
      let admitted: { sessionId: string; turn: number; expectedEvidenceHash: string } | undefined
      const record: ReplayableTurnRecord = {
        turn: 3, prompt: 'live prompt', provider: 'fake', model: 'm', reasoning: 'high', maxTokens: 2048,
        presetSurface: 'standard', systemHash: 's', toolSchemaHash: 't', evidenceHash: 'e'.repeat(64),
        missingFields: [], replayable: true, metrics: baselineMetrics, eventCount: 17, stepCount: 2,
        completedAt: 1, endReason: 'completed',
      }
      const service = makeService(caseSource(), {
        id: 'runner', run: async () => { throw new Error('must not run during admission') },
      }, async input => { admitted = input; return { record, sourceCwd } })
      const snap = await service.admit({ sessionId: 'live-session', turn: 3, expectedEvidenceHash: 'e'.repeat(64) })
      expect(Object.keys(admitted ?? {}).sort()).toEqual(['expectedEvidenceHash', 'sessionId', 'turn'])
      expect(snap.replayCase).toMatchObject({ sourceId: 'live-session:3', sourceCwd: resolve(sourceCwd), prompt: 'live prompt' })
      expect(snap.replayCase?.sourceWorkspaceHash).toHaveLength(64)
      expect(snap.replayCase?.observedBaseline).toMatchObject({ sessionId: 'live-session', metrics: baselineMetrics })
      expect(snap.experiment).toBeUndefined()
    } finally {
      await rm(sourceCwd, { recursive: true, force: true })
    }
  })

  it('reopens the latest saved scorecard for the same authoritative turn', async () => {
    const sourceCwd = await mkdtemp(join(tmpdir(), 'rld-history-cwd-'))
    try {
      await writeFile(join(sourceCwd, 'source.txt'), 'durable source', 'utf8')
      const record: ReplayableTurnRecord = {
        turn: 1, prompt: 'live prompt', provider: 'fake', model: 'm', reasoning: 'high', maxTokens: 2048,
        presetSurface: 'standard', systemHash: 's', toolSchemaHash: 't', evidenceHash: 'e'.repeat(64),
        missingFields: [], replayable: true, metrics: baselineMetrics, eventCount: 17, stepCount: 2,
        completedAt: 1, endReason: 'completed',
      }
      const runner: Runner = {
        id: 'runner',
        run: async ({ variant }) => ({
          runId: 'saved-run', sessionId: 'candidate-session', variantId: variant.id, status: 'completed',
          requestPhases: ['request'], metrics: baselineMetrics, complete: true, eventCount: 8,
          evidenceHash: 'candidate-hash',
        }),
      }
      const service = makeService(caseSource(), runner, async () => ({ record, sourceCwd }))
      const identifier = { sessionId: 'live-session', turn: 1, expectedEvidenceHash: 'e'.repeat(64) }
      await service.admit(identifier)
      await service.plan('standard')
      await service.approveAndRun()
      await expect.poll(async () => (await service.snapshot()).experiment?.status).toBe('completed')
      const savedId = (await service.snapshot()).experiment?.id
      await service.reset()

      const reopened = await service.admit(identifier)
      expect(reopened.experiment?.id).toBe(savedId)
      expect(reopened.experiment?.scorecard).toBeDefined()
      expect(reopened.history).toHaveLength(1)
    } finally {
      await rm(sourceCwd, { recursive: true, force: true })
    }
  })

  it('retains an in-flight experiment when the Replay view re-admits the same turn', async () => {
    const sourceCwd = await mkdtemp(join(tmpdir(), 'rld-remount-cwd-'))
    try {
      await writeFile(join(sourceCwd, 'source.txt'), 'durable source', 'utf8')
      const record: ReplayableTurnRecord = {
        turn: 1, prompt: 'live prompt', provider: 'fake', model: 'm', reasoning: 'high', maxTokens: 2048,
        presetSurface: 'standard', systemHash: 's', toolSchemaHash: 't', evidenceHash: 'e'.repeat(64),
        missingFields: [], replayable: true, metrics: baselineMetrics, eventCount: 17, stepCount: 2,
        completedAt: 1, endReason: 'completed',
      }
      let completeRun!: (evidence: RunEvidence) => void
      const pending = new Promise<RunEvidence>(resolveRun => { completeRun = resolveRun })
      const service = makeService(caseSource(), {
        id: 'runner', run: async () => pending,
      }, async () => ({ record, sourceCwd }))
      const identifier = { sessionId: 'live-session', turn: 1, expectedEvidenceHash: 'e'.repeat(64) }
      await service.admit(identifier)
      await service.plan('standard')
      const approved = await service.approveAndRun('live-session')
      expect(approved.experiment?.status).toBe('running')

      const remounted = await service.admit(identifier)
      expect(remounted.experiment).toMatchObject({ id: approved.experiment?.id, status: 'running' })

      completeRun({
        runId: 'remount-run', sessionId: 'candidate-session', variantId: 'standard', status: 'completed',
        requestPhases: ['request'], metrics: baselineMetrics, complete: true, eventCount: 8,
        evidenceHash: 'candidate-hash',
      })
      await expect.poll(async () => (await service.snapshot('live-session')).experiment?.status).toBe('completed')
    } finally {
      await rm(sourceCwd, { recursive: true, force: true })
    }
  })

  it('fails closed for a host-plane candidate', async () => {
    const service = makeService(caseSource(), { id: 'runner', run: async () => { throw new Error('must not run') } })
    await service.freeze('source')
    await expect(service.plan('host-provider-switch')).rejects.toThrow(/host-plane/)
  })

  it('isolates active workbenches by source session', async () => {
    const sourceCwd = await mkdtemp(join(tmpdir(), 'rld-session-scope-'))
    try {
      await writeFile(join(sourceCwd, 'source.txt'), 'durable source', 'utf8')
      const service = makeService(caseSource(), {
        id: 'runner', run: async () => { throw new Error('must not run before approval') },
      }, async identifier => ({
        sourceCwd,
        record: {
          turn: identifier.turn, prompt: `prompt ${identifier.sessionId}`, provider: 'fake', model: 'm',
          reasoning: 'high', maxTokens: 2048, presetSurface: 'standard', systemHash: 's', toolSchemaHash: 't',
          evidenceHash: identifier.expectedEvidenceHash, missingFields: [], replayable: true,
          metrics: baselineMetrics, eventCount: 3, stepCount: 1, completedAt: 1, endReason: 'completed',
        },
      }))
      const hashA = 'a'.repeat(64)
      const hashB = 'b'.repeat(64)
      await service.admit({ sessionId: 'fish-session', turn: 1, expectedEvidenceHash: hashA })
      await service.admit({ sessionId: 'bookmark-session', turn: 2, expectedEvidenceHash: hashB })
      await service.plan('anchored', 'fish-session')
      await service.plan('standard', 'bookmark-session')

      expect(await service.snapshot('fish-session')).toMatchObject({
        replayCase: { sourceSessionId: 'fish-session', sourceTurn: 1 },
        experiment: { candidateVariantId: 'anchored' },
      })
      expect(await service.snapshot('bookmark-session')).toMatchObject({
        replayCase: { sourceSessionId: 'bookmark-session', sourceTurn: 2 },
        experiment: { candidateVariantId: 'standard' },
      })

      await service.reset('fish-session')
      expect((await service.snapshot('fish-session')).replayCase).toBeUndefined()
      expect((await service.snapshot('bookmark-session')).experiment?.candidateVariantId).toBe('standard')
    } finally {
      await rm(sourceCwd, { recursive: true, force: true })
    }
  })
})

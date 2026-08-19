import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { JsonArtifactStore } from '../src/artifact-store.ts'
import { matchRouteLineage } from '../src/route-lineage.ts'
import type { FrozenReplayCase, ReplayExperiment } from '../src/types.ts'

const replayCase = {
  id: 'case', sourceId: 'session:1', sourceSessionId: 'session', sourceTurn: 1,
  createdAt: '2026-08-15T00:00:00.000Z', prompt: 'prompt', promptHash: 'p',
  sourceCwd: '/workspace', sourceWorkspaceHash: 'w', provider: 'provider', model: 'model',
  reasoning: 'high', maxTokens: 256, presetSurface: 'standard', systemHash: 's', toolSchemaHash: 't',
  observedBaseline: {
    runId: 'observed', sessionId: 'session', variantId: 'observed-current-session', status: 'completed',
    requestPhases: ['observed'], complete: true, eventCount: 2,
  },
} satisfies FrozenReplayCase

const experiment = {
  id: 'experiment', caseId: 'case', baselineMode: 'observed-current-session', candidateVariantId: 'standard',
  status: 'completed', createdAt: '2026-08-15T00:00:00.000Z', updatedAt: '2026-08-15T00:01:00.000Z',
} satisfies ReplayExperiment

describe('JsonArtifactStore replay history', () => {
  it('restores only valid durable route-lineage artifacts', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rld-store-lineage-'))
    const artifacts = join(directory, 'artifacts')
    try {
      const store = new JsonArtifactStore(join(directory, 'state.json'), artifacts)
      const evidence = matchRouteLineage(
        {
          sessionId: 'parent', header: { id: 'parent', createdAt: 1 },
          events: [{ type: 'request/header', seq: 0, time: 10, data: { header: { config: { provider: 'deepseek', model: 'new' } } } }],
        },
        {
          sessionId: 'child', header: { id: 'child', createdAt: 20, parentSession: 'parent', origin: 'subagent' },
          events: [{ type: 'request/header', seq: 0, time: 21, data: { header: { config: { provider: 'deepseek', model: 'old' } } } }],
        },
      )
      expect(evidence).toBeDefined()
      await store.put('route-lineage', 'valid', evidence)
      await store.put('route-lineage', 'invalid', { schemaVersion: 'route-lineage/v1', routeMismatch: false })
      expect(await store.loadRouteLineageEvidence()).toEqual([evidence])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('migrates a terminal v1 result and writes durable v2 history', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rld-store-'))
    const file = join(directory, 'state.json')
    try {
      await writeFile(file, JSON.stringify({ version: 1, replayCase, experiment }), 'utf8')
      const store = new JsonArtifactStore(file, join(directory, 'artifacts'))
      const migrated = await store.load()
      expect(migrated.history).toEqual([expect.objectContaining({
        sourceSessionId: 'session', sourceTurn: 1, replayCase, experiment,
      })])
      await store.save(migrated)
      expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({ version: 2, history: [{ experiment: { id: 'experiment' } }] })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('round-trips workspace drift provenance in the saved run and scorecard', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rld-store-drift-'))
    const file = join(directory, 'state.json')
    const drift = { detected: true, frozenHash: 'a'.repeat(64), currentHash: 'b'.repeat(64) }
    const driftExperiment: ReplayExperiment = {
      ...experiment,
      candidate: {
        runId: 'candidate', sessionId: 'candidate-session', variantId: 'standard', status: 'completed',
        requestPhases: ['request'], complete: true, eventCount: 3,
        workspace: {
          sourceCwd: '/workspace', sourceHash: drift.currentHash,
          executionCwd: '/artifacts/candidate/workspace', executionHash: drift.currentHash,
          isolation: 'copy', policy: 'test', drift,
        },
      },
      scorecard: {
        baselineSessionId: 'session', candidateSessionId: 'candidate-session', rows: [], workspaceDrift: drift,
      },
    }
    try {
      const store = new JsonArtifactStore(file, join(directory, 'artifacts'))
      await store.save({ history: [{
        sourceSessionId: 'session', sourceTurn: 1, replayCase, experiment: driftExperiment,
      }] })
      const loaded = await store.load()
      expect(loaded.history[0]?.experiment.candidate?.workspace?.drift).toEqual(drift)
      expect(loaded.history[0]?.experiment.scorecard?.workspaceDrift).toEqual(drift)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { JsonArtifactStore } from '../src/artifact-store.ts'
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
})

import { lstat, mkdtemp, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { hashDirectory } from '../src/hash.ts'
import {
  candidatePathGuard, copyWorkspaceSnapshot, CordisAgentRunner, DeterministicReplayAdapter, discardWorkspaceSnapshot,
  recoverManagedWorkspaceSnapshots, replayDisplayNames, requestSurfaceEvidence, rollbackWorkspaceSnapshot,
} from '../src/runner.ts'
import { DefaultReplayWorkspaceProvider } from '../src/replay-workspace.ts'
import type { IsolatedWorkspace } from '../src/runner.ts'

describe('deterministic replay adapter', () => {
  it('advertises complete replayable model metadata without provider credentials', async () => {
    const adapter = new DeterministicReplayAdapter()
    expect(adapter.providerInfo('replay-lab-fake')).toEqual({
      id: 'replay-lab-fake', name: 'Replay Lab deterministic',
    })
    await expect(adapter.listModels('replay-lab-fake')).resolves.toEqual([expect.objectContaining({
      provider: 'replay-lab-fake', id: 'fixture-model-v1', name: 'Replay Lab fixture model',
    })])
    await expect(adapter.resolveModel('replay-lab-fake', 'fixture-model-v1')).resolves.toMatchObject({
      defaultMaxTokens: 2048,
      context: { contextWindow: 8192 },
      reasoning: { defaultEffort: 'off', efforts: [{ id: 'off', name: 'Off' }] },
    })
  })
})

describe('candidate workspace isolation', () => {
  it('copies the durable source cwd with matching provenance and never writes through', async () => {
    const sourceCwd = await mkdtemp(join(tmpdir(), 'rld-runner-source-'))
    let isolatedRoot: string | undefined
    try {
      await writeFile(join(sourceCwd, 'task.txt'), 'source', 'utf8')
      await symlink('../missing-package/bin.js', join(sourceCwd, 'dangling-bin'))
      const sourceHash = await hashDirectory(sourceCwd)
      const isolated = await copyWorkspaceSnapshot(sourceCwd, sourceHash)
      isolatedRoot = isolated.root

      expect(isolated.provenance).toMatchObject({
        sourceCwd: resolve(sourceCwd), sourceHash, executionHash: sourceHash, isolation: 'copy',
        drift: { detected: false, frozenHash: sourceHash, currentHash: sourceHash },
        checkpoint: {
          schemaVersion: 'replay-workspace-checkpoint/v1', checkpointHash: sourceHash, sourceHash,
        },
        rollback: { status: 'pending' },
      })
      expect(isolated.durable).toBe(false)
      expect(isolated.provenance.executionCwd).not.toBe(resolve(sourceCwd))
      expect((await lstat(join(isolated.provenance.executionCwd, 'dangling-bin'))).isSymbolicLink()).toBe(true)
      expect(await readlink(join(isolated.provenance.executionCwd, 'dangling-bin'))).toBe('../missing-package/bin.js')
      await writeFile(join(isolated.provenance.executionCwd, 'task.txt'), 'candidate mutation', 'utf8')
      expect(await readFile(join(sourceCwd, 'task.txt'), 'utf8')).toBe('source')
      await writeFile(join(sourceCwd, 'task.txt'), 'baseline/source session mutation', 'utf8')
      expect(await hashDirectory(isolated.provenance.executionCwd)).not.toBe(sourceHash)
      await rollbackWorkspaceSnapshot(isolated)
      expect(await readFile(join(sourceCwd, 'task.txt'), 'utf8')).toBe('baseline/source session mutation')
      expect(await readFile(join(isolated.provenance.executionCwd, 'task.txt'), 'utf8')).toBe('source')
      expect(isolated.provenance.rollback).toMatchObject({ status: 'restored', restoredHash: sourceHash })
    } finally {
      if (isolatedRoot !== undefined) await rm(isolatedRoot, { recursive: true, force: true })
      await rm(sourceCwd, { recursive: true, force: true })
    }
  })

  it('materializes a stored S0 snapshot after the source advances to S1', async () => {
    const sourceCwd = await mkdtemp(join(tmpdir(), 'rld-runner-stale-'))
    let isolatedRoot: string | undefined
    try {
      await writeFile(join(sourceCwd, 'task.txt'), 'frozen', 'utf8')
      const frozenHash = await hashDirectory(sourceCwd)
      const provider = new DefaultReplayWorkspaceProvider()
      const s0 = await provider.checkpoint(sourceCwd, 'turn-start')
      await writeFile(join(sourceCwd, 'task.txt'), 'current', 'utf8')
      await writeFile(join(sourceCwd, 'added.txt'), 'added after freeze', 'utf8')

      const isolated = await provider.materialize(s0, frozenHash)
      isolatedRoot = isolated.root
      const currentHash = await hashDirectory(sourceCwd)
      expect(isolated.provenance).toMatchObject({
        sourceHash: frozenHash,
        executionHash: frozenHash,
        drift: { detected: true, frozenHash, currentHash },
      })
      expect(await readFile(join(isolated.provenance.executionCwd, 'task.txt'), 'utf8')).toBe('frozen')
      expect(await lstat(join(isolated.provenance.executionCwd, 'added.txt')).then(() => true, () => false)).toBe(false)
      expect(await readFile(join(sourceCwd, 'task.txt'), 'utf8')).toBe('current')
    } finally {
      if (isolatedRoot !== undefined) await rm(isolatedRoot, { recursive: true, force: true })
      await rm(sourceCwd, { recursive: true, force: true })
    }
  })

  it('creates descriptive source, turn, and candidate labels without a workspace fallback', () => {
    expect(replayDisplayNames(
      { sourceCwd: '/projects/replay-project', sourceTurn: 3 },
      { id: 'standard', label: 'Standard replay' },
    )).toEqual({
      workspaceTitle: 'replay-project · Isolated Replay · Turn 3 · Standard replay',
      sessionTitle: 'Replay · Turn 3 · Standard replay',
      executionName: 'replay-project-turn-3-standard',
    })
  })

  it('retains an approved candidate copy under the managed artifact directory', async () => {
    const sourceCwd = await mkdtemp(join(tmpdir(), 'rld-managed-source-'))
    const managedParent = await mkdtemp(join(tmpdir(), 'rld-managed-parent-'))
    try {
      await writeFile(join(sourceCwd, 'task.txt'), 'source', 'utf8')
      const sourceHash = await hashDirectory(sourceCwd)
      const isolated = await copyWorkspaceSnapshot(sourceCwd, sourceHash, {
        parentDirectory: managedParent,
        executionName: 'replay-project-turn-1-standard',
      })
      expect(isolated.durable).toBe(true)
      expect(isolated.root.startsWith(resolve(managedParent))).toBe(true)
      expect(isolated.provenance.executionCwd).toMatch(/replay-project-turn-1-standard$/)
      expect(isolated.provenance.policy).toMatch(/managed artifact directory/)
      expect(isolated.provenance.checkpoint?.checkpointCwd).toMatch(/\.replay-checkpoint$/)
    } finally {
      await rm(sourceCwd, { recursive: true, force: true })
      await rm(managedParent, { recursive: true, force: true })
    }
  })

  it('restores candidate mutations after a failed replay operation without reverting source changes', async () => {
    const sourceCwd = await mkdtemp(join(tmpdir(), 'rld-failed-source-'))
    let isolatedRoot: string | undefined
    try {
      await writeFile(join(sourceCwd, 'task.txt'), 'checkpoint state', 'utf8')
      const sourceHash = await hashDirectory(sourceCwd)
      const isolated = await copyWorkspaceSnapshot(sourceCwd, sourceHash)
      isolatedRoot = isolated.root

      await expect((async () => {
        try {
          await writeFile(join(isolated.provenance.executionCwd, 'task.txt'), 'failed candidate mutation', 'utf8')
          await writeFile(join(sourceCwd, 'source-only.txt'), 'must persist', 'utf8')
          throw new Error('candidate failed')
        } finally {
          await rollbackWorkspaceSnapshot(isolated)
        }
      })()).rejects.toThrow('candidate failed')

      expect(await readFile(join(isolated.provenance.executionCwd, 'task.txt'), 'utf8')).toBe('checkpoint state')
      expect(await readFile(join(sourceCwd, 'source-only.txt'), 'utf8')).toBe('must persist')
      expect(isolated.provenance.rollback?.status).toBe('restored')
    } finally {
      if (isolatedRoot !== undefined) await rm(isolatedRoot, { recursive: true, force: true })
      await rm(sourceCwd, { recursive: true, force: true })
    }
  })

  it('reconciles durable candidate mutations from the checkpoint after restart', async () => {
    const sourceCwd = await mkdtemp(join(tmpdir(), 'rld-restart-source-'))
    const managedParent = await mkdtemp(join(tmpdir(), 'rld-restart-managed-'))
    try {
      await writeFile(join(sourceCwd, 'task.txt'), 'checkpoint state', 'utf8')
      const sourceHash = await hashDirectory(sourceCwd)
      const isolated = await copyWorkspaceSnapshot(sourceCwd, sourceHash, {
        parentDirectory: managedParent, executionName: 'restart-candidate',
      })
      await writeFile(join(isolated.provenance.executionCwd, 'task.txt'), 'interrupted mutation', 'utf8')
      await writeFile(join(sourceCwd, 'source-after-checkpoint.txt'), 'preserved', 'utf8')

      await expect(recoverManagedWorkspaceSnapshots(managedParent)).resolves.toBe(1)
      expect(await readFile(join(isolated.provenance.executionCwd, 'task.txt'), 'utf8')).toBe('checkpoint state')
      expect(await readFile(join(sourceCwd, 'source-after-checkpoint.txt'), 'utf8')).toBe('preserved')
    } finally {
      await rm(sourceCwd, { recursive: true, force: true })
      await rm(managedParent, { recursive: true, force: true })
    }
  })

  it('rejects rollback and cleanup metadata that could target the source workspace', async () => {
    const sourceCwd = await mkdtemp(join(tmpdir(), 'rld-boundary-source-'))
    try {
      await writeFile(join(sourceCwd, 'task.txt'), 'untouched source', 'utf8')
      const sourceHash = await hashDirectory(sourceCwd)
      const unsafe: IsolatedWorkspace = {
        root: sourceCwd,
        durable: false,
        provenance: {
          sourceCwd, sourceHash, executionCwd: sourceCwd, executionHash: sourceHash,
          isolation: 'copy', policy: 'malformed test fixture',
          checkpoint: {
            schemaVersion: 'replay-workspace-checkpoint/v1', checkpointCwd: sourceCwd,
            checkpointHash: sourceHash, sourceHash, createdAt: new Date().toISOString(),
          },
          rollback: { status: 'pending' },
        },
      }

      await expect(rollbackWorkspaceSnapshot(unsafe)).rejects.toThrow(/disjoint from the source/)
      await expect(discardWorkspaceSnapshot(unsafe)).rejects.toThrow(/disjoint from the source/)
      expect(await readFile(join(sourceCwd, 'task.txt'), 'utf8')).toBe('untouched source')
    } finally {
      await rm(sourceCwd, { recursive: true, force: true })
    }
  })

  it('rejects a managed candidate parent inside the source before creating any files', async () => {
    const sourceCwd = await mkdtemp(join(tmpdir(), 'rld-parent-boundary-source-'))
    try {
      await writeFile(join(sourceCwd, 'task.txt'), 'untouched source', 'utf8')
      const sourceHash = await hashDirectory(sourceCwd)
      const unsafeParent = join(sourceCwd, '.replay-artifacts', 'candidate-workspaces')

      await expect(copyWorkspaceSnapshot(sourceCwd, sourceHash, {
        parentDirectory: unsafeParent, executionName: 'unsafe',
      })).rejects.toThrow(/parent must not be inside the source/)
      await expect(lstat(unsafeParent)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(await hashDirectory(sourceCwd)).toBe(sourceHash)
    } finally {
      await rm(sourceCwd, { recursive: true, force: true })
    }
  })

  it('the runner restores its durable candidate cwd even when candidate execution fails', async () => {
    const sourceCwd = await mkdtemp(join(tmpdir(), 'rld-runner-finally-source-'))
    const managedParent = await mkdtemp(join(tmpdir(), 'rld-runner-finally-managed-'))
    let executionCwd: string | undefined
    try {
      await writeFile(join(sourceCwd, 'task.txt'), 'checkpoint state', 'utf8')
      const sourceHash = await hashDirectory(sourceCwd)
      const events: Array<{ type: string; data: unknown }> = []
      let mutation = Promise.resolve()
      const session = {
        id: 'replay-experiment-standard-test', header: { cwd: '' }, events,
        append(type: string, data: unknown) { events.push({ type, data }) },
      }
      const agent = {
        session,
        followup() {
          mutation = writeFile(join(executionCwd as string, 'task.txt'), 'failed candidate mutation', 'utf8')
        },
        async whenIdle() {
          await mutation
          throw new Error('fixture candidate failed')
        },
        cancel() {},
      }
      const ctx = {
        agents: {
          async create(options: { meta: { cwd: string } }) {
            executionCwd = options.meta.cwd
            session.header.cwd = options.meta.cwd
            return { agent, async dispose() {} }
          },
        },
        agentPresets: { async mount() {} },
        sessionTitle: { rename() {} },
        workspaceRegistry: {
          async create() { return { id: 'candidate-workspace', async attachSession() {} } },
          async resolveByPath() { return undefined },
          list() { return [] },
          async insertBefore() {},
        },
      } as unknown as Context
      const runner = new CordisAgentRunner(
        ctx,
        { id: 'metrics', extract: () => undefined },
        () => ({
          id: 'standard', label: 'Standard replay', description: 'test', plane: 'agent', preset: 'standard',
          pluginSurface: 'preset:standard', supported: true, requestPhases: ['request'], behavior: 'normal',
        }),
        managedParent,
      )
      const result = await runner.run({
        replayCase: {
          id: 'case', sourceId: 'source', sourceSessionId: 'source-session', sourceTurn: 1,
          createdAt: new Date().toISOString(), prompt: 'mutate task', promptHash: 'prompt-hash',
          sourceCwd, sourceWorkspaceHash: sourceHash, provider: 'fake', model: 'fixture', reasoning: 'off',
          maxTokens: 256, presetSurface: 'standard', systemHash: 'system', toolSchemaHash: 'tools',
        },
        experimentId: 'experiment',
        variant: {
          id: 'standard', label: 'Standard replay', description: 'test', plane: 'agent', preset: 'standard',
          pluginSurface: 'preset:standard', supported: true, requestPhases: ['request'], behavior: 'normal',
        },
      })

      expect(result).toMatchObject({
        status: 'failed', complete: false, missingReason: 'fixture candidate failed',
        workspace: { rollback: { status: 'restored', restoredHash: sourceHash } },
      })
      expect(await readFile(join(executionCwd as string, 'task.txt'), 'utf8')).toBe('checkpoint state')
      expect(await readFile(join(sourceCwd, 'task.txt'), 'utf8')).toBe('checkpoint state')
      expect(events.at(-1)).toEqual({ type: 'sandbox/mode', data: { mode: 'read-only' } })
      expect(runner.isActiveCandidateSession(String(session.id))).toBe(false)
    } finally {
      await rm(sourceCwd, { recursive: true, force: true })
      await rm(managedParent, { recursive: true, force: true })
    }
  })
})

describe('durable candidate request surfaces', () => {
  it('reports the real anchored bootstrap and promoted tool catalogs without fabricating requests', () => {
    const event = (tools: string[], reason: string) => ({
      type: 'request/header',
      data: {
        reason,
        header: {
          config: { provider: 'fake', model: 'v4', reasoningEffort: 'max', maxTokens: 4096 },
          system: 'persona',
          tools: tools.map(name => ({ name, description: name, parameters: { type: 'object' } })),
        },
      },
    })
    const surfaces = requestSurfaceEvidence([
      event(['bash', 'str_replace_editor'], 'initial'),
      { type: 'assistant/message', data: {} },
      event(['bash', 'str_replace_editor', 'read', 'write', 'skill'], 'change'),
    ], 'anchored')

    expect(surfaces.map(surface => surface.phase)).toEqual(['bootstrap', 'promoted'])
    expect(surfaces[0]?.toolNames).toEqual(['bash', 'str_replace_editor'])
    expect(surfaces[1]?.toolNames).toEqual(['bash', 'str_replace_editor', 'read', 'write', 'skill'])
    expect(surfaces[0]?.toolSchemaHash).not.toBe(surfaces[1]?.toolSchemaHash)
  })

  it('labels later durable header changes as dynamic unlock surfaces', () => {
    const header = (tools: string[]) => ({ type: 'request/header', data: { header: {
      config: { provider: 'fake', model: 'v4' }, tools: tools.map(name => ({ name })),
    } } })
    expect(requestSurfaceEvidence([
      header(['bash', 'str_replace_editor']),
      header(['bash', 'str_replace_editor', 'dev_tool_search']),
      header(['bash', 'str_replace_editor', 'dev_tool_search', 'web_search']),
    ], 'anchored').map(surface => surface.phase)).toEqual(['bootstrap', 'promoted', 'dynamic-unlock-1'])
  })
})

describe('candidate path guard', () => {
  it('allows the isolated tree and rejects outside and symlink escapes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rld-guard-root-'))
    const outside = await mkdtemp(join(tmpdir(), 'rld-guard-outside-'))
    try {
      await writeFile(join(root, 'inside.txt'), 'inside', 'utf8')
      await symlink(outside, join(root, 'escape'))
      expect(candidatePathGuard({ path: join(root, 'inside.txt') }, root)).toBeUndefined()
      expect(candidatePathGuard({ workdir: root }, root)).toBeUndefined()
      expect(candidatePathGuard({ path: join(outside, 'outside.txt') }, root)).toMatch(/isolated workspace/)
      expect(candidatePathGuard({ path: join(root, 'escape', 'write.txt') }, root)).toMatch(/isolated workspace/)
      expect(candidatePathGuard({ command: `cat ${join(outside, 'outside.txt')}` }, root)).toBeUndefined()
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(outside, { recursive: true, force: true })
    }
  })
})

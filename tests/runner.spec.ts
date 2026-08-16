import { lstat, mkdtemp, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { hashDirectory } from '../src/hash.ts'
import {
  candidatePathGuard, copyWorkspaceSnapshot, replayDisplayNames, requestSurfaceEvidence,
} from '../src/runner.ts'

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
      })
      expect(isolated.durable).toBe(false)
      expect(isolated.provenance.executionCwd).not.toBe(resolve(sourceCwd))
      expect((await lstat(join(isolated.provenance.executionCwd, 'dangling-bin'))).isSymbolicLink()).toBe(true)
      expect(await readlink(join(isolated.provenance.executionCwd, 'dangling-bin'))).toBe('../missing-package/bin.js')
      await writeFile(join(isolated.provenance.executionCwd, 'task.txt'), 'candidate mutation', 'utf8')
      expect(await readFile(join(sourceCwd, 'task.txt'), 'utf8')).toBe('source')
      expect(await hashDirectory(isolated.provenance.executionCwd)).not.toBe(sourceHash)
    } finally {
      if (isolatedRoot !== undefined) await rm(isolatedRoot, { recursive: true, force: true })
      await rm(sourceCwd, { recursive: true, force: true })
    }
  })

  it('fails before copying when the source no longer matches its frozen hash', async () => {
    const sourceCwd = await mkdtemp(join(tmpdir(), 'rld-runner-stale-'))
    try {
      await writeFile(join(sourceCwd, 'task.txt'), 'changed', 'utf8')
      await expect(copyWorkspaceSnapshot(sourceCwd, '0'.repeat(64))).rejects.toThrow(/changed after/)
    } finally {
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

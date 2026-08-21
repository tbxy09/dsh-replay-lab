import { execFile } from 'node:child_process'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { DefaultReplayWorkspaceProvider } from '../src/replay-workspace.ts'
import { hashDirectory } from '../src/hash.ts'

const execFileAsync = promisify(execFile)

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
  })
  return result.stdout.trim()
}

async function initRepo(prefix: string): Promise<string> {
  const parent = join(process.cwd(), '.tmp', 'git-fixtures')
  const template = join(parent, 'empty-template')
  await import('node:fs/promises').then(({ mkdir }) => mkdir(template, { recursive: true }))
  const cwd = await mkdtemp(join(parent, prefix))
  await git(cwd, ['init', `--template=${template}`])
  await git(cwd, ['checkout', '-b', 'main'])
  await writeFile(join(cwd, 'task.txt'), 's0', 'utf8')
  await git(cwd, ['add', 'task.txt'])
  await git(cwd, ['commit', '-m', 's0'])
  return cwd
}

describe('ReplayWorkspaceProvider', () => {
  it('never git-inits a non-git source and uses a disjoint file snapshot', async () => {
    const sourceCwd = await mkdtemp(join(tmpdir(), 'rld-nongit-'))
    let isolatedRoot: string | undefined
    try {
      await writeFile(join(sourceCwd, 'task.txt'), 'plain', 'utf8')
      const provider = new DefaultReplayWorkspaceProvider()
      const s0 = await provider.checkpoint(sourceCwd, 'turn-start')
      expect(s0.kind).toBe('files')
      expect(s0.git).toBeUndefined()
      await access(join(sourceCwd, '.git')).then(() => { throw new Error('git init mutated the non-git source') }, () => undefined)
      const isolated = await provider.materialize(s0)
      isolatedRoot = isolated.root
      expect(isolated.provenance.isolation).toBe('copy')
      await writeFile(join(isolated.provenance.executionCwd, 'task.txt'), 'c1', 'utf8')
      await writeFile(join(sourceCwd, 'task.txt'), 's1', 'utf8')
      await provider.restore(isolated)
      expect(await readFile(join(isolated.provenance.executionCwd, 'task.txt'), 'utf8')).toBe('plain')
      expect(await readFile(join(sourceCwd, 'task.txt'), 'utf8')).toBe('s1')
    } finally {
      if (isolatedRoot !== undefined) await rm(isolatedRoot, { recursive: true, force: true })
      await rm(sourceCwd, { recursive: true, force: true })
    }
  })

  it('materializes a git worktree from the stored S0 commit after HEAD and the worktree advance', async () => {
    const sourceCwd = await initRepo('rld-git-clean-')
    const provider = new DefaultReplayWorkspaceProvider()
    let isolated: Awaited<ReturnType<DefaultReplayWorkspaceProvider['materialize']>> | undefined
    try {
      const headBefore = await git(sourceCwd, ['rev-parse', 'HEAD'])
      const s0 = await provider.checkpoint(sourceCwd, 'turn-start')
      expect(s0.kind).toBe('git-commit')
      expect(s0.git?.commit).toMatch(/^[0-9a-f]{40,64}$/i)
      await writeFile(join(sourceCwd, 'task.txt'), 's1', 'utf8')
      await git(sourceCwd, ['add', 'task.txt'])
      await git(sourceCwd, ['commit', '-m', 's1'])
      expect(await git(sourceCwd, ['rev-parse', 'HEAD'])).not.toBe(headBefore)

      isolated = await provider.materialize(s0)
      expect(isolated.provenance.isolation).toBe('git-worktree')
      expect(await readFile(join(isolated.provenance.executionCwd, 'task.txt'), 'utf8')).toBe('s0')
      expect(await readFile(join(sourceCwd, 'task.txt'), 'utf8')).toBe('s1')
      await writeFile(join(isolated.provenance.executionCwd, 'task.txt'), 'c1', 'utf8')
      await provider.restore(isolated)
      expect(await readFile(join(isolated.provenance.executionCwd, 'task.txt'), 'utf8')).toBe('s0')
      expect(await readFile(join(sourceCwd, 'task.txt'), 'utf8')).toBe('s1')
      expect(await git(sourceCwd, ['rev-parse', 'HEAD'])).not.toBe(headBefore)
    } finally {
      if (isolated !== undefined) {
        const root = isolated.root
        await provider.dispose(isolated).catch(() => rm(root, { recursive: true, force: true }))
      }
      await rm(sourceCwd, { recursive: true, force: true })
    }
  })

  it('captures dirty untracked files in a private snapshot commit without moving HEAD', async () => {
    const sourceCwd = await initRepo('rld-git-dirty-')
    const provider = new DefaultReplayWorkspaceProvider()
    let isolated: Awaited<ReturnType<DefaultReplayWorkspaceProvider['materialize']>> | undefined
    try {
      const headBefore = await git(sourceCwd, ['rev-parse', 'HEAD'])
      await writeFile(join(sourceCwd, 'task.txt'), 'dirty', 'utf8')
      await writeFile(join(sourceCwd, 'extra.txt'), 'untracked', 'utf8')
      const s0 = await provider.checkpoint(sourceCwd, 'turn-start')
      expect(s0.kind).toBe('git-commit')
      expect(await git(sourceCwd, ['rev-parse', 'HEAD'])).toBe(headBefore)
      await writeFile(join(sourceCwd, 'task.txt'), 's1', 'utf8')
      isolated = await provider.materialize(s0)
      expect(await readFile(join(isolated.provenance.executionCwd, 'task.txt'), 'utf8')).toBe('dirty')
      expect(await readFile(join(isolated.provenance.executionCwd, 'extra.txt'), 'utf8')).toBe('untracked')
      expect(await readFile(join(sourceCwd, 'task.txt'), 'utf8')).toBe('s1')
    } finally {
      if (isolated !== undefined) {
        const root = isolated.root
        await provider.dispose(isolated).catch(() => rm(root, { recursive: true, force: true }))
      }
      await rm(sourceCwd, { recursive: true, force: true })
    }
  })

  it('hashes a non-git S0 independently from later source mutations', async () => {
    const sourceCwd = await mkdtemp(join(tmpdir(), 'rld-hash-'))
    try {
      await writeFile(join(sourceCwd, 'task.txt'), 's0', 'utf8')
      const hash = await hashDirectory(sourceCwd)
      const s0 = await new DefaultReplayWorkspaceProvider().checkpoint(sourceCwd, 'turn-start')
      expect(s0.sourceHash).toBe(hash)
      await writeFile(join(sourceCwd, 'task.txt'), 's1', 'utf8')
      expect(await hashDirectory(sourceCwd)).not.toBe(hash)
      expect(s0.sourceHash).toBe(hash)
    } finally {
      await rm(sourceCwd, { recursive: true, force: true })
    }
  })
})

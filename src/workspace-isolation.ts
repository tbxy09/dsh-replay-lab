import { createHash } from 'node:crypto'
import { cp, lstat, mkdtemp, readFile, readdir, readlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, relative, resolve } from 'node:path'
import { canonicalJson } from './hash.ts'
import type { WorkspaceProvenance } from './types.ts'

const IGNORED_NAMES = new Set(['.git', 'node_modules'])
export const WORKSPACE_COPY_POLICY = 'copy-v1:exclude-.git,node_modules'

function ignored(path: string): boolean {
  return IGNORED_NAMES.has(basename(path))
}

/** Hash exactly the files copied by the candidate workspace policy. */
export async function hashReplayWorkspace(root: string): Promise<string> {
  const absoluteRoot = resolve(root)
  const entries: Array<{ path: string; kind: 'file' | 'link'; hash: string; size: number }> = []
  const visit = async (directory: string): Promise<void> => {
    for (const name of (await readdir(directory)).sort()) {
      if (IGNORED_NAMES.has(name)) continue
      const target = join(directory, name)
      const info = await lstat(target)
      if (info.isDirectory()) {
        await visit(target)
      } else if (info.isSymbolicLink()) {
        const link = await readlink(target)
        entries.push({
          path: relative(absoluteRoot, target).replaceAll('\\', '/'),
          kind: 'link',
          hash: createHash('sha256').update(link).digest('hex'),
          size: Buffer.byteLength(link),
        })
      } else if (info.isFile()) {
        const bytes = await readFile(target)
        entries.push({
          path: relative(absoluteRoot, target).replaceAll('\\', '/'),
          kind: 'file',
          hash: createHash('sha256').update(bytes).digest('hex'),
          size: bytes.length,
        })
      }
    }
  }
  await visit(absoluteRoot)
  return createHash('sha256').update(canonicalJson(entries)).digest('hex')
}

export interface IsolatedWorkspace {
  cwd: string
  provenance: WorkspaceProvenance
  cleanup(): Promise<void>
}

export interface WorkspaceIsolator {
  isolate(sourceCwd: string, expectedSourceHash: string): Promise<IsolatedWorkspace>
}

/**
 * Candidate runs receive a disposable copy. The source is hashed again before
 * copying and the copy is hashed afterwards; any drift fails closed.
 */
export class CopyWorkspaceIsolator implements WorkspaceIsolator {
  async isolate(sourceCwd: string, expectedSourceHash: string): Promise<IsolatedWorkspace> {
    const source = resolve(sourceCwd)
    const sourceHash = await hashReplayWorkspace(source)
    if (sourceHash !== expectedSourceHash) {
      throw new Error('source workspace changed after the replay turn was frozen; freeze it again before running')
    }
    const parent = await mkdtemp(join(tmpdir(), 'dsh-replay-workspace-'))
    const cwd = join(parent, 'workspace')
    try {
      await cp(source, cwd, {
        recursive: true,
        preserveTimestamps: true,
        filter: path => !ignored(path),
      })
      const executionHash = await hashReplayWorkspace(cwd)
      if (executionHash !== sourceHash) throw new Error('isolated workspace copy does not match its source snapshot')
      return {
        cwd,
        provenance: {
          sourceCwd: source,
          sourceHash,
          executionCwd: cwd,
          executionHash,
          isolation: 'copy',
          policy: WORKSPACE_COPY_POLICY,
        },
        cleanup: async () => { await rm(parent, { recursive: true, force: true }) },
      }
    } catch (error) {
      await rm(parent, { recursive: true, force: true })
      throw error
    }
  }
}

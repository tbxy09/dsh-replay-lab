import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, realpathSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { hashDirectory } from './hash.ts'
import type { ReplayWorkspaceCheckpoint, WorkspaceProvenance } from './types.ts'

const execFileAsync = promisify(execFile)
const CHECKPOINT_DIRECTORY = '.replay-checkpoint'
const CHECKPOINT_MANIFEST = '.replay-workspace.json'
const GIT_REF_PREFIX = 'refs/replay-lab/s0'

export interface IsolatedWorkspace {
  root: string
  durable: boolean
  provenance: WorkspaceProvenance
  worktreeCwd?: string
}

export interface WorkspaceSnapshotOptions {
  parentDirectory?: string
  executionName?: string
  capturedAt?: ReplayWorkspaceCheckpoint['capturedAt']
}

export interface CandidateWorkspace extends IsolatedWorkspace {
  checkpoint: ReplayWorkspaceCheckpoint
}

export interface ReplayWorkspaceProvider {
  checkpoint(sourceCwd: string, capturedAt?: ReplayWorkspaceCheckpoint['capturedAt']): Promise<ReplayWorkspaceCheckpoint>
  materialize(
    checkpoint: ReplayWorkspaceCheckpoint,
    expectedHash?: string,
    options?: WorkspaceSnapshotOptions,
  ): Promise<CandidateWorkspace>
  restore(workspace: CandidateWorkspace | IsolatedWorkspace, expectedHash?: string): Promise<void>
  dispose(workspace: CandidateWorkspace | IsolatedWorkspace): Promise<void>
}

interface WorkspaceCheckpointManifest {
  version: 1 | 2
  sourceCwd: string
  sourceHash: string
  expectedHash: string
  checkpointDirectory?: string
  checkpointHash: string
  executionDirectory: string
  createdAt: string
  capturedAt?: ReplayWorkspaceCheckpoint['capturedAt']
  kind?: ReplayWorkspaceCheckpoint['kind']
  git?: ReplayWorkspaceCheckpoint['git']
  worktreeDirectory?: string
  rollback: 'pending' | 'restored' | 'failed'
  restoredHash?: string
  completedAt?: string
  error?: string
}

function objectEnv(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...process.env, GIT_TERMINAL_PROMPT: '0', ...extra }
}

function realTarget(path: string): string {
  const target = resolve(path)
  let existing = target
  while (!existsSync(existing)) {
    const parent = dirname(existing)
    if (parent === existing) break
    existing = parent
  }
  return resolve(realpathSync(existing), relative(existing, target))
}

function inside(root: string, target: string): boolean {
  const child = relative(root, target)
  return child === '' || (child !== '..' && !child.startsWith(`..${sep}`))
}

function disjoint(root: string, sourceCwd: string): boolean {
  return !inside(root, sourceCwd) && !inside(sourceCwd, root)
}

function safePathSegment(value: string): string {
  const segment = value.normalize('NFKD').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return segment.slice(0, 96) || 'replay'
}

function checkpointRef(sourceCwd: string, hash: string): string {
  return `${GIT_REF_PREFIX}/${safePathSegment(basename(sourceCwd))}-${hash.slice(0, 16)}`
}

async function git(cwd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  const result = await execFileAsync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd, encoding: 'utf8', env: objectEnv(env),
  })
  return result.stdout.trim()
}

async function inspectGit(sourceCwd: string): Promise<{ gitRoot: string; sourceRelative: string; head: string } | undefined> {
  const source = resolve(sourceCwd)
  try {
    const gitRoot = resolve(await git(source, ['rev-parse', '--show-toplevel']))
    if (!inside(gitRoot, source)) return undefined
    const head = await git(gitRoot, ['rev-parse', 'HEAD'])
    if (!/^[0-9a-f]{40,64}$/i.test(head)) return undefined
    const sourceRelative = relative(gitRoot, source).replaceAll('\\', '/') || '.'
    return { gitRoot, sourceRelative, head }
  } catch {
    return undefined
  }
}

async function snapshotGit(
  source: string,
  capturedAt: ReplayWorkspaceCheckpoint['capturedAt'],
): Promise<ReplayWorkspaceCheckpoint | undefined> {
  const inspected = await inspectGit(source)
  if (inspected === undefined) return undefined
  const { gitRoot, sourceRelative, head } = inspected
  const indexFile = join(tmpdir(), `replay-lab-${randomUUID()}.index`)
  try {
    await git(gitRoot, ['read-tree', head], { GIT_INDEX_FILE: indexFile })
    await git(gitRoot, ['add', '-A', '--', sourceRelative], { GIT_INDEX_FILE: indexFile })
    const tree = await git(gitRoot, ['write-tree'], { GIT_INDEX_FILE: indexFile })
    const commit = await git(gitRoot, [
      'commit-tree', tree, '-p', head, '-m', `replay-lab S0 ${capturedAt} ${sourceRelative}`,
    ], {
      GIT_INDEX_FILE: indexFile,
      GIT_AUTHOR_NAME: 'replay-lab',
      GIT_AUTHOR_EMAIL: 'replay-lab@localhost',
      GIT_COMMITTER_NAME: 'replay-lab',
      GIT_COMMITTER_EMAIL: 'replay-lab@localhost',
    })
    const ref = checkpointRef(source, commit)
    await git(gitRoot, ['update-ref', ref, commit])
    const createdAt = new Date().toISOString()
    return {
      schemaVersion: 'replay-workspace-checkpoint/v1',
      kind: 'git-commit',
      sourceCwd: source,
      checkpointHash: tree,
      sourceHash: tree,
      createdAt,
      capturedAt,
      git: { gitRoot, commit, tree, sourceRelative, ref },
    }
  } finally {
    await rm(indexFile, { force: true })
  }
}

function filesCheckpoint(
  source: string,
  hash: string,
  capturedAt: ReplayWorkspaceCheckpoint['capturedAt'],
  checkpointCwd?: string,
): ReplayWorkspaceCheckpoint {
  return {
    schemaVersion: 'replay-workspace-checkpoint/v1',
    kind: 'files',
    sourceCwd: source,
    checkpointHash: hash,
    sourceHash: hash,
    createdAt: new Date().toISOString(),
    capturedAt,
    ...(checkpointCwd === undefined ? {} : { checkpointCwd }),
  }
}

function provenanceFor(
  checkpoint: ReplayWorkspaceCheckpoint,
  expectedHash: string,
  currentHash: string,
  executionCwd: string,
  executionHash: string,
  durable: boolean,
): WorkspaceProvenance {
  return {
    sourceCwd: checkpoint.sourceCwd,
    sourceHash: checkpoint.sourceHash,
    executionCwd,
    executionHash,
    isolation: checkpoint.kind === 'git-commit' ? 'git-worktree' : 'copy',
    drift: {
      detected: currentHash !== expectedHash,
      frozenHash: expectedHash,
      currentHash,
    },
    checkpoint: {
      schemaVersion: checkpoint.schemaVersion,
      kind: checkpoint.kind,
      checkpointHash: checkpoint.checkpointHash,
      sourceHash: checkpoint.sourceHash,
      createdAt: checkpoint.createdAt,
      capturedAt: checkpoint.capturedAt,
      ...(checkpoint.checkpointCwd === undefined ? {} : { checkpointCwd: checkpoint.checkpointCwd }),
      ...(checkpoint.git === undefined ? {} : { git: checkpoint.git }),
    },
    rollback: { status: 'pending' },
    policy: checkpoint.kind === 'git-commit'
      ? durable
        ? 'pre-turn git commit/tree materialized as a detached worktree; source HEAD is not used after baseline'
        : 'pre-turn git commit/tree materialized as a process-owned detached worktree; source HEAD is not used after baseline'
      : durable
        ? 'checkpointed symlink-preserving copy in the Replay Lab managed artifact directory; execution cwd restored at terminal state'
        : 'checkpointed symlink-preserving copy in a process-owned temporary directory; execution cwd restored at terminal state',
  }
}

function manifestFor(workspace: IsolatedWorkspace, expectedHash: string): WorkspaceCheckpointManifest {
  const checkpoint = workspace.provenance.checkpoint
  if (checkpoint === undefined) throw new Error('candidate workspace has no replay checkpoint')
  return {
    version: 2,
    sourceCwd: workspace.provenance.sourceCwd,
    sourceHash: workspace.provenance.sourceHash,
    expectedHash,
    ...(checkpoint.checkpointCwd === undefined
      ? {}
      : { checkpointDirectory: relative(workspace.root, checkpoint.checkpointCwd) }),
    checkpointHash: checkpoint.checkpointHash,
    executionDirectory: relative(workspace.root, workspace.provenance.executionCwd),
    createdAt: checkpoint.createdAt,
    capturedAt: checkpoint.capturedAt,
    kind: checkpoint.kind,
    ...(checkpoint.git === undefined ? {} : { git: checkpoint.git }),
    ...(workspace.worktreeCwd === undefined ? {} : { worktreeDirectory: relative(workspace.root, workspace.worktreeCwd) }),
    rollback: workspace.provenance.rollback?.status === 'restored' ? 'restored'
      : workspace.provenance.rollback?.status === 'failed' ? 'failed' : 'pending',
    ...(workspace.provenance.rollback?.restoredHash === undefined ? {} : { restoredHash: workspace.provenance.rollback.restoredHash }),
    ...(workspace.provenance.rollback?.completedAt === undefined ? {} : { completedAt: workspace.provenance.rollback.completedAt }),
    ...(workspace.provenance.rollback?.error === undefined ? {} : { error: workspace.provenance.rollback.error }),
  }
}

async function writeCheckpointManifest(workspace: IsolatedWorkspace, expectedHash: string): Promise<void> {
  const target = join(workspace.root, CHECKPOINT_MANIFEST)
  const temporary = `${target}.${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify(manifestFor(workspace, expectedHash), null, 2), 'utf8')
  await rename(temporary, target)
}

export function assertWorkspaceBoundary(workspace: IsolatedWorkspace): {
  root: string
  executionCwd: string
  checkpointCwd?: string
} {
  const root = resolve(workspace.root)
  const sourceCwd = resolve(workspace.provenance.sourceCwd)
  const executionCwd = resolve(workspace.provenance.executionCwd)
  const checkpointCwd = workspace.provenance.checkpoint?.checkpointCwd
  if (!disjoint(root, sourceCwd)) throw new Error('candidate workspace root must be disjoint from the source workspace')
  if (executionCwd === root || !inside(root, executionCwd)) {
    throw new Error('candidate execution path must be a distinct child of the isolated root')
  }
  if (checkpointCwd !== undefined) {
    const checkpoint = resolve(checkpointCwd)
    if (checkpoint === root || checkpoint === executionCwd || !inside(root, checkpoint)) {
      throw new Error('candidate execution and checkpoint paths must be distinct children of the isolated root')
    }
    return { root, executionCwd, checkpointCwd: checkpoint }
  }
  if (workspace.provenance.checkpoint?.kind !== 'git-commit') {
    throw new Error('candidate workspace has no replay checkpoint')
  }
  const gitRoot = workspace.provenance.checkpoint.git?.gitRoot
  if (gitRoot !== undefined && !disjoint(root, gitRoot)) {
    throw new Error('candidate worktree must be disjoint from the source git repository')
  }
  return { root, executionCwd }
}

async function restoreFiles(workspace: IsolatedWorkspace, expectedHash?: string): Promise<void> {
  const { root, executionCwd, checkpointCwd } = assertWorkspaceBoundary(workspace)
  if (checkpointCwd === undefined) throw new Error('candidate workspace has no replay checkpoint')
  const checkpointHash = workspace.provenance.checkpoint?.checkpointHash
  if (checkpointHash === undefined) throw new Error('candidate workspace has no replay checkpoint hash')
  const staging = join(root, `.replay-restore-${randomUUID()}`)
  const backup = join(root, `.replay-mutated-${randomUUID()}`)
  let movedExecution = false
  try {
    const actualCheckpointHash = await hashDirectory(checkpointCwd)
    if (actualCheckpointHash !== checkpointHash) throw new Error('replay checkpoint hash changed before rollback')
    await cp(checkpointCwd, staging, {
      recursive: true, dereference: false, verbatimSymlinks: true, preserveTimestamps: true,
    })
    if (await hashDirectory(staging) !== checkpointHash) throw new Error('rollback staging copy does not match replay checkpoint')
    if (existsSync(executionCwd)) {
      await rename(executionCwd, backup)
      movedExecution = true
    }
    await rename(staging, executionCwd)
    const restoredHash = await hashDirectory(executionCwd)
    if (restoredHash !== checkpointHash) throw new Error('restored candidate workspace does not match replay checkpoint')
    if (movedExecution) await rm(backup, { recursive: true, force: true })
    workspace.provenance.rollback = { status: 'restored', restoredHash, completedAt: new Date().toISOString() }
    await writeCheckpointManifest(workspace, expectedHash ?? workspace.provenance.drift?.frozenHash ?? workspace.provenance.sourceHash)
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    if (movedExecution && !existsSync(executionCwd) && existsSync(backup)) await rename(backup, executionCwd)
    const message = error instanceof Error ? error.message : String(error)
    workspace.provenance.rollback = { status: 'failed', completedAt: new Date().toISOString(), error: message }
    await writeCheckpointManifest(workspace, expectedHash ?? workspace.provenance.drift?.frozenHash ?? workspace.provenance.sourceHash).catch(() => undefined)
    throw error
  }
}

async function restoreGit(workspace: IsolatedWorkspace, expectedHash?: string): Promise<void> {
  assertWorkspaceBoundary(workspace)
  const gitMeta = workspace.provenance.checkpoint?.git
  if (gitMeta === undefined) throw new Error('candidate workspace has no git checkpoint')
  const worktree = workspace.worktreeCwd ?? (gitMeta.sourceRelative === '.'
    ? workspace.provenance.executionCwd
    : resolve(workspace.provenance.executionCwd, ...gitMeta.sourceRelative.split('/').filter(Boolean).map(() => '..')))
  try {
    await git(worktree, ['reset', '--hard', gitMeta.commit])
    await git(worktree, ['clean', '-fdx', '--', gitMeta.sourceRelative])
    workspace.provenance.rollback = {
      status: 'restored',
      restoredHash: gitMeta.tree,
      completedAt: new Date().toISOString(),
    }
    await writeCheckpointManifest(workspace, expectedHash ?? workspace.provenance.drift?.frozenHash ?? workspace.provenance.sourceHash)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    workspace.provenance.rollback = { status: 'failed', completedAt: new Date().toISOString(), error: message }
    await writeCheckpointManifest(workspace, expectedHash ?? workspace.provenance.drift?.frozenHash ?? workspace.provenance.sourceHash).catch(() => undefined)
    throw error
  }
}

async function materializeFiles(
  checkpoint: ReplayWorkspaceCheckpoint,
  expectedHash: string,
  options: WorkspaceSnapshotOptions,
): Promise<CandidateWorkspace> {
  const source = resolve(checkpoint.sourceCwd)
  const durable = options.parentDirectory !== undefined
  const parent = durable ? resolve(options.parentDirectory as string) : tmpdir()
  if (inside(source, parent)) throw new Error('candidate workspace parent must not be inside the source workspace')
  await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, 'candidate-'))
  const executionCwd = join(root, safePathSegment(options.executionName ?? 'replay'))
  const checkpointCwd = join(root, CHECKPOINT_DIRECTORY)
  try {
    if (!disjoint(resolve(root), source)) {
      throw new Error('candidate workspace root must be disjoint from the source workspace')
    }
    const snapshotSource = checkpoint.checkpointCwd === undefined ? source : checkpoint.checkpointCwd
    if (checkpoint.checkpointCwd !== undefined && !disjoint(checkpoint.checkpointCwd, source)) {
      throw new Error('stored S0 snapshot must be disjoint from the source workspace')
    }
    await cp(snapshotSource, checkpointCwd, {
      recursive: true, dereference: false, verbatimSymlinks: true, preserveTimestamps: true,
    })
    const checkpointHash = await hashDirectory(checkpointCwd)
    if (checkpoint.checkpointCwd === undefined && checkpointHash !== await hashDirectory(source)) {
      throw new Error('replay checkpoint does not match the current source snapshot')
    }
    if (checkpoint.checkpointCwd !== undefined && checkpointHash !== checkpoint.checkpointHash) {
      throw new Error('replay checkpoint does not match the stored S0 snapshot')
    }
    await cp(checkpointCwd, executionCwd, {
      recursive: true, dereference: false, verbatimSymlinks: true, preserveTimestamps: true,
    })
    const executionHash = await hashDirectory(executionCwd)
    if (executionHash !== checkpointHash) throw new Error('isolated workspace copy does not match its replay checkpoint')
    const stored = { ...checkpoint, checkpointCwd, checkpointHash, sourceHash: checkpointHash }
    const currentHash = await currentSourceHash(source).catch(() => checkpointHash)
    const workspace: CandidateWorkspace = {
      root, durable, checkpoint: stored,
      provenance: provenanceFor(stored, expectedHash, currentHash, executionCwd, executionHash, durable),
    }
    await writeCheckpointManifest(workspace, expectedHash)
    return workspace
  } catch (error) {
    await rm(root, { recursive: true, force: true })
    throw error
  }
}

async function materializeGit(
  checkpoint: ReplayWorkspaceCheckpoint,
  expectedHash: string,
  options: WorkspaceSnapshotOptions,
): Promise<CandidateWorkspace> {
  const gitMeta = checkpoint.git
  if (gitMeta === undefined) throw new Error('git checkpoint is missing commit metadata')
  const source = resolve(checkpoint.sourceCwd)
  const durable = options.parentDirectory !== undefined
  const parent = durable ? resolve(options.parentDirectory as string) : tmpdir()
  if (inside(source, parent) || inside(gitMeta.gitRoot, parent)) {
    throw new Error('candidate workspace parent must not be inside the source workspace')
  }
  await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, 'candidate-'))
  const worktree = join(root, safePathSegment(options.executionName ?? 'replay'))
  try {
    if (!disjoint(root, source) || !disjoint(root, gitMeta.gitRoot)) {
      throw new Error('candidate worktree must be disjoint from the source git repository')
    }
    await git(gitMeta.gitRoot, ['worktree', 'add', '--detach', worktree, gitMeta.commit])
    const executionCwd = gitMeta.sourceRelative === '.' ? worktree : join(worktree, gitMeta.sourceRelative)
    const currentHash = await currentSourceHash(source).catch(() => checkpoint.sourceHash)
    const workspace: CandidateWorkspace = {
      root, durable, checkpoint, worktreeCwd: worktree,
      provenance: provenanceFor(checkpoint, expectedHash, currentHash, executionCwd, gitMeta.tree, durable),
    }
    await writeCheckpointManifest(workspace, expectedHash)
    return workspace
  } catch (error) {
    await git(gitMeta.gitRoot, ['worktree', 'remove', '--force', worktree]).catch(() => undefined)
    await rm(root, { recursive: true, force: true })
    throw error
  }
}

export class DefaultReplayWorkspaceProvider implements ReplayWorkspaceProvider {
  constructor(private readonly snapshotDirectory?: string) {}

  async checkpoint(
    sourceCwd: string,
    capturedAt: ReplayWorkspaceCheckpoint['capturedAt'] = 'materialize',
  ): Promise<ReplayWorkspaceCheckpoint> {
    const source = resolve(sourceCwd)
    const gitCheckpoint = await snapshotGit(source, capturedAt)
    if (gitCheckpoint !== undefined) return gitCheckpoint
    const parent = this.snapshotDirectory === undefined ? tmpdir() : resolve(this.snapshotDirectory)
    await mkdir(parent, { recursive: true })
    const checkpointCwd = await mkdtemp(join(parent, 's0-'))
    if (!disjoint(checkpointCwd, source)) {
      await rm(checkpointCwd, { recursive: true, force: true })
      throw new Error('S0 snapshot directory must be disjoint from the source workspace')
    }
    await cp(source, checkpointCwd, {
      recursive: true, dereference: false, verbatimSymlinks: true, preserveTimestamps: true,
    })
    const hash = await hashDirectory(checkpointCwd)
    if (hash !== await hashDirectory(source)) {
      await rm(checkpointCwd, { recursive: true, force: true })
      throw new Error('replay checkpoint does not match the current source snapshot')
    }
    return filesCheckpoint(source, hash, capturedAt, checkpointCwd)
  }

  async materialize(
    checkpoint: ReplayWorkspaceCheckpoint,
    expectedHash = checkpoint.sourceHash,
    options: WorkspaceSnapshotOptions = {},
  ): Promise<CandidateWorkspace> {
    if (checkpoint.kind === 'git-commit') return materializeGit(checkpoint, expectedHash, options)
    return materializeFiles(checkpoint, expectedHash, options)
  }

  async restore(workspace: CandidateWorkspace | IsolatedWorkspace, expectedHash?: string): Promise<void> {
    if (workspace.provenance.checkpoint?.kind === 'git-commit') {
      await restoreGit(workspace, expectedHash)
      return
    }
    await restoreFiles(workspace, expectedHash)
  }

  async dispose(workspace: CandidateWorkspace | IsolatedWorkspace): Promise<void> {
    assertWorkspaceBoundary(workspace)
    if (workspace.durable) throw new Error('durable replay workspaces are retained for session/sidebar recovery')
    const gitMeta = workspace.provenance.checkpoint?.git
    if (gitMeta !== undefined) {
      const worktree = workspace.worktreeCwd ?? join(workspace.root, relative(workspace.root, workspace.provenance.executionCwd).split(sep)[0] ?? '')
      await git(gitMeta.gitRoot, ['worktree', 'remove', '--force', worktree]).catch(() => undefined)
    }
    await rm(resolve(workspace.root), { recursive: true, force: true })
  }
}

const defaultProvider = new DefaultReplayWorkspaceProvider()

/** Copy current source state into an isolated candidate. Prefer a stored S0 checkpoint at replay time. */
export async function copyWorkspaceSnapshot(
  sourceCwd: string,
  expectedHash: string,
  options: WorkspaceSnapshotOptions = {},
): Promise<IsolatedWorkspace> {
  const checkpoint = await defaultProvider.checkpoint(sourceCwd, options.capturedAt ?? 'materialize')
  return defaultProvider.materialize(checkpoint, expectedHash, options)
}

export async function materializeWorkspaceCheckpoint(
  checkpoint: ReplayWorkspaceCheckpoint,
  expectedHash: string,
  options: WorkspaceSnapshotOptions = {},
): Promise<IsolatedWorkspace> {
  return defaultProvider.materialize(checkpoint, expectedHash, options)
}

export async function rollbackWorkspaceSnapshot(workspace: IsolatedWorkspace, expectedHash?: string): Promise<void> {
  await defaultProvider.restore(workspace, expectedHash)
}

export async function discardWorkspaceSnapshot(workspace: IsolatedWorkspace): Promise<void> {
  await defaultProvider.dispose(workspace)
}

export async function recoverManagedWorkspaceSnapshots(parentDirectory: string): Promise<number> {
  const parent = resolve(parentDirectory)
  let names: string[]
  try { names = await readdir(parent) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0
    throw error
  }
  let recovered = 0
  for (const name of names.filter(item => item.startsWith('candidate-'))) {
    const root = join(parent, name)
    let manifest: WorkspaceCheckpointManifest
    try {
      manifest = JSON.parse(await readFile(join(root, CHECKPOINT_MANIFEST), 'utf8')) as WorkspaceCheckpointManifest
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    if (manifest.version !== 1 && manifest.version !== 2) throw new Error(`unsupported replay workspace manifest in ${root}`)
    const kind = manifest.kind ?? 'files'
    const executionCwd = join(root, manifest.executionDirectory)
    const workspace: IsolatedWorkspace = {
      root,
      durable: true,
      ...(manifest.worktreeDirectory === undefined ? {} : { worktreeCwd: join(root, manifest.worktreeDirectory) }),
      provenance: {
        sourceCwd: manifest.sourceCwd,
        sourceHash: manifest.sourceHash,
        executionCwd,
        executionHash: manifest.checkpointHash,
        isolation: kind === 'git-commit' ? 'git-worktree' : 'copy',
        policy: 'recovered durable replay checkpoint; execution cwd restored after host restart',
        checkpoint: {
          schemaVersion: 'replay-workspace-checkpoint/v1',
          kind,
          checkpointHash: manifest.checkpointHash,
          sourceHash: manifest.sourceHash,
          createdAt: manifest.createdAt,
          capturedAt: manifest.capturedAt ?? 'materialize',
          ...(manifest.checkpointDirectory === undefined
            ? {}
            : { checkpointCwd: join(root, manifest.checkpointDirectory) }),
          ...(manifest.git === undefined ? {} : { git: manifest.git }),
        },
        rollback: { status: 'pending' },
        drift: {
          detected: manifest.sourceHash !== manifest.expectedHash,
          frozenHash: manifest.expectedHash,
          currentHash: manifest.sourceHash,
        },
      },
    }
    await rollbackWorkspaceSnapshot(workspace, manifest.expectedHash)
    recovered += 1
  }
  return recovered
}

export class TurnCheckpointStore {
  private readonly checkpoints = new Map<string, ReplayWorkspaceCheckpoint>()

  static key(sessionId: string, turn: number): string {
    return `${sessionId}:${turn}`
  }

  get(sessionId: string, turn: number): ReplayWorkspaceCheckpoint | undefined {
    return this.checkpoints.get(TurnCheckpointStore.key(sessionId, turn))
  }

  set(sessionId: string, turn: number, checkpoint: ReplayWorkspaceCheckpoint): void {
    this.checkpoints.set(TurnCheckpointStore.key(sessionId, turn), checkpoint)
  }

  remember(checkpoint: ReplayWorkspaceCheckpoint, sessionId: string, turn: number): ReplayWorkspaceCheckpoint {
    this.set(sessionId, turn, checkpoint)
    return checkpoint
  }
}

export async function currentSourceHash(sourceCwd: string): Promise<string> {
  const inspected = await inspectGit(sourceCwd)
  if (inspected === undefined) return hashDirectory(resolve(sourceCwd))
  const indexFile = join(tmpdir(), `replay-lab-hash-${randomUUID()}.index`)
  try {
    await git(inspected.gitRoot, ['read-tree', inspected.head], { GIT_INDEX_FILE: indexFile })
    await git(inspected.gitRoot, ['add', '-A', '--', inspected.sourceRelative], { GIT_INDEX_FILE: indexFile })
    return await git(inspected.gitRoot, ['write-tree'], { GIT_INDEX_FILE: indexFile })
  } catch {
    return hashDirectory(resolve(sourceCwd))
  } finally {
    await rm(indexFile, { force: true })
  }
}

export { realTarget, inside, disjoint, safePathSegment }

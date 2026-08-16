import { randomUUID } from 'node:crypto'
import { existsSync, realpathSync } from 'node:fs'
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-presets'
import { createUserMessage, LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-session-title'
import type {} from '@deepseek-ai/dsh-workspace'
import { evidenceDigest } from './metrics.ts'
import { canonicalJson, hashDirectory, sha256 } from './hash.ts'
import type { MetricsExtractor, Runner, VariantContributor } from './registries.ts'
import type {
  FrozenReplayCase, RequestSurfaceEvidence, RunEvidence, VariantDescriptor, WorkspaceProvenance,
} from './types.ts'

export interface IsolatedWorkspace {
  root: string
  durable: boolean
  provenance: WorkspaceProvenance
}

export interface WorkspaceSnapshotOptions {
  /** Persistent parent used by approved candidate sessions so sidebar membership survives restart. */
  parentDirectory?: string
  /** Human-derived leaf name; only filesystem-safe characters are retained. */
  executionName?: string
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function realTarget(path: string): string {
  const target = resolve(path)
  let existing = target
  while (!existsSync(existing)) {
    const parent = dirname(existing)
    if (parent === existing) break
    existing = parent
  }
  const canonicalExisting = realpathSync(existing)
  return resolve(canonicalExisting, relative(existing, target))
}

function inside(root: string, target: string): boolean {
  const child = relative(root, target)
  return child === '' || (child !== '..' && !child.startsWith(`..${sep}`))
}

function pathValues(value: unknown, key = ''): string[] {
  if (typeof value === 'string') return /(?:^|_)(?:path|paths|cwd|workdir|file|files|directory|directories)$/i.test(key) ? [value] : []
  if (Array.isArray(value)) return value.flatMap(item => pathValues(item, key))
  if (value === null || typeof value !== 'object') return []
  return Object.entries(value).flatMap(([childKey, child]) => pathValues(child, childKey))
}

/** Monotonic guard for structured file arguments used by replay agents and descendants. */
export function candidatePathGuard(argumentsValue: unknown, executionCwd: string): string | undefined {
  const root = realTarget(executionCwd)
  for (const value of pathValues(argumentsValue)) {
    if (!value.startsWith(sep)) continue
    if (!inside(root, realTarget(value))) {
      return `Replay candidates may access files only inside their isolated workspace: ${executionCwd}`
    }
  }
  return undefined
}

/** Recover every distinct, durable provider-bound request surface in log order. */
export function requestSurfaceEvidence(
  events: readonly unknown[],
  behavior: VariantDescriptor['behavior'],
): RequestSurfaceEvidence[] {
  const headers = events
    .filter((event): event is Record<string, unknown> => object(event).type === 'request/header')
    .map(event => object(object(event.data).header))
  return headers.map((header, index) => {
    const config = object(header.config)
    const tools = Array.isArray(header.tools) ? header.tools : []
    const phase = behavior === 'anchored'
      ? index === 0 ? 'bootstrap' : index === 1 ? 'promoted' : `dynamic-unlock-${index - 1}`
      : 'request'
    return {
      phase,
      provider: typeof config.provider === 'string' ? config.provider : '',
      model: typeof config.model === 'string' ? config.model : '',
      ...(typeof config.reasoningEffort === 'string' ? { reasoning: config.reasoningEffort } : {}),
      ...(typeof config.maxTokens === 'number' ? { maxTokens: config.maxTokens } : {}),
      systemHash: sha256(canonicalJson(header.system ?? null)),
      toolSchemaHash: sha256(canonicalJson(tools)),
      toolNames: tools.map(tool => object(tool).name).filter((name): name is string => typeof name === 'string'),
    }
  })
}

function safePathSegment(value: string): string {
  const segment = value.normalize('NFKD').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return segment.slice(0, 96) || 'replay'
}

export function replayDisplayNames(
  replayCase: Pick<FrozenReplayCase, 'sourceCwd' | 'sourceTurn'>,
  variant: Pick<VariantDescriptor, 'id' | 'label'>,
): { workspaceTitle: string; sessionTitle: string; executionName: string } {
  const source = basename(resolve(replayCase.sourceCwd)) || 'workspace'
  const candidate = variant.label.trim() || variant.id
  return {
    workspaceTitle: `${source} · Isolated Replay · Turn ${replayCase.sourceTurn} · ${candidate}`,
    sessionTitle: `Replay · Turn ${replayCase.sourceTurn} · ${candidate}`,
    executionName: safePathSegment(`${source}-turn-${replayCase.sourceTurn}-${variant.id}`),
  }
}

/** Copy the current source workspace and retain its comparison with the frozen case hash. */
export async function copyWorkspaceSnapshot(
  sourceCwd: string,
  expectedHash: string,
  options: WorkspaceSnapshotOptions = {},
): Promise<IsolatedWorkspace> {
  const source = resolve(sourceCwd)
  const sourceHash = await hashDirectory(source)
  const durable = options.parentDirectory !== undefined
  const parent = durable ? resolve(options.parentDirectory as string) : tmpdir()
  await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, 'candidate-'))
  const executionCwd = join(root, safePathSegment(options.executionName ?? 'replay'))
  try {
    await cp(source, executionCwd, {
      recursive: true, dereference: false, verbatimSymlinks: true, preserveTimestamps: true,
    })
    const executionHash = await hashDirectory(executionCwd)
    if (executionHash !== sourceHash) throw new Error('isolated workspace copy does not match the current source snapshot')
    return {
      root, durable,
      provenance: {
        sourceCwd: source, sourceHash, executionCwd, executionHash,
        isolation: 'copy',
        drift: { detected: sourceHash !== expectedHash, frozenHash: expectedHash, currentHash: sourceHash },
        policy: durable
          ? 'recursive symlink-preserving copy in the Replay Lab managed artifact directory'
          : 'recursive symlink-preserving copy in a process-owned temporary directory',
      },
    }
  } catch (error) {
    await rm(root, { recursive: true, force: true })
    throw error
  }
}

export class DeterministicReplayAdapter extends LlmAdapter {
  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const text = 'fixture-ok'
    const chunks: StreamChunk[] = [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text },
      { type: 'block-end', index: 0, block: { type: 'text', text } },
      { type: 'usage', usage: { inputTokens: 128, outputTokens: 10, cacheReadTokens: 64 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ]
    for (const chunk of chunks) {
      if (options.signal?.aborted) throw new Error('fixture run aborted')
      yield chunk
    }
  }
}

export class CordisAgentRunner implements Runner {
  readonly id = 'cordis-agent-runner'
  private readonly handles = new Set<AgentHandle>()
  private readonly isolatedRoots = new Set<string>()

  constructor(
    private readonly ctx: Context,
    private readonly metrics: MetricsExtractor,
    private readonly variantLookup: (id: string) => VariantContributor | undefined,
    private readonly managedWorkspaceDirectory?: string,
  ) {}

  async run(input: { replayCase: FrozenReplayCase; experimentId: string; variant: VariantDescriptor }): Promise<RunEvidence> {
    const sessionId = SessionId(`replay-${input.experimentId}-${input.variant.id}-${randomUUID()}`)
    const runId = `run-${randomUUID()}`
    const hookPhases: string[] = []
    let handle: AgentHandle | undefined
    let workspace: IsolatedWorkspace | undefined
    try {
      const variant = this.variantLookup(input.variant.id)
      if (variant === undefined || !variant.supported || variant.preset === undefined) {
        throw new Error(variant?.unsupportedReason ?? `variant ${input.variant.id} 不可运行`)
      }
      const names = replayDisplayNames(input.replayCase, input.variant)
      workspace = await copyWorkspaceSnapshot(
        input.replayCase.sourceCwd,
        input.replayCase.sourceWorkspaceHash,
        { parentDirectory: this.managedWorkspaceDirectory, executionName: names.executionName },
      )
      if (!workspace.durable) this.isolatedRoots.add(workspace.root)
      handle = await this.ctx.agents.create({
        sessionId,
        meta: { cwd: workspace.provenance.executionCwd, agentPreset: variant.preset },
        agentOptions: {
          provider: input.replayCase.provider,
          model: input.replayCase.model,
          maxTokens: input.replayCase.maxTokens,
          reasoningEffort: input.replayCase.reasoning,
        } as never,
        setup: async (agentCtx) => {
          await this.ctx.agentPresets.mount(agentCtx, variant.preset)
          variant.install?.(agentCtx, hookPhases)
        },
      })
      this.handles.add(handle)
      // Freeze every approved candidate (and its confined shell) to the isolated cwd,
      // independent of a user's deployment-wide default mode.
      setSandboxMode(handle.agent.session, 'workspace-write')
      this.ctx.sessionTitle.rename(handle.agent.session, names.sessionTitle)
      const replayWorkspace = await this.ctx.workspaceRegistry.create(
        workspace.provenance.executionCwd,
        names.workspaceTitle,
      )
      await replayWorkspace.attachSession(sessionId)

      // Keep the isolated sibling next to its source workspace while
      // preserving native cwd-validated membership.
      const sourceWorkspace = await this.ctx.workspaceRegistry.resolveByPath(input.replayCase.sourceCwd)
      if (sourceWorkspace !== undefined) {
        const withoutReplay = this.ctx.workspaceRegistry.list().filter(item => item.id !== replayWorkspace.id)
        const sourceIndex = withoutReplay.findIndex(item => item.id === sourceWorkspace.id)
        if (sourceIndex >= 0) {
          await this.ctx.workspaceRegistry.insertBefore(replayWorkspace.id, withoutReplay[sourceIndex + 1]?.id)
        }
      }
      handle.agent.followup(createUserMessage({
        content: [{ type: 'text', text: input.replayCase.prompt }],
        source: { kind: 'plugin', plugin: '@tbxy09/dsh-replay-lab' },
      }))
      await handle.agent.whenIdle()
      const events = [...handle.agent.session.events] as readonly unknown[]
      const metrics = this.metrics.extract(events)
      const requestSurfaces = requestSurfaceEvidence(events, variant.behavior)
      const requestPhases = requestSurfaces.length > 0
        ? requestSurfaces.map(surface => surface.phase)
        : hookPhases.length > 0 ? hookPhases : variant.requestPhases.slice(0, 1)
      return {
        runId,
        sessionId,
        variantId: variant.id,
        status: metrics === undefined ? 'failed' : 'completed',
        requestPhases: Object.freeze([...requestPhases]),
        requestSurfaces: Object.freeze(requestSurfaces),
        ...(metrics === undefined ? { complete: false, missingReason: 'session 未形成完整 turn/end evidence' } : { metrics, complete: true }),
        eventCount: events.length,
        evidenceHash: evidenceDigest(sessionId, events),
        workspace: workspace.provenance,
      }
    } catch (error) {
      const events = handle === undefined ? [] : [...handle.agent.session.events]
      return {
        runId,
        sessionId,
        variantId: input.variant.id,
        status: 'failed',
        requestPhases: Object.freeze([...hookPhases]),
        complete: false,
        missingReason: error instanceof Error ? error.message : String(error),
        eventCount: events.length,
        evidenceHash: evidenceDigest(sessionId, events),
        ...(workspace === undefined ? {} : { workspace: workspace.provenance }),
      }
    }
  }

  async dispose(): Promise<void> {
    const handles = [...this.handles]
    this.handles.clear()
    await Promise.all(handles.map(handle => handle.dispose()))
    const roots = [...this.isolatedRoots]
    this.isolatedRoots.clear()
    await Promise.all(roots.map(root => rm(root, { recursive: true, force: true })))
  }
}

import { randomUUID } from 'node:crypto'
import { basename, join, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-presets'
import { createUserMessage, LlmAdapter, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-session-title'
import type {} from '@deepseek-ai/dsh-workspace'
import { evidenceDigest } from './metrics.ts'
import { extractRawCallEvidence } from './call-evidence.ts'
import { canonicalJson, sha256 } from './hash.ts'
import type { MetricsExtractor, Runner, VariantContributor } from './registries.ts'
import {
  copyWorkspaceSnapshot, discardWorkspaceSnapshot, materializeWorkspaceCheckpoint,
  recoverManagedWorkspaceSnapshots, rollbackWorkspaceSnapshot, safePathSegment,
  inside, realTarget, type IsolatedWorkspace, type WorkspaceSnapshotOptions,
} from './replay-workspace.ts'
import type { FrozenReplayCase, RequestSurfaceEvidence, RunEvidence, VariantDescriptor } from './types.ts'

export type { IsolatedWorkspace, WorkspaceSnapshotOptions } from './replay-workspace.ts'
export {
  copyWorkspaceSnapshot, discardWorkspaceSnapshot, materializeWorkspaceCheckpoint,
  recoverManagedWorkspaceSnapshots, rollbackWorkspaceSnapshot,
}

interface ActiveCandidate {
  aborted: boolean
  handle?: AgentHandle
  promise?: Promise<RunEvidence>
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}
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

export class DeterministicReplayAdapter extends LlmAdapter {
  override providerInfo(provider: string) {
    return { id: provider, name: 'Replay Lab deterministic' }
  }

  override async listModels(provider: string) {
    return [{ provider, id: 'fixture-model-v1', name: 'Replay Lab fixture model', inputModalities: ['text' as const] }]
  }

  override async resolveModel(provider: string, model: string) {
    const off = ReasoningEffortId('off')
    return {
      provider,
      id: model,
      name: model === 'fixture-model-v1' ? 'Replay Lab fixture model' : model,
      inputModalities: ['text' as const],
      context: { contextWindow: 8_192 },
      defaultMaxTokens: 2_048,
      reasoning: {
        efforts: [{ id: off, name: 'Off', description: 'Deterministic fixture reasoning disabled' }],
        defaultEffort: off,
      },
    }
  }

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
  private readonly isolatedRoots = new Map<string, IsolatedWorkspace>()
  private readonly activeCandidates = new Map<string, ActiveCandidate>()

  constructor(
    private readonly ctx: Context,
    private readonly metrics: MetricsExtractor,
    private readonly variantLookup: (id: string) => VariantContributor | undefined,
    private readonly managedWorkspaceDirectory?: string,
  ) {}

  async recoverManagedWorkspaces(): Promise<number> {
    return this.managedWorkspaceDirectory === undefined
      ? 0
      : recoverManagedWorkspaceSnapshots(this.managedWorkspaceDirectory)
  }

  /** Candidate and descendant tool access is writable only during the owned replay run. */
  isActiveCandidateSession(sessionId: string): boolean {
    return [...this.activeCandidates.values()].some(active =>
      !active.aborted && active.handle !== undefined && String(active.handle.agent.session.id) === sessionId)
  }

  async run(input: { replayCase: FrozenReplayCase; experimentId: string; variant: VariantDescriptor }): Promise<RunEvidence> {
    const active: ActiveCandidate = { aborted: false }
    this.activeCandidates.set(input.experimentId, active)
    const promise = this.runCandidate(input, active)
    active.promise = promise
    try {
      return await promise
    } finally {
      if (this.activeCandidates.get(input.experimentId) === active) this.activeCandidates.delete(input.experimentId)
    }
  }

  private async runCandidate(
    input: { replayCase: FrozenReplayCase; experimentId: string; variant: VariantDescriptor },
    active: ActiveCandidate,
  ): Promise<RunEvidence> {
    const sessionId = SessionId(`replay-${input.experimentId}-${input.variant.id}-${randomUUID()}`)
    const runId = `run-${randomUUID()}`
    const hookPhases: string[] = []
    let handle: AgentHandle | undefined
    let workspace: IsolatedWorkspace | undefined
    let evidence: RunEvidence | undefined
    try {
      const variant = this.variantLookup(input.variant.id)
      if (variant === undefined || !variant.supported || variant.preset === undefined) {
        throw new Error(variant?.unsupportedReason ?? `variant ${input.variant.id} 不可运行`)
      }
      const names = replayDisplayNames(input.replayCase, input.variant)
      const snapshotOptions = { parentDirectory: this.managedWorkspaceDirectory, executionName: names.executionName }
      workspace = input.replayCase.sourceCheckpoint === undefined
        ? await copyWorkspaceSnapshot(input.replayCase.sourceCwd, input.replayCase.sourceWorkspaceHash, snapshotOptions)
        : await materializeWorkspaceCheckpoint(
          input.replayCase.sourceCheckpoint,
          input.replayCase.sourceWorkspaceHash,
          snapshotOptions,
        )
      if (!workspace.durable) this.isolatedRoots.set(workspace.root, workspace)
      if (active.aborted) throw new Error('candidate run aborted before session creation')
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
      active.handle = handle
      this.handles.add(handle)
      if (active.aborted) {
        await handle.dispose()
        this.handles.delete(handle)
        throw new Error('candidate run aborted during session creation')
      }
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
        source: { kind: 'plugin', plugin: '@webwalkerhq/dsh-replay-lab' },
      }))
      await handle.agent.whenIdle()
      const events = [...handle.agent.session.events] as readonly unknown[]
      const metrics = this.metrics.extract(events)
      const callEvidence = extractRawCallEvidence(events)
      const requestSurfaces = requestSurfaceEvidence(events, variant.behavior)
      const requestPhases = requestSurfaces.length > 0
        ? requestSurfaces.map(surface => surface.phase)
        : hookPhases.length > 0 ? hookPhases : variant.requestPhases.slice(0, 1)
      evidence = {
        runId,
        sessionId,
        variantId: variant.id,
        status: metrics === undefined ? 'failed' : 'completed',
        requestPhases: Object.freeze([...requestPhases]),
        requestSurfaces: Object.freeze(requestSurfaces),
        ...(callEvidence === undefined ? {} : { callEvidence }),
        ...(metrics === undefined ? { complete: false, missingReason: 'session 未形成完整 turn/end evidence' } : { metrics, complete: true }),
        eventCount: events.length,
        evidenceHash: evidenceDigest(sessionId, events),
        workspace: workspace.provenance,
      }
    } catch (error) {
      const events = handle === undefined ? [] : [...handle.agent.session.events]
      const callEvidence = extractRawCallEvidence(events)
      evidence = {
        runId,
        sessionId,
        variantId: input.variant.id,
        status: 'failed',
        requestPhases: Object.freeze([...hookPhases]),
        complete: false,
        missingReason: error instanceof Error ? error.message : String(error),
        eventCount: events.length,
        evidenceHash: evidenceDigest(sessionId, events),
        ...(callEvidence === undefined ? {} : { callEvidence }),
        ...(workspace === undefined ? {} : { workspace: workspace.provenance }),
      }
    } finally {
      if (workspace !== undefined) {
        const terminalErrors: string[] = []
        if (handle !== undefined) {
          try { setSandboxMode(handle.agent.session, 'read-only') } catch (error) {
            terminalErrors.push(`read-only seal failed: ${error instanceof Error ? error.message : String(error)}`)
          }
        }
        try {
          await rollbackWorkspaceSnapshot(workspace, input.replayCase.sourceWorkspaceHash)
        } catch (error) {
          terminalErrors.push(`workspace rollback failed: ${error instanceof Error ? error.message : String(error)}`)
        }
        if (terminalErrors.length > 0) {
          const prior = evidence?.missingReason
          evidence = {
            ...(evidence ?? {
              runId, sessionId, variantId: input.variant.id, requestPhases: Object.freeze([...hookPhases]),
              eventCount: handle === undefined ? 0 : handle.agent.session.events.length,
              evidenceHash: evidenceDigest(sessionId, handle === undefined ? [] : [...handle.agent.session.events]),
            }),
            status: 'failed', complete: false,
            missingReason: `${prior === undefined ? '' : `${prior}; `}candidate terminal isolation failed: ${terminalErrors.join('; ')}`,
            workspace: workspace.provenance,
          }
        }
      }
    }
    return evidence as RunEvidence
  }

  async abort(experimentId: string): Promise<RunEvidence | undefined> {
    const active = this.activeCandidates.get(experimentId)
    if (active === undefined) return undefined
    active.aborted = true
    if (active.handle !== undefined) {
      active.handle.agent.cancel({ kind: 'hook', reason: 'Replay Lab experiment aborted' })
      await active.handle.agent.whenIdle()
    }
    return active.promise
  }

  async dispose(): Promise<void> {
    for (const active of this.activeCandidates.values()) active.aborted = true
    const handles = [...this.handles]
    this.handles.clear()
    await Promise.all(handles.map(handle => handle.dispose()))
    await Promise.allSettled([...this.activeCandidates.values()].flatMap(active => active.promise === undefined ? [] : [active.promise]))
    const roots = [...this.isolatedRoots.values()]
    this.isolatedRoots.clear()
    await Promise.all(roots.map(workspace => discardWorkspaceSnapshot(workspace)))
  }
}

import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-presets'
import { resolveSessionPreset } from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-title'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-workspace'
import { FixtureCaseSource } from './case-source.ts'
import { JsonArtifactStore } from './artifact-store.ts'
import { createHttpHandler } from './http.ts'
import { IndependentEvidenceOracle, SessionMetricsExtractor } from './metrics.ts'
import { candidatePathGuard, DeterministicReplayAdapter, CordisAgentRunner } from './runner.ts'
import { DefaultReplayWorkspaceProvider, TurnCheckpointStore } from './replay-workspace.ts'
import { ReplayLabService } from './service.ts'
import { builtInVariants } from './variants.ts'
import { replayTurnsProjectionDefinition } from './replay-turn-projection.ts'
import { RouteLineageMonitor, type DurableSessionRouteLog } from './route-lineage.ts'
import { DirectRuntimeEvidenceSummarizer } from './evidence-summary.ts'
import type { ReplayExperiment, ReplayTurnIdentifier, TransitionStage } from './types.ts'

export * from './types.ts'
export * from './registries.ts'
export { ReplayLabService } from './service.ts'
export { FixtureCaseSource } from './case-source.ts'
export { JsonArtifactStore } from './artifact-store.ts'
export { SessionMetricsExtractor, IndependentEvidenceOracle } from './metrics.ts'
export { CordisAgentRunner, DeterministicReplayAdapter } from './runner.ts'
export { DefaultReplayWorkspaceProvider, TurnCheckpointStore } from './replay-workspace.ts'
export { builtInVariants } from './variants.ts'
export * from './route-lineage.ts'
export * from './call-evidence.ts'
export * from './evidence-summary.ts'
export * from './dashboard-prompts.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { replayLabDsh: ReplayLabService }
}

export const name = 'replay-lab-dsh'
export const inject = [
  'webServer', 'agents', 'agentPresets', 'llm', 'sessions', 'sessionProjections',
  'sessionTitle', 'workspaceRegistry',
  'tools',
]

export interface Config {
  routeBase: string
  historyFixture: string
  workspaceFixture: string
  stateFile: string
  artifactDirectory: string
  provider: string
  fakeAdapter: boolean
}

export const Config: z<Config> = z.object({
  routeBase: z.string().default('/replay-lab-dsh'),
  historyFixture: z.string().required(),
  workspaceFixture: z.string().required(),
  stateFile: z.string().required(),
  artifactDirectory: z.string().required(),
  provider: z.string().default('replay-lab-fake'),
  fakeAdapter: z.boolean().default(false),
})

function baseDirectory(ctx: Context): string {
  if (ctx.baseUrl === undefined) return process.cwd()
  try { return dirname(fileURLToPath(new URL('profile-anchor', ctx.baseUrl))) } catch { return ctx.baseUrl }
}

function absolute(base: string, value: string): string { return resolve(base, value) }

export async function apply(ctx: Context, config: Config): Promise<void> {
  if (!/^\/[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*$/.test(config.routeBase)) {
    throw new TypeError('routeBase 必须是无尾斜杠的绝对路径')
  }
  const base = baseDirectory(ctx)
  const workspaceFixture = absolute(base, config.workspaceFixture)
  ctx.sessionProjections.register(replayTurnsProjectionDefinition)
  const artifactDirectory = absolute(base, config.artifactDirectory)
  const store = new JsonArtifactStore(absolute(base, config.stateFile), artifactDirectory)
  const turnCheckpoints = new TurnCheckpointStore()
  const workspaceProvider = new DefaultReplayWorkspaceProvider(join(artifactDirectory, 's0-checkpoints'))
  const resolveTurn = async (identifier: ReplayTurnIdentifier) => {
    const session = ctx.sessions.get(identifier.sessionId as SessionId)
    if (session === undefined) throw new Error(`session "${identifier.sessionId}" is not live`)
    const sourceCwd = session.header.cwd
    if (typeof sourceCwd !== 'string' || sourceCwd.length === 0) {
      throw new Error(`session "${identifier.sessionId}" has no durable source cwd`)
    }
    const projection = ctx.sessionProjections.snapshot(session).values.replayLabTurns
    const record = projection?.turns.find(turn => turn.turn === identifier.turn)
    if (record === undefined) throw new Error(`turn ${identifier.turn} is not finalized in session "${identifier.sessionId}"`)
    if (!record.replayable || record.evidenceHash === null) {
      throw new Error(`turn ${identifier.turn} is not replayable: ${record.missingFields.join(', ') || 'incomplete evidence'}`)
    }
    if (record.evidenceHash !== identifier.expectedEvidenceHash) {
      throw new Error(`turn ${identifier.turn} evidence changed; refresh the session projection and try again`)
    }
    const presetSurface = record.presetSurface ?? resolveSessionPreset(session) ?? null
    if (presetSurface === null) throw new Error(`turn ${identifier.turn} has no durable preset/plugin surface`)
    return {
      record: { ...record, presetSurface },
      sourceCwd,
      checkpoint: turnCheckpoints.get(identifier.sessionId, identifier.turn),
    }
  }
  const source = new FixtureCaseSource(absolute(base, config.historyFixture), workspaceFixture)
  const sessionLogs = (): DurableSessionRouteLog[] => ctx.sessions.list().map(session => ({
    sessionId: String(session.header.id),
    header: session.header,
    events: session.events,
  }))
  const routeLineage = new RouteLineageMonitor(sessionLogs, async evidence => {
    const id = createHash('sha256').update(evidence.childSessionId).digest('hex').slice(0, 24)
    await store.put('route-lineage', id, evidence)
  })
  routeLineage.restore(await store.loadRouteLineageEvidence())
  await routeLineage.refresh()
  const service = new ReplayLabService(config.routeBase, resolveTurn, async sessionId => {
    await routeLineage.refresh()
    return routeLineage.list(sessionId)
  }, new DirectRuntimeEvidenceSummarizer(ctx.llm))
  const metrics = new SessionMetricsExtractor()
  const oracle = new IndependentEvidenceOracle()

  service.registries.caseSources.register(source)
  service.registries.artifactStores.register(store)
  service.registries.metricsExtractors.register(metrics)
  service.registries.oracles.register(oracle)
  let anchoredStandard: NonNullable<Parameters<typeof builtInVariants>[0]>['anchoredStandard']
  try {
    const preset = await ctx.agentPresets.resolve('anchored-standard')
    anchoredStandard = preset.broken === undefined
      ? { available: true }
      : { available: false, reason: `anchored-standard is installed but cannot mount: ${preset.broken}` }
  } catch (error) {
    anchoredStandard = {
      available: false,
      reason: `Install anchored-standard in this DSH profile and restart the server. ${error instanceof Error ? error.message : String(error)}`,
    }
  }
  for (const variant of builtInVariants({ anchoredStandard })) service.registries.variants.register(variant)
  const runner = new CordisAgentRunner(
    ctx,
    metrics,
    id => service.registries.variants.get(id),
    join(artifactDirectory, 'candidate-workspaces'),
  )
  const recoveredWorkspaces = await runner.recoverManagedWorkspaces()
  if (recoveredWorkspaces > 0) {
    ctx.logger.info('Replay Lab restored %d durable candidate workspace(s) from checkpoints', recoveredWorkspaces)
  }
  ctx.tools.guard((exec) => {
    let session = exec.agent?.session
    while (session !== undefined) {
      if (String(session.id).startsWith('replay-')) {
        if (!runner.isActiveCandidateSession(String(session.id))) {
          return 'Replay candidate sessions are read-only after their controlled run reaches a terminal state.'
        }
        const cwd = exec.agent?.session.header.cwd
        return typeof cwd === 'string' && cwd.length > 0
          ? candidatePathGuard(exec.arguments, cwd)
          : 'Replay candidate has no isolated workspace boundary.'
      }
      session = session.header.parentSession === undefined
        ? undefined
        : ctx.sessions.get(session.header.parentSession)
    }
    return undefined
  })
  service.registries.runners.register(runner)
  service.registries.hooks.register({
    id: 'artifact-transition-audit',
    async onTransition(stage: TransitionStage, experiment: ReplayExperiment) {
      await store.put('transition', `${experiment.id}-${stage}`, { stage, experiment })
    },
  })
  await service.restore(store)

  const refreshRouteLineage = (): void => {
    void routeLineage.refresh().catch(error => {
      ctx.logger.warn('Replay Lab route-lineage evidence capture failed: %s', error instanceof Error ? error.message : String(error))
    })
  }
  ctx.on('session/created', refreshRouteLineage)
  ctx.on('session/event', (session, event) => {
    if (event.type === 'request/header') refreshRouteLineage()
    if (event.type !== 'turn/start') return
    if (String(session.id).startsWith('replay-')) return
    const cwd = session.header.cwd
    const turn = Number((event.data as { turn?: unknown } | undefined)?.turn)
    if (typeof cwd !== 'string' || cwd.length === 0 || !Number.isSafeInteger(turn) || turn < 1) return
    void workspaceProvider.checkpoint(cwd, 'turn-start').then(async checkpoint => {
      turnCheckpoints.set(String(session.id), turn, checkpoint)
      await store.put('turn-checkpoint', `${String(session.id)}-${turn}`, checkpoint)
    }).catch(error => {
      ctx.logger.warn('Replay Lab failed to capture pre-turn S0 for session %s turn %s: %s',
        String(session.id), String(turn), error instanceof Error ? error.message : String(error))
    })
  })

  if (config.fakeAdapter) ctx.llm.registerAdapter([config.provider], new DeterministicReplayAdapter())
  ctx.provide('replayLabDsh', service)
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: config.routeBase, handler: createHttpHandler(service) }), 'replay-lab-dsh: host route')
  ctx.effect(() => async () => { await runner.dispose() }, 'replay-lab-dsh: runner lifecycle')
}

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { ArtifactStore } from './registries.ts'
import type { FrozenReplayCase, ReplayExperiment, ReplayHistoryEntry } from './types.ts'
import { isRouteLineageEvidence } from './route-lineage.ts'
import type { RouteLineageEvidence } from './types.ts'

interface PersistedStateV1 { version: 1; replayCase?: FrozenReplayCase; experiment?: ReplayExperiment }
interface PersistedStateV2 {
  version: 2
  replayCase?: FrozenReplayCase
  experiment?: ReplayExperiment
  history: readonly ReplayHistoryEntry[]
}

function isTerminal(experiment: ReplayExperiment | undefined): experiment is ReplayExperiment {
  return experiment !== undefined && ['completed', 'failed', 'aborted'].includes(experiment.status)
}

function historyEntry(replayCase: FrozenReplayCase, experiment: ReplayExperiment): ReplayHistoryEntry {
  return {
    sourceSessionId: replayCase.sourceSessionId,
    sourceTurn: replayCase.sourceTurn,
    ...(replayCase.observedBaseline?.evidenceHash === undefined
      ? {}
      : { sourceEvidenceHash: replayCase.observedBaseline.evidenceHash }),
    replayCase,
    experiment,
  }
}

function backfilledEntry(experiment: ReplayExperiment): ReplayHistoryEntry | undefined {
  if (!isTerminal(experiment) || experiment.baseline === undefined) return undefined
  const prefix = `observed-${experiment.baseline.sessionId}-`
  if (!experiment.baseline.runId.startsWith(prefix)) return undefined
  const sourceTurn = Number(experiment.baseline.runId.slice(prefix.length))
  if (!Number.isSafeInteger(sourceTurn) || sourceTurn < 1) return undefined
  return {
    sourceSessionId: experiment.baseline.sessionId,
    sourceTurn,
    ...(experiment.baseline.evidenceHash === undefined ? {} : { sourceEvidenceHash: experiment.baseline.evidenceHash }),
    experiment,
  }
}

export class JsonArtifactStore implements ArtifactStore {
  readonly id = 'json-artifacts'
  constructor(readonly file: string, readonly artifactDirectory: string) {}

  private async artifactHistory(): Promise<ReplayHistoryEntry[]> {
    let names: string[]
    try {
      names = await readdir(resolve(this.artifactDirectory))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    const entries = await Promise.all(names
      .filter(name => name.startsWith('experiment-') && name.endsWith('.json'))
      .map(async name => backfilledEntry(JSON.parse(
        await readFile(join(resolve(this.artifactDirectory), name), 'utf8'),
      ) as ReplayExperiment)))
    return entries.filter((entry): entry is ReplayHistoryEntry => entry !== undefined)
  }

  async loadRouteLineageEvidence(): Promise<RouteLineageEvidence[]> {
    let names: string[]
    try {
      names = await readdir(resolve(this.artifactDirectory))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    const values = await Promise.all(names
      .filter(name => name.startsWith('route-lineage-') && name.endsWith('.json'))
      .map(async name => {
        try {
          return JSON.parse(await readFile(join(resolve(this.artifactDirectory), name), 'utf8')) as unknown
        } catch {
          return undefined
        }
      }))
    return values.filter(isRouteLineageEvidence)
  }

  async load(): Promise<{ replayCase?: FrozenReplayCase; experiment?: ReplayExperiment; history: readonly ReplayHistoryEntry[] }> {
    const artifacts = await this.artifactHistory()
    try {
      const value = JSON.parse(await readFile(resolve(this.file), 'utf8')) as PersistedStateV1 | PersistedStateV2
      if (value.version === 1) {
        const history = value.replayCase !== undefined && isTerminal(value.experiment)
          ? [historyEntry(value.replayCase, value.experiment)]
          : []
        const merged = new Map(artifacts.map(entry => [entry.experiment.id, entry]))
        for (const entry of history) merged.set(entry.experiment.id, entry)
        return {
          ...(value.replayCase === undefined ? {} : { replayCase: value.replayCase }),
          ...(value.experiment === undefined ? {} : { experiment: value.experiment }),
          history: [...merged.values()],
        }
      }
      if (value.version !== 2 || !Array.isArray(value.history)) throw new Error('Replay Lab state 版本不支持')
      const merged = new Map(artifacts.map(entry => [entry.experiment.id, entry]))
      for (const entry of value.history) merged.set(entry.experiment.id, entry)
      return {
        ...(value.replayCase === undefined ? {} : { replayCase: value.replayCase }),
        ...(value.experiment === undefined ? {} : { experiment: value.experiment }),
        history: [...merged.values()],
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { history: artifacts }
      throw error
    }
  }

  async save(value: { replayCase?: FrozenReplayCase; experiment?: ReplayExperiment; history: readonly ReplayHistoryEntry[] }): Promise<void> {
    await mkdir(dirname(resolve(this.file)), { recursive: true })
    const temp = `${resolve(this.file)}.tmp`
    await writeFile(temp, JSON.stringify({ version: 2, ...value }, null, 2), 'utf8')
    await rename(temp, resolve(this.file))
  }

  async put(kind: string, id: string, value: unknown): Promise<string> {
    const directory = resolve(this.artifactDirectory)
    await mkdir(directory, { recursive: true })
    const target = join(directory, `${kind}-${id}.json`)
    const temp = `${target}.${randomUUID()}.tmp`
    await writeFile(temp, JSON.stringify(value, null, 2), 'utf8')
    await rename(temp, target)
    return target
  }
}

import type {
  FrozenReplayCase, ReplayExperiment, ReplayHistoryEntry, RunEvidence, RunMetrics, ScorecardRow,
  VariantDescriptor,
} from './types.ts'

export interface DashboardRunSlice {
  id: string
  kind: 'baseline' | 'candidate'
  label: string
  phases: readonly string[]
  route: string | null
  tools: readonly string[]
  systemHashes: readonly string[]
  toolSchemaHashes: readonly string[]
  metrics?: RunMetrics
  callMetrics?: {
    toolCallCount: number
    toolRetryCount: number
    toolRetryRatePercent: number
    maxProgresslessSpan: number
    firstEffectiveActionLatencyMs: number | null
  }
}

export interface DashboardPayload {
  schemaVersion: 'replay-dashboard-payload/v1'
  fixtureId: string
  turn: number
  variantId: string
  activeRunId: string
  baseline: DashboardRunSlice
  candidate: DashboardRunSlice
  runs: readonly DashboardRunSlice[]
  scorecard?: { rows: readonly ScorecardRow[] }
  facts: readonly {
    evidenceId: string
    metric: string
    unit: string
    baseline: number
    candidate: number
    delta: number
    relativeDeltaPercent: number | null
  }[]
}

export interface DashboardCohort {
  history?: readonly ReplayHistoryEntry[]
  variants?: readonly VariantDescriptor[]
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter(value => value.length > 0))]
}

function slice(
  id: string,
  kind: DashboardRunSlice['kind'],
  label: string,
  evidence: RunEvidence | undefined,
  fallback?: FrozenReplayCase,
): DashboardRunSlice {
  const surfaces = evidence?.requestSurfaces ?? []
  const route = surfaces.length > 0
    ? unique(surfaces.map(surface => `${surface.provider} / ${surface.model}`)).join(' → ')
    : fallback === undefined ? null : `${fallback.provider} / ${fallback.model}`
  return {
    id,
    kind,
    label,
    phases: evidence?.requestPhases ?? [],
    route,
    tools: unique(surfaces.flatMap(surface => surface.toolNames)),
    systemHashes: surfaces.length > 0
      ? unique(surfaces.map(surface => surface.systemHash))
      : fallback === undefined ? [] : [fallback.systemHash],
    toolSchemaHashes: surfaces.length > 0
      ? unique(surfaces.map(surface => surface.toolSchemaHash))
      : fallback === undefined ? [] : [fallback.toolSchemaHash],
    ...(evidence?.metrics === undefined ? {} : { metrics: evidence.metrics }),
    ...(evidence?.callEvidence === undefined ? {} : { callMetrics: evidence.callEvidence.metrics }),
  }
}

function retainedExperiments(
  experiment: ReplayExperiment,
  history: readonly ReplayHistoryEntry[],
): readonly ReplayExperiment[] {
  const retained = history.map(entry => entry.experiment)
  return retained.some(item => item.id === experiment.id) ? retained : [experiment, ...retained]
}

/** Host-owned dashboard JSON. The model may visualize this object; it may not invent replacements. */
export function buildDashboardPayload(
  replayCase: FrozenReplayCase,
  experiment: ReplayExperiment,
  cohort: DashboardCohort = {},
): DashboardPayload {
  const variantLabels = new Map((cohort.variants ?? []).map(variant => [variant.id, variant.label]))
  const baseline = slice(
    `observed-${replayCase.sourceSessionId}-${replayCase.sourceTurn}`,
    'baseline',
    'Observed baseline',
    experiment.baseline ?? replayCase.observedBaseline, replayCase,
  )
  const candidate = slice(
    experiment.id,
    'candidate',
    variantLabels.get(experiment.candidateVariantId) ?? 'Candidate replay',
    experiment.candidate,
  )
  const runs = [
    baseline,
    ...retainedExperiments(experiment, cohort.history ?? []).map(item => slice(
      item.id,
      'candidate',
      variantLabels.get(item.candidateVariantId) ?? item.candidateVariantId,
      item.candidate,
    )),
  ]
  return {
    schemaVersion: 'replay-dashboard-payload/v1',
    fixtureId: replayCase.id,
    turn: replayCase.sourceTurn,
    variantId: experiment.candidateVariantId,
    activeRunId: experiment.id,
    baseline,
    candidate,
    runs,
    ...(experiment.scorecard === undefined ? {} : { scorecard: { rows: experiment.scorecard.rows } }),
    facts: (experiment.callEvidenceComparison?.facts ?? []).map(fact => ({
      evidenceId: fact.evidenceId,
      metric: fact.metric,
      unit: fact.unit,
      baseline: fact.baseline,
      candidate: fact.candidate,
      delta: fact.delta,
      relativeDeltaPercent: fact.relativeDeltaPercent,
    })),
  }
}

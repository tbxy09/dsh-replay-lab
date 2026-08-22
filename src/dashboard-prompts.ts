export type DashboardPromptId =
  | 'overlay-all-runs'
  | 'focus-selected'
  | 'delta-callouts'
  | 'request-surface'
  | 'execution-delta'
export type EvidencePromptId = DashboardPromptId | 'sentence'
export const MAX_DASHBOARD_PROMPT_CHARS = 12_000
/** Prompt Send is independent of the frozen observed-turn route. */
export const EVIDENCE_PROMPT_PROVIDER = 'deepseek-official'
export const EVIDENCE_PROMPT_MODEL = 'deepseek-v4-pro'

export interface EvidencePromptOption {
  id: EvidencePromptId
  kind: 'dashboard' | 'sentence'
  label: string
  blurb: string
  instruction: string
}

export type DashboardPromptOption = EvidencePromptOption & { id: DashboardPromptId; kind: 'dashboard' }

export const DASHBOARD_PROMPT_OPTIONS: readonly DashboardPromptOption[] = [
  {
    id: 'overlay-all-runs',
    kind: 'dashboard',
    label: 'Overlay all runs',
    blurb: 'One chart for every retained run. Saved runs only highlights the active series.',
    instruction: 'Visualize every retained run. Draw one series per run. Use the active run only to highlight; do not drop other runs.',
  },
  {
    id: 'focus-selected',
    kind: 'dashboard',
    label: 'Focus selected',
    blurb: 'Keep the cohort on screen, but compose around the Saved-runs selection versus baseline.',
    instruction: 'Plot all runs, but compose the layout around activeRunId versus baseline. Other candidates stay visible at lower emphasis.',
  },
  {
    id: 'delta-callouts',
    kind: 'dashboard',
    label: 'Metric deltas',
    blurb: 'Annotate the largest payload deltas for the selected run. Do not invent causes.',
    instruction: 'Keep a compact chart of all runs and add callouts for the largest absolute deltas between baseline and the active run using payload numbers only.',
  },
  {
    id: 'request-surface',
    kind: 'dashboard',
    label: 'Request surface diff',
    blurb: 'Compare observed vs candidate route, phases, tools, and hashes. Do not invent missing surfaces.',
    instruction: 'Visualize the supplied request-surface comparison. Show baseline versus the active run: route, phases, tools, system hashes, and tool-schema hashes. Mark match or mismatch only from those fields. Do not invent tools or hashes.',
  },
  {
    id: 'execution-delta',
    kind: 'dashboard',
    label: 'Execution delta',
    blurb: 'Chart scorecard deltas for the selected run versus baseline. Do not invent causes.',
    instruction: 'Visualize the supplied scorecard as an execution delta for the active run versus baseline. Use the supplied baseline, candidate, and delta values only. Do not invent missing metrics or causes.',
  },
]

export const SENTENCE_PROMPT_OPTION: EvidencePromptOption = {
  id: 'sentence',
  kind: 'sentence',
  label: 'Summarize as sentence',
  blurb: 'One cited Chinese sentence from derived facts. Not a chart redraw.',
  instruction: '请总结下面同一 fixture 的 baseline/candidate 原始逐调用证据。产出恰好一句简洁中文。每个定量主张必须引用证据 ID，例如 [F1]。使用 derived_facts，不要重算或发明原因。',
}

export const EVIDENCE_PROMPT_OPTIONS: readonly EvidencePromptOption[] = [
  ...DASHBOARD_PROMPT_OPTIONS,
  SENTENCE_PROMPT_OPTION,
]

export function dashboardPromptOption(id: string | undefined): DashboardPromptOption {
  return DASHBOARD_PROMPT_OPTIONS.find(option => option.id === id) ?? DASHBOARD_PROMPT_OPTIONS[0]!
}

export function evidencePromptOption(id: string | undefined): EvidencePromptOption {
  return EVIDENCE_PROMPT_OPTIONS.find(option => option.id === id) ?? DASHBOARD_PROMPT_OPTIONS[0]!
}

export function isDashboardPromptId(value: unknown): value is DashboardPromptId {
  return typeof value === 'string' && DASHBOARD_PROMPT_OPTIONS.some(option => option.id === value)
}

export function isEvidencePromptId(value: unknown): value is EvidencePromptId {
  return typeof value === 'string' && EVIDENCE_PROMPT_OPTIONS.some(option => option.id === value)
}

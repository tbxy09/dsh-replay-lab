export type DashboardPromptId = 'overlay-all-runs' | 'focus-selected' | 'delta-callouts' | 'request-surface' | 'execution-delta';
export type EvidencePromptId = DashboardPromptId | 'sentence';
export declare const MAX_DASHBOARD_PROMPT_CHARS = 12000;
/** Prompt Send is independent of the frozen observed-turn route. */
export declare const EVIDENCE_PROMPT_PROVIDER = "deepseek-official";
export declare const EVIDENCE_PROMPT_MODEL = "deepseek-v4-pro";
export interface EvidencePromptOption {
    id: EvidencePromptId;
    kind: 'dashboard' | 'sentence';
    label: string;
    blurb: string;
    instruction: string;
}
export type DashboardPromptOption = EvidencePromptOption & {
    id: DashboardPromptId;
    kind: 'dashboard';
};
export declare const DASHBOARD_PROMPT_OPTIONS: readonly DashboardPromptOption[];
export declare const SENTENCE_PROMPT_OPTION: EvidencePromptOption;
export declare const EVIDENCE_PROMPT_OPTIONS: readonly EvidencePromptOption[];
export declare function dashboardPromptOption(id: string | undefined): DashboardPromptOption;
export declare function evidencePromptOption(id: string | undefined): EvidencePromptOption;
export declare function isDashboardPromptId(value: unknown): value is DashboardPromptId;
export declare function isEvidencePromptId(value: unknown): value is EvidencePromptId;

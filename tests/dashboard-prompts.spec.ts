import { describe, expect, it } from 'vitest'
import { CSS } from '../src/client/styles.ts'
import {
  DASHBOARD_PROMPT_OPTIONS, dashboardPromptOption, EVIDENCE_PROMPT_MODEL, EVIDENCE_PROMPT_PROVIDER,
  isDashboardPromptId, MAX_DASHBOARD_PROMPT_CHARS,
} from '../src/dashboard-prompts.ts'

describe('dashboard visualization prompts', () => {
  it('exposes several launchable visualization prompts', () => {
    expect(DASHBOARD_PROMPT_OPTIONS.map(option => option.id)).toEqual([
      'overlay-all-runs', 'focus-selected', 'delta-callouts', 'request-surface', 'execution-delta',
    ])
    expect(isDashboardPromptId('request-surface')).toBe(true)
    expect(isDashboardPromptId('execution-delta')).toBe(true)
    expect(dashboardPromptOption(undefined).id).toBe('overlay-all-runs')
    expect(isDashboardPromptId('focus-selected')).toBe(true)
    expect(isDashboardPromptId('not-a-prompt')).toBe(false)
    expect(MAX_DASHBOARD_PROMPT_CHARS).toBe(12_000)
    expect(EVIDENCE_PROMPT_PROVIDER).toBe('deepseek-official')
    expect(EVIDENCE_PROMPT_MODEL).toBe('deepseek-v4-pro')
    expect(DASHBOARD_PROMPT_OPTIONS.every(option => !option.instruction.includes('window.__EVIDENCE__'))).toBe(true)
  })

  it('styles compact presets and a composer instead of large action cards', () => {
    expect(CSS).toContain('rld-prompt-presets')
    expect(CSS).toContain('rld-prompt-composer textarea')
    expect(CSS).toContain('rld-prompt-send')
    expect(CSS).toContain('min-height:22px')
    expect(CSS).toContain('rld-dashboard-generating')
    expect(CSS).toContain('rld-prompt-scan')
    expect(CSS).toContain('.rld-result-disclosure .rld-result-section')
    expect(CSS).not.toContain('rld-dashboard-actions')
    expect(CSS).not.toContain('rld-prompt-option-sentence')
  })
})

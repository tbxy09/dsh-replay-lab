import type { VariantContributor } from './registries.ts'

export interface BuiltInVariantOptions {
  anchoredStandard?: {
    available: boolean
    reason?: string
  }
}

export function builtInVariants(options: BuiltInVariantOptions = {}): VariantContributor[] {
  const anchored = options.anchoredStandard ?? { available: true }
  return [
    {
      id: 'standard', label: 'Standard replay', description: 'Fresh DSH standard-preset candidate', plane: 'agent',
      preset: 'standard', pluginSurface: 'preset:standard', supported: true, requestPhases: ['request'], behavior: 'normal',
    },
    {
      id: 'minimal', label: 'Minimal', description: '最小 agent preset', plane: 'agent',
      preset: 'minimal', pluginSurface: 'preset:minimal', supported: true, requestPhases: ['request'], behavior: 'normal',
    },
    {
      id: 'anchored', label: 'Anchored Standard',
      description: 'Native preset: exact Minimal bootstrap, then resident discovery tools with durable on-demand unlocks',
      plane: 'agent', preset: 'anchored-standard', pluginSurface: 'preset:anchored-standard',
      supported: anchored.available,
      ...(anchored.available ? {} : {
        unsupportedReason: anchored.reason ?? 'The anchored-standard preset is not installed in this DSH profile.',
      }),
      requestPhases: ['bootstrap', 'promoted', 'dynamic unlocks'], behavior: 'anchored',
    },
    {
      id: 'candidate-agent-plugin', label: 'Candidate Agent Plugin', description: 'agent-scoped request-hook 候选', plane: 'agent',
      preset: 'standard', pluginSurface: 'agent-plugin:candidate@1', supported: true, requestPhases: ['request'], behavior: 'normal',
      install: (agentCtx, phases) => {
        agentCtx.on('agent/request', async (_payload, next) => { phases.push('request'); return next() })
      },
    },
    {
      id: 'candidate-missing-evidence', label: 'Candidate（缺 evidence fixture）', description: '确定性失败，用于验证缺 evidence 边界', plane: 'agent',
      preset: 'standard', pluginSurface: 'agent-plugin:missing-evidence@1', supported: true,
      requestPhases: ['request'], behavior: 'missing-evidence',
      install: (agentCtx, phases) => {
        agentCtx.on('agent/request', async () => { phases.push('request'); throw new Error('fixture: candidate evidence intentionally unavailable') })
      },
    },
    {
      id: 'host-provider-switch', label: 'Provider / Sandbox Switch', description: '需要切换 host singleton', plane: 'host',
      pluginSurface: 'host-plane:provider+sandbox', supported: false,
      unsupportedReason: '首期仅支持 agent-scoped preset/request-hook；该 variant 需要 host-plane singleton', requestPhases: [],
    },
  ]
}

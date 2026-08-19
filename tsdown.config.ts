import { defineConfig } from 'tsdown'

const ID = '@webwalkerhq/dsh-replay-lab'
const hostExternal = [
  '@deepseek-ai/cordis', '@deepseek-ai/schemastery', '@deepseek-ai/dsh-agent',
  '@deepseek-ai/dsh-agent-presets', '@deepseek-ai/dsh-host-webserver',
  '@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-sandbox-policy', '@deepseek-ai/dsh-session',
  '@deepseek-ai/dsh-session-projection', '@deepseek-ai/dsh-session-title',
  '@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-workspace', 'zod',
]
const clientExternal = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client',
  '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-runtime',
  '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-ui-conversation',
]

export default defineConfig([
  {
    name: ID,
    entry: ['src/index.ts'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2022',
    dts: false,
    clean: true,
    external: hostExternal,
    outputOptions: { entryFileNames: 'index.js' },
  },
  {
    name: `${ID}/client`,
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    dts: false,
    sourcemap: true,
    clean: false,
    external: clientExternal,
    noExternal: (id: string) => clientExternal.includes(id) ? undefined : true,
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])

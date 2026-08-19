import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

async function registeredId(scriptSrc?: string): Promise<string | undefined> {
  const bundle = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  let id: string | undefined
  const window = {
    location: { href: 'https://dsh.local/' },
    __ModuleLoader__: {
      load(handoff: { id: string }): void { id = handoff.id },
    },
  }
  const document = { currentScript: scriptSrc === undefined ? null : { src: scriptSrc } }
  runInNewContext(bundle, { window, document, URL, decodeURIComponent })
  return id
}

describe('client bundle module-loader registration', () => {
  it('registers the exact local graph alias from the plugin bundle URL', async () => {
    expect(await registeredId(
      'https://dsh.local/plugins/@local/dsh-replay-lab-dsh/client.js?rev=cb7a71b88fb6',
    )).toBe('@local/dsh-replay-lab-dsh')
  })

  it('registers the published package id from its normal bundle URL', async () => {
    expect(await registeredId(
      'https://dsh.local/plugins/@webwalkerhq/dsh-replay-lab/client.js?rev=release',
    )).toBe('@webwalkerhq/dsh-replay-lab')
  })

  it('falls back to the published package id outside a plugin script load', async () => {
    expect(await registeredId()).toBe('@webwalkerhq/dsh-replay-lab')
  })
})

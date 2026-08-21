import { describe, expect, it } from 'vitest'
import {
  collectRouteLineageEvidence, matchRouteLineage, RouteLineageMonitor,
  type DurableSessionRouteLog,
} from '../src/route-lineage.ts'

function request(seq: number, time: number, provider: string, model: string, maxTokens = 256): unknown {
  return {
    type: 'request/header', seq, time,
    data: { reason: 'initial', header: { config: { provider, model, reasoningEffort: 'high', maxTokens } } },
  }
}

function parent(events: readonly unknown[] = [request(0, 100, 'deepseek', 'model-new')]): DurableSessionRouteLog {
  return { sessionId: 'parent', header: { id: 'parent', createdAt: 10 }, events }
}

function child(id: string, events: readonly unknown[], overrides: Record<string, unknown> = {}): DurableSessionRouteLog {
  return {
    sessionId: id,
    header: { id, createdAt: 200, parentSession: 'parent', origin: 'subagent', seedLength: 0, ...overrides },
    events,
  }
}

describe('durable parent/child route lineage matcher', () => {
  it('reports route match and mismatch from request headers, not metadata', () => {
    const matched = matchRouteLineage(parent(), child('child-match', [request(0, 201, 'deepseek', 'model-new')]))
    expect(matched).toMatchObject({
      expectedParentRoute: { provider: 'deepseek', model: 'model-new' },
      actualChildRoute: { provider: 'deepseek', model: 'model-new' },
      routeMismatch: false,
    })

    const mismatched = matchRouteLineage(parent(), child('child-drift', [request(0, 201, 'deepseek', 'model-old')]))
    expect(mismatched).toMatchObject({
      expectedParentRoute: { provider: 'deepseek', model: 'model-new' },
      actualChildRoute: { provider: 'deepseek', model: 'model-old' },
      routeMismatch: true,
      routeSource: {
        expectedParentRoute: 'parent-latest-request-header-at-or-before-child-createdAt',
        actualChildRoute: 'child-first-owned-request-header',
      },
    })
    expect(mismatched?.provenance.evidenceHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('fails closed when the parent request header is missing', () => {
    expect(matchRouteLineage(parent([]), child('child', [request(0, 201, 'deepseek', 'model-new')]))).toMatchObject({
      expectedParentRoute: null,
      routeMismatch: null,
      missingReason: 'parent has no durable request/header at or before child creation',
    })
  })

  it('fails closed when the child owned request header is missing', () => {
    const inherited = request(0, 100, 'deepseek', 'model-old')
    expect(matchRouteLineage(parent(), child('child', [inherited], { seedLength: 1 }))).toMatchObject({
      expectedParentRoute: { model: 'model-new' },
      actualChildRoute: null,
      routeMismatch: null,
      missingReason: 'child has no owned durable request/header',
    })
  })

  it('collects multiple children independently', () => {
    const evidence = collectRouteLineageEvidence([
      parent(),
      child('child-a', [request(0, 201, 'deepseek', 'model-new')]),
      child('child-b', [request(0, 202, 'deepseek', 'model-old')]),
    ])
    expect(evidence.map(item => [item.childSessionId, item.routeMismatch])).toEqual([
      ['child-a', false], ['child-b', true],
    ])
  })

  it('uses event sequence/time rather than array order and rejects incorrect lineage', () => {
    const unorderedParent = parent([
      request(9, 300, 'deepseek', 'too-late'),
      request(4, 190, 'deepseek', 'latest-before-child'),
      request(1, 100, 'deepseek', 'old'),
    ])
    const unorderedChild = child('child', [
      request(4, 240, 'deepseek', 'later-child'),
      request(3, 230, 'deepseek', 'latest-before-child'),
      request(0, 100, 'deepseek', 'inherited'),
    ], { seedLength: 3 })
    expect(matchRouteLineage(unorderedParent, unorderedChild)).toMatchObject({
      expectedParentRoute: { model: 'latest-before-child' },
      actualChildRoute: { model: 'latest-before-child' },
      routeMismatch: false,
    })

    const wrong = child('child-wrong', [request(0, 201, 'deepseek', 'model-new')], { parentSession: 'other' })
    expect(matchRouteLineage(parent(), wrong)).toMatchObject({
      routeMismatch: null,
      missingReason: 'parent lineage does not resolve to a matching durable session header',
    })
    expect(matchRouteLineage(parent(), child('ordinary-fork', [], { origin: undefined }))).toBeUndefined()
  })

  it('retains captured evidence after a child leaves the live session store', async () => {
    let logs: readonly DurableSessionRouteLog[] = [parent(), child('child', [request(0, 201, 'deepseek', 'model-old')])]
    const persisted: unknown[] = []
    const monitor = new RouteLineageMonitor(() => logs, async evidence => { persisted.push(evidence) })
    await monitor.refresh()
    logs = [parent()]
    await monitor.refresh()
    expect(monitor.list('parent')).toHaveLength(1)
    expect(monitor.list('parent')[0]?.routeMismatch).toBe(true)
    expect(persisted).toHaveLength(1)
  })
})

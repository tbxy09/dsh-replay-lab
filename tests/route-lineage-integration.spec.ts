import { describe, expect, it } from 'vitest'
import {
  SESSION_FORMAT_VERSION, Session, SessionId, type SessionHeader,
} from '@deepseek-ai/dsh-session'
import { collectRouteLineageEvidence, type DurableSessionRouteLog } from '../src/route-lineage.ts'

function header(id: string, createdAt: number, extra: Partial<SessionHeader> = {}): SessionHeader {
  return { version: SESSION_FORMAT_VERSION, id: SessionId(id), createdAt, ...extra }
}

function log(session: Session): DurableSessionRouteLog {
  return { sessionId: String(session.id), header: session.header, events: session.events }
}

describe('native Session event integration', () => {
  it('projects native durable headers and request/header events into semantic route evidence', () => {
    const parent = Session.create(SessionId('parent-native'), [], header('parent-native', 10))
    const parentEvent = parent.append('request/header', {
      reason: 'initial',
      header: { config: { provider: 'deepseek', model: 'route-after-switch', maxTokens: 128 } },
    })
    const childCreatedAt = parentEvent.time + 1
    const child = Session.create(SessionId('child-native'), parent.events, header('child-native', childCreatedAt, {
      parentSession: parent.id,
      origin: 'subagent',
      seedLength: parent.events.length,
      delegationDepth: 1,
    }))
    const childEvent = child.append('request/header', {
      reason: 'change',
      header: { config: { provider: 'deepseek', model: 'creation-time-route', maxTokens: 128 } },
    })

    const [evidence] = collectRouteLineageEvidence([log(parent), log(child)])
    expect(evidence).toMatchObject({
      parentSessionId: 'parent-native',
      childSessionId: 'child-native',
      expectedParentRoute: { provider: 'deepseek', model: 'route-after-switch' },
      actualChildRoute: { provider: 'deepseek', model: 'creation-time-route' },
      routeMismatch: true,
      provenance: {
        lineage: 'session.header.parentSession+origin',
        parentRequestSeq: parentEvent.seq,
        childRequestSeq: childEvent.seq,
      },
    })
  })
})

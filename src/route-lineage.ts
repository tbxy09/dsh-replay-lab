import { createHash } from 'node:crypto'
import type { DurableRouteIdentity, RouteLineageEvidence } from './types.ts'

interface SessionHeaderLike {
  id?: unknown
  createdAt?: unknown
  parentSession?: unknown
  origin?: unknown
  seedLength?: unknown
}

export interface DurableSessionRouteLog {
  sessionId: string
  header: SessionHeaderLike
  events: readonly unknown[]
}

interface RouteRequest {
  seq: number
  time: number
  route: DurableRouteIdentity
}

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined
}

function safeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function routeRequest(value: unknown): RouteRequest | undefined {
  const event = object(value)
  if (event?.type !== 'request/header') return undefined
  const seq = safeInteger(event.seq)
  const time = safeInteger(event.time)
  const config = object(object(object(event.data)?.header)?.config)
  if (seq === undefined || time === undefined || config === undefined) return undefined
  if (typeof config.provider !== 'string' || config.provider.length === 0) return undefined
  if (typeof config.model !== 'string' || config.model.length === 0) return undefined
  const maxTokens = safeInteger(config.maxTokens)
  const route: DurableRouteIdentity = {
    provider: config.provider,
    model: config.model,
    ...(typeof config.reasoningEffort === 'string' ? { reasoning: config.reasoningEffort } : {}),
    ...(maxTokens === undefined ? {} : { maxTokens }),
  }
  return { seq, time, route }
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function unknownEvidence(
  child: DurableSessionRouteLog,
  parentSessionId: string,
  reason: string,
  childCreatedAt: number | null,
  childSeedLength: number,
  parentRequest: RouteRequest | undefined,
  childRequest: RouteRequest | undefined,
): RouteLineageEvidence {
  const core = {
    parentSessionId,
    childSessionId: child.sessionId,
    expectedParentRoute: parentRequest?.route ?? null,
    actualChildRoute: childRequest?.route ?? null,
    routeMismatch: null,
    childCreatedAt,
    childSeedLength,
    parentRequestSeq: parentRequest?.seq ?? null,
    childRequestSeq: childRequest?.seq ?? null,
    missingReason: reason,
  }
  return {
    schemaVersion: 'route-lineage/v1',
    parentSessionId,
    childSessionId: child.sessionId,
    expectedParentRoute: parentRequest?.route ?? null,
    actualChildRoute: childRequest?.route ?? null,
    routeMismatch: null,
    routeSource: {
      expectedParentRoute: 'parent-latest-request-header-at-or-before-child-createdAt',
      actualChildRoute: 'child-first-owned-request-header',
    },
    provenance: {
      lineage: 'session.header.parentSession+origin',
      expectedParentRoute: 'durable-request/header',
      actualChildRoute: 'durable-request/header',
      childCreatedAt,
      childSeedLength,
      parentRequestSeq: parentRequest?.seq ?? null,
      childRequestSeq: childRequest?.seq ?? null,
      evidenceHash: hash(core),
    },
    missingReason: reason,
  }
}

/** Match only a native subagent lineage. Generic forks are not child-agent evidence. */
export function matchRouteLineage(
  parent: DurableSessionRouteLog | undefined,
  child: DurableSessionRouteLog,
): RouteLineageEvidence | undefined {
  if (child.header.origin !== 'subagent' || typeof child.header.parentSession !== 'string') return undefined
  const parentSessionId = child.header.parentSession
  const childCreatedAt = safeInteger(child.header.createdAt) ?? null
  const childSeedLength = safeInteger(child.header.seedLength) ?? 0
  const childRequest = child.events
    .map(routeRequest)
    .filter((event): event is RouteRequest => event !== undefined && event.seq >= childSeedLength)
    .sort((a, b) => a.seq - b.seq || a.time - b.time)[0]

  if (child.header.id !== child.sessionId) {
    return unknownEvidence(child, parentSessionId, 'child session header id does not match its durable session id', childCreatedAt, childSeedLength, undefined, childRequest)
  }
  if (parent === undefined) {
    return unknownEvidence(child, parentSessionId, 'parent session is unavailable', childCreatedAt, childSeedLength, undefined, childRequest)
  }
  if (parent.header.id !== parent.sessionId || parent.sessionId !== parentSessionId) {
    return unknownEvidence(child, parentSessionId, 'parent lineage does not resolve to a matching durable session header', childCreatedAt, childSeedLength, undefined, childRequest)
  }
  if (childCreatedAt === null) {
    return unknownEvidence(child, parentSessionId, 'child createdAt is unavailable', childCreatedAt, childSeedLength, undefined, childRequest)
  }

  const parentRequest = parent.events
    .map(routeRequest)
    .filter((event): event is RouteRequest => event !== undefined && event.time <= childCreatedAt)
    .sort((a, b) => b.time - a.time || b.seq - a.seq)[0]

  if (parentRequest === undefined) {
    return unknownEvidence(child, parentSessionId, 'parent has no durable request/header at or before child creation', childCreatedAt, childSeedLength, undefined, childRequest)
  }
  if (childRequest === undefined) {
    return unknownEvidence(child, parentSessionId, 'child has no owned durable request/header', childCreatedAt, childSeedLength, parentRequest, undefined)
  }

  // Route drift is provider/model ownership. Other request config remains visible
  // but does not create a false route mismatch on its own.
  const routeMismatch = parentRequest.route.provider !== childRequest.route.provider
    || parentRequest.route.model !== childRequest.route.model
  const core = {
    parentSessionId,
    childSessionId: child.sessionId,
    expectedParentRoute: parentRequest.route,
    actualChildRoute: childRequest.route,
    routeMismatch,
    childCreatedAt,
    childSeedLength,
    parentRequestSeq: parentRequest.seq,
    childRequestSeq: childRequest.seq,
  }
  return {
    schemaVersion: 'route-lineage/v1',
    parentSessionId,
    childSessionId: child.sessionId,
    expectedParentRoute: parentRequest.route,
    actualChildRoute: childRequest.route,
    routeMismatch,
    routeSource: {
      expectedParentRoute: 'parent-latest-request-header-at-or-before-child-createdAt',
      actualChildRoute: 'child-first-owned-request-header',
    },
    provenance: {
      lineage: 'session.header.parentSession+origin',
      expectedParentRoute: 'durable-request/header',
      actualChildRoute: 'durable-request/header',
      childCreatedAt,
      childSeedLength,
      parentRequestSeq: parentRequest.seq,
      childRequestSeq: childRequest.seq,
      evidenceHash: hash(core),
    },
  }
}

export function collectRouteLineageEvidence(logs: readonly DurableSessionRouteLog[]): RouteLineageEvidence[] {
  const byId = new Map(logs.map(log => [log.sessionId, log]))
  return logs.flatMap(child => {
    const parentId = typeof child.header.parentSession === 'string' ? child.header.parentSession : undefined
    const evidence = matchRouteLineage(parentId === undefined ? undefined : byId.get(parentId), child)
    return evidence === undefined ? [] : [evidence]
  }).sort((a, b) => a.childSessionId.localeCompare(b.childSessionId))
}

export function isRouteLineageEvidence(value: unknown): value is RouteLineageEvidence {
  const candidate = object(value)
  const expectedRoute = candidate?.expectedParentRoute === null ? null : object(candidate?.expectedParentRoute)
  const actualRoute = candidate?.actualChildRoute === null ? null : object(candidate?.actualChildRoute)
  const routeSource = object(candidate?.routeSource)
  const provenance = object(candidate?.provenance)
  const validRoute = (route: Record<string, unknown> | null | undefined): boolean => route === null
    || (route !== undefined && typeof route.provider === 'string' && typeof route.model === 'string')
  const validNullableInteger = (number: unknown): boolean => number === null || safeInteger(number) !== undefined
  return candidate?.schemaVersion === 'route-lineage/v1'
    && typeof candidate.parentSessionId === 'string'
    && typeof candidate.childSessionId === 'string'
    && (candidate.routeMismatch === null || typeof candidate.routeMismatch === 'boolean')
    && validRoute(expectedRoute)
    && validRoute(actualRoute)
    && (candidate.routeMismatch === null || (expectedRoute !== null && actualRoute !== null))
    && routeSource?.expectedParentRoute === 'parent-latest-request-header-at-or-before-child-createdAt'
    && routeSource.actualChildRoute === 'child-first-owned-request-header'
    && provenance?.lineage === 'session.header.parentSession+origin'
    && provenance.expectedParentRoute === 'durable-request/header'
    && provenance.actualChildRoute === 'durable-request/header'
    && validNullableInteger(provenance.childCreatedAt)
    && safeInteger(provenance.childSeedLength) !== undefined
    && validNullableInteger(provenance.parentRequestSeq)
    && validNullableInteger(provenance.childRequestSeq)
    && typeof provenance.evidenceHash === 'string'
    && /^[a-f0-9]{64}$/.test(provenance.evidenceHash)
    && (candidate.missingReason === undefined || typeof candidate.missingReason === 'string')
}

export class RouteLineageMonitor {
  private readonly evidence = new Map<string, RouteLineageEvidence>()
  private pending: Promise<void> = Promise.resolve()

  constructor(
    private readonly logs: () => readonly DurableSessionRouteLog[],
    private readonly persist?: (evidence: RouteLineageEvidence) => Promise<void>,
  ) {}

  restore(values: readonly unknown[]): void {
    for (const value of values) if (isRouteLineageEvidence(value)) this.evidence.set(value.childSessionId, value)
  }

  refresh(): Promise<void> {
    const current = this.pending.then(() => this.refreshNow())
    this.pending = current.catch(() => undefined)
    return current
  }

  private async refreshNow(): Promise<void> {
    for (const evidence of collectRouteLineageEvidence(this.logs())) {
      const previous = this.evidence.get(evidence.childSessionId)
      // A transiently unavailable parent after restart must not downgrade a
      // previously captured, complete durable decision for the same child.
      if (previous?.routeMismatch !== null && evidence.routeMismatch === null) continue
      this.evidence.set(evidence.childSessionId, evidence)
      if (this.persist !== undefined && previous?.provenance.evidenceHash !== evidence.provenance.evidenceHash) {
        await this.persist(evidence)
      }
    }
  }

  list(sessionId?: string): readonly RouteLineageEvidence[] {
    return [...this.evidence.values()]
      .filter(evidence => sessionId === undefined || evidence.parentSessionId === sessionId || evidence.childSessionId === sessionId)
      .sort((a, b) => a.childSessionId.localeCompare(b.childSessionId))
  }
}

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ReplayLabService } from './service.ts'
import type { ApiResponse, ReplayTurnIdentifier } from './types.ts'

function respond<T>(res: ServerResponse, status: number, body: ApiResponse<T>): void {
  const bytes = Buffer.from(JSON.stringify(body))
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(bytes.length),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(bytes)
}

function success<T>(value: T): ApiResponse<T> { return { ok: true, value } }
function failure(code: string, message: string): ApiResponse<never> { return { ok: false, error: { code, message } } }

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += bytes.length
    if (size > 64 * 1024) throw new Error('request body too large')
    chunks.push(bytes)
  }
  if (chunks.length === 0) return {}
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('body 必须是 JSON object')
  return value as Record<string, unknown>
}

function asIdentifier(value: Record<string, unknown>): ReplayTurnIdentifier {
  if (typeof value.sessionId !== 'string' || value.sessionId.length === 0) throw new Error('sessionId is required')
  if (!Number.isSafeInteger(value.turn) || Number(value.turn) < 1) throw new Error('turn must be a positive integer')
  if (typeof value.expectedEvidenceHash !== 'string' || !/^[a-f0-9]{64}$/u.test(value.expectedEvidenceHash)) {
    throw new Error('expectedEvidenceHash must be a SHA-256 hash')
  }
  return value as unknown as ReplayTurnIdentifier
}

function asSessionId(value: Record<string, unknown>): string {
  if (typeof value.sessionId !== 'string' || value.sessionId.length === 0) throw new Error('sessionId is required')
  return value.sessionId
}

export function createHttpHandler(service: ReplayLabService) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const base = service.routeBase
    const path = url.pathname === base ? '' : url.pathname.startsWith(`${base}/`) ? url.pathname.slice(base.length + 1) : null
    if (path === null) { respond(res, 404, failure('not-found', 'Replay Lab route 不存在')); return }
    try {
      if (req.method === 'GET' && path === '') {
        const sessionId = url.searchParams.get('sessionId') ?? undefined
        respond(res, 200, success(await service.snapshot(sessionId))); return
      }
      if (req.method === 'POST' && path === 'case') {
        const value = await body(req)
        if (typeof value.sourceId !== 'string') throw new Error('sourceId 必须是字符串')
        respond(res, 200, success(await service.freeze(value.sourceId))); return
      }
      if (req.method === 'POST' && path === 'admit') {
        respond(res, 200, success(await service.admit(asIdentifier(await body(req))))); return
      }
      if (req.method === 'POST' && path === 'plan') {
        const value = await body(req)
        if (typeof value.candidateVariantId !== 'string') throw new Error('candidateVariantId 必须是字符串')
        respond(res, 200, success(await service.plan(value.candidateVariantId, asSessionId(value)))); return
      }
      if (req.method === 'POST' && path === 'approve-run') {
        respond(res, 202, success(await service.approveAndRun(asSessionId(await body(req))))); return
      }
      if (req.method === 'POST' && path === 'summarize') {
        const value = await body(req)
        if (typeof value.experimentId !== 'string' || value.experimentId.length === 0) throw new Error('experimentId is required')
        respond(res, 200, success(await service.summarize(value.experimentId, asSessionId(value)))); return
      }
      if (req.method === 'POST' && path === 'abort') {
        respond(res, 200, success(await service.abort(asSessionId(await body(req))))); return
      }
      if (req.method === 'POST' && path === 'reset') {
        respond(res, 200, success(await service.reset(asSessionId(await body(req))))); return
      }
      respond(res, 405, failure('method', 'Replay Lab method 不支持'))
    } catch (error) {
      respond(res, 400, failure('request', error instanceof Error ? error.message : String(error)))
    }
  }
}

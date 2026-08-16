import type { ApiResponse, LabSnapshot, ReplayTurnIdentifier } from '../types.ts'

export interface ClientState {
  open: boolean
  status: 'cold' | 'loading' | 'ready' | 'error'
  snapshot?: LabSnapshot
  error?: string
  unsupported?: string
}

export class ReplayLabController {
  private listeners = new Set<() => void>()
  private state: ClientState = Object.freeze({ open: false, status: 'cold' })
  private poll?: number

  constructor(
    private readonly apiBase = '/replay-lab-dsh',
    private readonly sessionId?: string,
  ) {}

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  readonly getSnapshot = (): ClientState => this.state

  open(): void { this.patch({ open: true }); void this.refresh() }
  close(): void { this.patch({ open: false, unsupported: undefined }); this.stopPolling() }

  async refresh(): Promise<void> {
    const query = this.sessionId === undefined ? '' : `?sessionId=${encodeURIComponent(this.sessionId)}`
    await this.request('GET', query)
    const status = this.state.snapshot?.experiment?.status
    if (status === 'approved' || status === 'running') this.startPolling()
    else this.stopPolling()
  }

  async freeze(sourceId: string): Promise<void> {
    await this.request('POST', '/case', { sourceId })
  }

  async admit(identifier: ReplayTurnIdentifier): Promise<void> {
    if (this.sessionId !== undefined && identifier.sessionId !== this.sessionId) {
      throw new Error('Replay controller session mismatch')
    }
    await this.request('POST', '/admit', identifier)
  }

  async plan(candidateVariantId: string): Promise<void> {
    const variant = this.state.snapshot?.variants.find(item => item.id === candidateVariantId)
    if (variant?.supported === false) {
      this.patch({ unsupported: variant.unsupportedReason ?? '该 variant 不支持' })
      return
    }
    this.patch({ unsupported: undefined })
    await this.request('POST', '/plan', { sessionId: this.requireSessionId(), candidateVariantId })
  }

  async approveRun(): Promise<void> {
    await this.request('POST', '/approve-run', { sessionId: this.requireSessionId() })
    this.startPolling()
  }

  async reset(): Promise<void> {
    await this.request('POST', '/reset', { sessionId: this.requireSessionId() })
    this.stopPolling()
  }

  async abort(): Promise<void> {
    await this.request('POST', '/abort', { sessionId: this.requireSessionId() })
    this.stopPolling()
  }

  private requireSessionId(): string {
    if (this.sessionId === undefined) throw new Error('session-scoped Replay controller is required')
    return this.sessionId
  }

  private async request(method: 'GET' | 'POST', path: string, value?: unknown): Promise<void> {
    this.patch({ status: 'loading', error: undefined })
    try {
      const response = await fetch(`${this.apiBase}${path}`, {
        method,
        headers: value === undefined ? undefined : { 'content-type': 'application/json' },
        body: value === undefined ? undefined : JSON.stringify(value),
      })
      const payload = await response.json() as ApiResponse<LabSnapshot>
      if (!payload.ok) throw new Error(payload.error.message)
      this.patch({ status: 'ready', snapshot: payload.value, error: undefined })
    } catch (error) {
      this.patch({ status: 'error', error: error instanceof Error ? error.message : String(error) })
    }
  }

  private startPolling(): void {
    if (this.poll !== undefined) return
    this.poll = window.setInterval(() => { void this.refresh() }, 120)
  }

  private stopPolling(): void {
    if (this.poll !== undefined) window.clearInterval(this.poll)
    this.poll = undefined
  }

  private patch(next: Partial<ClientState>): void {
    this.state = Object.freeze({ ...this.state, ...next })
    for (const listener of this.listeners) listener()
  }
}

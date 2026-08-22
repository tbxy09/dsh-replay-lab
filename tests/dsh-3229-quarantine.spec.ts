import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { interruptedTurnClosers, type SessionEvent } from '@deepseek-ai/dsh-session'
import { replayTurnsProjectionDefinition as projection } from '../src/replay-turn-projection.ts'

const evidencePath = fileURLToPath(new URL(
  '../artifacts/fixture-packets/dsh-3229-runaway-pwsh/evidence.json',
  import.meta.url,
))
const evidence = JSON.parse(readFileSync(evidencePath, 'utf8')) as {
  classification: { role: string; baselineEligibility: string; isCandidate: boolean }
  turnBoundary: { sourceCompletedTurnCount: number; repairBoundaryIsSourceEvidence: boolean }
  replayLabProjection: { finalizedTurnCount: number }
  sensitivity: { rawContentIncluded: boolean; knownCredentialPatternMatches: number }
}
const provenance = JSON.parse(readFileSync(fileURLToPath(new URL(
  '../artifacts/fixture-packets/dsh-3229-runaway-pwsh/PROVENANCE.json',
  import.meta.url,
)), 'utf8')) as {
  source: { sha256: string }
  handling: { rawCommitted: boolean; rawPackaged: boolean; rawCommandsExecuted: boolean }
  derivedEvidence: { sha256: string }
}

function rawLikeOpenTurn(): SessionEvent[] {
  return [
    { type: 'turn/start', seq: 0, time: 10, data: { turn: 1 } },
    {
      type: 'user/message', seq: 1, time: 11, surfaceOp: 'append', data: {
        id: 'synthetic-user', role: 'user', source: { kind: 'user' },
        content: [{ type: 'text', text: 'synthetic inert prompt' }],
      },
    },
    {
      type: 'request/header', seq: 2, time: 12, data: {
        reason: 'initial', header: {
          config: { provider: 'fake', model: 'fixture', reasoningEffort: 'low', maxTokens: 32 },
          system: 'synthetic', tools: [],
        },
      },
    },
    { type: 'step/start', seq: 3, time: 13, data: { turn: 1, step: 1 } },
    {
      type: 'assistant/chunk', seq: 4, time: 14, data: {
        turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'unfinished' },
      },
    },
  ] as SessionEvent[]
}

describe('Discussion #3229 source-session quarantine', () => {
  it('keeps the source-session role distinct from a candidate', () => {
    expect(evidence.classification).toMatchObject({
      role: 'source-session', baselineEligibility: 'quarantined', isCandidate: false,
    })
    expect(evidence.turnBoundary).toMatchObject({
      sourceCompletedTurnCount: 0, repairBoundaryIsSourceEvidence: false,
    })
    expect(evidence.replayLabProjection.finalizedTurnCount).toBe(0)
  })

  it('does not publish an unfinished imported turn', () => {
    let state = projection.init()
    for (const event of rawLikeOpenTurn()) state = projection.apply(state, event)
    expect(projection.view(state).turns).toEqual([])
  })

  it('distinguishes crash-repair closers from source-recorded completion', () => {
    const closers = interruptedTurnClosers(rawLikeOpenTurn())
    expect(closers.map(event => event.type)).toEqual(['step/end', 'turn/end'])
    expect(closers.at(-1)).toMatchObject({ data: { reason: { kind: 'interrupted' } } })
    expect(evidence.turnBoundary.repairBoundaryIsSourceEvidence).toBe(false)
  })

  it('commits only redacted aggregate evidence', () => {
    expect(evidence.sensitivity).toMatchObject({
      rawContentIncluded: false,
      knownCredentialPatternMatches: 0,
    })
    expect(provenance.handling).toEqual(expect.objectContaining({
      rawCommitted: false, rawPackaged: false, rawCommandsExecuted: false,
    }))
    expect(createHash('sha256').update(readFileSync(evidencePath)).digest('hex'))
      .toBe(provenance.derivedEvidence.sha256)
    expect(provenance.source.sha256).toMatch(/^[a-f0-9]{64}$/)
  })
})

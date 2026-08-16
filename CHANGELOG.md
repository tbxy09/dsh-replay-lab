# Changelog

All notable changes are documented here. This project follows Semantic Versioning.

## Unreleased

### Changed

- Workspace hash drift no longer blocks an approved candidate. Replay Lab now
  copies the current source state into the normal isolated workspace, records
  frozen/current hashes in run and scorecard provenance, and marks the saved
  comparison as drifted in the Replay UI.
- Scorecards and evidence summaries now use readable metric names, grouped
  numbers, human-duration units, friendly request phases, and compact IDs while
  retaining exact raw values in hover text.

## 0.1.0 - 2026-08-15

### Added

- Per-session Replay tab backed by authoritative durable session projections.
- Frozen replay cases with prompt, workspace, model, reasoning, token-budget,
  preset, system, and tool-schema evidence hashes.
- Standard, Minimal, Anchored Standard, and agent-scoped candidate variants.
- Explicit approval boundary before candidate execution.
- Candidate workspace isolation and path-containment guards.
- Independent-evidence scorecards for tokens, duration, steps, and tool calls.
- Deterministic fake adapter for offline verification.

### Security

- Missing request metadata fails closed.
- Unsupported provider, session-store, sandbox, and host-plane changes fail closed.

# Changelog

All notable changes are documented here. This project follows Semantic Versioning.

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

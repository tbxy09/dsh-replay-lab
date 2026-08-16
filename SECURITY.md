# Security policy

## Supported versions

Only the latest `0.1.x` release receives security fixes during the
developer-preview period.

## Report a vulnerability

Do not open a public issue for a vulnerability that may expose files,
credentials, provider requests, session logs, or candidate workspaces. Use the
private vulnerability-reporting form in the repository Security tab.

Include the affected versions, operating system, a credential-free
reproduction, the expected containment boundary, and whether a candidate,
subagent, symlink, route, or artifact path is involved.

## Trust boundaries

- The observed source session is read-only evidence.
- A candidate runs only after explicit user approval.
- Candidate execution is restricted to a process-owned workspace copy.
- Structured file arguments are rejected when they escape the copy, including
  through symlinks.
- The Web client talks only to the plugin Host JSON API. It does not directly
  read the filesystem or call a model provider.
- Provider, session-store, sandbox-provider, and host-singleton replacements
  are unsupported in `0.1.x`.
- Artifacts may contain prompts, paths, outputs, tool evidence, and cost data.
  Store them privately and review them before sharing.

## CI safety

CI must use deterministic fixtures only. Release and pull-request workflows
must not receive model-provider credentials or approve a live run.

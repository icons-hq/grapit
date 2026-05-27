# Domain Docs

This is a single-context repo.

## Before exploring, read these when present

- `CONTEXT.md` at the repo root
- `docs/adr/`
- `AGENTS.md`
- `docs/03-ARCHITECTURE.md`

If `CONTEXT.md` or `docs/adr/` does not exist yet, continue from source code and existing repo docs. Do not create them unless the user asks or a documentation skill explicitly resolves new domain terms or decisions.

## Current Grabit context

Grabit is a live entertainment ticket booking platform. Preserve the core flow: `discover -> seat selection -> booking/payment -> QR ticket -> venue entry`.

Treat `.planning/` as historical context, not as the current source of truth, unless a workflow explicitly asks for planning artifacts.

## Use the glossary's vocabulary

When `CONTEXT.md` exists, use its domain terms in issue titles, hypotheses, tests, and refactor proposals.

## Flag ADR conflicts

If an output contradicts an existing ADR, surface the conflict explicitly instead of silently overriding it.

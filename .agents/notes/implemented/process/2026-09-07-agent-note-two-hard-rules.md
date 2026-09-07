# Agent Note: Two hard rules for Agent Notes (write before implementing + one note per PR)

Status: implemented

English | [中文](2026-09-07-agent-note-two-hard-rules.zh.md)

## Problem

Too many Agent Notes in this repo are junk: 59 notes in 9 days, most of them diff summaries ("deleted these files, migrated those tests") that duplicate commit messages; of the 34 `architecture/` notes, almost none is a pure architecture decision. Root cause is timing — notes are backfilled after implementation, the decision context has already been compressed away, and the AI can only rewrite the diff into prose.

## Decision

Add two hard rules to the "When to write one" section of `.agents/notes/README.md`:

1. **Write the note before implementing.** When the design is finalized — that is, when the user says "start implementing" — draft the Agent Note as `proposed/` first, before any plan work begins; after verification promote it to `implemented/`, appending only `## Consequences`; `Problem`/`Decision`/`Alternatives considered` are frozen at proposal time.
2. **One note per PR/plan, not per commit.** A pure refactor or test-migration commit carries no note of its own (any decision lives in the PR's note).

## Alternatives considered

- **Only prompt the AI to write better notes, keep the process unchanged.** Rejected: once implementation is done the decision context is unrecoverable; better prompts produce better-formatted logs, not recovered information.
- **Add a CI gate that checks note quality (forbidden-words list etc.).** Rejected: a gate is a necessary complement, but this round the user explicitly wants "only two rules"; forbidden words and scripts stay for later. This addresses the root cause (information loss) first.

## Consequences

- README's "When to write one" now carries the two hard rules in both languages; the pairing record (README.i18n.yaml) is updated.
- First practical application of rule 1: this note itself was drafted as `proposed/` before the README edit and promoted to `implemented/` after `npm run doc-sync` passed.
- Explicitly out of scope this round: forbidden-word list and CI gate scripts for note quality.

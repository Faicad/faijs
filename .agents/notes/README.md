# Agent Notes

English | [中文](README.zh.md)

Agent Notes are decision records: why a change was made, what was given up, and what alternatives were rejected. They live under `.agents/notes/` in a lifecycle/class tree and are distinct from standing documentation in `docs/`.

## Layout and naming

```
.agents/notes/{lifecycle}/{class}/yyyy-mm-dd-topic-title.md
```

- **lifecycle** (closed set): `proposed`, `implemented`, `rejected`
- **class** (closed set): `feature`, `bug-fix`, `simplification`, `architecture`, `process`, `testing`
- **filename**: `yyyy-mm-dd-topic-title.md` (kebab-case topic after the date)

A Chinese counterpart (`foo.zh.md`) and its `.i18n.yaml` record sit beside the English source. The pairing gate owns their consistency.

## Lifecycle

- `proposed/` — a decision is being proposed but not yet adopted
- `implemented/` — the decision is adopted and delivered; the note states what *is* (present tense)
- `rejected/` — the proposal was not adopted; the reason is on the `Status:` line
- `archived/` — frozen historical `implemented/` notes, sealed in `manifest.json`; see `archived/AGENTS.md`

## When to write one

Every non-trivial change must include at least one Agent Note. If a full design document exists in `docs/plans/`, the Agent Note is a concise summary of the decision — stated so that it stands alone, because the docs standard forbids any non-`docs/plans/` document from referencing a `docs/plans/` document.

## The file format

### Header block (first three lines, exactly)

```markdown
# Agent Note: <title>

Status: <status>
```

`Status:` values (must match the lifecycle folder):
- `Status: proposed`
- `Status: implemented`
- `Status: rejected — <why, in one line>`

### Body skeleton

#### `proposed/`

```markdown
## Problem
## Proposal
…bespoke sections…
## Alternatives considered
## Acceptance criteria
## Risks
```

#### `implemented/`

```markdown
## Problem
## Decision
…bespoke sections…
## Alternatives considered
## Consequences
```

#### `rejected/`

Retain all proposal sections; the conclusion is on the `Status:` line.

### `## Alternatives considered` — required

Every Agent Note must include this section. Each alternative and why it was not chosen.

## Relationship to `docs/plans/`

- `docs/plans/` holds full design documents (requirements, technical analysis, implementation plan)
- Agent Notes are self-contained decision records; they do not reference a `docs/plans/` document (only a plan may reference another plan)
- When a plan lands, create an `implemented/` Agent Note summary that states the decision on its own terms

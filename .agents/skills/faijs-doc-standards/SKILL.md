# Skill: faijs Doc Standards

When writing or editing documentation in the faijs repository, follow these standards.

## Where to put documents

- **Standing reference** (architecture, API, syntax) → `docs/*.md`
- **Design document** (requirements, plan) → `docs/plans/yyyy-mm-dd-topic.md`
- **Technical analysis** → `docs/analysis/`
- **Decision record** → `.agents/notes/{lifecycle}/{class}/yyyy-mm-dd-topic.md`
- **Reusable workflow** → `.agents/skills/<skill-name>/SKILL.md`
- **Session instructions** → `AGENTS.md` (root or subtree)

## Rules

1. One home per fact — don't duplicate rules across documents
2. Record current state, not history — history goes in commit messages
3. One physical line per prose paragraph
4. Bilingual pairing required for standing docs and Agent Notes (not for `docs/plans/` or `docs/analysis/`)
5. Run `npm run doc-sync` before submitting

## See also

- [docs/AGENTS.md](../../../docs/AGENTS.md) — full documentation standard
- [.agents/notes/README.md](../../notes/README.md) — Agent Note format

# Skill: faijs Archive Agent Notes

When archiving implemented Agent Notes to the frozen archive.

## Workflow

1. Identify `implemented/` Agent Notes that are old enough to be historical (typically > 3 months or superseded by newer decisions)
2. Move the file to `.agents/notes/archived/{class}/` (same class folder)
3. Run `npx tsx scripts/verify-archived-agent-notes.ts --write` to seal the new artifact in `manifest.json`
4. Run `npx tsx scripts/verify-archived-agent-notes.ts` to verify the archive

## Rules

- Archived notes are frozen — never modify or delete
- The archive tree must contain every class directory (`feature/`, `bug-fix/`, etc.)
- Only `AGENTS.md` and `manifest.json` at the archive root
- Append-only: new files may be added, existing files never change

## See also

- [.agents/notes/archived/AGENTS.md](../../notes/archived/AGENTS.md) — archive rules

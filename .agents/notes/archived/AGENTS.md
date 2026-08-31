# Archived Agent Notes

Frozen historical `implemented/` notes. Once an Agent Note is archived here, it never changes. The archive is sealed by `manifest.json` (git blob hashes of every artifact).

## Rules

- Artifacts are append-only: new files may be added, existing files may never be modified or deleted
- Every artifact must be sealed in `manifest.json` (run `npx tsx scripts/verify-archived-agent-notes.ts --write` to seal new artifacts)
- The archive tree must contain every required kind directory (`feature/`, `bug-fix/`, `simplification/`, `architecture/`, `process/`, `testing/`)
- Only `AGENTS.md` and `manifest.json` are allowed at the root level

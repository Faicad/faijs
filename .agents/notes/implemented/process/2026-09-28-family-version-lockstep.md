# Agent Note: one version for the whole @faicad/* family (single source + writer + guard)

Status: implemented

English | [中文](2026-09-28-family-version-lockstep.zh.md)

## Problem

The publishable `@faicad/*` family is supposed to release under one version, but the rule existed only as an intent: version bumps were hand-edited across twelve `package.json` files, and the family had silently forked into four version lines (`@faicad/faijs` 0.20.0, seven packages 0.19.0, `@faicad/faijs-draw` 0.18.3, the three `cq-compat-*` packages 0.17.0). Nothing in the commit or CI path noticed.

Three concrete gaps:

- **No single source of truth.** The version lived in each package's own `version` field, so "bump the family" was a multi-file manual edit with no way to check the result short of reading twelve files.
- **The writer had rotted.** `scripts/bump-version.mjs` bumped the *root* package version (the root is `private` and never published) and rewrote `demo/package.json` — a path that no longer exists since the demo moved to `packages/demo`. Running it would have thrown on a missing directory while leaving every family member untouched. The last real family bump was a hand-written commit.
- **The guard could not see the drift.** The [dependency lockstep guard](../bug-fix/2026-09-24-dep-lockstep-guard.md) only checked that each inter-package range matched *the target's own* version line, so a family split across four lines still passed. The only version-equality assertion lived in `publish-all.ps1` step 1, i.e. it could only fire at release time, and `scripts/ci.sh` ran no lockstep guard at all.
- **A second home had already rotted.** `cdn/versions.json` — the generated exact-pin mirror the plan-b browser lib loader reads — carried three older version lines (0.16.2 / 0.16.1 / 0.13.2) and was missing `@faicad/faijs-draw` and `@faicad/faijs-sketch` entirely, because nothing regenerates it except a manual `gen-importmap.mjs` run.

## Decision

Three cooperating pieces, one rule, in `scripts/lockstep-lib.mjs` (shared definitions: family discovery, `expectedRange`, `readCdnVersions`, `collectViolations`):

1. **Single source of truth** — the family version is declared once as root `package.json` → `config.faijsVersion`. The root package is `private`, so its own `version` field is not a release version and is not used for this purpose.
2. **Writer** — `scripts/set-version.mjs <ver>` writes the declared version, every family member's `version`, and every registry-range `@faicad/*` entry (`dependencies` / `peerDependencies` / `devDependencies`) to `^<major>.<minor>.0`; then it refreshes `package-lock.json` so the lock's workspace entries match, and regenerates `cdn/versions.json` so the CDN pin mirror cannot be left behind. `--dry-run` prints the plan, `--no-lock` skips the refresh, `--include-private` extends the family to `fixtures` / `tests` / `demo`.
3. **Guard** — `scripts/check-lockstep.mjs` asserts all three halves: (a) every family member's `version` equals `config.faijsVersion`; (b) every registry-range `@faicad/*` entry equals `^<major>.<minor>.0` of its target; (c) `cdn/versions.json` pins every family member at its current version (skipped when the file is absent). `file:` / `workspace:` / `link:` entries are local resolutions and are skipped. The rules are a pure function over an in-memory package map, so `--self-test` runs them against synthetic families (aligned / forked line / stale range / local range / external name / undeclared version / devDependency range / stale CDN pin / missing CDN pin / absent CDN mirror) — a guard never seen failing is not evidence.

Rules (a) and (b) are complementary: (a) cannot see a stale range (the 2026-09 CDN break), (b) cannot see a forked line (this note's problem). Rule (c) exists because a generated mirror is still a second home for the fact, and it had drifted three version lines behind without a single gate noticing.

Gate wiring — the same single command runs in four places, so drift cannot land unnoticed:

| Gate | Role |
|---|---|
| `lefthook.yml` pre-commit (`glob: {package.json,packages/*/package.json}`) | fails the commit that introduces the drift |
| `scripts/ci.ps1` step 5 | full Windows CI |
| `scripts/ci.sh` step 5 | full Linux/macOS CI (previously ran no lockstep guard) |
| `scripts/publish-all.ps1` step 1 | release gate; absorbs the former step 1 (equality) + step 1b (ranges) and reads `$Version` from the root declaration |

Private workspace packages (`@faicad/faijs-fixtures`, `@faicad/faijs-tests`, `@faicad/faijs-demo`) are outside the family by default: they are never published, use `*` or `file:` resolutions, and their version fields carry no release meaning. `--include-private` opts them in.

The family is aligned at `0.20.0`, which also repaired two stale ranges the old guard accepted: `fcstd → @faicad/faijs-draw` (`^0.18.0`) and `fcstd → @faicad/faijs-sketch` (`^0.19.0`). The regenerated `cdn/versions.json` now pins all twelve family members at `0.20.0` and covers `@faicad/faijs-draw` / `@faicad/faijs-sketch`, which it had omitted.

## Alternatives considered

- **npm built-in workspaces version handling.** npm has no fixed-version mode; workspaces only link packages, and there is no supported way to declare one version for all members.
- **changesets / lerna fixed mode / independent-versions tooling.** Each adds a dependency and a config file, and changesets' whole value is per-package version *selection* — the opposite of the requirement. A 60-line Node script over `package.json` files needs no new dependency.
- **Keep the root `version` field as the source instead of `config.faijsVersion`.** The root package is `private: true`; npm derives the workspace-root version from that field for its own bookkeeping, so overloading it would collide with npm's semantics and mislead readers into thinking 0.x is the release line.
- **Extend the existing range guard only (status quo).** It passed on a four-way-split family — demonstrated, not hypothetical. Range coherence without version equality cannot express "one version for the family".
- **Leave equality to `publish-all.ps1` only (status quo).** Fires at release time, after the feature work is merged; a drift costs a release abort instead of a commit rejection.
- **CI-only enforcement, no pre-commit hook.** Slower feedback and it lets unaligned work sit on a branch; the hook costs ~100 ms because the rule engine is a file scan.
- **A vitest unit test in `packages/tests` instead of `--self-test`.** `packages/tests` includes only `faijs/**/*.test.ts`, and a repository-tooling test does not belong in the language/geometry integration package. Folding the synthetic cases into the guard keeps the rules and their verification in one file and runs them on every invocation.
- **Keeping `scripts/bump-version.mjs` as a deprecation shim.** It would have to forward to `set-version.mjs` under a name that no longer describes what it does; the family has one writer, so the old name was removed rather than aliased.
- **Leaving `cdn/versions.json` to a manual `gen-importmap.mjs` run.** That is the status quo, and it is how the mirror ended up three version lines behind with two packages missing. Folding the regeneration into the writer costs one local, deterministic script call and makes the mirror un-forgettable; a `--no-cdn` escape hatch was left out because the regeneration is idempotent, needs no network, and is what the guard tells you to run when the mirror drifts.
- **Deleting `cdn/versions.json` and relying on importmap resolution only.** Exact pinning exists for reproducible release artifacts, which is a different guarantee from dev/playground resolution; dropping it would trade a real property for tidiness.

## Consequences

- A family bump is one command: `node scripts/set-version.mjs <ver>`. A patch bump may legitimately leave ranges untouched (`^0.20.0` admits `0.20.x`); the writer reports unchanged fields instead of pretending to rewrite them.
- Editing one package's `version` or an `@faicad/*` range by hand fails the pre-commit hook, both CI variants, and the publish gate.
- `scripts/bump-version.mjs` and `scripts/check-dep-lockstep.mjs` are removed; their live logic lives in `set-version.mjs` and `check-lockstep.mjs`. The 2026-09-24 note is kept as the record of why the range rule exists.
- `check-lockstep.mjs --include-private` currently reports the private packages' divergence (fixtures 0.5.8, tests 0.5.9, demo unversioned, and `tests`' `*` ranges). That is the expected diagnostic output for packages outside the release family, and becomes a fix list the moment someone opts them in.
- A new publishable `@faicad/*` package joins the family automatically by virtue of being non-private under `packages/`; adding it to the `FAMILY_EXCLUDE` set is the only way to opt out, which is deliberate friction.

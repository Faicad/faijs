# Agent Note: dependency lockstep guard for publishable @faicad/* packages

Status: implemented

English | [中文](2026-09-24-dep-lockstep-guard.zh.md)

## Problem

`@faicad/fai-cq-gears` was bumped to 0.16.x but its `dependencies` still declared
`"@faicad/cq-compat": "^0.14.0"`. The CDN library build resolved the stale
cq-compat@0.14.1 from the registry, whose own pins pulled an old
`@faicad/faijs`, breaking the package graph at runtime.

`publish-all.ps1` Step 1 only checks that every package's own `version` matches
the lockstep version. It never inspects the `@faicad/*` dependency ranges
between packages, so a missed range bump sails through publish and only
surfaces as a broken CDN build. Lockstep version bumps are manual edits across
every package.json (own version + each inter-package range); one missed sed
target produces exactly this class of failure, silently.

## Decision

New guard `scripts/check-dep-lockstep.mjs` (pure Node ESM, same shape as
`check-ghost-deps.mjs`):

- Scope: every non-private `@faicad/*` package under `packages/` (same
  exclusion list as `gen-importmap.mjs`).
- Rule: for `dependencies` / `peerDependencies` entries that name another
  publishable in-repo `@faicad/*` package with a registry semver range, the
  range must be exactly `^<target-major>.<target-minor>.0` derived from the
  target's current version (e.g. target 0.16.1 → only `^0.16.0` allowed).
- `file:` / `workspace:` / `link:` local references are skipped (never resolved
  through the registry, lockstep does not apply).
- Wired in at both gates: `scripts/ci.ps1` step 5 (next to
  check-ghost-deps / check-workspaces-order) and `publish-all.ps1` new Step 1b,
  immediately after version consistency and before build/publish — a missed
  range now aborts the publish instead of shipping a broken graph.

## Alternatives considered

- **Post-publish packument verification only (warn-only)**: detects the failure
  after the packages are already on npm; useless as a gate.
- **Checking ranges across the whole workspace including private packages**
  (`faijs-tests` etc.): those use `*` / `file:` and never reach the CDN;
  constraining them adds churn without closing the failure mode.

## Consequences

A lockstep bump must now update, in the same change: every package's own
`version` and every inter-package registry range; otherwise CI and publish both
fail with a message naming the offending package and the expected range. The
guard is deliberately strict (`^X.Y.0` equality, not arbitrary satisfiable
ranges) so a stale line like `^0.14.0` can never satisfy it.

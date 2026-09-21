import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Editor-owned op boundary guard (2026-09-21) — see
 * .agents/notes/implemented/architecture/2026-09-21-editor-owned-ops-deprecation.md
 *
 * FCStd conversion is a platform capability. The sibling `../3d_editor`
 * project's interaction ops — the transform family, `group`/`assembly` and
 * `copy` — serve that editor's canvas, drag and timeline model, so they are
 * deprecated on the faijs platform surface (their source JSDoc carries
 * `@deprecated`).
 *
 * The lowering still borrows a **declared** subset of them while a platform API
 * for a geometry compound and a placement is designed. This guard pins that
 * boundary from both sides: the borrow may not grow, and the deprecation
 * markers may not be dropped. Either change fails here instead of slipping
 * through review.
 */

/** Ops owned by `../3d_editor`'s interaction model, and the file that declares them. */
const EDITOR_OWNED: Record<string, string> = {
  translate: 'api/transform.ts',
  rotate_euler: 'api/transform.ts',
  scale: 'api/transform.ts',
  scale3d: 'api/transform.ts',
  group: 'api/compound.ts',
  assembly: 'api/compound.ts',
  copy: 'api/copy.ts',
};

/**
 * The borrow the FCStd lowering is allowed to keep, with the number of emitted
 * sites per op. Rewiring the lowering onto a platform API lowers these numbers;
 * anything that raises them, or introduces a new name, is a mistake.
 *
 * GOTCHA: `cad.group` counts THREE sites, not one — besides the
 * `Part::Compound` branch in `feature-translate.ts`, `codegen.ts` uses it twice
 * as the product-aggregation outlet (multi-Body documents and single-file
 * roots). Grepping `feature-translate.ts` alone finds only a third of it.
 */
const DECLARED_BORROW: Record<string, number> = {
  group: 3,
  rotate_euler: 2,
  translate: 2,
};

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, '..');

function read(relative: string): string {
  return readFileSync(join(srcRoot, relative), 'utf-8');
}

describe('editor-owned op boundary', () => {
  it('every editor-owned op still carries @deprecated in its source JSDoc', () => {
    for (const [op, file] of Object.entries(EDITOR_OWNED)) {
      const text = read(file);
      const nameAt = text.indexOf(`@name ${op}\n`);
      expect(nameAt, `${file} declares @name ${op}`).toBeGreaterThan(-1);
      const jsdocEnd = text.indexOf('*/', nameAt);
      const jsdoc = text.slice(nameAt, jsdocEnd);
      expect(jsdoc, `${op} carries @deprecated`).toContain('@deprecated');
    }
  });

  it('the fcstd lowering borrows exactly the declared editor-owned ops', () => {
    const found: Record<string, number> = {};
    for (const entry of readdirSync(here)) {
      if (!entry.endsWith('.ts') || entry.includes('.test.')) continue;
      const text = readFileSync(join(here, entry), 'utf-8');
      // Two emission shapes: a call-plan `op: 'cad.x'` field, and a literal
      // `cad.x(` inside a generated template string (codegen's aggregation).
      const names = [
        ...[...text.matchAll(/op: 'cad\.(\w+)'/g)].map((m) => m[1]!),
        ...[...text.matchAll(/cad\.(\w+)\(/g)].map((m) => m[1]!),
      ];
      for (const name of names) {
        if (!(name in EDITOR_OWNED)) continue;
        found[name] = (found[name] ?? 0) + 1;
      }
    }
    expect(found).toEqual(DECLARED_BORROW);
  });
});

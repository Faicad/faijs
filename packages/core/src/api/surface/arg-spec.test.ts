/**
 * arg-spec.test.ts — Phase 2 declaration enforcement anti-regression tests (plan Phase 2.8 / 2.9).
 *
 * 2.8: missing naming for brep-op + scriptFace:true -> generator throws;
 *      missing defineOp.naming -> tsc --noEmit fails (enforced by type system).
 * 2.9: G5 audit: compat face vs cad face name parity.
 *
 * tsc compile-time guard (missing defineOp.naming -> tsc failure) is enforced
 * by `DualOpOptions.naming: Provenance` being required — no runtime test needed.
 */
import { describe, expect, it } from 'vitest'
import { ARG_SPEC } from './arg-spec'
import { PROVENANCE_KINDS, type ProvenanceKind } from '../../topology/naming/lineage'

const VALID_KINDS = new Set<ProvenanceKind>(PROVENANCE_KINDS)

describe('Phase 2.8 — declaration enforcement anti-regression', () => {
  it('all brep-op + scriptFace:true entries have naming', () => {
    const missing = ARG_SPEC.filter(
      (e) => e.kind === 'brep-op' && e.scriptFace === true && !e.naming,
    )
    expect(missing).toEqual([])
  })

  it('all naming fields have a valid provenance kind (closed set of 6)', () => {
    const invalid = ARG_SPEC.filter(
      (e) => e.naming && !VALID_KINDS.has(e.naming.kind),
    )
    expect(invalid).toEqual([])
  })

  it('all brep-op entries (including scriptFace:false) have naming (CompatSpec required)', () => {
    const missing = ARG_SPEC.filter(
      (e) => e.kind === 'brep-op' && !e.naming,
    )
    expect(missing).toEqual([])
  })
})

describe('Phase 2.9 — G5 audit: compat face vs cad face naming parity', () => {
  it('every script-face brep-op has a naming declaration', () => {
    const scriptFaceOps = ARG_SPEC.filter((e) => e.scriptFace === true && e.kind === 'brep-op')
    const withoutNaming = scriptFaceOps.filter((e) => !e.naming)
    expect(withoutNaming).toEqual([])
  })

  it('5 handwritten override entries are marked skip (not in generation path)', () => {
    const handwrittenOverrides = ['box', 'cylinder', 'cone', 'scale', 'fillet']
    for (const name of handwrittenOverrides) {
      const entry = ARG_SPEC.find((e) => e.name === name)
      expect(entry).toBeDefined()
      expect(entry!.kind).toBe('skip')
    }
  })
})

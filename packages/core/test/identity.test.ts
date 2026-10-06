import { describe, it, expect } from 'vitest'
import {
  asFileId,
  asInnerId,
  asGroupName,
  asRefId,
  asReferenceId,
  asSelectorKey,
  asShapeId,
  asFaceId,
  asEdgeId,
  asNodeId,
  asScopedId,
  toScopedId,
  splitScopedId,
  isScopedId,
  toInnerId,
} from '../src/identity'
import { assertContractVersion, CONTRACT_VERSION } from '../src/runtime-state'

describe('identity: as* trust points (string → brand, identity passthrough)', () => {
  it('asFileId returns the same string, preserving the raw value', () => {
    const raw = 'prim_1'
    expect(asFileId(raw)).toBe(raw)
    const uuid = '550e8400-e29b-41d4-a716-446655440000'
    expect(asFileId(uuid)).toBe(uuid)
  })

  it('asInnerId returns the same string', () => {
    expect(asInnerId('o1')).toBe('o1')
    expect(asInnerId('part-0')).toBe('part-0')
  })

  it('asGroupName returns the same string', () => {
    expect(asGroupName('grp_0')).toBe('grp_0')
  })

  it('asScopedId returns the same string', () => {
    const scoped = 'fileId:part-0'
    expect(asScopedId(scoped)).toBe(scoped)
  })

  it('asRefId returns the same string', () => {
    const ref = 'fileId:part-0'
    expect(asRefId(ref)).toBe(ref)
  })

  it('asReferenceId returns the same string', () => {
    const key = 'topology|face|o1.f1'
    expect(asReferenceId(key)).toBe(key)
  })

  it('asSelectorKey returns the same string', () => {
    expect(asSelectorKey('o1.f1')).toBe('o1.f1')
    expect(asSelectorKey('f1')).toBe('f1')
  })

  it('asShapeId returns the same string', () => {
    expect(asShapeId('o1.f0')).toBe('o1.f0')
  })

  it('asFaceId returns the same string', () => {
    expect(asFaceId('o1.f1')).toBe('o1.f1')
  })

  it('asEdgeId returns the same string', () => {
    expect(asEdgeId('o1.e1')).toBe('o1.e1')
  })

  it('asNodeId returns the same string', () => {
    expect(asNodeId('fileId:part-0')).toBe('fileId:part-0')
    expect(asNodeId('rootFileId')).toBe('rootFileId')
  })

  it('as* preserves empty/general strings (trust point, no validation)', () => {
    expect(asFileId('')).toBe('')
    expect(asScopedId('#any#')).toBe('#any#')
  })
})

describe('toScopedId(fileId, innerId) — scopedId construction', () => {
  it('builds `${fileId}:${innerId}` for valid non-empty inputs', () => {
    const fileId = asFileId('file-1')
    const innerId = asInnerId('part-0')
    const scoped = toScopedId(fileId, innerId)
    expect(scoped).toBe('file-1:part-0')
  })

  it('round-trips through splitScopedId', () => {
    const fileId = asFileId('f')
    const innerId = asInnerId('o1')
    const scoped = toScopedId(fileId, innerId)
    const back = splitScopedId(scoped)
    expect(back.fileId).toBe('f')
    expect(back.innerId).toBe('o1')
  })

  it('throws on empty fileId (parameter: fileId boundary)', () => {
    expect(() => toScopedId(asFileId(''), asInnerId('o1'))).toThrow(
      '[identity] toScopedId: fileId is empty',
    )
  })

  it('throws on empty innerId (parameter: innerId boundary)', () => {
    expect(() => toScopedId(asFileId('f'), asInnerId(''))).toThrow(
      '[identity] toScopedId: innerId is empty',
    )
  })

  it('throws when fileId contains a colon (double-prefix guard)', () => {
    expect(() => toScopedId(asFileId('a:b'), asInnerId('o1'))).toThrow(
      '[identity] toScopedId: fileId "a:b" contains colon — did you pass a scopedId?',
    )
  })

  it('throws when innerId contains a colon (double-prefix guard)', () => {
    expect(() => toScopedId(asFileId('f'), asInnerId('o1:o2'))).toThrow(
      '[identity] toScopedId: innerId "o1:o2" contains colon — did you pass a scopedId?',
    )
  })
})

describe('splitScopedId(scopedId) — scopedId splitting', () => {
  it('splits a valid scopedId into fileId and innerId', () => {
    const res = splitScopedId(asScopedId('fileId:part-0'))
    expect(res).toEqual({ fileId: 'fileId', innerId: 'part-0' })
  })

  it('splits arbitrary single-colon strings (format-driven, not semantic)', () => {
    const res = splitScopedId(asScopedId('scene-root:o1.f1'))
    expect(res.fileId).toBe('scene-root')
    expect(res.innerId).toBe('o1.f1')
  })

  it('round-trips asFileId/asInnerId → toScopedId → splitScopedId', () => {
    const fid = 'scene-1'
    const iid = 'o2'
    const scoped = toScopedId(asFileId(fid), asInnerId(iid))
    const { fileId, innerId } = splitScopedId(scoped)
    expect(fileId).toBe(fid)
    expect(innerId).toBe(iid)
  })

  it('throws on empty input', () => {
    expect(() => splitScopedId(asScopedId(''))).toThrow(
      '[identity] splitScopedId: input is empty',
    )
  })

  it('throws when there is no colon', () => {
    expect(() => splitScopedId(asScopedId('part-0'))).toThrow(
      '[identity] splitScopedId: "part-0" — no colon found, not a scopedId',
    )
  })

  it('throws when the leading fileId segment is empty', () => {
    expect(() => splitScopedId(asScopedId(':part-0'))).toThrow(
      '[identity] splitScopedId: ":part-0" — fileId is empty',
    )
  })

  it('throws when the trailing innerId segment is empty', () => {
    expect(() => splitScopedId(asScopedId('fileId:'))).toThrow(
      '[identity] splitScopedId: "fileId:" — innerId is empty',
    )
  })

  it('throws when there are multiple colons', () => {
    expect(() => splitScopedId(asScopedId('a:b:c'))).toThrow(
      '[identity] splitScopedId: "a:b:c" — multiple colons, not a valid scopedId',
    )
  })
})

describe('isScopedId(s) — format check + type guard', () => {
  it('returns true when the string contains a colon', () => {
    expect(isScopedId('fileId:part-0')).toBe(true)
  })

  it('returns false when the string has no colon (filesystem root nodeKey `fileId`)', () => {
    expect(isScopedId('fileId')).toBe(false)
  })

  it('narrows the type: true branch is usable as a ScopedId', () => {
    const s: string = 'a:b'
    if (isScopedId(s)) {
      const { fileId, innerId } = splitScopedId(s)
      expect(fileId).toBe('a')
      expect(innerId).toBe('b')
    } else {
      throw new Error('expected narrowing to treat string as ScopedId')
    }
  })

  it('narrows the type: false branch excludes the ScopedId path', () => {
    const s: string = 'no-colon'
    if (isScopedId(s)) {
      throw new Error('escaped — should not be a scopedId')
    } else {
      expect(s).toBe('no-colon')
    }
  })
})

describe('toInnerId(raw) — prefix stripping', () => {
  it('strips the `fileId:` prefix from a scopedId', () => {
    expect(toInnerId('fileId:part-0')).toBe('part-0')
  })

  it('returns a bare innerId (no colon) unchanged', () => {
    expect(toInnerId('part-0')).toBe('part-0')
  })

  it('returns the unchanged value for an empty-colon-edge general string with no colon', () => {
    expect(toInnerId('#selector#')).toBe('#selector#')
  })

  it('throws on empty input', () => {
    expect(() => toInnerId('')).toThrow('[identity] toInnerId: input is empty')
  })

  it('throws when the innerId segment after the first colon is empty', () => {
    expect(() => toInnerId('fileId:')).toThrow(
      '[identity] toInnerId: "fileId:" — innerId after colon is empty',
    )
  })

  it('throws when there are multiple colons (cannot produce a valid innerId)', () => {
    expect(() => toInnerId('a:b:c')).toThrow(
      '[identity] toInnerId: "a:b:c" — multiple colons, cannot produce valid innerId',
    )
  })
})

describe('assertContractVersion(lib) — contract version validation', () => {
  it('passes when lib is a plain object without a contractVersion field', () => {
    expect(() => assertContractVersion({})).not.toThrow()
  })

  it('passes when contractVersion is undefined (explicitly absent)', () => {
    expect(() => assertContractVersion({ contractVersion: undefined })).not.toThrow()
  })

  it('passes when contractVersion === CONTRACT_VERSION', () => {
    expect(() => assertContractVersion({ contractVersion: CONTRACT_VERSION })).not.toThrow()
  })

  it('passes when contractVersion matches via equal-but-differently-typed number, no coercion check', () => {
    // Abide by the exact runtime predicate (===), not loose equality.
    expect(() => assertContractVersion({ contractVersion: 3 })).not.toThrow()
  })

  it('throws on a mismatched contractVersion (older contract)', () => {
    expect(() => assertContractVersion({ contractVersion: 2 })).toThrow(
      '[faijs] library contract version mismatch: got 2, expected 3',
    )
  })

  it('throws on a mismatched contractVersion (newer contract)', () => {
    expect(() => assertContractVersion({ contractVersion: 4 })).toThrow(
      '[faijs] library contract version mismatch: got 4, expected 3',
    )
  })

  it('throws on a non-numeric contractVersion value, stringified in the message', () => {
    expect(() => assertContractVersion({ contractVersion: 'v2' })).toThrow(
      '[faijs] library contract version mismatch: got v2, expected 3',
    )
  })
})
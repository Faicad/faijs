/**
 * Grammar parity tests — validate the hand-rolled selector grammar against the
 * upstream cadquery `testGrammar` test (C:\git\CADQ\cadquery\tests\test_selectors.py:1115)
 * and the plan's §5.2 grammar acceptance rules.
 */
import { describe, expect, it } from 'vitest'
import { parseSelector } from './grammar'
import type { AtomDesc, SelectorExpr } from './types'

/** The 23 expressions from upstream testGrammar. */
const UPSTREAM_EXPRESSIONS = [
  '+X ',
  '-Y',
  '|(1,0,0)',
  '|(-1, -0.1 , 2. )',
  '#(1.,1.4114,-0.532)',
  '%Plane',
  '>XZ',
  '<Z[-2]',
  '<<Z[2]',
  '>>(1,1,0)',
  '>(1,4,55.)[20]',
  '|XY',
  '<YZ[0]',
  'front',
  'back',
  'left',
  'right',
  'top',
  'bottom',
  'not |(1,1,0) and >(0,0,1) or XY except >(1,1,1)[-1]',
  '(not |(1,1,0) and >(0,0,1)) exc XY and (Z or X)',
  'not ( <X or >X or <Y or >Y )',
] as const

/** Expressions that must throw SyntaxError (plan §4.2 negative cases & §5.2). */
const INVALID_EXPRESSIONS = [
  '>[0]', // operator with no direction
  '|', // operator with no direction
  '(X', // unterminated vector
  '>Z[]', // empty index
  'not', // dangling operator
  '%NOTATYPE', // not in the LUT union
  '',
  'and', // bare connective
  'Z and', // dangling right operand
]

function atomOf(e: SelectorExpr): AtomDesc {
  if (e.op !== 'atom') throw new Error('expected atom node')
  return e.desc
}

describe('grammar: upstream testGrammar expressions all parse', () => {
  it('parses every upstream expression without throwing', () => {
    for (const e of UPSTREAM_EXPRESSIONS) {
      expect(() => parseSelector(e)).not.toThrow()
    }
  })
})

describe('grammar: invalid expressions throw SyntaxError', () => {
  it.each(INVALID_EXPRESSIONS)('rejects %s', (e) => {
    expect(() => parseSelector(e)).toThrow(SyntaxError)
  })
})

describe('grammar: atom distinctness (plan §5.2)', () => {
  it('distinguishes >Z / >Z[-2] / >>Z / >>Z[2]', () => {
    expect(atomOf(parseSelector('>Z'))).toEqual({ kind: 'minmax', vec: { x: 0, y: 0, z: 1 }, max: true })
    expect(atomOf(parseSelector('>Z[-2]'))).toEqual({ kind: 'minmaxNth', vec: { x: 0, y: 0, z: 1 }, max: true, n: -2 })
    expect(atomOf(parseSelector('>>Z'))).toEqual({ kind: 'centerNth', vec: { x: 0, y: 0, z: 1 }, max: true, n: null })
    expect(atomOf(parseSelector('>>Z[2]'))).toEqual({ kind: 'centerNth', vec: { x: 0, y: 0, z: 1 }, max: true, n: 2 })
  })

  it('maps bare X to DirectionSelector (== +X)', () => {
    expect(atomOf(parseSelector('X'))).toEqual({ kind: 'dir', vec: { x: 1, y: 0, z: 0 } })
    expect(atomOf(parseSelector('+X'))).toEqual({ kind: 'signed', vec: { x: 1, y: 0, z: 0 }, sign: 1 })
  })

  it('keeps vectors non-normalised and parses floats with or without decimals', () => {
    expect(atomOf(parseSelector('>(1,4,55.)'))).toEqual({ kind: 'minmax', vec: { x: 1, y: 4, z: 55 }, max: true })
    expect(atomOf(parseSelector('|(-1, -0.1 , 2. )'))).toEqual({
      kind: 'parallel',
      vec: { x: -1, y: -0.1, z: 2 },
    })
  })

  it('parses %type case-insensitively and upcases', () => {
    expect(atomOf(parseSelector('%plane'))).toEqual({ kind: 'type', name: 'PLANE' })
    expect(atomOf(parseSelector('%CIRCLE'))).toEqual({ kind: 'type', name: 'CIRCLE' })
  })
})
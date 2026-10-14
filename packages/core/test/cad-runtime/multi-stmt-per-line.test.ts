/**
 * Constraint 5: one statement per line — no silent drop.
 *
 * Before the fix, `runCode` deduped by physical line number (`executedLines:
 * Set<number>`). When acorn split `let a = 1; let b = 2` into two statements
 * on the same line, the second was silently skipped (`executedLines.has(lineNo)`
 * → continue). Worse, lineNo was also the key for blockOutputs / keepByLine /
 * StatementSummary.id → shape visibility collisions.
 *
 * Fix (option A): parseAndTransform rejects multiple statements on the same
 * physical line with E_SYNTAX. One statement per line is the contract.
 */
import { describe, it, expect } from 'vitest'
import { DirectExecutor } from '../../src/cad-runtime/direct-executor'
import { ParseError } from '../../src/lang/parse-error'
import { createApiNamespaceWithEditorOps } from '../support/editor-ops'

function makeExecutor(): DirectExecutor {
  return new DirectExecutor({ namespaces: { cad: createApiNamespaceWithEditorOps() } })
}

describe('constraint 5: one statement per line (no silent drop)', () => {
  it('two statements on one line → ParseError', async () => {
    const ex = makeExecutor()
    await expect(ex.execute('let a = 1; let b = 2')).rejects.toBeInstanceOf(ParseError)
  })

  it('three statements on one line → ParseError', async () => {
    const ex = makeExecutor()
    await expect(ex.execute('let a = 1; let b = 2; let c = 3')).rejects.toBeInstanceOf(ParseError)
  })

  it('error carries correct line number and message', async () => {
    const ex = makeExecutor()
    try {
      await ex.execute('let a = 1; let b = 2')
      expect.unreachable('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(ParseError)
      const pe = e as ParseError
      expect(pe.line).toBe(1)
      expect(pe.code).toBe('E_SYNTAX')
      expect(pe.message).toContain('one statement per line')
    }
  })

  it('multi-stmt on line 2 → ParseError with line=2', async () => {
    const ex = makeExecutor()
    try {
      await ex.execute('let a = 1\nlet b = 2; let c = 3')
      expect.unreachable('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(ParseError)
      expect((e as ParseError).line).toBe(2)
    }
  })

  it('one statement per line → no error, all vars present', async () => {
    const ex = makeExecutor()
    const out = await ex.execute('let a = 1\nlet b = 2\nlet c = 3')
    expect(out.failedAt).toBeUndefined()
    expect(ex.listCtxKeys().sort()).toEqual(['a', 'b', 'c'])
  })

  it('for-loop header semicolons → no error (not statement separators)', async () => {
    const ex = makeExecutor()
    const out = await ex.execute([
      'let total = 0',
      'for (let i = 0; i < 5; i++) {',
      '  total = total + i',
      '}',
    ].join('\n'))
    expect(out.failedAt).toBeUndefined()
  })

  it('op call + plain JS on one line → ParseError', async () => {
    const ex = makeExecutor()
    await expect(ex.execute('let a = cad.box(1, 1, 1); let n = 42')).rejects.toBeInstanceOf(ParseError)
  })

  it('two op calls on one line → ParseError', async () => {
    const ex = makeExecutor()
    await expect(
      ex.execute('let a = cad.box(1, 1, 1); let b = cad.sphere({ radius: 2 })'),
    ).rejects.toBeInstanceOf(ParseError)
  })

  it('trailing semicolon (one statement) → no error', async () => {
    const ex = makeExecutor()
    const out = await ex.execute('let a = 1;')
    expect(out.failedAt).toBeUndefined()
    expect(ex.listCtxKeys()).toEqual(['a'])
  })
})
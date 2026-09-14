/**
 * signals — internal control-flow signals for the AST interpreter.
 *
 * break/continue/return are modelled as exception-class signals so the
 * recursive interpreter can unwind to the owning statement boundary. They are
 * engine-internal: user try/catch must re-throw them untouched (they are not
 * user-thrown values), and an escaped signal at a unit boundary is an
 * interpreter bug — the backend converts it into a plain internal error.
 */
/** Unwind signal for a `break` statement (optionally labeled). */
export class BreakSignal extends Error {
  constructor(readonly label?: string) {
    super(`__fai_break${label ? `:${label}` : ''}`)
    this.name = 'BreakSignal'
  }
}

/** Unwind signal for a `continue` statement (optionally labeled). */
export class ContinueSignal extends Error {
  constructor(readonly label?: string) {
    super(`__fai_continue${label ? `:${label}` : ''}`)
    this.name = 'ContinueSignal'
  }
}

/** Unwind signal for a `return` statement carrying the returned value. */
export class ReturnSignal extends Error {
  constructor(readonly value: unknown) {
    super('__fai_return')
    this.name = 'ReturnSignal'
  }
}

/**
 * True if the error is one of the interpreter's internal control signals.
 * @param e - the thrown value to test.
 * @returns true when `e` is a Break/Continue/Return signal.
 */
export function isControlSignal(e: unknown): boolean {
  return e instanceof BreakSignal || e instanceof ContinueSignal || e instanceof ReturnSignal
}

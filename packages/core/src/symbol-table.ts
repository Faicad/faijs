/**
 * symbol-table — public subpath for the standard-library symbol table.
 *
 * The table itself lives in `lang/symbol-table.ts` (generated file plus the P5
 * host-extension registry). This root-level module exists so library authors can
 * reach it environment-agnostically — `@faicad/faijs/symbol-table` has no
 * three / occt / node dependency, so a browser or weapp host may import it
 * without touching the node entry.
 *
 * Consumers: hosts that install a library namespace (`registerSymbolTableEntries`)
 * and tooling that resolves `cad.<name>` statically.
 */
export {
  SYMBOL_TABLE, getFunctionSymbol,
  registerSymbolTableEntries, unregisterSymbolTableEntries, symbolTableNames,
} from './lang/symbol-table'
export type { SymbolTable, FunctionSymbol } from './lang/symbol-table'

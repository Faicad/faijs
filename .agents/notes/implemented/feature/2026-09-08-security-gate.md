# Agent Note: .fai.js Static Security Gate

Status: implemented

## Problem

`.fai.js` scripts execute arbitrary JavaScript in the host runtime (Node.js or browser worker). Without a static security gate, malicious or AI-generated code could access `eval`, `globalThis`, `process`, `fetch`, `setTimeout`, prototype pollution chains, and other escape hatches. The previous parser only validated syntax and control-flow at the top level—it did not recurse into function bodies, blocks, or nested scopes, leaving a blind spot for dangerous identifiers hidden inside control-flow blocks.

## Decision

Implement a **static security scanner** (`security-scanner.ts`) that performs a full AST recursive traversal of `.fai.js` source code before parsing and execution. The scanner runs at three integration points (A1/A2/A3):

- **A1** (`extractMetadata`): UI channel — scan before `acornParse`, line numbers match the user's editor.
- **A2** (`DirectExecutor.parseAndTransform`): execution channel — scan before `parseBody`.
- **A3** (`ModuleRegistry`): sub-module channel — scan sub-module source (fixed `strict` policy).

The scanner enforces six rule categories:

| Rule | ID | Description |
|------|----|-------------|
| S1 | `SEC_IDENT` | Dangerous identifier blacklist (eval, globalThis, process, fetch, etc.) |
| S2 | `SEC_SYNTAX` | Dangerous syntax nodes (dynamic import(), with, debugger, tagged templates, import.meta) |
| S3 | `SEC_MEMBER` | Dangerous member names (__proto__, constructor, prototype, defineProperty, etc.) |
| S4 | `SEC_FREE_IDENT` | Free-identifier whitelist — undeclared identifiers not in safe globals or known namespaces are rejected |
| S5 | `SEC_LIMIT` | Structural limits (source length ≤ 1 MiB, ≤ 5000 top statements, ≤ 200K AST nodes, depth ≤ 100) |
| S7 | `SEC_NS_ASSIGN` | Namespace protection — assignment to namespace names (cad, gearlib, etc.) is rejected |

Three policy tiers:

- `strict` (default): all rules active, including strict-only identifiers (setTimeout, crypto, Reflect, Proxy).
- `balanced`: S1 strict-only identifiers relaxed; S2 strict-only syntax relaxed; S4/S5/S7 still active.
- `off`: no scanning (controlled debugging only).

### Channel consistency

A1 and A2 use the same scanner with the same policy, ensuring UI and execution channels reject the same code. Violations produce `ParseError(code='E_SECURITY', ruleId=<rule>)`, which `CadRuntime.check()` surfaces as `CheckError(stage='security', ruleId=<rule>)`.

### Append and params integration

- `DirectExecutor.runCode` passes `opts.params` and `opts.imports` keys as `knownNames` to avoid `SEC_FREE_IDENT` false positives on pre-injected variables.
- `appendDirectText` runs `missingPrefixVar` (with `skipSecurity=true`) before A1, so `AppendPrefixError` takes priority over `SEC_FREE_IDENT` for missing-references.
- S7 uses a separate `nsNames` parameter (only namespace names, not ctx variables) to avoid false positives when re-assigning `let` variables that share names with namespaces.
- `scanSource` catches acorn `SyntaxError` and returns `ok=true` (no security violations), letting the caller's main parse path handle syntax errors as `E_SYNTAX`.

## Alternatives considered

1. **RegExp-based scanning**: Rejected — cannot handle nested scopes, member expressions, or computed property access reliably. AST traversal is required for correctness.

2. **Runtime sandbox (vm module / Worker isolation)**: Rejected as the primary defense — too heavy for the common case, does not prevent the code from attempting escapes (only catches them after the fact). Static scanning cuts off capability sources before execution begins. Runtime isolation remains a complementary layer (R7, future work).

3. **Acorn plugin / custom parser**: Rejected — would couple security rules to the parser implementation. The current design decouples rules (data-driven S1/S2/S3 tables) from the traversal logic (R6), so adding new ops or syntax forms does not require scanner changes.

4. **ESLint integration**: Rejected — ESLint is a development tool, not a runtime dependency. The scanner must be zero-dependency (only `acorn`, already a dependency) and run in both Node and browser environments.

## Consequences

- All `.fai.js` fixture files (119 files) pass the scanner with `strict` policy — no false positives.
- 152 new tests (33 unit + 119 fixture regression) verify scanner behavior.
- `CadRuntimeOptions.security` field allows hosts to set the policy tier (default `strict`).
- `CheckError` now includes `stage='security'` and `ruleId` for precise AI feedback.
- `ParseError` gains `ruleId` field (only set when `code='E_SECURITY'`).
- `LibLoader.loadSource` optional hook added for future library source-code scanning (P4, not yet wired).
- The scanner is an honest static defense — it does not claim sandbox equivalence (D9). String concatenation property access (`g['ev'+'al']`), string-internal code, and already-obtained reference reuse are not statically detectable. S4 (free-identifier whitelist) cuts off the capability source for residual attacks.

# Agent Note: Script-face export commands are open on the node host only

Status: implemented

English | [中文](2026-10-08-export-commands-node-host-only.zh.md)

## Problem

A `.fai.js` script is text an AI can generate, so it is untrusted input. The static scanner in `packages/core/src/lang/security-scanner.ts` is the first layer of defence against it, and it states its own limit: a static scan is not a sandbox, and its policy tier — `strict`, `balanced`, `off` — is a run-time option that turns the scan off entirely.

Export sits at the far end of the damage scale among the capabilities a script can reach. It hands geometry out of the kernel to script text, and on the host it ends in a user-visible write: a download, a save, a clipboard transfer. Both export commands were reachable on every host — the Node CLI, the browser worker and the mini-program worker. `cad.exportStl` was even documented as an engine-neutral op: it reads only the triangle payload a Shape carries, so it never consulted any environment fact at all. Script text therefore decided what was written, where, and how many times, in exactly the environment where that decision is most sensitive, because an in-page download is the pattern CSP, user-gesture requirements and drive-by-download defences exist to constrain.

## Decision

**The script-face export commands are open on the `node` host only.** On any other host they fail before touching the payload, with `E_HOST_UNSUPPORTED`.

- The host declares its environment once, at port assembly: `HostPorts.hostEnv`, typed `'node' | 'browser' | 'weapp'` in `packages/core/src/cad-runtime/ports.ts`. `createNodePorts()` declares `'node'` and `createBrowserPorts()` declares `'browser'`. The field stays optional and the read side is fail-closed: an undeclared host is not `node`, so it is refused instead of being allowed by default.
- `CadRuntime.claimBackends()` publishes the value as `config.hostEnv`, beside `mode` and `brepEngineId`. `Backends.config.hostEnv` is declared in the zero-dependency layer `packages/core/src/runtime-state.ts`, and the runtime's getter pins the two declarations together at compile time.
- The assertion `assertHostFor(opName, hosts)` sits in `packages/core/src/api/internal/l3-bridge.ts` beside `assertEngineFor`, and throws `HostUnsupportedError`, defined in `runtime-state.ts` with `code = 'E_HOST_UNSUPPORTED'` so a host can read the kind from `ExecutionResult.failedAt.code`.
- Both export ops call it as the first statement of the function body: `exportStl` before it reads the mesh payload, `exportBrep` before its existing engine assertion, which fixes the order as host gate first, engine gate second. The gate lives in the function body rather than in dispatch metadata because these two ops are plain functions that never go through `dispatchPath`; that placement also covers a TypeScript consumer importing the same function from a subpath, so no import bypasses it.
- The gate reads `config.hostEnv` and nothing else. It is decoupled from the security policy tier: relaxing the scan to `balanced` or `off` does not reopen the command.
- This is not a ban on exporting from a browser. It is a rule about who starts the export. The host's own byte channels — `exportModel`, `exportModelSync`, `exportStepFromSolids` and `buildStlBufferFromMesh` — are untouched and stay callable on every host, and that is the path an application takes when a user presses an export button.

## Alternatives considered

**Rely on the static security scan.** Rejected: the scanner documents itself as a first layer whose policy tier can be switched off, and it inspects text instead of granting capabilities. Hiding a capability behind a scan that can be turned off guarantees nothing.

**Probe the environment inside the gate at run time.** Rejected: `typeof process` style probes belong to the kernel loaders, where they choose a wasm loading channel. A capability gate that infers its host from ambient globals is neither static nor auditable, while the host already knows its own identity when it assembles its ports.

**Make `hostEnv` a required field of `HostPorts`.** Rejected: `HostPorts` is a public type assembled in about a hundred places, most of which supply only `events`. A required field forces mechanical edits unrelated to this capability. Optional plus fail-closed refusal has the same effect at the call sites that matter.

**Leave the commands open and emit a warning.** Rejected: a warning is not a gate. The decision is to deny the capability, and a warning leaves the write under script control.

## Consequences

- Node hosts keep exporting; a script run through the CLI or through `executeScript` is unchanged. `createProcessPorts` in the sibling `3d_editor` application spreads the Node ports, so its Electron main process inherits `'node'`.
- Browser and mini-program hosts refuse the two commands. An application that wants an export there calls the host byte channels from its own entry point — the same functions the gate does not cover.
- Any host that assembles `HostPorts` by hand and omits `hostEnv` loses the export commands. The mini-program port assembly in `3d_editor` is the one such site and has to declare `'weapp'`.
- The gate is pinned in `packages/core/test/api/export-stl-brep.test.ts`: refusal on the browser, mini-program and undeclared hosts; the payload-getter trap that proves the gate runs before the implementation body; the host-before-engine ordering; and the security-tier decoupling. `packages/core/test/node-host/ports.test.ts` and `packages/core/test/browser-host/index.test.ts` pin the two factory declarations, so a host wired through a factory cannot lose the value by omission.

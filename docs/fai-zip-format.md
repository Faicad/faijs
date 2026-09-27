# faijs `.fai.zip` Container Format Specification

English | [中文](fai-zip-format.zh.md)

> Position: This document is the **normative specification** of the `.fai.zip` container format — the packaging format for a faijs model graph. It defines the archive rules, the member model (required, conditionally required, optional), the `manifest.json` schema, entry and module resolution, the data and asset members, the obligations of a conforming reader and writer, and the versioning policy. The format is implementation-independent: any third party may implement a reader or a writer against this document alone.
>
> Related: [`docs/api-contract.md`](api-contract.md) owns the interface contract (script API, host injection, execution); [`docs/syntax-design.md`](syntax-design.md) owns `.fai.js` syntax and the incremental execution contract; [`docs/reproducibility-contract.md`](reproducibility-contract.md) owns geometry determinism; [`docs/ops-api-inventory.md`](ops-api-inventory.md) is the op manual. This document does not track development plans or defects, and it does not reference `docs/plans/` documents.

## 1. Scope and conformance

A `.fai.zip` container packages one or more **models**: each model is a faijs entry script plus, optionally, the data member that records what cannot be derived from the scripts. The container also carries the file and asset payloads those scripts reference. It is the packaging format for a multi-file faijs project, and it is the only container format faijs defines.

The keywords **MUST**, **MUST NOT**, **SHOULD**, and **MAY** are normative. Conformance is defined per role, not per implementation:

| Role | Requirement |
|---|---|
| Reader | Loads a container and reconstructs its models, data, and assets (§9) |
| Writer | Produces a container (§10) |

A reader MUST NOT assume any specific producer: the containers it loads may come from any tool, including tools written by other parties. A writer MUST NOT assume any specific reader.

## 2. Container and member naming

A container is a ZIP archive whose file name ends with `.fai.zip`. Nothing else identifies it: the suffix is a naming convention, and `manifest.json` (§4) is the authoritative marker.

Member paths MUST use `/` as the separator, MUST be relative, and MUST NOT contain a leading `/`, a drive letter, a `..` segment, or a backslash. Member paths are UTF-8 and case-sensitive: `model/Plate.fai.js` and `model/plate.fai.js` are two different members.

Entries MAY use any ZIP compression method the format allows (store, deflate); a reader MUST accept both. Encrypted members are not supported: a writer MUST NOT emit them, and a reader MUST report an error rather than prompt for a password. Resource limits (archive size, member count, uncompressed size) are implementation-defined; a reader that enforces a limit MUST fail with an error naming the limit rather than partially load a container.

## 3. Member model

Members fall into classes by what a reader must do when the member is absent, and by nothing else.

| Member | Class | Reader obligation when absent |
|---|---|---|
| `manifest.json` | Required | Error. A container without a readable manifest is not a container |
| `model/**/*.fai.js` | Required | Error for the members named by `models[].entry`; the remaining `.fai.js` members are the module graph (§5) |
| `data/**` | Conditionally required | Error for the members named by `models[].data`; no other member of this namespace is required |
| `files/**` | Conditionally required | Error when a model script references the member's key (§7); otherwise not required |
| `assets/**` | Conditionally required | Error when a model script references the member's key (§7); otherwise not required |
| `preview/**` | Optional, standard namespace | No preview available. Not an error |
| `export/**` | Optional, standard namespace | No pre-exported artifact available. Not an error |
| `cache/**` | Optional, standard namespace | Recompute. Not an error; a reader MAY delete this namespace |
| `mapping.json` | Optional, FCStd conversion convention | No fidelity ledger available. Not an error |
| `freecad/**` | Optional, FCStd conversion convention | No source shadow available. Not an error |
| Any other member | Optional, producer-defined | Ignore it. Not an error |

There is no "member outside the table is a violation" rule: a producer may add members, and a reader MUST ignore every member it does not consume. What the classes forbid is the opposite direction — a required or conditionally required member whose absence breaks reconstruction is a defect of the container, never a case for the reader to guess around.

## 4. `manifest.json`

The manifest is a UTF-8 JSON object:

```jsonc
{
  "format": 3,
  "units": "mm",
  "models": [
    { "id": "plate", "entry": "model/plate.fai.js", "label": "Plate", "data": "data/plate.json" },
    { "id": "bracket", "entry": "model/bracket.fai.js" }
  ],
  "active": "plate",

  "createdAt": "2026-09-27T10:00:00.000Z",
  "appVersion": "0.18.3",
  "label": "Engraved import",

  "source": { "file": "Beds.FCStd", "programVersion": "0.21.1", "schemaVersion": 4 },
  "requiresBrep": true
}
```

| Field | Presence | Type | Meaning |
|---|---|---|---|
| `format` | Required | integer | Container format identifier; `3` in this revision (§11) |
| `units` | Required | string | Unit of every coordinate in the container; `"mm"` |
| `models` | Required | array, length ≥ 1 | The complete model list (§5) |
| `models[].id` | Required | string | Model identifier: unique in the container, no `/` and no `\` |
| `models[].entry` | Required | string | Container path of the model's entry script |
| `models[].label` | Optional | string | Display name. A reader MUST NOT use it as an identifier |
| `models[].data` | Optional | string | Container path of the model's data member (§6). Absent = the model has no data member |
| `active` | Optional | string | `models[].id` of the initially active model. Absent = `models[0]` |
| `createdAt` | Optional | string | ISO 8601 timestamp. Display only |
| `appVersion` | Optional | string | Version of the producing tool. Display only |
| `label` | Optional | string | Container display name. Display only |
| `source` | Optional | object | FCStd conversion provenance (§8.2). Display only |
| `requiresBrep` | Optional | boolean | The model graph requires the BREP chain (§8.2) |

Rules:

1. `format` MUST be the integer `3`. A reader MUST reject any other value with an error that names the observed value; it MUST NOT interpret, upgrade, or partially read such a container.
2. `units` MUST be `"mm"`. Coordinate and angle conventions themselves are owned by [`docs/api-contract.md`](api-contract.md).
3. `models[].id` values MUST be unique, and `models[].entry` values MUST be unique and MUST resolve to an existing member of `model/`.
4. `active`, when present, MUST equal some `models[].id`; otherwise the container is invalid.
5. `models[].data`, when present, MUST resolve to an existing member; a named data member that is missing is a defect, not a case for a conventional-path fallback.
6. Fields this specification does not define MUST be ignored by readers. A producer MUST NOT use an undefined field to change the meaning of a defined one.
7. The manifest is a declaration, not a cache: no field may state a value that a reader could contradict by reading the members it points at.

## 5. Models, entries, and module resolution

A **model** is one entry script plus, when declared, one data member. Models are the units a host lists, executes, and switches between; `models` is the complete list, and a member under `model/` that `models[]` does not name is not a model.

A **module** is any `.fai.js` member under `model/`. The **module key** of a member is its container path relative to `model/`: `model/plate.fai.js` has key `plate.fai.js`, and `model/parts/a.fai.js` has key `parts/a.fai.js`.

Rules:

1. Every `models[].entry` MUST be a member under `model/` whose name ends with `.fai.js`.
2. A relative import specifier inside a module resolves against the importing module's key: `./x.fai.js` and `../x.fai.js` are relative to the importer's directory, and a leading `/` names a key from the root of `model/`. Resolution normalizes `.` and `..` segments and yields a module key. Script text and import syntax are owned by [`docs/syntax-design.md`](syntax-design.md).
3. A specifier that yields no existing `.fai.js` member under `model/` MUST be reported as an error. A bare specifier — one not starting with `.`, `..`, or `/` — does not name a container member at all: it is a library reference, and libraries are outside this specification.
4. Entry selection is static: the active model is `models[].id === active`, or `models[0]` when `active` is absent. A reader MUST NOT select an entry by file name pattern, member order, or timestamps.
5. Executing a model MUST NOT require a member outside `model/**`, `files/**`, `assets/**`, and that model's own data member. Two models may share modules and assets; they MUST NOT share data members.

## 6. Data members

A data member records what a plain re-execution of the scripts does not reproduce: the user's editing decisions layered on top of reconstructed geometry, such as display names, visibility, materials, transforms, and the record of imported files.

Rules:

1. A data member is a UTF-8 JSON object. Binary payloads MUST NOT be embedded in it and MUST NOT be required alongside it: payloads live in `files/**` or `assets/**` (§7), located by key. A member of `data/**` that is not JSON is invalid.
2. This specification does not define the keys of a data member. They are owned by the tool that writes it. A reader MUST ignore keys it does not recognize, and MUST NOT treat an unrecognized key as an error.
3. A model's script text lives in its entry member and in the modules under `model/**` only. A data member MUST NOT carry a copy of it.
4. A data member is an overlay on reconstructed results, never their source: dropping every data member MUST still leave a container whose models execute and produce their geometry (a model may lose its editing overlay, but not its geometry or its identity).
5. A model without `models[].data` has no data member. A reader MUST NOT look for a data member by a conventional path.

## 7. Asset members

Payload bytes live in two namespaces: `files/**` for the bytes of files a user imported into a model, and `assets/**` for bytes a script consumes directly (a BREP carrier, a contour description, an image). Both are addressed the same way.

The **asset key** of a member is its base name with the final extension removed: `assets/bracket.brp` has key `bracket`, and `files/9f1c2a.bin` has key `9f1c2a`. This is the same rule the faijs filesystem asset resolver applies to a directory, so an unpacked container and a packed one address identical payloads.

Rules:

1. Keys MUST be unique across `files/**` and `assets/**` taken together. A reader MUST fail on a duplicate key naming both members rather than pick one.
2. A model script references an asset by key. When a script references a key that no member provides, loading MUST fail with an error naming the key. A reader MUST NOT substitute another member, fetch a remote resource, or continue with empty geometry.
3. Extensions are producer-chosen and carry no meaning beyond the key rule: resolution is by key, never by extension or by sniffing content.
4. These namespaces SHOULD stay flat: a member at any depth is keyed by its base name, so a producer that uses subdirectories must still keep base names unique.
5. The bytes are opaque to the container: a reader MUST hand them to the consumer that asked for the key, and MUST NOT rewrite, transcode, or validate them against a format of its own choosing.

## 8. Optional namespaces

### 8.1 Standard namespaces

Producers that want a container to be useful without executing it may add these members. Their paths are the contract; there is no manifest field to declare them.

| Path | Contents |
|---|---|
| `preview/thumbnail.<ext>` | Container-level preview image |
| `preview/<modelId>.<ext>` | Preview image of one model |
| `export/<modelId>.<ext>` | Exported artifact of one model (STEP, STL, 3MF, ...) |
| `cache/<modelId>/**` | Execution cache of one model |

Obligations:

1. A reader MAY use a member of these namespaces and MUST NOT require one.
2. A writer MUST NOT let a required or conditionally required member depend on one of them.
3. Deleting every member of these namespaces MUST leave a container that describes the same models with the same geometry and the same identity. This is the only boundary a namespace needs to satisfy to be optional: it may change the cost of loading, never the result.

### 8.2 FCStd conversion conventions

The FCStd → `.fai.zip` converter writes additional members that record the fidelity of a conversion. They are conventions of that producer, not requirements on any other; a container without them is conforming.

| Member | Contents |
|---|---|
| `mapping.json` | Per-object fidelity ledger: one entry per source object with its disposition (`translated`, `baked`, `preserved-only`), the reason when it was not translated, and the artifacts it produced |
| `freecad/**` | Byte-exact shadow of every member of the source document archive; the conversion drops no source bytes |
| `assets/*.brp` | Baked BREP carriers, referenced by the converted scripts through the platform BREP-asset import op |
| `manifest.source` | Provenance: source file name, producing program version, document schema version |
| `manifest.requiresBrep` | `true` when the model graph requires the BREP chain — the baked carriers have no mesh parser, so a host that cannot provide the BREP chain must fail rather than silently substitute a mesh path |

## 9. Reader obligations

1. **Self-sufficiency.** Reconstruction MUST depend only on the members a declaration actually names: `models[].entry`, `models[].data`, and the `files/**` or `assets/**` members that scripts reference by key. With every member that no declaration references removed — `preview/**`, `export/**`, `cache/**`, `mapping.json`, `freecad/**`, and any producer-defined member — reconstruction MUST still succeed. Removing a data member means removing its declaration with it: a declaration left pointing at a missing member is a defect, not an optional member that happens to be absent.
2. **Ignore the unknown.** Members not listed in §3, manifest fields not listed in §4, and data-member keys not defined by the reader MUST all be ignored without error.
3. **Fail on defects.** A missing or malformed `manifest.json`, a `format` other than `3`, a malformed `models` array, an entry that does not exist, a relative import that resolves to nothing, a referenced asset key with no member, a duplicate asset key, and a named data member that is missing MUST each be an error carrying the offending path or key.
4. **No guessing.** Entry selection is `active` or `models[0]` (§5.4). A reader MUST NOT fall back to a file-name heuristic, member order, or a timestamp.
5. **Optional members never decide anything.** Cached geometry, previews, and exported artifacts MUST NOT be loaded as model geometry, and MUST NOT be used to skip or to substitute an execution.
6. **No remote substitution.** A member reference MUST be satisfied from the archive; a reader MUST NOT fetch a remote resource to satisfy one.
7. **Report, do not repair.** A reader MUST NOT rewrite a container it loaded, and MUST NOT silently drop a member it could not consume.

## 10. Writer obligations

1. **Declare.** Emit `manifest.json` with every required field, `format` equal to `3`, and `units` equal to `"mm"`.
2. **Deliver what is referenced.** Emit every member that a manifest field, a module import, a data member, or an asset reference names. When a referenced member cannot be emitted, the writer MUST fail instead of producing a container that a reader cannot reconstruct.
3. **Be complete.** Emit every module in the entry graph, including modules that only a nested import reaches. A container MUST NOT depend on files that exist only on the authoring machine.
4. **Stay location- and machine-independent.** No member may require a filesystem path outside the archive, a member of the authoring machine, or the machine's clock for its meaning.
5. **Keep identity unique.** `models[].id`, `models[].entry`, and asset keys MUST each be unique within the container.
6. **Keep optional members optional.** Every declared member MUST leave the container's models, geometry, and identity unchanged when removed (§8.1).
7. **Fail loudly.** A silent loss — a source object, a referenced payload, or an editing decision that the writer drops without an error — is a defect of the writer.

## 11. Versioning and change policy

`format` is the container format identifier: an integer that names one revision of the member model, the manifest schema, and the resolution rules.

1. A breaking change — member semantics, required-field meaning, the key rule, or the resolution rules — MUST bump `format`.
2. An additive change MUST NOT bump `format`: new optional namespaces, new optional manifest fields, and new optional members are conforming under the current value, because readers already ignore members and fields they do not consume.
3. This specification defines no migration and no negotiation. A container whose `format` is not supported MUST be rejected with an error naming the observed value; interpreting it under different rules, upgrading it, or reading it partially is a violation of §9.3.
4. A reader MUST NOT infer a format revision from member presence, member count, tool metadata, or timestamps.

## 12. Minimal conforming container

```
example.fai.zip
├── manifest.json
└── model/
    └── plate.fai.js
```

```json
{
  "format": 3,
  "units": "mm",
  "models": [{ "id": "plate", "entry": "model/plate.fai.js" }]
}
```

This container holds one model, no data member, and no assets. A conforming reader executes `model/plate.fai.js` as the active model and reconstructs its geometry; a conforming reader also loads the same container with any optional member added, and keeps the models, geometry, and identity it had without them.

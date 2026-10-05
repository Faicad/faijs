# Agent Note: Part-level metadata method chain

Status: implemented

English | [中文](2026-10-05-part-metadata-name-description.zh.md)

## Problem

shapes could only carry geometric + visual state; a part had no first-class way to hold an informative name, description, part number, or custom key-value metadata, and there was no file-level container for document-wide descriptive fields (title, designer, copyright, license). Users asked for name/description on a shape with the same member-call API style used for color/material, and for both part-level and whole-file informative fields from 3MF/STEP to survive import/export.

## Decision

A shape's informative metadata lives in a new JSON-serializable field `Shape.meta` (`ShapeMeta = { name?, description?, partNumber?, metadata? }`), set through non-op instance methods `setName / setDescription / setPartNumber / setMetaField / setMeta / getMeta` in the same member-call form as the appearance API — method-not-op, one `setX` statement per call, no chaining in scripts, zero-dependency `api/meta.ts` (type-only `Shape` import), and the field rides both the mesh and brep chains. Whole-file/document metadata lives in a separate `FileMeta` (`title`, `description`, `designer`, `author`, `organization`, `copyright`, licenseTerms, rating, creationDate, modificationDate, application, custom `metadata`) that is not attached to any shape; it rides import results and export options. Op products inherit `input.meta` by reference when the product declares none of its own; an explicit set wins. An empty string clears the corresponding field / key.

Import maps 3MF onto the spec positions: object-level `name`/`partnumber`/`metadatagroup` → part meta (with `faijs:description` promoted back to `description`), and `<model><metadata>` well-known names plus vendor keys → `FileMeta.metadata`. Export inverts the mapping for 3MF (`<object partnumber>` + `<metadatagroup>` for part meta, model-level `<metadata>` from `FileMeta`, `faijs:` namespace prefix for vendor keys). STEP read enriches the part with description and vendor properties and FileMeta-with-header fields (title, creationDate, author, organization, application, designer, description) via a text parser. STEP export writes the `FileMeta` header fields into the P21 `FILE_NAME`/`FILE_DESCRIPTION` entities by text rewrite (`rewriteStepHeader` in `brep/export/step-meta-header.ts`, alias `rewriteFileMetaHeader`, reused by the `exportModel`/`exportModelSync` STEP branches and by `exportStepFromSolids`/`exportStepFromSolidsHighLevel` through a new optional `fileMeta` argument), bounded to those two standard header entities and to spec-defined slots only; the part-level STEP `description`/`partNumber` write stays unimplemented because the OCCT-wasm XCAF writer exposes only the name/color label channel.

## Alternatives considered

- A `note` field with a `setNote` method — rejected: the spec field is `description`, matching the 3MF/STEP field and the camelCase style shared across the faijs / TS ecosystem; using `description` avoids inventing a private name.
- Naming the file-level container `ModelMeta` — rejected in favor of `FileMeta`: `Model` reads as a single part, while `File` matches the document/file scope the structure belongs to.
- A single shape-attached structure for both part-level and file-level fields — rejected: whole-file document fields cannot belong to one shape (a shape does not have a title); keeping `FileMeta` separate gives each fact one home and keeps parts free of model-level noise.

## Consequences

- `Shape.meta` and `FileMeta` are engine-agnostic and JSON-safe, so they cleanly cross the token/worker boundary; the editor plumbs them through `protocol.ts`, `formatLoaders.ts`, `exporters/index.ts`, and a new `part-meta-store.ts` (a material-store analog) so a part's name/partNumber flow from import → parts display → export without loss.
- Inherited metadata is an intentional fallback, not a source of truth: models that need a fresh name set it explicitly.
- Part-level metadata persists through 3MF import/export round-trips; the editor's display-name and export read the same store so renames surface everywhere. STEP export preserves `FileMeta` header fields (title/description/designer/author/organization/application/creationDate) through the P21 header rewrite in both the host-side `exportModel` route and the editor worker STEP route (`exportSolids` → `exportStepFromSolidsHighLevel` with `fileMeta`, web/electron); the weapp per-solid brepkit channel does not write a header. Part-level STEP `description`/`partNumber` are not written because the OCCT-wasm XCAF writer exposes no such label channel, and a text-level entity surgery would violate the export red line, so that path stays honest and unimplemented.
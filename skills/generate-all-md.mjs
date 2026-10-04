#!/usr/bin/env node
/**
 * generate-all-md.mjs
 *
 * Template script that assembles skills/all.md from the individual skill files.
 *
 * Usage:  node skills/generate-all-md.mjs
 *
 * Output: skills/all.md  (a single consolidated API reference for third-party AI)
 *
 * Structure of all.md:
 *   1. SKILL.md content (overview, key concepts, unit system, quick reference)
 *      — with internal links rewritten to anchor links (#section)
 *   2. core.md       (full cad.* op reference)
 *   3. faijs-extra.md (editor extension ops)
 *   4. sketch.md     (constraint-based sketch)
 *   5. sheetmetal.md (sheet-metal domain)
 *   6. faijs-gears.md (gear generation)
 *   7. faijs-fasteners.md (fastener generation)
 *
 * draw.md and faijs-cadquery.md are EXCLUDED (per user request).
 *
 * De-duplication: each sub-file's H1 title and blockquote description are
 * stripped (the SKILL.md overview already covers what they say).
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** Files to embed, in order. */
const EMBED_FILES = [
  'core.md',
  'faijs-extra.md',
  'sketch.md',
  'sheetmetal.md',
  'faijs-gears.md',
  'faijs-fasteners.md',
]

/**
 * Read a skill file, strip its H1 title and leading blockquote description
 * (to avoid duplication with the SKILL.md overview), and return the body.
 */
function embedFile(filename) {
  const raw = readFileSync(join(__dirname, filename), 'utf-8')
  const lines = raw.split('\n')

  // Skip leading H1 line (# ...)
  let i = 0
  while (i < lines.length && lines[i].trim() === '') i++ // skip blank
  if (i < lines.length && lines[i].startsWith('# ')) {
    i++ // skip H1
  }

  // Skip leading blank lines after H1
  while (i < lines.length && lines[i].trim() === '') i++

  // Skip leading blockquote (> ...) description (may be multi-line)
  while (i < lines.length && lines[i].startsWith('>')) {
    i++
  }

  // Skip blank lines after blockquote
  while (i < lines.length && lines[i].trim() === '') i++

  return lines.slice(i).join('\n').trimEnd()
}

/**
 * Process SKILL.md: rewrite internal markdown links like [core.md](core.md)
 * to anchor-style links, since all content is now in a single file.
 */
function processSkillMd(content) {
  // Replace links to embedded files with anchor links
  // e.g., [core.md](core.md) → #core-faicadfaijs-core-platform-cad-namespace
  // Since anchors are auto-generated from headings, we just link to the
  // H1 heading text of each embedded file.
  const anchorMap = {
    'core.md': '#faicadfaijs-core-platform-cad-namespace',
    'faijs-extra.md': '#faicadfaijs-extra-editor-extension-ops',
    'sketch.md': '#faicadfaijs-sketch-constraint-based-sketch-op',
    'sheetmetal.md': '#faicadsheetmetal-sheet-metal-cad-domain',
    'faijs-gears.md': '#faicadfaijs-gears-gear-generation-library',
    'faijs-fasteners.md': '#faicadfaijs-fasteners-fastener-generation-library',
  }
  let result = content
  for (const [file, anchor] of Object.entries(anchorMap)) {
    // [text](file) → [text](anchor)
    result = result.replaceAll(`](${file})`, `](${anchor})`)
  }
  return result
}

// ── Assemble all.md ──

const skillMd = readFileSync(join(__dirname, 'SKILL.md'), 'utf-8')
const header = processSkillMd(skillMd.trimEnd())

const parts = [header]

for (const file of EMBED_FILES) {
  const body = embedFile(file)
  // Add a separator and the file's H1 as a level-1 heading
  // Re-read to get the H1 title
  const raw = readFileSync(join(__dirname, file), 'utf-8')
  const h1Line = raw.split('\n').find((l) => l.startsWith('# ')) || `# ${file}`
  parts.push(`\n\n---\n\n${h1Line}\n\n${body}`)
}

const allContent = parts.join('\n') + '\n'

const outPath = join(__dirname, 'all.md')
writeFileSync(outPath, allContent, 'utf-8')
console.log(`Generated ${outPath} (${allContent.length} chars)`)

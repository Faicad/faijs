#!/usr/bin/env node
/**
 * generate-all-md.mjs
 *
 * Template script that assembles skills/all.md from the individual skill files.
 *
 * Usage:  node skills/generate-all-md.mjs
 * Output: skills/all.md
 *
 * all.md is a SINGLE SELF-CONTAINED file — no external file references, no
 * duplicate content. It is meant to be fed wholesale to a third-party AI.
 *
 * Structure:
 *   1. Overview (from SKILL.md: what is faijs, script structure, key concepts,
 *      unit system) — with the "Available Libraries" table and "Quick Reference"
 *      REMOVED, since the full content is embedded below.
 *   2. core.md body (full cad.* op reference)
 *   3. faijs-extra.md body (editor extension ops)
 *   4. sketch.md body (constraint-based sketch)
 *   5. sheetmetal.md body (sheet-metal domain)
 *   6. faijs-gears.md body (gear generation)
 *   7. faijs-fasteners.md body (fastener generation)
 *
 * draw.md, faijs-cadquery.md, and faijs-freecad.md are EXCLUDED.
 *
 * De-duplication:
 *   - SKILL.md: "Available Libraries" table and "Quick Reference" section are
 *     stripped (their content is embedded inline below).
 *   - Each sub-file: H1 title and leading blockquote description are stripped
 *     (the overview already covers what they say).
 *   - No external file links remain.
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
 * (to avoid duplication with the overview), and return the body starting
 * from the first ## heading.
 */
function embedFile(filename) {
  const raw = readFileSync(join(__dirname, filename), 'utf-8')
  const lines = raw.split('\n')

  let i = 0
  // Skip leading blank lines
  while (i < lines.length && lines[i].trim() === '') i++
  // Skip H1 line
  if (i < lines.length && lines[i].startsWith('# ')) i++
  // Skip blank lines after H1
  while (i < lines.length && lines[i].trim() === '') i++
  // Skip leading blockquote (> ...) description
  while (i < lines.length && lines[i].startsWith('>')) i++
  // Skip blank lines after blockquote
  while (i < lines.length && lines[i].trim() === '') i++

  return lines.slice(i).join('\n').trimEnd()
}

/**
 * Process SKILL.md: extract only the overview sections (What is faijs,
 * Script Structure, Key Concepts, Unit System). Remove the "Available
 * Libraries" table, "Quick Reference" section, and any external file links
 * — since all content is embedded inline in all.md.
 */
function processSkillMd(content) {
  const lines = content.split('\n')
  const kept = []
  let i = 0

  // Keep H1
  while (i < lines.length && lines[i].trim() === '') i++
  if (i < lines.length && lines[i].startsWith('# ')) {
    kept.push(lines[i])
    i++
  }

  // Process sections: keep everything EXCEPT "Available Libraries" and
  // "Quick Reference" sections (their content is embedded below).
  while (i < lines.length) {
    // Detect H2 headings
    if (lines[i].startsWith('## ')) {
      const heading = lines[i].slice(3).trim()

      if (heading === 'Available Libraries') {
        // Skip this entire section until the next ## heading
        i++
        while (i < lines.length && !lines[i].startsWith('## ')) i++
        continue
      }

      if (heading === 'Quick Reference: Platform `cad.*` Ops') {
        // Skip this entire section until the next ## heading
        i++
        while (i < lines.length && !lines[i].startsWith('## ')) i++
        continue
      }
    }

    kept.push(lines[i])
    i++
  }

  // Remove any remaining external file links like [text](core.md)
  let result = kept.join('\n')
  // Remove links to .md files that are embedded (convert to plain text)
  for (const file of ['core.md', 'faijs-extra.md', 'sketch.md', 'sheetmetal.md', 'faijs-gears.md', 'faijs-fasteners.md', 'draw.md', 'faijs-cadquery.md', 'faijs-freecad.md']) {
    // [text](file) → text
    result = result.replaceAll(new RegExp(`\\[([^\\]]+)\\]\\(${file.replace('.', '\\.')}\\)`, 'g'), '$1')
  }

  return result.trimEnd()
}

// ── Assemble all.md ──

const skillMd = readFileSync(join(__dirname, 'SKILL.md'), 'utf-8')
const header = processSkillMd(skillMd)

const parts = [header]

for (const file of EMBED_FILES) {
  const body = embedFile(file)
  parts.push(body)
}

// Join with separator blank lines
const allContent = parts.join('\n\n---\n\n') + '\n'

const outPath = join(__dirname, 'all.md')
writeFileSync(outPath, allContent, 'utf-8')
console.log(`Generated ${outPath} (${allContent.length} chars)`)

#!/usr/bin/env node
/**
 * Archive last month's docs/plans/ documents into yyyy-mm/ folders.
 * On January 1st, also wrap the previous year's months into yyyy/ folders.
 * Usage: node scripts/archive-plans.mjs [--dry-run]
 */
import { readdirSync, mkdirSync, renameSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { execSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const plansDir = resolve(root, 'docs/plans')
const dryRun = process.argv.includes('--dry-run')

const now = new Date()
const year = now.getFullYear()
const month = now.getMonth() + 1 // 1-12

// Previous month
let prevYear = year
let prevMonth = month - 1
if (prevMonth === 0) { prevMonth = 12; prevYear = year - 1 }

const prevMonthStr = String(prevMonth).padStart(2, '0')
const prevYearStr = String(prevYear)

// 1. Archive last month's files into yyyy-mm/
const monthFolder = join(plansDir, `${prevYearStr}-${prevMonthStr}`)
const prefix = `${prevYearStr}-${prevMonthStr}-`

const files = readdirSync(plansDir).filter(
  (f) => f.startsWith(prefix) && f.endsWith('.md')
)

if (files.length === 0) {
  console.log(`archive-plans: no files matching ${prefix}*.md found in docs/plans/`)
} else {
  if (!dryRun) mkdirSync(monthFolder, { recursive: true })
  for (const f of files) {
    const src = join(plansDir, f)
    const dst = join(monthFolder, f)
    if (dryRun) {
      console.log(`[dry-run] git mv: ${f} -> ${prevYearStr}-${prevMonthStr}/${f}`)
    } else {
      try {
        execSync(`git mv "${src}" "${dst}"`, { cwd: root, stdio: 'pipe' })
      } catch {
        // If git mv fails (file not tracked), do a plain rename
        renameSync(src, dst)
      }
      console.log(`archived: ${f} -> ${prevYearStr}-${prevMonthStr}/${f}`)
    }
  }
}

// 2. On January 1st, wrap previous year's months into yyyy/
if (month === 1) {
  const yearFolder = join(plansDir, prevYearStr)
  const monthDirs = readdirSync(plansDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith(`${prevYearStr}-`))

  if (monthDirs.length > 0) {
    if (!dryRun) mkdirSync(yearFolder, { recursive: true })
    for (const d of monthDirs) {
      const src = join(plansDir, d.name)
      const dst = join(yearFolder, d.name)
      if (dryRun) {
        console.log(`[dry-run] git mv: ${d.name} -> ${prevYearStr}/${d.name}`)
      } else {
        try {
          execSync(`git mv "${src}" "${dst}"`, { cwd: root, stdio: 'pipe' })
        } catch {
          renameSync(src, dst)
        }
        console.log(`wrapped: ${d.name} -> ${prevYearStr}/${d.name}`)
      }
    }
  }
}

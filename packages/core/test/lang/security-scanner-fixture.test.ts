/**
 * security-scanner-fixture — 全量 fixture 无误杀回归测试
 *
 * 扫描仓库中所有 .fai.js 文件，确保安全门禁不产生误杀。
 * 方案 docs/plans/2026-09-08-faijs-security-gate.md §8.1 P3 验收断言。
 */

import { describe, it, expect } from 'vitest'
import { scanSource } from '../../src/lang/security-scanner'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname, relative, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// vitest 可从任意 cwd 启动（根 workspace / package 目录）。用 import.meta.url
// 定位仓库根（本文件位于 <faijs>/packages/core/src/lang，上溯 4 级），不依赖 process.cwd()。
const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..', '..', '..')
const packagesDir = join(repoRoot, 'packages')

// ── 收集全部 .fai.js 文件 ──

function collectFaiJsFiles(dir: string, base: string, results: string[]): void {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    // Skip node_modules, dist, test-results, tmp-* (temp dirs)
    if (entry === 'node_modules' || entry === 'dist' || entry === 'test-results' || entry.startsWith('tmp-')) continue
    const full = join(dir, entry)
    const rel = relative(base, full)
    if (statSync(full).isDirectory()) {
      collectFaiJsFiles(full, base, results)
    } else if (extname(entry) === '.js' && entry.endsWith('.fai.js')) {
      results.push(rel)
    }
  }
}

const allFixtures: string[] = []
collectFaiJsFiles(packagesDir, packagesDir, allFixtures)

describe('SecurityScanner: fixture regression (no false positives)', () => {
  // P3：全量 fixture 无误杀——每个 .fai.js 文件都必须通过 strict 扫描。
  // 如果有文件被拒，说明扫描器规则太严（误杀）或 fixture 有安全问题（需修）。
  for (const fixture of allFixtures) {
    const fullPath = join(packagesDir, fixture)
    let code: string
    try {
      code = readFileSync(fullPath, 'utf-8')
    } catch {
      // Skip files that can't be read
      continue
    }

    it(`fixture passes: ${fixture}`, () => {
      const result = scanSource(code, {
        policy: 'strict',
        knownNames: ['cad'],
      })
      if (!result.ok) {
        const v = result.violations[0]
        // Provide helpful error message
        expect(result.ok, `Fixture ${fixture} rejected: ${v.ruleId} at line ${v.lineNo}: ${v.message}`).toBe(true)
      }
      expect(result.violations).toHaveLength(0)
    })
  }
})

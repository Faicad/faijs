/**
 * svg — D4 SVG path roundtrip for polygonal contours.
 *
 * `contourToSvgPath` writes a set of closed loops to a single SVG `d` string
 * (`M … L … Z` per loop, absolute coordinates); `svgPathToContours` reads such a
 * path back into loops, supporting the absolute and relative `M` / `L` / `H` /
 * `V` commands and implicit line-after-moveto pairs. Together they give an exact
 * roundtrip for the polygonal contours the D-group ops produce.
 *
 * Pure text, no kernel and no drawing DAG — only `Point2d`.
 *
 * @module
 */

import type { Point2d } from './custom-corners'

const fmt = (v: number): string => {
  const s = Math.round(v * 1000) / 1000
  return Object.is(s, -0) ? '0' : String(s)
}

/**
 * Serialize a set of closed contours into an SVG path `d` string.
 * @param loops - the closed contours (first point equals the last is optional).
 * @returns the SVG path data.
 */
export function contourToSvgPath(loops: Point2d[][]): string {
  const parts: string[] = []
  for (const loop of loops) {
    if (!loop.length) continue
    parts.push(`M ${fmt(loop[0]![0])} ${fmt(loop[0]![1])}`)
    const end = loop[loop.length - 1]!
    const closed = loop.length > 1 && loop[0]![0] === end[0] && loop[0]![1] === end[1]
    const n = closed ? loop.length - 1 : loop.length
    for (let i = 1; i < n; i++) {
      parts.push(`L ${fmt(loop[i]![0])} ${fmt(loop[i]![1])}`)
    }
    parts.push('Z')
  }
  return parts.join(' ')
}

/**
 * Parse an SVG path `d` string into closed loop contours.
 *
 * Supports `M`/`m`, `L`/`l`, `H`/`h`, `V`/`v`, and closi `Z`/`z`. Numbers may be
 * integers, decimals, or exponent forms. A closed loop (terminated by `Z`) is
 * returned without the duplicated closing vertex.
 * @param d the SVG path `d` string.
 * @returns the parsed loops.
 */
export function svgPathToContours(d: string): Point2d[][] {
  const tokens = d.match(/[A-Za-z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? []
  const loops: Point2d[][] = []
  let sub: Point2d[] | null = null
  let cur: Point2d = [0, 0]
  let cmd: string | null = null
  let i = 0
  const num = (): number => {
    const v = parseFloat(tokens[i]!)
    i++
    return v
  }
  const close = (): void => {
    if (sub && sub.length) loops.push(sub)
    sub = null
  }
  while (i < tokens.length) {
    const t = tokens[i]!
    if (/^[A-Za-z]$/.test(t)) {
      cmd = t
      i++
      if (t.toUpperCase() === 'Z') close()
      continue
    }
    if (!cmd) {
      i++
      continue
    }
    const u = cmd.toUpperCase()
    const rel = cmd === cmd.toLowerCase()
    if (u === 'M' || u === 'L') {
      const x = num()
      const y = num()
      const nx = rel ? cur[0] + x : x
      const ny = rel ? cur[1] + y : y
      cur = [nx, ny]
      if (u === 'M') close()
      if (!sub) sub = [[nx, ny]]
      else sub.push([nx, ny])
      cmd = rel ? 'l' : 'L'
    } else if (u === 'H') {
      const x = num()
      const nx = rel ? cur[0] + x : x
      cur = [nx, cur[1]]
      if (sub) sub.push(cur)
      cmd = rel ? 'h' : 'H'
    } else if (u === 'V') {
      const y = num()
      const ny = rel ? cur[1] + y : y
      cur = [cur[0], ny]
      if (sub) sub.push(cur)
      cmd = rel ? 'v' : 'V'
    } else {
      i++
    }
  }
  close()
  return loops
}
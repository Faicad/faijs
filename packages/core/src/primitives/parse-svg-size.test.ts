import { describe, it, expect } from 'vitest'
import { parseSvgNaturalSize } from './parse-svg-size'

describe('parseSvgNaturalSize', () => {
  it('prefers viewBox min/max width/height (parts[2] and parts[3])', () => {
    const svg = `<svg viewBox="0 0 200 100" width="999" height="888"></svg>`
    expect(parseSvgNaturalSize(svg)).toEqual({ naturalWidth: 200, naturalHeight: 100 })
  })

  it('parses viewBox with comma or space separators and a min offset', () => {
    const svg = `<svg viewBox="-50,-25 300,150"></svg>`
    expect(parseSvgNaturalSize(svg)).toEqual({ naturalWidth: 300, naturalHeight: 150 })
  })

  it('respects single-quoted viewBox', () => {
    const svg = `<svg viewBox='0 0 40 20'></svg>`
    expect(parseSvgNaturalSize(svg)).toEqual({ naturalWidth: 40, naturalHeight: 20 })
  })

  it('ignores a malformed viewBox (not 4 parts / non-positive extents) and falls back to width/height', () => {
    // 3 parts → invalid viewBox
    const threeParts = `<svg viewBox="0 0 10"></svg>`
    expect(parseSvgNaturalSize(threeParts)).toEqual({ naturalWidth: 0, naturalHeight: 0 })

    // zero/negative extent → invalid, falls back to width/height present
    const zeroExtent = `<svg viewBox="0 0 0 50" width="7" height="9"></svg>`
    expect(parseSvgNaturalSize(zeroExtent)).toEqual({ naturalWidth: 7, naturalHeight: 9 })
  })

  it('falls back to width/height attributes when there is no valid viewBox', () => {
    const svg = `<svg width="320" height="240"></svg>`
    expect(parseSvgNaturalSize(svg)).toEqual({ naturalWidth: 320, naturalHeight: 240 })
  })

  it('parses decimal width/height values', () => {
    const svg = `<svg width="12.5" height="8.25"></svg>`
    expect(parseSvgNaturalSize(svg)).toEqual({ naturalWidth: 12.5, naturalHeight: 8.25 })
  })

  it('requires BOTH width and height to fall back (partial is ignored)', () => {
    const onlyW = `<svg width="100"></svg>`
    expect(parseSvgNaturalSize(onlyW)).toEqual({ naturalWidth: 0, naturalHeight: 0 })
    const onlyH = `<svg height="100"></svg>`
    expect(parseSvgNaturalSize(onlyH)).toEqual({ naturalWidth: 0, naturalHeight: 0 })
  })

  it('returns zeros for an empty / attribute-less SVG', () => {
    expect(parseSvgNaturalSize('')).toEqual({ naturalWidth: 0, naturalHeight: 0 })
    expect(parseSvgNaturalSize('<svg></svg>')).toEqual({ naturalWidth: 0, naturalHeight: 0 })
  })

  it('is case-insensitive for attribute names', () => {
    const svg = `<svg VIEWBOX="0 0 6 9"></svg>`
    expect(parseSvgNaturalSize(svg)).toEqual({ naturalWidth: 6, naturalHeight: 9 })
  })
})
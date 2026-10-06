/**
 * STEP 颜色解析器回归 —— 重点是 `DRAUGHTING_PRE_DEFINED_COLOUR`。
 *
 * GOTCHA: STEP 只在颜色**恰好等于某个 ISO 预定义色**时才写名字形式
 * （`DRAUGHTING_PRE_DEFINED_COLOUR('red')`）；近似色仍写 `COLOUR_RGB`。
 * 只认 `COLOUR_RGB` 会让这类颜色整批静默丢失 —— 这正是
 * docs/plans/2026-10-02-cadquery-port-gap-audit.md §3.5 E3b 的一半。
 *
 * 表中的 RGB 值冻结自一次性捕获（CadQuery 2.8.0 / OCCT 7.9.3）：
 * packages/faijs-cadquery/tests/ref-harness/predefined-colour-probe.py。
 * 断言存在的意义就是**挡住手调这些数字**：只有与 OCCT 同源，
 * 「CadQuery 写出 → faijs 读回」才逐位相等。
 */
import { describe, expect, it } from 'vitest'
import {
  STEP_PREDEFINED_COLOURS,
  getSolidColorsOrdered,
  parseStepColors,
} from '../../src/occt-kernel/stepColorParser'

/** Wrap entities in a minimal-but-valid STEP envelope. */
function step(...entities: string[]): string {
  return [
    'ISO-10303-21;',
    'HEADER;',
    'ENDSEC;',
    'DATA;',
    ...entities,
    'ENDSEC;',
    'END-ISO-10303-21;',
  ].join('\n')
}

/** STYLED_ITEM → PRESENTATION_STYLE_ASSIGNMENT → … → <colour entity>. */
function styledSolid(solidId: number, colourEntity: string, colourId = 900): string[] {
  return [
    colourEntity,
    `#${colourId + 1} = FILL_AREA_STYLE_COLOUR('',#${colourId});`,
    `#${colourId + 2} = FILL_AREA_STYLE('',(#${colourId + 1}));`,
    `#${colourId + 3} = SURFACE_STYLE_FILL_AREA(#${colourId + 2});`,
    `#${colourId + 4} = SURFACE_SIDE_STYLE('',(#${colourId + 3}));`,
    `#${colourId + 5} = SURFACE_STYLE_USAGE(.BOTH.,#${colourId + 4});`,
    `#${colourId + 6} = PRESENTATION_STYLE_ASSIGNMENT((#${colourId + 5}));`,
    `#${colourId + 7} = STYLED_ITEM('color',(#${colourId + 6}),#${solidId});`,
  ]
}

describe('STEP_PREDEFINED_COLOURS (frozen from OCCT Quantity_Color)', () => {
  it('carries the 13 captured ISO names, no more and no less', () => {
    expect(Object.keys(STEP_PREDEFINED_COLOURS).sort()).toEqual([
      'black', 'blue', 'brown', 'cyan', 'gold', 'green', 'magenta',
      'orange', 'pink', 'purple', 'red', 'white', 'yellow',
    ])
  })

  it('matches the OCCT values digit for digit', () => {
    // Primary eight — exactly 0/1.
    expect(STEP_PREDEFINED_COLOURS.black).toEqual([0, 0, 0])
    expect(STEP_PREDEFINED_COLOURS.red).toEqual([1, 0, 0])
    expect(STEP_PREDEFINED_COLOURS.green).toEqual([0, 1, 0])
    expect(STEP_PREDEFINED_COLOURS.blue).toEqual([0, 0, 1])
    expect(STEP_PREDEFINED_COLOURS.yellow).toEqual([1, 1, 0])
    expect(STEP_PREDEFINED_COLOURS.magenta).toEqual([1, 0, 1])
    expect(STEP_PREDEFINED_COLOURS.cyan).toEqual([0, 1, 1])
    expect(STEP_PREDEFINED_COLOURS.white).toEqual([1, 1, 1])
    // Extended — these are NOT simple fractions; hard-coding 0.5 here would be wrong.
    expect(STEP_PREDEFINED_COLOURS.orange).toEqual([1, 0.376262009, 0])
    expect(STEP_PREDEFINED_COLOURS.pink).toEqual([1, 0.527114987, 0.59720099])
    expect(STEP_PREDEFINED_COLOURS.brown).toEqual([0.376262009, 0.023153, 0.023153])
    expect(STEP_PREDEFINED_COLOURS.purple).toEqual([0.351532996, 0.014444, 0.871366024])
    expect(STEP_PREDEFINED_COLOURS.gold).toEqual([1, 0.679542005, 0])
  })
})

describe('parseStepColors', () => {
  it('resolves COLOUR_RGB (arbitrary colour)', () => {
    const text = step(
      '#37 = MANIFOLD_SOLID_BREP(\'\',#38);',
      ...styledSolid(37, "#900 = COLOUR_RGB('',0.123,0.456,0.789);"),
    )
    expect(parseStepColors(text).get(37)).toEqual([0.123, 0.456, 0.789])
  })

  it('resolves DRAUGHTING_PRE_DEFINED_COLOUR (exact predefined colour)', () => {
    const text = step(
      '#37 = MANIFOLD_SOLID_BREP(\'\',#38);',
      ...styledSolid(37, "#900 = DRAUGHTING_PRE_DEFINED_COLOUR('red');"),
    )
    expect(parseStepColors(text).get(37)).toEqual([1, 0, 0])
  })

  it('is case-insensitive on the predefined name', () => {
    const text = step(
      '#37 = MANIFOLD_SOLID_BREP(\'\',#38);',
      ...styledSolid(37, "#900 = DRAUGHTING_PRE_DEFINED_COLOUR('RED');"),
    )
    expect(parseStepColors(text).get(37)).toEqual([1, 0, 0])
  })

  it('returns null for an unknown predefined name instead of guessing', () => {
    const text = step(
      '#37 = MANIFOLD_SOLID_BREP(\'\',#38);',
      ...styledSolid(37, "#900 = DRAUGHTING_PRE_DEFINED_COLOUR('banana');"),
    )
    expect(parseStepColors(text).get(37)).toBeUndefined()
  })

  it('keeps a chained COLOUR_RGB working through SURFACE_STYLE_USAGE (regression)', () => {
    // Verbatim shape of an OCCT XCAF export: the colour lives two hops deeper.
    const text = step(
      '#1 = MANIFOLD_SOLID_BREP(\'\',#2);',
      "#10 = COLOUR_RGB('',1.0,0.0,0.0);",
      '#11 = FILL_AREA_STYLE_COLOUR(\'\',#10);',
      "#12 = FILL_AREA_STYLE('',(#11));",
      '#13 = SURFACE_STYLE_FILL_AREA(#12);',
      "#14 = SURFACE_SIDE_STYLE('',(#13));",
      '#15 = SURFACE_STYLE_USAGE(.BOTH.,#14);',
      '#16 = PRESENTATION_STYLE_ASSIGNMENT((#15));',
      "#17 = STYLED_ITEM('color',(#16),#1);",
    )
    expect(parseStepColors(text).get(1)).toEqual([1, 0, 0])
  })
})

describe('getSolidColorsOrdered', () => {
  it('lines colours up with MANIFOLD_SOLID_BREP order, null where unstyled', () => {
    const text = step(
      '#37 = MANIFOLD_SOLID_BREP(\'\',#38);',
      '#386 = MANIFOLD_SOLID_BREP(\'\',#387);',
      '#700 = MANIFOLD_SOLID_BREP(\'\',#701);',
      ...styledSolid(37, "#900 = DRAUGHTING_PRE_DEFINED_COLOUR('red');"),
      ...styledSolid(386, "#1000 = DRAUGHTING_PRE_DEFINED_COLOUR('green');", 1000),
    )
    expect(getSolidColorsOrdered(text)).toEqual([[1, 0, 0], [0, 1, 0], null])
  })
})

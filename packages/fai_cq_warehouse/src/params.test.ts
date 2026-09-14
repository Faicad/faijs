/**
 * params.test.ts — W1 验收（方案 §8-W1）：
 *  1. 参数表逐值与 A 侧快照（Python eval 语义）一致，相对容差 1e-12；
 *  2. types()/sizes()/selectBySize 与快照派生结果一致；
 *  3. 工艺表（clearance/tap/drill/nominal）与上游已解析结果（快照 resolved 段）一致；
 *  4. 34 表哈希断言（上游数据变动必须显式更新）。
 *
 * 快照由 `pwsh -NoProfile scripts/gen-reference.ps1 --dump-data` 生成。
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  NUT_TABLES,
  SCREW_TABLES,
  WASHER_TABLES,
  BEARING_TABLES,
  typesOf,
  sizesOf,
  selectBySize,
  isolateFastenerType,
  nutTypes,
  nutSizes,
  clearanceHoleData,
  tapHoleData,
  readDrillSizes,
  readNominalScrewLengths,
  iso10664Def,
  unreferencedTables,
  imperialStrToFloat,
  type ParamTable,
} from './params'
import dataManifest from './data/manifest.json'

const HERE = dirname(fileURLToPath(import.meta.url))
const SNAPSHOT = join(HERE, '../fixtures/reference/data-snapshot.json')
const UPSTREAM_DEFAULT = 'C:/git/CADQ/cq_warehouse/src/cq_warehouse'

interface Snapshot {
  tables: Record<string, Record<string, Record<string, number | string>>>
  resolved: {
    clearance_hole_data: Record<string, Record<string, number>>
    tap_hole_data: Record<string, Record<string, number>>
    drill_sizes: Record<string, number>
    nominal_screw_lengths: Record<string, number[]>
  }
}

const snapshot = JSON.parse(readFileSync(SNAPSHOT, 'utf8')) as Snapshot

/** CSV → 本包数据表（参数表 27 张；5 张工艺表走 resolved 段比对）。 */
const TABLE_BY_CSV: Array<[string, ParamTable]> = [
  ['hex_nut_parameters.csv', NUT_TABLES.HexNut],
  ['hex_nut_with_flange_parameters.csv', NUT_TABLES.HexNutWithFlange],
  ['unchamfered_hex_nut_parameters.csv', NUT_TABLES.UnchamferedHexagonNut],
  ['square_nut_parameters.csv', NUT_TABLES.SquareNut],
  ['domed_cap_nut_parameters.csv', NUT_TABLES.DomedCapNut],
  ['brad_tee_nut_parameters.csv', NUT_TABLES.BradTeeNut],
  ['heatset_nut_parameters.csv', NUT_TABLES.HeatSetNut],
  ['button_head_parameters.csv', SCREW_TABLES.ButtonHeadScrew],
  ['button_head_with_collar_parameters.csv', SCREW_TABLES.ButtonHeadWithCollarScrew],
  ['cheese_head_parameters.csv', SCREW_TABLES.CheeseHeadScrew],
  ['countersunk_head_parameters.csv', SCREW_TABLES.CounterSunkScrew],
  ['hex_head_parameters.csv', SCREW_TABLES.HexHeadScrew],
  ['hex_head_with_flange_parameters.csv', SCREW_TABLES.HexHeadWithFlangeScrew],
  ['pan_head_parameters.csv', SCREW_TABLES.PanHeadScrew],
  ['pan_head_with_collar_parameters.csv', SCREW_TABLES.PanHeadWithCollarScrew],
  ['raised_cheese_head_parameters.csv', SCREW_TABLES.RaisedCheeseHeadScrew],
  ['raised_countersunk_oval_head_parameters.csv', SCREW_TABLES.RaisedCounterSunkOvalHeadScrew],
  ['setscrew_parameters.csv', SCREW_TABLES.SetScrew],
  ['socket_head_cap_parameters.csv', SCREW_TABLES.SocketHeadCapScrew],
  ['plain_washer_parameters.csv', WASHER_TABLES.PlainWasher],
  ['chamfered_washer_parameters.csv', WASHER_TABLES.ChamferedWasher],
  ['cheese_head_washer_parameters.csv', WASHER_TABLES.CheeseHeadWasher],
  ['single_row_deep_groove_ball_bearing_parameters.csv', BEARING_TABLES.SingleRowDeepGrooveBallBearing],
  ['single_row_capped_deep_groove_ball_bearing_parameters.csv', BEARING_TABLES.SingleRowCappedDeepGrooveBallBearing],
  ['single_row_angular_contact_ball_bearing_parameters.csv', BEARING_TABLES.SingleRowAngularContactBallBearing],
  ['single_row_cylindrical_roller_bearing_parameters.csv', BEARING_TABLES.SingleRowCylindricalRollerBearing],
  ['single_row_tapered_roller_bearing_parameters.csv', BEARING_TABLES.SingleRowTaperedRollerBearing],
]

const REL_TOL = 1e-12

function expectSameValue(a: number | string, b: number | string, where: string): void {
  if (typeof a === 'number' && typeof b === 'number') {
    const scale = Math.max(Math.abs(a), Math.abs(b), 1)
    const rel = Math.abs(a - b) / scale
    expect(rel, `${where}: TS=${a} python=${b} relDiff=${rel}`).toBeLessThanOrEqual(REL_TOL)
  } else {
    expect(String(a), where).toBe(String(b))
  }
}

describe('W1 数据层（方案 §8-W1 验收）', () => {
  it('快照 34 表齐全', () => {
    expect(Object.keys(snapshot.tables)).toHaveLength(34)
  })

  it('参数表逐值与 Python eval 快照一致（相对容差 1e-12）', () => {
    let compared = 0
    for (const [csv, table] of TABLE_BY_CSV) {
      const snapTable = snapshot.tables[csv]
      expect(snapTable, `${csv} missing in snapshot`).toBeDefined()
      for (const [size, row] of Object.entries(table)) {
        const snapRow = snapTable![size]
        if (!snapRow) continue // 快照滤掉空行；空行不产生几何
        for (const [col, value] of Object.entries(row)) {
          if (value === '') continue // isolate 语义：空串单元格不参与
          // 快照列名是原始表头（可能带尾空格），TS 侧已 trim——归一化后找值
          const snapVal =
            snapRow[col] ?? snapRow[col.trim()] ?? snapRow[Object.keys(snapRow).find((k) => k.trim() === col.trim()) ?? '']
          expect(snapVal, `${csv}[${size}].${col} missing in snapshot`).toBeDefined()
          expectSameValue(value, snapVal as number | string, `${csv}[${size}].${col}`)
          compared++
        }
      }
    }
    expect(compared).toBeGreaterThan(5000)
  })

  it('types()/sizes() 与快照派生结果逐字一致（全部 27 张参数表）', () => {
    for (const [csv, table] of TABLE_BY_CSV) {
      const snapTable = snapshot.tables[csv]!
      // types：快照全表非空值的 `type:dim` 前缀并集。
      // （上游 types() 取原始首行前缀、含空串列——快照已滤空，故用全表并集等价比对；
      //   34 表中每张表的每个 type 在非空行里都会出现，两口径结果一致。）
      const expectedTypes = [
        ...new Set(
          Object.values(snapTable).flatMap((row) =>
            Object.entries(row)
              .filter(([, v]) => v !== '')
              .map(([k]) => k.split(':')[0]!.trim()),
          ),
        ),
      ].sort()
      expect(typesOf(table).sort(), `${csv} types()`).toEqual(expectedTypes)
      // sizes：每个 type 的非空行集合一致（isolate 语义）
      for (const t of typesOf(table)) {
        const expected = Object.entries(snapTable)
          .filter(([, row]) =>
            Object.entries(row).some(([k, v]) => k.split(':')[0]!.trim() === t && v !== ''),
          )
          .map(([size]) => size)
          .sort()
        expect(sizesOf(t, table).sort(), `${csv} sizes(${t})`).toEqual(expected)
      }
    }
  })

  it('clearance/tap 孔径与上游已解析结果一致（快照 resolved 段）', () => {
    expect(clearanceHoleData).toEqual(snapshot.resolved.clearance_hole_data)
    expect(tapHoleData).toEqual(snapshot.resolved.tap_hole_data)
  })

  it('drill_sizes 与上游已解析结果一致（mm）', () => {
    const drills = readDrillSizes()
    const expected = snapshot.resolved.drill_sizes
    expect(Object.keys(drills).sort()).toEqual(Object.keys(expected).sort())
    for (const [key, v] of Object.entries(expected)) {
      expect(drills[key], `drill_sizes[${key}]`).toBeCloseTo(v, 9)
    }
  })

  it('nominal_screw_lengths 与上游已解析结果一致（mm）', () => {
    const nominal = readNominalScrewLengths()
    const expected = snapshot.resolved.nominal_screw_lengths
    expect(Object.keys(nominal).sort()).toEqual(Object.keys(expected).sort())
    for (const [type, arr] of Object.entries(expected)) {
      expect(nominal[type], `nominal[${type}]`).toEqual(arr)
    }
  })

  it('iso10664def（hexalobular recess）与快照一致', () => {
    const snap = snapshot.tables['iso10664def.csv']!
    for (const [size, row] of Object.entries(snap)) {
      const ours = iso10664Def[size]
      expect(ours, `iso10664def[${size}]`).toBeDefined()
      for (const [col, value] of Object.entries(row)) {
        expectSameValue(ours![col] as number | string, value as number | string, `iso10664def[${size}].${col}`)
      }
    }
  })

  it('零引用 2 表照常生成、进 manifest 且标 referencedByUpstream:false', () => {
    expect(Object.keys(unreferencedTables.imperial_set_screw_parameters).length).toBeGreaterThan(0)
    expect(Object.keys(unreferencedTables.metric_set_screw_parameters).length).toBeGreaterThan(0)
    const m = dataManifest as unknown as {
      tables: Record<string, { referencedByUpstream: boolean; sha256: string }>
    }
    expect(m.tables['imperial_set_screw_parameters']!.referencedByUpstream).toBe(false)
    expect(m.tables['metric_set_screw_parameters']!.referencedByUpstream).toBe(false)
  })

  it('selectBySize 语义：M6-1 命中 HexNut(iso4032)，未知 size 返回空', () => {
    const m6 = selectBySize('M6-1')
    expect(m6['HexNut']).toContain('iso4032')
    expect(Object.keys(m6).length).toBeGreaterThan(3)
    expect(selectBySize('M999-99')).toEqual({})
  })

  it('nutTypes/nutSizes 公共 API 与表数据一致', () => {
    expect(nutTypes()).toContain('iso4032')
    expect(nutSizes('iso4032')).toContain('M6-1')
  })

  it('英制分数求值：imperial_str_to_float("1 1/2") = 1.5×25.4', () => {
    expect(imperialStrToFloat('1 1/2')).toBeCloseTo(38.1, 9)
    expect(imperialStrToFloat('3/8')).toBeCloseTo(9.525, 9)
  })

  it('34 表哈希断言：manifest sha256 与当前上游 CSV 一致（上游变动必须显式更新）', () => {
    const upstream = process.env.FAI_CQ_UPSTREAM ?? UPSTREAM_DEFAULT
    const m = dataManifest as unknown as {
      tables: Record<string, { source: string; sha256: string }>
    }
    let checked = 0
    for (const [name, entry] of Object.entries(m.tables)) {
      const p = join(upstream, entry.source)
      const actual = createHash('sha256').update(readFileSync(p)).digest('hex')
      expect(actual, `${name} (${entry.source}) upstream data changed — rerun gen-data.ts`).toBe(entry.sha256)
      checked++
    }
    expect(checked).toBe(34)
  })
})

describe('isolate_fastener_type 语义（fastener.py:144）', () => {
  it('拆 type:dim、按类型过滤、过滤空串、两段 strip', () => {
    const isolated = isolateFastenerType('iso4032', NUT_TABLES.HexNut)
    expect(isolated['M6-1']).toEqual({ m: 5.2, s: 10 })
    expect(isolated['M6-1']!['iso4033:m']).toBeUndefined()
  })
})

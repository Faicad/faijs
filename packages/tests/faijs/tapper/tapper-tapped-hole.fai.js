let part0 = cad.box(40 * MM, 40 * MM, 20 * MM, { centered: true })
// 底孔参照与攻丝是同一毛坯上的**两路派生**：part0 被第一条 fai_drill 消费后不能再引用，
// 所以先声明 keep（语言级消费规则的唯一显式豁免路径，方案 §9.3 R-D）。
part0.keep()
let ref = cad.fai_drill(part0, { diameter: 2.5 * MM, depth: 0, position: [0 * MM, 0 * MM, 10 * MM], direction: 'z' })
let tapped = cad.fai_drill_tapper(part0, { drill: 'Ø2.5 完全贯穿', tap: 'M3-6H 完全贯穿', position: [0 * MM, 0 * MM, 10 * MM], direction: 'z' })

import * as cq from '@faicad/cq-compat'

const EDGE_MARGIN = 12
const OUTX = 100
const OUTY = 100
const TOL = 0.02
const INX = (100 - (12 * 2))
const INY = (100 - (12 * 2))
const INX_FDM = ((100 - (12 * 2)) - 0.1)
const INY_FDM = ((100 - (12 * 2)) - 0.1)
const C_RECT_LEN = (100 - 12)
const MID_HOLE_D = 7.9
const MID_HOLE_D_FDM = 8.2
const EDGE_HOLE_D = 6
const M3_AUTO = 2.5
const M6_AUTO = 5
const M8_AUTO = 6.8
const TOP_CUT_H = 1.9
const MID_H = 5
const M6_F = 12
const C_RECT_R = ((100 - 12) / 2)

async function pin_holes(wp) {
  return await cq.hole(await cq.pushPoints(await cq.workplane(await cq.faces(wp, ">Z")), [0, 15, 30, 45, 60, 90, 120].map((a) => [(((100 - 12) / 2) * Math.cos(((a / 2) * Math.PI / 180))), (((100 - 12) / 2) * Math.sin(((a / 2) * Math.PI / 180)))])), 2.49)
}

let x_len = 110
let y_len = 137.9
let margin = 3
let fa = 0.33
let slide_mid = cq.extrude(cq.rect(cq.Workplane("XY"), ((x_len + margin) + fa), ((y_len + margin) + fa)), (8 + margin))
slide_mid = cq.cutBlind(cq.rect(cq.workplane(cq.faces(slide_mid, "<Z")), (x_len + fa), (y_len + fa)), (-margin))
slide_mid = cq.cutBlind(cq.rect(cq.workplane(cq.faces(slide_mid, "<Z")), (x_len / 2), (y_len * 2)), (-margin))
slide_mid = cq.cskHole(cq.pushPoints(cq.workplane(cq.faces(slide_mid, ">Z")), [[0, (y_len / 4)], [0, ((-y_len) / 4)]]), 3.5, 8.5, 45)
let slot_x = 27.4
let slot_y = 36
let depth = 1
let x_min = ((-x_len) / 2)
let x_max = (x_len / 2)
let left_slot_x0 = (x_min + margin)
let left_slot_center_x = (left_slot_x0 + (slot_x / 2))
let right_slot_x1 = (x_max - margin)
let right_slot_center_x = (right_slot_x1 - (slot_x / 2))
let center_y = 0
let cut_centers = [[left_slot_center_x, center_y], [right_slot_center_x, center_y]]
slide_mid = cq.cutBlind(cq.rect(cq.pushPoints(cq.workplane(cq.faces(slide_mid, ">Z")), cut_centers), slot_x, slot_y), (-depth))
let hole_positions = [[(-48.3), (-7.5)], [(-48.3), 7.5], [(-28.3), (-7.5)], [(-28.3), 7.5], [28.3, (-7.5)], [28.3, 7.5], [48.3, (-7.5)], [48.3, 7.5]]
slide_mid = cq.cboreHole(cq.pushPoints(cq.transformed(cq.workplane(cq.faces(slide_mid, "<Z")), { offset: [0, 0, (-margin)] }), hole_positions), 3, 5.2, 2)
let block = cq.extrude(cq.rect(cq.Workplane("XY"), 20, 10), 13.7)
let hexagon_side = 4.62
let hexagon_dia = 8
let hexagon_out = 9.24
let hex_center_z = ((4.3 - 1.4) / 2)
block = cq.cutBlind(cq.polygon(cq.center(cq.workplane(cq.faces(block, "<Y"), { centerOption: "CenterOfBoundBox" }), 0, hex_center_z), 6, hexagon_out), (-4))
block = cq.cutBlind(cq.polygon(cq.center(cq.workplane(cq.faces(block, ">Y"), { centerOption: "CenterOfBoundBox" }), 0, hex_center_z), 6, hexagon_out), (-4))
block = cq.hole(cq.center(cq.workplane(cq.faces(block, "<Y"), { centerOption: "CenterOfBoundBox" }), 0, hex_center_z), 5.3)
block = cq.translate(block, [0, 0, (8 + margin)])
slide_mid = cq.union(slide_mid, block)
// show_object(block)

let result = cq.val(slide_mid)

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

let slide_top = cq.extrude(cq.rect(cq.Workplane("XY"), 110, 120), 8)
let slot_x = 27.4
let slot_y = 36
let depth = 1
let margin = 3
let x_min = (-55)
let x_max = 55
let y_min = (-60)
let y_max = 60
let left_slot_x0 = (x_min + margin)
let left_slot_center_x = (left_slot_x0 + (slot_x / 2))
let right_slot_x1 = (x_max - margin)
let right_slot_center_x = (right_slot_x1 - (slot_x / 2))
let center_y = 0
let cut_centers = [[left_slot_center_x, center_y], [right_slot_center_x, center_y]]
slide_top = cq.cutBlind(cq.rect(cq.pushPoints(cq.workplane(cq.faces(slide_top, ">Z")), cut_centers), slot_x, slot_y), (-depth))
let hole_positions = [[(-48.3), (-7.5)], [(-48.3), 7.5], [(-28.3), (-7.5)], [(-28.3), 7.5], [28.3, (-7.5)], [28.3, 7.5], [48.3, (-7.5)], [48.3, 7.5]]
slide_top = cq.cboreHole(cq.pushPoints(cq.workplane(cq.faces(slide_top, "<Z")), hole_positions), 3, 5.2, 2)
slide_top = cq.hole(cq.center(cq.workplane(cq.faces(slide_top, ">Z")), 0, (8 / 2)), 8.2)
slide_top = cq.extrude(cq.rect(cq.center(cq.workplane(cq.faces(slide_top, ">Z"), { centerOption: "CenterOfBoundBox" }), 0, (-((((15 - 8) / 2) + (10 / 2)) + 0.555))), 20, 10), 13.7)
let hexagon_side = 4.62
let hexagon_dia = 8
let hexagon_out = 9.24
let hex_center_z = ((4.3 - 1.4) / 2)
slide_top = cq.cutBlind(cq.polygon(cq.center(cq.workplane(cq.faces(slide_top, "-Y"), { centerOption: "CenterOfBoundBox" }), 0, hex_center_z), 6, hexagon_out), (-4))
slide_top = cq.cutBlind(cq.polygon(cq.center(cq.workplane(cq.faces(slide_top, "+Y"), { centerOption: "CenterOfBoundBox" }), 0, hex_center_z), 6, hexagon_out), (-4))
slide_top = cq.hole(cq.center(cq.workplane(cq.faces(slide_top, "+Y"), { centerOption: "CenterOfBoundBox" }), 0, hex_center_z), 5.3)
let rect_width = (46 + 0.555)
let rect_height = (100 + 0.555)
let square_size = 27.333
let tool1 = cq.extrude(cq.rect(cq.Workplane("XY"), rect_width, rect_height), 3)
let tool2 = cq.translate(cq.extrude(cq.rect(cq.Workplane("XY"), square_size, (square_size + 4)), 3), [(-36.5), (-34.5), 0])
let tool = cq.union(tool1, tool2)
tool = cq.translate(tool, [0, 4, 0])
slide_top = cq.cut(slide_top, tool)

let result = cq.val(slide_top)

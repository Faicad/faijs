import * as cq from '@faicad/cq-compat'
import * as config from '../config.fai.js'

let slide_top_wp = cq.extrude(cq.rect(cq.Workplane("XY"), 110, 120), 8)
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
slide_top_wp = cq.cutBlind(cq.rect(cq.pushPoints(cq.workplane(cq.faces(slide_top_wp, ">Z")), cut_centers), slot_x, slot_y), (-depth))
let hole_positions = [[(-48.3), (-7.5)], [(-48.3), 7.5], [(-28.3), (-7.5)], [(-28.3), 7.5], [28.3, (-7.5)], [28.3, 7.5], [48.3, (-7.5)], [48.3, 7.5]]
slide_top_wp = cq.cboreHole(cq.pushPoints(cq.workplane(cq.faces(slide_top_wp, "<Z")), hole_positions), 3, 5.2, 2)
slide_top_wp = cq.hole(cq.center(cq.workplane(cq.faces(slide_top_wp, ">Z")), 0, (8 / 2)), config.MID_HOLE_D_FDM)
slide_top_wp = cq.extrude(cq.rect(cq.center(cq.workplane(cq.faces(slide_top_wp, ">Z"), { centerOption: "CenterOfBoundBox" }), 0, (-((((15 - 8) / 2) + (10 / 2)) + 0.555))), 20, 10), 13.7)
let hexagon_side = 4.62
let hexagon_dia = 8
let hexagon_out = 9.24
let hex_center_z = ((4.3 - 1.4) / 2)
slide_top_wp = cq.cutBlind(cq.polygon(cq.center(cq.workplane(cq.faces(slide_top_wp, "-Y"), { centerOption: "CenterOfBoundBox" }), 0, hex_center_z), 6, hexagon_out), (-4))
slide_top_wp = cq.cutBlind(cq.polygon(cq.center(cq.workplane(cq.faces(slide_top_wp, "+Y"), { centerOption: "CenterOfBoundBox" }), 0, hex_center_z), 6, hexagon_out), (-4))
slide_top_wp = cq.hole(cq.center(cq.workplane(cq.faces(slide_top_wp, "+Y"), { centerOption: "CenterOfBoundBox" }), 0, hex_center_z), 5.3)
let rect_width = (46 + 0.555)
let rect_height = (100 + 0.555)
let square_size = 27.333
let tool1 = cq.extrude(cq.rect(cq.Workplane("XY"), rect_width, rect_height), 3)
let tool2 = cq.translate(cq.extrude(cq.rect(cq.Workplane("XY"), square_size, (square_size + 4)), 3), [(-36.5), (-34.5), 0])
let tool = cq.union(tool1, tool2)
tool = cq.translate(tool, [0, 4, 0])
slide_top_wp = cq.cut(slide_top_wp, tool)

let slide_top = cq.val(slide_top_wp)

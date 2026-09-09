import * as cq from '@faicad/cq-compat'

let x_len = 110
let y_len = 137.9
let margin = 3
let fa = 0.33
let slide_mid_wp = cq.extrude(cq.rect(cq.Workplane("XY"), ((x_len + margin) + fa), ((y_len + margin) + fa)), (8 + margin))
slide_mid_wp = cq.cutBlind(cq.rect(cq.workplane(cq.faces(slide_mid_wp, "<Z")), (x_len + fa), (y_len + fa)), (-margin))
slide_mid_wp = cq.cutBlind(cq.rect(cq.workplane(cq.faces(slide_mid_wp, "<Z")), (x_len / 2), (y_len * 2)), (-margin))
slide_mid_wp = cq.cskHole(cq.pushPoints(cq.workplane(cq.faces(slide_mid_wp, ">Z")), [[0, (y_len / 4)], [0, ((-y_len) / 4)]]), 3.5, 8.5, 45)
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
slide_mid_wp = cq.cutBlind(cq.rect(cq.pushPoints(cq.workplane(cq.faces(slide_mid_wp, ">Z")), cut_centers), slot_x, slot_y), (-depth))
let hole_positions = [[(-48.3), (-7.5)], [(-48.3), 7.5], [(-28.3), (-7.5)], [(-28.3), 7.5], [28.3, (-7.5)], [28.3, 7.5], [48.3, (-7.5)], [48.3, 7.5]]
slide_mid_wp = cq.cboreHole(cq.pushPoints(cq.transformed(cq.workplane(cq.faces(slide_mid_wp, "<Z")), { offset: [0, 0, (-margin)] }), hole_positions), 3, 5.2, 2)
let block = cq.extrude(cq.rect(cq.Workplane("XY"), 20, 10), 13.7)
let hexagon_side = 4.62
let hexagon_dia = 8
let hexagon_out = 9.24
let hex_center_z = ((4.3 - 1.4) / 2)
block = cq.cutBlind(cq.polygon(cq.center(cq.workplane(cq.faces(block, "<Y"), { centerOption: "CenterOfBoundBox" }), 0, hex_center_z), 6, hexagon_out), (-4))
block = cq.cutBlind(cq.polygon(cq.center(cq.workplane(cq.faces(block, ">Y"), { centerOption: "CenterOfBoundBox" }), 0, hex_center_z), 6, hexagon_out), (-4))
block = cq.hole(cq.center(cq.workplane(cq.faces(block, "<Y"), { centerOption: "CenterOfBoundBox" }), 0, hex_center_z), 5.3)
block = cq.translate(block, [0, 0, (8 + margin)])
slide_mid_wp = cq.union(slide_mid_wp, block)

let slide_mid = cq.val(slide_mid_wp)

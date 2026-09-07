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

let rect_width = 100
let rect_height = 46
let square_size = ((rect_width - rect_height) / 2)
let thickness = 10
let cc = cq.extrude(cq.rect(cq.transformed(cq.Workplane("XY"), { offset: [(36.5 - 2), 36.5, 0] }), (square_size + 4), square_size), thickness)
let axk = cq.extrude(cq.rect(cq.Workplane("XY"), 100, 46), thickness)
axk = cq.hole(cq.workplane(cq.faces(axk, ">Z")), 6.8)
axk = cq.cutBlind(cq.circle(cq.workplane(cq.faces(axk, ">Z")), ((28 / 2) + 0.02)), (-4))
axk = cq.union(axk, cc)
axk = cq.fillet(cq.edges(axk, "|Z"), 2)
axk = pin_holes(axk)

let result = cq.val(axk)

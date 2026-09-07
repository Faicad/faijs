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

let tp = cq.extrude(cq.rect(cq.Workplane("XY"), 100, 100), 8)
tp = cq.hole(cq.edges(cq.rect(cq.workplane(cq.faces(cq.hole(cq.edges(cq.rect(cq.workplane(cq.faces(cq.hole(cq.vertices(cq.rect(cq.workplane(cq.faces(cq.hole(cq.vertices(cq.rect(cq.workplane(cq.faces(cq.hole(cq.workplane(cq.faces(tp, ">Z")), 7.9), ">Z")), (100 - 12), (100 - 12), { forConstruction: true }), { slice: [0, (-1)] }), 5), ">Z")), (100 - 12), (100 - 12), { forConstruction: true }), { index: (-1) }), 5.85), ">Z")), (100 - 12), (100 - 12), { forConstruction: true }), { slice: [2] }), 5.85), ">Z")), (100 - 12), (100 - 12), { forConstruction: true }), { slice: [0, 2] }), 5)
tp = cq.fillet(cq.edges(cq.cutBlind(cq.rect(cq.workplane(cq.faces(tp, "<Z")), (100 - (12 * 2)), (100 - (12 * 2))), (-1.9)), "|Z"), 2)

let result = cq.val(tp)

import * as cq from '@faicad/cq-compat'
import * as config from '../config.fai.js'

let tp = cq.extrude(cq.rect(cq.Workplane("XY"), config.OUTX, config.OUTY), 8)
tp = cq.hole(cq.edges(cq.rect(cq.workplane(cq.faces(cq.hole(cq.edges(cq.rect(cq.workplane(cq.faces(cq.hole(cq.vertices(cq.rect(cq.workplane(cq.faces(cq.hole(cq.vertices(cq.rect(cq.workplane(cq.faces(cq.hole(cq.workplane(cq.faces(tp, ">Z")), config.MID_HOLE_D), ">Z")), config.C_RECT_LEN, config.C_RECT_LEN, { forConstruction: true }), { slice: [0, (-1)] }), config.M6_AUTO), ">Z")), config.C_RECT_LEN, config.C_RECT_LEN, { forConstruction: true }), { index: (-1) }), 5.85), ">Z")), config.C_RECT_LEN, config.C_RECT_LEN, { forConstruction: true }), { slice: [2] }), 5.85), ">Z")), config.C_RECT_LEN, config.C_RECT_LEN, { forConstruction: true }), { slice: [0, 2] }), config.M6_AUTO)
tp = cq.fillet(cq.edges(cq.cutBlind(cq.rect(cq.workplane(cq.faces(tp, "<Z")), config.INX, config.INY), (-config.TOP_CUT_H)), "|Z"), 2)

let top_plate = cq.val(tp)

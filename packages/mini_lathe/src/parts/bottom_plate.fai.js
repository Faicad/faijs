import * as cq from '@faicad/cq-compat'
import * as config from '../config.fai.js'

let bp = cq.extrude(cq.rect(cq.Workplane("XY"), config.OUTX, config.OUTY), 8)
bp = cq.hole(cq.edges(cq.rect(cq.workplane(cq.faces(cq.hole(cq.vertices(cq.rect(cq.workplane(cq.faces(cq.hole(cq.workplane(cq.faces(bp, ">Z")), config.MID_HOLE_D), ">Z")), config.C_RECT_LEN, config.C_RECT_LEN, { forConstruction: true })), 5.85), ">Z")), config.C_RECT_LEN, config.C_RECT_LEN, { forConstruction: true })), config.M6_AUTO)
bp = cq.fillet(cq.edges(cq.cutBlind(cq.rect(cq.workplane(cq.faces(bp, ">Z")), config.INX, config.INY), (-config.TOP_CUT_H)), "|Z"), 2)

let bottom_plate = cq.val(bp)

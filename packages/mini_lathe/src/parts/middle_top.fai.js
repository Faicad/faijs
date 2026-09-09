import * as cq from '@faicad/cq-compat'
import * as config from '../config.fai.js'

let mt = cq.extrude(cq.rect(cq.Workplane("XY"), config.INX_FDM, config.INY_FDM), (10 - config.MID_H))
mt = cq.fillet(cq.edges(cq.hole(cq.edges(cq.rect(cq.workplane(cq.faces(cq.hole(cq.vertices(cq.rect(cq.workplane(cq.faces(cq.hole(cq.workplane(cq.faces(cq.extrude(cq.rect(cq.workplane(cq.faces(mt, "<Z")), 28, 28), config.MID_H), ">Z")), config.MID_HOLE_D_FDM), ">Z")), 68, 68, { forConstruction: true })), config.M3_AUTO), ">Z")), 68, 68, { forConstruction: true })), 5.85), "|Z"), 2)

let middle_top = cq.val(mt)

import * as cq from '@faicad/cq-compat'
import * as config from '../config.fai.js'

let mb = cq.extrude(cq.rect(cq.Workplane("XY"), config.INX_FDM, config.INY_FDM), 10)
mb = cq.fillet(cq.edges(cq.hole(cq.edges(cq.rect(cq.workplane(cq.faces(cq.hole(cq.vertices(cq.rect(cq.workplane(cq.faces(cq.hole(cq.workplane(cq.faces(cq.cutBlind(cq.rect(cq.workplane(cq.faces(mb, ">Z")), (28 + config.TOL), (28 + config.TOL)), (-config.MID_H)), ">Z")), config.MID_HOLE_D_FDM), ">Z")), 68, 68, { forConstruction: true })), config.M3_AUTO), ">Z")), 68, 68, { forConstruction: true })), 5.85), "|Z"), 2)

let middle_bottom = cq.val(mb)

import * as cq from '@faicad/cq-compat'
import * as config from '../config.fai.js'

// AXK平面压力滚针轴承 15*28*4mm

let rect_width = 100
let rect_height = 46
let square_size = ((rect_width - rect_height) / 2)
let thickness = 10

let cc = cq.extrude(cq.rect(cq.transformed(cq.Workplane("XY"), { offset: [(36.5 - 2), 36.5, 0] }), (square_size + 4), square_size), thickness)

let axk_wp = cq.extrude(cq.rect(cq.Workplane("XY"), 100, 46), thickness)
axk_wp = cq.hole(cq.workplane(cq.faces(axk_wp, ">Z")), config.M8_AUTO)
axk_wp = cq.cutBlind(cq.circle(cq.workplane(cq.faces(axk_wp, ">Z")), ((28 / 2) + config.TOL)), (-4))
axk_wp = cq.union(axk_wp, cc)
axk_wp = cq.fillet(cq.edges(axk_wp, "|Z"), 2)
axk_wp = config.pin_holes(axk_wp, config.C_RECT_R)

let axk = cq.val(axk_wp)

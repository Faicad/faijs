import * as cq from '@faicad/cq-compat'
import { bottom_plate } from './parts/bottom_plate.fai.js'
import { middle_bottom } from './parts/middle_bottom.fai.js'
import { middle_top } from './parts/middle_top.fai.js'
import { top_plate } from './parts/top_plate.fai.js'
import { axk } from './parts/axk.fai.js'
import { slide_top } from './parts/slide_top.fai.js'

// Build constraints
let c1 = cq.constraint("bp", ">Z", bottom_plate, "mb", "<Z", middle_bottom, "Plane")
let c2 = cq.constraint("mb", ">Z", middle_bottom, "mt", "<Z", middle_top, "Plane")
let c3 = cq.constraint("mt", ">Z", middle_top, "tp", ">Z", top_plate, "Plane")
let c4 = cq.constraint("bp", "<X", bottom_plate, "mb", "<X", middle_bottom, "Axis")
let c5 = cq.constraint("bp", "<X", bottom_plate, "mt", "<X", middle_top, "Axis")
let c6 = cq.constraint("bp", "<X", bottom_plate, "tp", "<X", top_plate, "Axis")
let c7 = cq.constraint("bp", "<Z", bottom_plate, "axk", ">Z", axk, "Plane")
let c8 = cq.constraint("bp", "<X", bottom_plate, "axk", "<X", axk, "Axis")

let asm = cq.buildAssembly(
  "mini_lathe",
  [
    { name: "axk", shape: axk, color: [0.3, 0.3, 0.3] },
    { name: "bp", shape: bottom_plate, color: [0.8, 0.5, 0.1] },
    { name: "mb", shape: middle_bottom, color: [0.1, 0.7, 0.7] },
    { name: "mt", shape: middle_top, color: [0.0, 0.9, 0.8] },
    { name: "tp", shape: top_plate, color: [1.0, 0.7, 0.2] },
    { name: "slide_top", shape: slide_top, color: [1.0, 0.7, 0.2] },
  ],
  [c1, c2, c3, c4, c5, c6, c7, c8]
)

let result = asm

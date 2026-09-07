import * as cq from '@faicad/cq-compat'

async function make_mt() {
  let mt = await cq.extrude(await cq.rect(await cq.Workplane("XY"), ((100 - (12 * 2)) - 0.1), ((100 - (12 * 2)) - 0.1)), (10 - 5))
  mt = await cq.fillet(await cq.edges(await cq.hole(await cq.edges(await cq.rect(await cq.workplane(await cq.faces(await cq.hole(await cq.vertices(await cq.rect(await cq.workplane(await cq.faces(await cq.hole(await cq.workplane(await cq.faces(await cq.extrude(await cq.rect(await cq.workplane(await cq.faces(mt, "<Z")), 28, 28), 5), ">Z")), 8.2), ">Z")), 68, 68, { forConstruction: true })), 2.5), ">Z")), 68, 68, { forConstruction: true })), 5.85), "|Z"), 2)

  return cq.val(mt)
}

async function make_tp() {
  let tp = await cq.extrude(await cq.rect(await cq.Workplane("XY"), 100, 100), 8)
  tp = await cq.hole(await cq.edges(await cq.rect(await cq.workplane(await cq.faces(await cq.hole(await cq.edges(await cq.rect(await cq.workplane(await cq.faces(await cq.hole(await cq.vertices(await cq.rect(await cq.workplane(await cq.faces(await cq.hole(await cq.vertices(await cq.rect(await cq.workplane(await cq.faces(await cq.hole(await cq.workplane(await cq.faces(tp, ">Z")), 7.9), ">Z")), (100 - 12), (100 - 12), { forConstruction: true }), { slice: [0, (-1)] }), 5), ">Z")), (100 - 12), (100 - 12), { forConstruction: true }), { index: (-1) }), 5.85), ">Z")), (100 - 12), (100 - 12), { forConstruction: true }), { slice: [2] }), 5.85), ">Z")), (100 - 12), (100 - 12), { forConstruction: true }), { slice: [0, 2] }), 5)
  tp = await cq.fillet(await cq.edges(await cq.cutBlind(await cq.rect(await cq.workplane(await cq.faces(tp, "<Z")), (100 - (12 * 2)), (100 - (12 * 2))), (-1.9)), "|Z"), 2)

  return cq.val(tp)
}

async function make_bp() {
  let bp = await cq.extrude(await cq.rect(await cq.Workplane("XY"), 100, 100), 8)
  bp = await cq.hole(await cq.edges(await cq.rect(await cq.workplane(await cq.faces(await cq.hole(await cq.vertices(await cq.rect(await cq.workplane(await cq.faces(await cq.hole(await cq.workplane(await cq.faces(bp, ">Z")), 7.9), ">Z")), (100 - 12), (100 - 12), { forConstruction: true })), 5.85), ">Z")), (100 - 12), (100 - 12), { forConstruction: true })), 5)
  bp = await cq.fillet(await cq.edges(await cq.cutBlind(await cq.rect(await cq.workplane(await cq.faces(bp, ">Z")), (100 - (12 * 2)), (100 - (12 * 2))), (-1.9)), "|Z"), 2)

  return cq.val(bp)
}

async function make_slide_top() {
  let slide_top = await cq.extrude(await cq.rect(await cq.Workplane("XY"), 110, 120), 8)
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
  slide_top = await cq.cutBlind(await cq.rect(await cq.pushPoints(await cq.workplane(await cq.faces(slide_top, ">Z")), cut_centers), slot_x, slot_y), (-depth))
  let hole_positions = [[(-48.3), (-7.5)], [(-48.3), 7.5], [(-28.3), (-7.5)], [(-28.3), 7.5], [28.3, (-7.5)], [28.3, 7.5], [48.3, (-7.5)], [48.3, 7.5]]
  slide_top = await cq.cboreHole(await cq.pushPoints(await cq.workplane(await cq.faces(slide_top, "<Z")), hole_positions), 3, 5.2, 2)
  slide_top = await cq.hole(await cq.center(await cq.workplane(await cq.faces(slide_top, ">Z")), 0, (8 / 2)), 8.2)
  slide_top = await cq.extrude(await cq.rect(await cq.center(await cq.workplane(await cq.faces(slide_top, ">Z"), { centerOption: "CenterOfBoundBox" }), 0, (-((((15 - 8) / 2) + (10 / 2)) + 0.555))), 20, 10), 13.7)
  let hexagon_side = 4.62
  let hexagon_dia = 8
  let hexagon_out = 9.24
  let hex_center_z = ((4.3 - 1.4) / 2)
  slide_top = await cq.cutBlind(await cq.polygon(await cq.center(await cq.workplane(await cq.faces(slide_top, "-Y"), { centerOption: "CenterOfBoundBox" }), 0, hex_center_z), 6, hexagon_out), (-4))
  slide_top = await cq.cutBlind(await cq.polygon(await cq.center(await cq.workplane(await cq.faces(slide_top, "+Y"), { centerOption: "CenterOfBoundBox" }), 0, hex_center_z), 6, hexagon_out), (-4))
  slide_top = await cq.hole(await cq.center(await cq.workplane(await cq.faces(slide_top, "+Y"), { centerOption: "CenterOfBoundBox" }), 0, hex_center_z), 5.3)
  let rect_width = (46 + 0.555)
  let rect_height = (100 + 0.555)
  let square_size = 27.333
  let tool1 = await cq.extrude(await cq.rect(await cq.Workplane("XY"), rect_width, rect_height), 3)
  let tool2 = await cq.translate(await cq.extrude(await cq.rect(await cq.Workplane("XY"), square_size, (square_size + 4)), 3), [(-36.5), (-34.5), 0])
  let tool = await cq.union(tool1, tool2)
  tool = await cq.translate(tool, [0, 4, 0])
  slide_top = await cq.cut(slide_top, tool)

  return cq.val(slide_top)
}

async function make_axk() {
  let rect_width = 100
  let rect_height = 46
  let square_size = ((rect_width - rect_height) / 2)
  let thickness = 10
  let cc = await cq.extrude(await cq.rect(await cq.transformed(await cq.Workplane("XY"), { offset: [(36.5 - 2), 36.5, 0] }), (square_size + 4), square_size), thickness)
  let axk = await cq.extrude(await cq.rect(await cq.Workplane("XY"), 100, 46), thickness)
  axk = await cq.hole(await cq.workplane(await cq.faces(axk, ">Z")), 6.8)
  axk = await cq.cutBlind(await cq.circle(await cq.workplane(await cq.faces(axk, ">Z")), ((28 / 2) + 0.02)), (-4))
  axk = await cq.union(axk, cc)
  axk = await cq.fillet(await cq.edges(axk, "|Z"), 2)
  axk = await cq.hole(await cq.pushPoints(await cq.workplane(await cq.faces(axk, ">Z")), [0, 15, 30, 45, 60, 90, 120].map((a) => [(((100 - 12) / 2) * Math.cos(((a / 2) * Math.PI / 180))), (((100 - 12) / 2) * Math.sin(((a / 2) * Math.PI / 180)))])), 2.49)

  return cq.val(axk)
}

async function make_mb() {
  let mb = await cq.extrude(await cq.rect(await cq.Workplane("XY"), ((100 - (12 * 2)) - 0.1), ((100 - (12 * 2)) - 0.1)), 10)
  mb = await cq.fillet(await cq.edges(await cq.hole(await cq.edges(await cq.rect(await cq.workplane(await cq.faces(await cq.hole(await cq.vertices(await cq.rect(await cq.workplane(await cq.faces(await cq.hole(await cq.workplane(await cq.faces(await cq.cutBlind(await cq.rect(await cq.workplane(await cq.faces(mb, ">Z")), (28 + 0.02), (28 + 0.02)), (-5)), ">Z")), 8.2), ">Z")), 68, 68, { forConstruction: true })), 2.5), ">Z")), 68, 68, { forConstruction: true })), 5.85), "|Z"), 2)

  return cq.val(mb)
}

// Create all parts
let shape_mt = await make_mt()
let shape_tp = await make_tp()
let shape_bp = await make_bp()
let shape_slide_top = await make_slide_top()
let shape_axk = await make_axk()
let shape_mb = await make_mb()


// Build constraints
let c1 = cq.constraint("bp", ">Z", shape_bp, "mb", "<Z", shape_mb, "Plane")
let c2 = cq.constraint("mb", ">Z", shape_mb, "mt", "<Z", shape_mt, "Plane")
let c3 = cq.constraint("mt", ">Z", shape_mt, "tp", ">Z", shape_tp, "Plane")
let c4 = cq.constraint("bp", "<X", shape_bp, "mb", "<X", shape_mb, "Axis")
let c5 = cq.constraint("bp", "<X", shape_bp, "mt", "<X", shape_mt, "Axis")
let c6 = cq.constraint("bp", "<X", shape_bp, "tp", "<X", shape_tp, "Axis")
let c7 = cq.constraint("bp", "<Z", shape_bp, "axk", ">Z", shape_axk, "Plane")
let c8 = cq.constraint("bp", "<X", shape_bp, "axk", "<X", shape_axk, "Axis")

let asm = cq.buildAssembly(
  "mini_lathe",
  [
    { name: "axk", shape: shape_axk, color: [0.3, 0.3, 0.3] },
    { name: "bp", shape: shape_bp, color: [0.8, 0.5, 0.1] },
    { name: "mb", shape: shape_mb, color: [0.1, 0.7, 0.7] },
    { name: "mt", shape: shape_mt, color: [0.0, 0.9, 0.8] },
    { name: "tp", shape: shape_tp, color: [1.0, 0.7, 0.2] },
    { name: "slide_top", shape: shape_slide_top, color: [1.0, 0.7, 0.2] },
  ],
  [c1, c2, c3, c4, c5, c6, c7, c8]
)

let result = asm

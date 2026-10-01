// 用户场景（脚本面）：上传 STL → 识别边倒圆角 → 识别面上草图 → 拉伸 → 融合
//
// 选择器序号（边 9 / 面 4）不是猜的：宿主先把识别出来的边和面展示给用户，用户点选
// 一条边、一张面，编辑器把该条目的序号写进脚本。这里的两处序号对应
// packages/fixtures/data/cube-10x5x5.stl 的真实读数——
//
//   边 9 = 长 20、中点 (0, -5, -5) 的底棱 → 倒圆角碰不到 +Z 顶面
//   面 4 = +Z 顶面、面积 200          → 草图就画在它上面
//
// 注意面 4 是在**倒圆角之后**那份拓扑上读出来的：圆角新增一张面（15 条边 / 7 张面），
// 序号是位置号、随改型重建，所以在 `a` 上读到的顶面序号（6）在 `b` 上已经不作数。
// 该映射由 stl-detect-edit.test.ts 对同一份夹具的拓扑读数逐条断言。
let a = await cad.load({ file: 'cube-10x5x5.stl' })
let b = cad.fillet(a, { edges: [9], radius: 1 })
let s = await cad.sketchOnFace({
  contours: [{ segments: [
    { kind: 'line', x1: -2, y1: -3, x2: 2, y2: -3 },
    { kind: 'line', x1: 2, y1: -3, x2: 2, y2: 3 },
    { kind: 'line', x1: 2, y1: 3, x2: -2, y2: 3 },
    { kind: 'line', x1: -2, y1: 3, x2: -2, y2: -3 },
  ] }],
  on: b,
  face: 4,
})
let p = await cad.extrude(s, 5)
let u = await cad.union(b, p)

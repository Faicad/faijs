/**
 * manifest 慢点定位（brepkit 引擎）——2026-10-23
 *
 * 背景：真机皮卡丘首次执行收尾 postLastFrame=135.6s，node brepkit 同段 12.2s，
 * built(mesh/solid)=14/0（14 终端全部 buildTopologyFromMesh，复用显示 mesh）。
 * 初测结论：裸球（32/64 段）只有 2 面 32 边，manifest ≈ 155-299ms——**不是**瓶颈。
 * 本版扩展：scale3d 非均匀椭球（皮卡丘耳朵 [7,6,20] 等）、box、union 布尔产物——
 * 找出回环里 870ms/终端 的真实来源（嫌疑：非均匀缩放曲面升阶 / 布尔结果高面数）。
 *
 * 链路 = buildAssemblySelectorManifest + buildSelectorRuntime（buildTopologyFromMesh
 * 的完整等价物，含 JS 组装与缓冲构建）。
 */

import { describe, expect, it } from 'vitest'
import { createBrepkitPrimitives, getBrepKitKernel } from '../src/brepkit-kernel/brepkitKernel'
import { buildAssemblySelectorManifest } from '../src/occt-kernel/topologyExt'
import { buildSelectorRuntime } from '../src/topology/build-selector-runtime'

type Api = Awaited<ReturnType<typeof createBrepkitPrimitives>>

function timeSolid(api: Api, label: string, solid: number): void {
  try {
    // 显示参数（与 faijs solidToShape 同源）
    const mesh = api.meshShape(solid, { linearDeflection: 0.1, angularDeflection: (2 * Math.PI) / 64 })
    const faces = api.getSubShapes(solid, 'face')
    const edges = api.getSubShapes(solid, 'edge')
    const tG = Date.now()
    const m = buildAssemblySelectorManifest(api, [{
      labelPath: 'o1',
      shapeHandle: solid,
      meshWithGroups: mesh,
    }])
    const tH = Date.now()
    const runtime = buildSelectorRuntime({
      manifest: m.manifest as never,
      buffers: m.buffers as never,
    }, { scale: 1 })
    const tI = Date.now()
    console.log(
      `[manifest-timing] ${label}: faces=${faces.length} edges=${edges.length} ` +
        `faceGroups=${Math.floor((mesh.faceGroups?.length ?? 0) / 3)} tris=${mesh.triangleCount} ` +
        `manifest=${tH - tG}ms runtime=${tI - tH}ms total=${tI - tG}ms`,
    )
    expect(runtime).toBeTruthy()
  } finally {
    api.release(solid)
  }
}

function timeSolidDetail(api: Api, label: string, solid: number): void {
  try {
    const mesh = api.meshShape(solid, { linearDeflection: 0.1, angularDeflection: (2 * Math.PI) / 64 })
    const tA = Date.now()
    const faces = api.getSubShapes(solid, 'face')
    const edges = api.getSubShapes(solid, 'edge')
    const tB = Date.now()
    // wireframe 规模（嫌疑：非均匀 scale 后边采样点数暴涨）
    const wf = api.wireframe(solid, 0.1)
    const tC = Date.now()
    // edgeRows 段等价循环：每边 curveType/curveLength/curveIsClosed/hashCode/折线提取
    let fec = 0
    const tD0 = Date.now()
    // 段 3 findOrdinal 等价循环：face edge 经 hash lookup + isSame 冲突解决
    const edgeHashLookup = new Map<number, number[]>()
    edges.forEach((e, i) => {
      const h = api.hashCode(e, 2 ** 31 - 1)
      const l = edgeHashLookup.get(h)
      if (l) l.push(i + 1)
      else edgeHashLookup.set(h, [i + 1])
    })
    let ordCalls = 0
    let sameCalls = 0
    for (const f of faces) {
      for (const fe of api.getSubShapes(f, 'edge')) {
        const h = api.hashCode(fe, 2 ** 31 - 1)
        ordCalls++
        for (const ord of edgeHashLookup.get(h) ?? []) {
          if (api.isSame(fe, edges[ord - 1])) { sameCalls++; break }
        }
      }
    }
    const tD = Date.now()
    let curveCalls = 0
    for (const e of edges) {
      api.curveType(e); api.curveLength(e); api.curveIsClosed(e); api.hashCode(e, 2 ** 31 - 1)
      curveCalls += 4
    }
    const tE = Date.now()
    // faceRows 段等价循环：extractFaceGeometry 由 manifest 内部调用；此处只测 surfaceType/hashCode
    const tF0 = Date.now()
    for (const f of faces) {
      api.surfaceType(f); api.hashCode(f, 2 ** 31 - 1)
    }
    const tF = Date.now()
    // 段 6/7 的曲线/曲面参数查询（manifest 内部 getCurveParams/getSurfaceParams 的等价 wasm 调用）
    const tG0 = Date.now()
    for (const e of edges) { api.curveParameters(e) }
    const tG = Date.now()
    for (const f of faces) { api.uvBounds(f) }
    const tH = Date.now()
    // 段 11：getVolume + getCenterOfMass（嫌疑：brepkit 对 transform 后椭球的积分慢）
    const tI0 = Date.now()
    const vol = api.getVolume(solid)
    const com = api.getCenterOfMass(solid)
    const tI = Date.now()
    console.log(
      `[manifest-detail] ${label}: faces=${faces.length} edges=${edges.length} tris=${mesh.triangleCount} ` +
        `wfPoints=${wf.points.length} wfEdgeGroups=${Math.floor((wf.edgeGroups?.length ?? 0) / 3)} ` +
        `enum=${tB - tA}ms wireframe=${tC - tB}ms findOrdinal=${tD - tC}ms(${ordCalls}ord/${sameCalls}same) ` +
        `edgeCurveCalls=${tE - tD}ms(${curveCalls}) faceQuery=${tF - tF0}ms ` +
        `curveParams=${tG - tG0}ms(${edges.length}) uvBounds=${tH - tG}ms(${faces.length}) ` +
        `volCom=${tI - tI0}ms vol=${vol?.toFixed?.(2) ?? vol}`,
    )
  } finally {
    api.release(solid)
  }
}

describe('manifest 慢点定位（brepkit）', () => {
  it('球 / scale 椭球 / box / union 布尔产物：manifest 各段成本', async () => {
    const api = await createBrepkitPrimitives()
    const kernel = getBrepKitKernel()
    expect(kernel).toBeTruthy()

    // 1. 裸球（适配层固定 32 段）
    timeSolid(api, 'sphere r=1(32)', api.makeSphere(1))
    timeSolid(api, 'sphere r=1(64)', kernel.makeSphere(1, 64))

    // 2. 皮卡丘部件：非均匀缩放椭球（scale3d factor [7,6,20] 与 [26,24,28]）
    for (const [fx, fy, fz] of [[7, 6, 20], [26, 24, 28], [11, 14, 7]]) {
      const base = kernel.makeSphere(1, 64)
      // 3×4 行主序非均匀缩放矩阵（faijs transform 契约）
      const scaled = api.transform(base, [fx, 0, 0, 0, 0, fy, 0, 0, 0, 0, fz, 0])
      api.release(base)
      timeSolid(api, `scale([${fx},${fy},${fz}])`, scaled)
      timeSolidDetail(api, `scale([${fx},${fy},${fz}])`, api.copy(scaled))
    }

    // 3. box（尾巴三段之一 8×10×31）
    timeSolid(api, 'box 8x10x31', api.makeBox(8, 10, 31))

    // 4. union 布尔（尾巴：union(box_a, union(box_b, box_c))）
    const mkBox = (w: number, d: number, h: number): number => api.makeBox(w, d, h)
    const b1 = mkBox(8, 10, 31)
    const b2 = mkBox(8, 10, 22)
    const b3 = mkBox(8, 10, 27)
    const u1 = api.fuse(b2, b3)
    const u2 = api.fuse(b1, u1)
    api.release(b1); api.release(b2); api.release(b3); api.release(u1)
    timeSolid(api, 'union(box*3)', u2)
  }, 120_000)
})

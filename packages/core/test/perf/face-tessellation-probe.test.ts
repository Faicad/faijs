/**
 * face.fai.js 三角化探针（性能实验，非 CI 常驻断言）。
 *
 * 用法（packages/core 目录）：
 *   FACE_DEFLECTION=0.1 FACE_ANGULAR=0.196 FACE_RUNS=1 npx vitest run --config vitest.perf.config.ts
 *
 * 环境变量：
 *   FACE_DEFLECTION  linearDeflection（mm），缺省 0.1
 *   FACE_ANGULAR     angularDeflection（rad），缺省不设（= faijs 默认 2π/64）
 *   FACE_TIMING      'eager' | 'defer'（三角化时机，方案 2026-10-21），缺省 'eager'
 *   FACE_RUNS        执行轮次，缺省 1（每轮约 30-70s）
 *
 * 输出：每轮 execute 耗时 + 每个终端（outputs 逐 part）的顶点/三角数，
 * 用于评估「增大 deflection 缓解 scale3d 三角化膨胀」的几何与耗时收益。
 *
 * ⚠️ 2026-10-21 实测结论（两版探针 + bundle 对拍）：
 * - **brepkit 忽略 linearDeflection**：0.1/0.3/0.5 三档几何逐字节一致（head 7908 /
 *   ear 32164 / human_face 36214，与端侧 bundle 完全一致）；scale3d 膨胀（未缩放球
 *   482 → 缩放椭球 32164 顶点）不受 linearDeflection 影响。
 * - 有效旋钮是 **angularDeflection**（默认 2π/64）；报告 §2.1 "默认 angular=0.5 rad"
 *   与 §3 "增大 deflection" 均不成立（真默认 2π/64；deflection 无效）。
 * - 基本体的 angular 由显式 `segments` 决定（2π/segments），全局 angular 只影响
 *   变换/布尔结果的 solidToShape 路径（scale3d/translate/subtract/union 产出）。
 */
import { describe, it, expect } from 'vitest'
import { createRuntime } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs/node'
import type { Shape } from '@faicad/faijs/mesh/types'

const FACE_SCRIPT = `// ===== 3D 人脸：以球体为基础 =====
let head = cad.sphere({ radius: 10 * MM, segments: 64 })
head = cad.scale3d(head, { factor: [0.9, 1.0, 1.15] })
head.setColor('#F2C49B')
let eye_socket_left = cad.sphere({ radius: 2.4 * MM, segments: 32 })
eye_socket_left = cad.scale3d(eye_socket_left, { factor: [1, 0.7, 1] })
eye_socket_left = cad.translate(eye_socket_left, { offset: [-3.6 * MM, 8.0 * MM, 3.2 * MM] })
let eye_socket_right = cad.sphere({ radius: 2.4 * MM, segments: 32 })
eye_socket_right = cad.scale3d(eye_socket_right, { factor: [1, 0.7, 1] })
eye_socket_right = cad.translate(eye_socket_right, { offset: [3.6 * MM, 8.0 * MM, 3.2 * MM] })
let mouth_cut = cad.sphere({ radius: 1.6 * MM, segments: 32 })
mouth_cut = cad.scale3d(mouth_cut, { factor: [2.2, 1.4, 0.55] })
mouth_cut = cad.translate(mouth_cut, { offset: [0, 8.2 * MM, -3.6 * MM] })
let head_carved = cad.subtract(head, eye_socket_left, eye_socket_right, mouth_cut)
let eyeball_left = cad.sphere({ radius: 1.5 * MM, segments: 32 })
eyeball_left = cad.translate(eyeball_left, { offset: [-3.6 * MM, 8.2 * MM, 3.2 * MM] })
eyeball_left.setColor('#FFFFFF')
let eyeball_right = cad.sphere({ radius: 1.5 * MM, segments: 32 })
eyeball_right = cad.translate(eyeball_right, { offset: [3.6 * MM, 8.2 * MM, 3.2 * MM] })
eyeball_right.setColor('#FFFFFF')
let pupil_left = cad.sphere({ radius: 0.55 * MM, segments: 24 })
pupil_left = cad.translate(pupil_left, { offset: [-3.6 * MM, 9.6 * MM, 3.2 * MM] })
pupil_left.setColor('#1A1A1A')
let pupil_right = cad.sphere({ radius: 0.55 * MM, segments: 24 })
pupil_right = cad.translate(pupil_right, { offset: [3.6 * MM, 9.6 * MM, 3.2 * MM] })
pupil_right.setColor('#1A1A1A')
let nose = cad.cone({ radiusBottom: 1.8 * MM, radiusTop: 0.5 * MM, height: 3.2 * MM, segments: 48 })
nose = cad.rotate_euler(nose, { angles: [-90 * DEGREE, 0, 0] })
nose = cad.translate(nose, { offset: [0, 9.0 * MM, 0.5 * MM] })
nose.setColor('#F2C49B')
let ear_left = cad.sphere({ radius: 2 * MM, segments: 32 })
ear_left = cad.scale3d(ear_left, { factor: [0.35, 0.9, 1.3] })
ear_left = cad.translate(ear_left, { offset: [-8.8 * MM, 0, 1.0 * MM] })
ear_left.setColor('#F2C49B')
let ear_right = cad.sphere({ radius: 2 * MM, segments: 32 })
ear_right = cad.scale3d(ear_right, { factor: [0.35, 0.9, 1.3] })
ear_right = cad.translate(ear_right, { offset: [8.8 * MM, 0, 1.0 * MM] })
ear_right.setColor('#F2C49B')
let human_face = cad.union(head_carved, eyeball_left, eyeball_right, pupil_left, pupil_right, nose, ear_left, ear_right)
human_face.setName("3D人脸")`

function deflectionFromEnv(): number {
  const raw = process.env.FACE_DEFLECTION
  const v = raw ? Number(raw) : 0.1
  if (!Number.isFinite(v) || v <= 0) throw new Error(`FACE_DEFLECTION 非法: ${raw}`)
  return v
}

function angularFromEnv(): number | undefined {
  const raw = process.env.FACE_ANGULAR
  if (raw === undefined || raw === '') return undefined
  const v = Number(raw)
  if (!Number.isFinite(v) || v <= 0) throw new Error(`FACE_ANGULAR 非法: ${raw}`)
  return v
}

function timingFromEnv(): 'eager' | 'defer' {
  const raw = process.env.FACE_TIMING
  if (raw === undefined || raw === '') return 'eager'
  if (raw !== 'eager' && raw !== 'defer') throw new Error(`FACE_TIMING 非法: ${raw}`)
  return raw
}

function runsFromEnv(): number {
  const raw = process.env.FACE_RUNS
  const v = raw ? Number(raw) : 1
  if (!Number.isFinite(v) || v <= 0) throw new Error(`FACE_RUNS 非法: ${raw}`)
  return v
}

function topoFromEnv(): 'auto' | 'off' | 'brep' {
  const raw = process.env.FACE_TOPO
  if (raw === undefined || raw === '') return 'auto'
  if (raw !== 'auto' && raw !== 'off' && raw !== 'brep') throw new Error(`FACE_TOPO 非法: ${raw}`)
  return raw
}

describe('face tessellation deflection probe', () => {
  it('runs face.fai.js and reports timing + per-part geometry', async () => {
    const linearDeflection = deflectionFromEnv()
    const angularDeflection = angularFromEnv()
    const timing = timingFromEnv()
    const runs = runsFromEnv()
    const topo = topoFromEnv()
    // 引擎装配在 setup-perf.ts（只注册 brepkit → 默认 = 端侧引擎）；这里不再注册。
    // angular 缺省保持 faijs 默认 2π/64 rad（≈5.6°）。实测（2026-10-21）：brepkit
    // **忽略 linearDeflection**（0.1/0.3/0.5 几何逐字节一致）；有效旋钮是 angular。
    const rt = createRuntime(createNodePorts(), topo as 'auto' | 'brep', undefined, {
      execBackend: 'interpreter',
      ...(timing === 'defer' ? { tessellationTiming: 'defer' } : {}),
      tessellation: {
        linearDeflection,
        ...(angularDeflection !== undefined ? { angularDeflection } : {}),
      },
    })
    // meshShape 调用统计（包一层，不改内核）：计数 + 累计耗时，定位 defer 慢因。
    const { getActiveBrepEngine } = await import('@faicad/faijs/brep/engine/registry')
    const engine = await getActiveBrepEngine()
    const kernel = engine.primitives as unknown as Record<string, unknown>
    const origMeshShape = kernel['meshShape'] as (...a: unknown[]) => unknown
    let meshShapeCount = 0
    let meshShapeMs = 0
    kernel['meshShape'] = function (this: unknown, ...args: unknown[]) {
      const t = Date.now()
      const r = origMeshShape.apply(this, args)
      meshShapeMs += Date.now() - t
      meshShapeCount++
      return r
    }

    const timings: number[] = []
    let lastTerminals = 0
    let lastFaceVerts = 0
    for (let i = 0; i < runs; i++) {
      meshShapeCount = 0
      meshShapeMs = 0
      const t0 = Date.now()
      const res = await rt.execute(FACE_SCRIPT)
      const ms = Date.now() - t0
      timings.push(ms)
      lastTerminals = res.terminals.length
      const humanFace = res.outputs.get('human_face' as never)
      if (humanFace) {
        const s = humanFace as unknown as Shape
        lastFaceVerts = s.positions ? s.positions.length / 3 : 0
      }
      console.log(
        `[probe] timing=${timing} topo=${topo} linear=${linearDeflection} angular=${angularDeflection ?? 'default(2π/64)'} run#${i + 1}: ${ms}ms 终端=${lastTerminals} human_face 顶点=${lastFaceVerts} meshShape调用=${meshShapeCount} meshShape耗时=${meshShapeMs}ms`,
      )
      if (i === 0) {
        for (const [name, shape] of res.outputs) {
          const s = shape as unknown as Shape
          if (!s.positions) continue
          console.log(
            `[probe]    ${String(name)}: 顶点=${s.positions.length / 3} 三角=${s.indices ? s.indices.length / 3 : 0}`,
          )
        }
      }
    }
    timings.sort((a, b) => a - b)
    console.log(
      `[probe] timing=${timing} topo=${topo} linear=${linearDeflection} angular=${angularDeflection ?? 'default(2π/64)'} ${runs} 轮: min=${timings[0]} median=${timings[Math.floor(timings.length / 2)]} max=${timings[timings.length - 1]}`,
    )
    expect(lastTerminals).toBe(13)
  })
})

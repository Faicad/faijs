/**
 * faijs demo — main logic
 *
 * Layout: left editor + Run button, right two stacked 3D viewers
 * (top: brep mode, bottom: mesh mode). Run executes the script in
 * both modes in parallel and renders each result in its own viewer.
 *
 * Flow:
 * 1. User edits faijs source code in the textarea
 * 2. Click "Run" → createRuntime ×2 (brep + mesh) → runtime.execute(code) for each
 * 3. Extract terminal shapes from each result, render into the matching viewer
 */

import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { createRuntime, createBrowserPorts, setOcctWasmInitFn, ensureOcctKernel, exportStepFromSolid, exportStep, buildStlBufferFromMesh, deriveNormals, setManifoldWasmUrl, isMeshShape } from '@faicad/faijs/browser'
import type { ExecutionMode, HostPorts, ShapeHandle, OcctKernel, ExecutionResult, LibLoader, StdlibNamespace } from '@faicad/faijs/browser'
import { OcctKernel as OcctKernelValue } from 'occt-wasm'
import fontUrl from './assets/fonts/OpenSans-Regular.ttf?url'
// P 四（4.4）：gear-lib-demo 静态引用——供 LIB_MODULES 映射表引用 + 打包。
// Vite/Rollup 对变量参数 import(packageName) 做不了静态分析，必须静态字面量。
import * as gearLib from '@faicad/gear-lib-demo'
import * as sheetmetalLib from '@faicad/sheetmetal'

// ── 浏览器 libLoader（自动装载注册表） ──
// key 必须与 registerLib 的 packageName（即脚本 import specifier）严格一致：
// demo 走自动加载主链路，gear-demo 只有 specifier 与 key 完全一致才能运行；
// 不一致 → 自动装载失败 → 显式报错（正是本方案根治的「名字不符却能跑」bug 形态）。
// value 必须是静态字面量 specifier，Vite/Rollup 才能静态分析打包。
const LIB_MODULES: Record<string, () => Promise<StdlibNamespace>> = {
  // 静态 import * as gearLib 已引用并参与打包；此处返回同一命名空间。
  // 断言：gear 包 exports 形状满足 StdlibNamespace（加载后由 libLoader 契约收口）。
  'gear-lib-demo': async () => gearLib as unknown as StdlibNamespace,
  // sheetmetal：与 gear-lib-demo 同理，静态 import 参与打包，运行时返回命名空间。
  'sheetmetal': async () => sheetmetalLib as unknown as StdlibNamespace,
}

const demoLibLoader: LibLoader = {
  loadLib: async (name) => {
    const loader = LIB_MODULES[name]
    if (!loader) throw new Error(`[faijs] demo: unregistered library "${name}"`)
    return await loader()
  },
  listLibs: () => Object.keys(LIB_MODULES),
  options: { autoLift: true },
}

// ── Example .fai.js files ──

const EXAMPLES: Record<string, string> = {
  'box-boolean': `let part0 = cad.box(20, 20, 20, { centered: true })
let part1 = cad.sphere({ radius: 8, center: [5, 0, 0] })
let part2 = cad.subtract(part0, part1)`,
  'drill-test': `let part0 = cad.box(30, 20, 15, { centered: true })
let part1 = cad.cylinder(5, 20, { centered: true, at: [0, 0, 0] })
let part2 = cad.subtract(part0, part1)
part2 = cad.translate(part2, { offset: [10, 0, 0] })`,
  'text-engrave': `let part0 = cad.box(30, 30, 30, { centered: true })
part0 = cad.translate(part0, { offset: [0, 0, 14] })
let part1 = cad.text(part0, { text: 'HELLO', size: 8, depth: 2 })`,
  'transform-chain': `let part0 = cad.box(20, 10, 5, { centered: true })
part0 = cad.rotate_euler(part0, { anglesDeg: [0, 0, 30] })
part0 = cad.translate(part0, { offset: [5, 0, 0] })
part0 = cad.scale3d(part0, { factor: [1, 1, 2] })`,
  'gear-demo': `import * as gear from 'gear-lib-demo'

let g1 = gear.external({ teeth: 24, moduleSize: 2, thickness: 8, bore: 8 })
let t1 = gear.thread({ radius: 5, pitch: 1, height: 20 })
let u1 = cad.union(g1, t1)`,
  'sheetmetal-demo': `import * as sm from 'sheetmetal'

let part = sm.author({
  thickness: 1,
  base: { length: 40, width: 30 },
  flanges: [
    { id: 'fx', length: 15, angleDeg: 90, rule: { innerRadius: 2, kFactor: 0.44 }, side: 'xmax' },
    { id: 'fy', length: 15, angleDeg: 90, rule: { innerRadius: 2, kFactor: 0.44 }, side: 'ymax' },
  ],
})
let s1 = sm.solidOf(part)`,
}

// ── DOM elements ──

const codeEditor = document.getElementById('code-editor') as HTMLTextAreaElement
const runBtn = document.getElementById('run-btn') as HTMLButtonElement
const openBtn = document.getElementById('open-btn') as HTMLButtonElement
const fileInput = document.getElementById('file-input') as HTMLInputElement
const exampleSelect = document.getElementById('example-select') as HTMLSelectElement
const statusBar = document.getElementById('status-bar') as HTMLDivElement
const btnStep = document.getElementById('btn-step') as HTMLButtonElement
const btnStl = document.getElementById('btn-stl') as HTMLButtonElement

// ── 3D viewer factory ──

interface Viewer3D {
  mode: ExecutionMode
  canvas: HTMLCanvasElement
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  controls: OrbitControls
  meshGroup: THREE.Group
  // 最近一次成功运行的结果（供导出按钮使用）
  lastShapes?: Array<{ id: string; positions: Float32Array; indices: Uint32Array }>
  lastBrepSolid?: { solid: ShapeHandle; kernel: OcctKernel }
}

function createViewer(canvas: HTMLCanvasElement, mode: ExecutionMode): Viewer3D {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x0d0d1a)

  // faijs 产出的 CAD 数据是 Z-up（与 3d_editor 一致），
  // three.js 场景同步为 Z-up：不转数据，只设 up 轴
  scene.up.set(0, 0, 1)

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000)
  // Y-up 视角 (30, 25, 35) → Z-up：绕 X +90°（(x,y,z) → (x,-z,y)）
  camera.position.set(30, -35, 25)
  camera.up.set(0, 0, 1)
  camera.lookAt(0, 0, 0)

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(window.devicePixelRatio)

  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.dampingFactor = 0.08

  // Lighting
  const ambientLight = new THREE.AmbientLight(0x404060, 1.5)
  scene.add(ambientLight)

  const dirLight = new THREE.DirectionalLight(0xffffff, 1.2)
  dirLight.position.set(20, 30, 20)
  scene.add(dirLight)

  const dirLight2 = new THREE.DirectionalLight(0x8899ff, 0.5)
  dirLight2.position.set(-15, 10, -15)
  scene.add(dirLight2)

  // Grid helper（Z-up 地面为 XY 平面，GridHelper 默认在 XZ 平面需旋转）
  const grid = new THREE.GridHelper(100, 20, 0x333355, 0x222244)
  grid.rotation.x = Math.PI / 2
  scene.add(grid)

  // Axes helper
  const axes = new THREE.AxesHelper(15)
  scene.add(axes)

  // Mesh group (cleared and refilled on each run)
  const meshGroup = new THREE.Group()
  scene.add(meshGroup)

  return { mode, canvas, scene, camera, renderer, controls, meshGroup }
}

const brepView = createViewer(document.getElementById('canvas-brep') as HTMLCanvasElement, 'brep')
const meshView = createViewer(document.getElementById('canvas-mesh') as HTMLCanvasElement, 'mesh')
const viewers: Viewer3D[] = [brepView, meshView]

// ── Resize handling ──

function resize() {
  for (const view of viewers) {
    const container = view.canvas.parentElement!
    const w = container.clientWidth
    const h = container.clientHeight
    view.renderer.setSize(w, h, false)
    view.camera.aspect = w / h
    view.camera.updateProjectionMatrix()
  }
}

window.addEventListener('resize', resize)
resize()

// ── Animation loop ──

function animate() {
  requestAnimationFrame(animate)
  for (const view of viewers) {
    view.controls.update()
    view.renderer.render(view.scene, view.camera)
  }
}
animate()

// ── Status bar helpers ──

function setStatus(text: string, kind: 'info' | 'success' | 'error' = 'info') {
  statusBar.textContent = text
  statusBar.className = 'status-bar ' + kind
}

// ── Render shapes ──

function clearMeshes(view: Viewer3D) {
  for (const child of view.meshGroup.children) {
    view.meshGroup.remove(child)
    if (child instanceof THREE.Mesh) {
      child.geometry?.dispose()
      const mat = child.material
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
      else mat?.dispose()
    }
  }
}

function renderShapes(view: Viewer3D, shapes: Array<{ id: string; positions: Float32Array; indices: Uint32Array }>) {
  clearMeshes(view)

  for (const shape of shapes) {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(shape.positions, 3))
    geo.setIndex(new THREE.BufferAttribute(shape.indices, 1))
    // Derive creased normals so sharp edges stay sharp. The old
    // computeVertexNormals() averaged normals on the welded shared-vertex
    // topology of manifold (mesh chain) results and rounded edges off — the
    // same root cause fixed in 3d_editor (ba5e6441). deriveNormals uses
    // toCreasedNormals: only faces meeting at more than the crease angle get
    // per-face normals, so curved surfaces stay smooth.
    const finalGeo = deriveNormals(geo)
    geo.dispose()

    const material = new THREE.MeshStandardMaterial({
      color: 0x4a90d9,
      metalness: 0.15,
      roughness: 0.65,
      flatShading: false,
    })

    const mesh = new THREE.Mesh(finalGeo, material)
    mesh.castShadow = true
    mesh.receiveShadow = true
    view.meshGroup.add(mesh)
  }

  // Auto-frame camera to fit the meshes
  if (view.meshGroup.children.length > 0) {
    const box = new THREE.Box3().setFromObject(view.meshGroup)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z)
    const dist = maxDim * 2.2 + 5
    // Z-up：高度分量放在 Z 轴，俯视 45°
    view.camera.position.set(dist, -dist, dist * 0.7)
    view.controls.target.copy(center)
    view.controls.update()
  }
}

// ── Run faijs code ──

// OCCT kernel 首次初始化需从 CDN 下载 ~22MB wasm，耗时较长。
// 页面加载即后台预热，runCode 等待同一个 promise，避免状态卡在 "Executing..."
let occtReady: Promise<void> | null = null

function preloadOcct() {
  if (occtReady) return
  setStatus('Loading OCCT kernel (~22MB, first run only)...', 'info')
  occtReady = ensureOcctKernel().then(() => {}).catch((err) => {
    occtReady = null // 失败后允许下次重试
    const msg = err instanceof Error ? err.message : String(err)
    setStatus(`OCCT kernel failed: ${msg}`, 'error')
    throw err
  })
}

type ShapeSummary = { id: string; positions: Float32Array; indices: Uint32Array }

function extractShapes(result: ExecutionResult): ShapeSummary[] {
  const shapes: ShapeSummary[] = []

  if (result.terminals.length > 0) {
    for (const terminal of result.terminals) {
      // keep-syntax：布尔源（box/sphere）等以 hidden 终端保留在场景里但不渲染
      // （Demo 与 3d_editor 的 setNodeVisible(!terminal.hidden) 语义一致，契约 §9）。
      // 渲染/统计只数可见终端——box-boolean 仅 subtract 显示 → 1 shape(s)。
      if (terminal.hidden) continue
      const shape = result.outputs.get(terminal.id)
      if (shape && isMeshShape(shape) && shape.positions.length > 0) {
        shapes.push({ id: terminal.id, positions: shape.positions, indices: shape.indices })
      }
    }
  } else {
    // No explicit terminals — use last statement output
    const outputs = Array.from(result.outputs.entries())
    if (outputs.length > 0) {
      const last = outputs[outputs.length - 1]
      if (isMeshShape(last[1]) && last[1].positions.length > 0) {
        shapes.push({ id: last[0], positions: last[1].positions, indices: last[1].indices })
      }
    }
  }

  return shapes
}

async function runMode(
  view: Viewer3D,
  code: string,
  ports: HostPorts,
): Promise<string> {
  const runtime = createRuntime(ports, view.mode)
  const result = await runtime.execute(code)

  if (result.failedAt) {
    clearMeshes(view)
    view.lastShapes = undefined
    view.lastBrepSolid = undefined
    return `Failed at op "${result.failedAt.op}": ${result.failedAt.message}`
  }

  const shapes = extractShapes(result)

  if (shapes.length === 0) {
    clearMeshes(view)
    view.lastShapes = undefined
    view.lastBrepSolid = undefined
    return 'No geometry produced.'
  }

  renderShapes(view, shapes)
  view.lastShapes = shapes
  // brepSolids 是逐终端的 Map（E13 起由 ExecutionResult 携带）；
  // demo 的 STEP 导出只需任一终端 solid，取第一个即可
  view.lastBrepSolid = result.brepSolids?.values().next().value

  const totalVerts = shapes.reduce((s, sh) => s + sh.positions.length / 3, 0)
  const totalTris = shapes.reduce((s, sh) => s + sh.indices.length / 3, 0)
  return `${shapes.length} shape(s), ${totalVerts} verts, ${totalTris} triangles`
}

async function runCode() {
  const code = codeEditor.value

  runBtn.disabled = true
  // 新一次运行开始前禁用导出按钮，成功产出后再启用
  btnStep.disabled = true
  btnStl.disabled = true
  setStatus('Parsing...', 'info')

  try {
    // 每个模式各自 execute(code)（公共文本 API；引擎内部 parse）。libLoader 注入
// HostPorts——gear-demo 的 import specifier 由 execute 阶段自动装载，无需手动 registerLib。
    const [portsBrep, portsMesh] = await Promise.all([
      createBrowserPorts({ fontUrl, libLoader: demoLibLoader }),
      createBrowserPorts({ fontUrl, libLoader: demoLibLoader }),
    ])

    // 公共校验 API（宿主规范用法）：parse + 符号/引用预检，零几何副作用。
    // 无效代码在此直接以 Error 呈现，不进执行流程（避免误报 "OK"）。
    const checkResult = createRuntime(portsMesh, 'auto').check(code)
    if (!checkResult.ok) {
      const first = checkResult.errors[0]
      setStatus(
        `Error: ${first?.message ?? 'invalid faijs source'}${first?.line != null ? ` (line ${first.line})` : ''}`,
        'error',
      )
      return
    }

    setStatus('Executing (brep + mesh)...', 'info')

    // 两条链路**串行**执行（不再并发）：
    // 引擎契约（2026-08-29-engine-library-contract.md §O7）把后端环境装配为
    // **模块级单例**（stdlib 经 getBackends() 读取，runtime-state.ts），同一执行
    // 环境里同时存在两个 CadRuntime（brep/mesh 不同 mode）时，后构造的 runtime
    // 会 overwrite 全局 backends → 先跑的 mesh 链读到 brep 配置而它的 BREP 链
    // 尚未初始化 → `[stdlib/box] no OCCT kernel`。多实例并发在契约范围外。
    // 顺序：先 mesh（只依赖 manifold，快），再等 OCCT 后 brep——视觉上仍保持
    // "mesh 视图先出模型、brep 视图随后补齐"，只是不再两条同时跑。
    const meshReport = await (async () => {
      try {
        return await runMode(meshView, code, portsMesh)
      } catch (err) {
        // mesh 后端失败不影响 brep 结果
        const msg = err instanceof Error ? err.message : String(err)
        return `Mesh unavailable: ${msg}`
      }
    })()

    const brepReport = await (async () => {
      try {
        if (occtReady) {
          setStatus('Waiting for OCCT kernel (~22MB)...', 'info')
          await occtReady
        }
        return await runMode(brepView, code, portsBrep)
      } catch (err) {
        // OCCT 失败只影响 brep 链路，不拖累 mesh 结果
        const msg = err instanceof Error ? err.message : String(err)
        return `BREP unavailable: ${msg}`
      }
    })()

    setStatus(`OK — brep: ${brepReport} | mesh: ${meshReport}`, 'success')

    // 成功且产出几何时才开放导出（导出格式由用户主动选择）：
    // - STEP：有 BREP solid → 精确 STEP；无 solid → 三角化 STEP
    // - STL：mesh 三角化数据
    btnStep.disabled = !(brepView.lastShapes && brepView.lastShapes.length > 0)
    btnStl.disabled = !(meshView.lastShapes && meshView.lastShapes.length > 0)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    setStatus(`Error: ${msg}`, 'error')
    console.error(err)
  } finally {
    // 记录本次运行内容；Run 按钮置灰状态由 syncRunBtnState 按内容是否变化决定
    lastRunCode = code
    syncRunBtnState()
  }
}

// ── Export downloads ──

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// 合并多个终端 shape 的三角化数据为单一 mesh（顶点去重不做，直接拼接）
function mergeShapes(shapes: Array<{ positions: Float32Array; indices: Uint32Array }>): { positions: Float32Array; indices: Uint32Array } {
  const vertCount = shapes.reduce((n, s) => n + s.positions.length / 3, 0)
  const triCount = shapes.reduce((n, s) => n + s.indices.length / 3, 0)
  const positions = new Float32Array(vertCount * 3)
  const indices = new Uint32Array(triCount * 3)

  let vo = 0
  let io = 0
  for (const shape of shapes) {
    positions.set(shape.positions, vo * 3)
    for (let i = 0; i < shape.indices.length; i++) {
      indices[io + i] = shape.indices[i] + vo
    }
    vo += shape.positions.length / 3
    io += shape.indices.length
  }

  return { positions, indices }
}

// STEP：导出格式由用户主动选择（不因 BREP 链状态禁用）。
// 有 BREP solid → 精确 STEP（ADVANCED_FACE）；无 solid → 三角化 STEP。
btnStep.addEventListener('click', () => {
  const shapes = brepView.lastShapes
  if (!shapes || shapes.length === 0) return

  const solid = brepView.lastBrepSolid
  if (solid) {
    const buffer = exportStepFromSolid(solid.solid, solid.kernel)
    downloadBlob(new Blob([buffer], { type: 'model/step' }), 'faijs-model.step')
  } else {
    const merged = mergeShapes(shapes)
    const stepText = exportStep(merged)
    downloadBlob(new Blob([stepText], { type: 'model/step' }), 'faijs-model.step')
  }
})

// STL：合并所有终端 shape 的三角化数据导出 binary STL
btnStl.addEventListener('click', () => {
  const shapes = meshView.lastShapes
  if (!shapes || shapes.length === 0) return

  const merged = mergeShapes(shapes)
  const buffer = buildStlBufferFromMesh(merged.positions, merged.indices)
  downloadBlob(new Blob([buffer], { type: 'model/stl' }), 'faijs-model.stl')
})

// ── Event handlers ──

// 最近一次打开的本地文件（内容+文件名），下拉框切回 __file__ 时恢复
let loadedFile: { name: string; content: string } | null = null

// 最近一次运行（或加载后自动运行）的代码内容；
// Run 按钮仅在编辑器内容与它不同（即用户手动修改过）时可用
let lastRunCode: string | null = null

// Run 按钮状态：代码加载后无变化 → 置灰；用户手动修改 → 恢复可用
function syncRunBtnState() {
  runBtn.disabled = lastRunCode === codeEditor.value
}

runBtn.addEventListener('click', runCode)

exampleSelect.addEventListener('change', () => {
  const key = exampleSelect.value
  if (key === '__file__') {
    if (loadedFile) {
      codeEditor.value = loadedFile.content
      runCode()
    }
    return
  }
  if (EXAMPLES[key]) {
    codeEditor.value = EXAMPLES[key]
    runCode()
  }
})

// Open a local .fai.js file → load its source and run immediately
openBtn.addEventListener('click', () => fileInput.click())

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0]
  fileInput.value = '' // allow re-selecting the same file later
  if (!file) return

  if (!file.name.toLowerCase().endsWith('.fai.js')) {
    setStatus(`Error: "${file.name}" is not a .fai.js file`, 'error')
    return
  }

  try {
    const text = await file.text()
    loadedFile = { name: file.name, content: text }
    codeEditor.value = text
    const fileOption = exampleSelect.querySelector<HTMLOptionElement>('option[value="__file__"]')
    if (fileOption) fileOption.textContent = file.name
    exampleSelect.value = '__file__'
    await runCode()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    setStatus(`Error reading file: ${msg}`, 'error')
  }
})

// 用户手动修改代码 → 与最近一次运行内容不同 → Run 按钮恢复可用
codeEditor.addEventListener('input', syncRunBtnState)

// Ctrl+Enter to run（仅当 Run 按钮可用，即代码被手动修改过）
codeEditor.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault()
    if (!runBtn.disabled) runCode()
  }
})

// ── Initialize ──

// OCCT kernel is required by BREP ops — let faijs use occt-wasm's browser init.
// dev：wasm 走本地 node_modules 文件（vite dev server 直接 serve）；
// build：走 jsdelivr CDN（与 importmap 版本一致）。
// 注意：demo 与 faijs 各有一份 occt-wasm（#private 成员导致名义类型不兼容），
// 运行时两副本同版本同 API，此处以 faijs 期望的签名断言
const initOcct = (() =>
  OcctKernelValue.init({
    wasm: import.meta.env.DEV
      ? '/wasm/occt-wasm.wasm'
      : 'https://cdn.jsdelivr.net/npm/occt-wasm@3.8.4/dist/occt-wasm.wasm',
  })) as unknown as () => Promise<never>
setOcctWasmInitFn(initOcct)

// Manifold WASM：经 faijs 的 manifold-loader 单一挂点指定（Worker/Inline 后端共用）。
// 注意：manifold.wasm 位于包根（lib/ 下没有该文件），dev 与 CDN 路径均指向包根。
// 必须在 faijs 首次加载 manifold 模块前调用（本模块顶层即早于运行时动态 import）。
setManifoldWasmUrl(
  import.meta.env.DEV
    ? '/wasm/manifold.wasm'
    : 'https://cdn.jsdelivr.net/npm/manifold-3d@3.5.1/manifold.wasm',
)

codeEditor.value = EXAMPLES['box-boolean']

// 预热 OCCT kernel（首次 ~22MB 下载），然后自动执行
preloadOcct()
void runCode()
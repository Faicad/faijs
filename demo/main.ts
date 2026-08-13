/**
 * faijs demo — main logic
 *
 * Layout: left editor + Run button, right two stacked 3D viewers
 * (top: brep mode, bottom: mesh mode). Run executes the script in
 * both modes in parallel and renders each result in its own viewer.
 *
 * Flow:
 * 1. User edits faijs source code in the textarea
 * 2. Click "Run" → parseScript(code) → createRuntime ×2 (brep + mesh) → replay both
 * 3. Extract terminal shapes from each result, render into the matching viewer
 */

import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { parseScript, ParseError, createRuntime, createBrowserPorts, setOcctWasmInitFn, initOcctWasm } from '@faicad/faijs/browser'
import type { ExecutionMode } from '@faicad/faijs/browser'
import { OcctKernel } from 'occt-wasm'
import { setWasmUrl as setManifoldWasmUrl } from 'manifold-3d/lib/wasm.js'
import fontUrl from './assets/fonts/OpenSans-Regular.ttf?url'

// ── Example .faijs files ──

const EXAMPLES: Record<string, string> = {
  'box-boolean': `// apiVersion: 1
export default async (cad) => {
  const part0_v0 = cad.box({ size: 20 })
  const part0_v1 = cad.sphere({ radius: 8, center: [5, 0, 0] })
  const part0_v2 = cad.subtract(part0_v0, part0_v1)
  return { shape: part0_v2, name: 'box-boolean' }
}`,
  'drill-test': `// apiVersion: 1
export default async (cad) => {
  const part0_v0 = cad.box({ size: [30, 20, 15] })
  const part0_v1 = cad.cylinder({ radius: 5, height: 20, center: [0, 0, 0] })
  const part0_v2 = cad.subtract(part0_v0, part0_v1)
  const part0_v3 = cad.translate({ offset: [10, 0, 0] }, part0_v2)
  return { shape: part0_v3, name: 'drill-test' }
}`,
  'text-engrave': `// apiVersion: 1
export default async (cad) => {
  const part0_v0 = cad.box({ size: 30 })
  const part0_v1 = cad.translate({ offset: [0, 0, 14] }, part0_v0)
  const part0_v2 = cad.text({ text: 'HELLO', size: 8, depth: 2 }, part0_v1)
  return { shape: part0_v2, name: 'text-engrave' }
}`,
  'transform-chain': `// apiVersion: 1
export default async (cad) => {
  const part0_v0 = cad.box({ size: [20, 10, 5] })
  const part0_v1 = cad.rotate({ angles: [0, 0, 30] }, part0_v0)
  const part0_v2 = cad.translate({ offset: [5, 0, 0] }, part0_v1)
  const part0_v3 = cad.scale({ factor: [1, 1, 2] }, part0_v2)
  return { shape: part0_v3, name: 'transform-chain' }
}`,
}

// ── DOM elements ──

const codeEditor = document.getElementById('code-editor') as HTMLTextAreaElement
const runBtn = document.getElementById('run-btn') as HTMLButtonElement
const exampleSelect = document.getElementById('example-select') as HTMLSelectElement
const statusBar = document.getElementById('status-bar') as HTMLDivElement

// ── 3D viewer factory ──

interface Viewer3D {
  mode: ExecutionMode
  canvas: HTMLCanvasElement
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  controls: OrbitControls
  meshGroup: THREE.Group
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
    geo.computeVertexNormals()

    const material = new THREE.MeshStandardMaterial({
      color: 0x4a90d9,
      metalness: 0.15,
      roughness: 0.65,
      flatShading: false,
    })

    const mesh = new THREE.Mesh(geo, material)
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
  occtReady = initOcctWasm().then(() => {}).catch((err) => {
    occtReady = null // 失败后允许下次重试
    const msg = err instanceof Error ? err.message : String(err)
    setStatus(`OCCT kernel failed: ${msg}`, 'error')
    throw err
  })
}

type ShapeSummary = { id: string; positions: Float32Array; indices: Uint32Array }

function extractShapes(result: Awaited<ReturnType<ReturnType<typeof createRuntime>['replay']>>): ShapeSummary[] {
  const shapes: ShapeSummary[] = []

  if (result.terminals.length > 0) {
    for (const terminal of result.terminals) {
      const shape = result.outputs.get(terminal.id)
      if (shape && shape.positions.length > 0) {
        shapes.push({ id: terminal.id, positions: shape.positions, indices: shape.indices })
      }
    }
  } else {
    // No explicit terminals — use last statement output
    const outputs = Array.from(result.outputs.entries())
    if (outputs.length > 0) {
      const last = outputs[outputs.length - 1]
      if (last[1].positions.length > 0) {
        shapes.push({ id: last[0], positions: last[1].positions, indices: last[1].indices })
      }
    }
  }

  return shapes
}

async function runMode(
  view: Viewer3D,
  script: ReturnType<typeof parseScript>['script'],
  ports: ReturnType<typeof createBrowserPorts>,
): Promise<string> {
  const runtime = createRuntime(ports, view.mode)
  const result = await runtime.replay(script)

  if (result.failedAt) {
    clearMeshes(view)
    return `Failed at op "${result.failedAt.op}": ${result.failedAt.message}`
  }

  const shapes = extractShapes(result)

  if (shapes.length === 0) {
    clearMeshes(view)
    return 'No geometry produced.'
  }

  renderShapes(view, shapes)

  const totalVerts = shapes.reduce((s, sh) => s + sh.positions.length / 3, 0)
  const totalTris = shapes.reduce((s, sh) => s + sh.indices.length / 3, 0)
  return `${shapes.length} shape(s), ${totalVerts} verts, ${totalTris} triangles`
}

async function runCode() {
  const code = codeEditor.value

  runBtn.disabled = true
  setStatus('Parsing...', 'info')

  try {
    // Parse (parseScript throws ParseError on failure)
    const parseResult = parseScript(code)

    // OCCT kernel is shared across executions — wait for the preload
    if (occtReady) {
      setStatus('Waiting for OCCT kernel...', 'info')
      await occtReady
    }

    // Run both modes in parallel; each mode gets its own ports + runtime
    const portsBrep = createBrowserPorts({ fontUrl })
    const portsMesh = createBrowserPorts({ fontUrl })

    setStatus('Executing (brep + mesh)...', 'info')
    const [brepReport, meshReport] = await Promise.all([
      runMode(brepView, parseResult.script, portsBrep),
      runMode(meshView, parseResult.script, portsMesh),
    ])

    setStatus(`OK — brep: ${brepReport} | mesh: ${meshReport}`, 'success')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    setStatus(`Error: ${msg}`, 'error')
    console.error(err)
  } finally {
    runBtn.disabled = false
  }
}

// ── Event handlers ──

runBtn.addEventListener('click', runCode)

exampleSelect.addEventListener('change', () => {
  const key = exampleSelect.value
  if (EXAMPLES[key]) {
    codeEditor.value = EXAMPLES[key]
    runCode()
  }
})

// Ctrl+Enter to run
codeEditor.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault()
    runCode()
  }
})

// ── Initialize ──

// OCCT kernel is required by BREP ops — let faijs use occt-wasm's browser init.
// dev：wasm 走本地 node_modules 文件（vite dev server 直接 serve）；
// build：走 jsdelivr CDN（与 importmap 版本一致）。
// 注意：demo 与 faijs 各有一份 occt-wasm（#private 成员导致名义类型不兼容），
// 运行时两副本同版本同 API，此处以 faijs 期望的签名断言
const initOcct = (() =>
  OcctKernel.init({
    wasm: import.meta.env.DEV
      ? '/node_modules/occt-wasm/dist/occt-wasm.wasm'
      : 'https://cdn.jsdelivr.net/npm/occt-wasm@3.7.0/dist/occt-wasm.wasm',
  })) as unknown as () => Promise<never>
setOcctWasmInitFn(initOcct)

// Manifold WASM：预打包会破坏 manifold-3d 内部的 import.meta.url 定位，
// 用官方 setWasmUrl 显式指定（须在 manifoldCAD 模块求值前调用，本模块顶层即早于
// faijs 的运行时动态 import）
setManifoldWasmUrl(
  import.meta.env.DEV
    ? '/node_modules/manifold-3d/lib/manifold.wasm'
    : 'https://cdn.jsdelivr.net/npm/manifold-3d@3.5.1/lib/manifold.wasm',
)

codeEditor.value = EXAMPLES['box-boolean']

// 预热 OCCT kernel（首次 ~22MB 下载），然后自动执行
preloadOcct()
void runCode()
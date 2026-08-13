/**
 * faijs demo — main logic
 *
 * Flow:
 * 1. User edits faijs source code in the textarea
 * 2. Click "Run" → parseScript(code) → createRuntime(createBrowserPorts()) → runtime.replay(script)
 * 3. Get terminal shapes from result.outputs
 * 4. Render meshes in Three.js
 */

import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { parseScript, ParseError, createRuntime, createBrowserPorts, setOcctWasmInitFn } from '@faicad/faijs/browser'
import type { ExecutionMode } from '@faicad/faijs/browser'
import { OcctKernel } from 'occt-wasm'
import occtWasmUrl from 'occt-wasm/dist/occt-wasm.wasm?url'
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
const modeSelect = document.getElementById('mode-select') as HTMLSelectElement
const statusBar = document.getElementById('status-bar') as HTMLDivElement
const canvas = document.getElementById('three-canvas') as HTMLCanvasElement

// ── Three.js setup ──

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x0d0d1a)

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000)
camera.position.set(30, 25, 35)
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

// Grid helper
const grid = new THREE.GridHelper(100, 20, 0x333355, 0x222244)
scene.add(grid)

// Axes helper
const axes = new THREE.AxesHelper(15)
scene.add(axes)

// Mesh group (cleared and refilled on each run)
let meshGroup = new THREE.Group()
scene.add(meshGroup)

// ── Resize handling ──

function resize() {
  const container = canvas.parentElement!
  const w = container.clientWidth
  const h = container.clientHeight
  renderer.setSize(w, h, false)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
}

window.addEventListener('resize', resize)
resize()

// ── Animation loop ──

function animate() {
  requestAnimationFrame(animate)
  controls.update()
  renderer.render(scene, camera)
}
animate()

// ── Status bar helpers ──

function setStatus(text: string, kind: 'info' | 'success' | 'error' = 'info') {
  statusBar.textContent = text
  statusBar.className = 'status-bar ' + kind
}

// ── Render shapes ──

function clearMeshes() {
  for (const child of meshGroup.children) {
    meshGroup.remove(child)
    if (child instanceof THREE.Mesh) {
      child.geometry?.dispose()
      const mat = child.material
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
      else mat?.dispose()
    }
  }
}

function renderShapes(shapes: Array<{ id: string; positions: Float32Array; indices: Uint32Array }>) {
  clearMeshes()

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
    meshGroup.add(mesh)
  }

  // Auto-frame camera to fit the meshes
  if (meshGroup.children.length > 0) {
    const box = new THREE.Box3().setFromObject(meshGroup)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z)
    const dist = maxDim * 2.2 + 5
    camera.position.set(dist, dist * 0.7, dist)
    controls.target.copy(center)
    controls.update()
  }
}

// ── Run faijs code ──

let occtInitialized = false
let runtime: ReturnType<typeof createRuntime> | null = null

async function runCode() {
  const code = codeEditor.value
  const mode = modeSelect.value as ExecutionMode

  runBtn.disabled = true
  setStatus('Parsing...', 'info')

  try {
    // Parse (parseScript throws ParseError on failure)
    const parseResult = parseScript(code)

    // Create runtime (recreate if mode changed)
    const ports = createBrowserPorts({ fontUrl })
    runtime = createRuntime(ports, mode)

    setStatus('Executing...', 'info')

    // Execute
    const result = await runtime.replay(parseResult.script)

    if (result.failedAt) {
      setStatus(`Failed at op "${result.failedAt.op}": ${result.failedAt.message}`, 'error')
      return
    }

    // Extract terminal shapes
    const shapes: Array<{ id: string; positions: Float32Array; indices: Uint32Array }> = []

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

    if (shapes.length === 0) {
      setStatus('No geometry produced.', 'error')
      return
    }

    // Render
    renderShapes(shapes)

    const totalVerts = shapes.reduce((s, sh) => s + sh.positions.length / 3, 0)
    const totalTris = shapes.reduce((s, sh) => s + sh.indices.length / 3, 0)
    const infos = result.infos.length > 0 ? ` | infos: ${result.infos.join('; ')}` : ''
    setStatus(
      `OK — ${shapes.length} shape(s), ${totalVerts} verts, ${totalTris} triangles${infos}`,
      'success',
    )
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
  }
})

modeSelect.addEventListener('change', () => {
  // Force runtime recreation on next run
  runtime = null
})

// Ctrl+Enter to run
codeEditor.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault()
    runCode()
  }
})

// ── Initialize ──

// OCCT kernel is required by BREP ops — let faijs use occt-wasm's browser init,
// with the WASM binary served as a Vite asset (dev server & build)
setOcctWasmInitFn(() => OcctKernel.init({ wasm: occtWasmUrl }))

codeEditor.value = EXAMPLES['box-boolean']
setStatus('Ready. Click Run or press Ctrl+Enter.', 'info')

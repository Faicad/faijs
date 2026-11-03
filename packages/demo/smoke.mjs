import { executeScript } from '@faicad/faijs/node'
const code = `let a = cad.sphere({ radius: 30 * MM })
let b = cad.box(20 * MM, 20 * MM, 20 * MM, { centered: true })
let c = cad.subtract(a, b)
let d = cad.translate(c, { offset: [0, 0, 0] })`
try {
  const r = await executeScript(code, { mode: 'mesh' })
  console.log('OK terminals=', r.terminals.length, 'failedAt=', JSON.stringify(r.failedAt))
} catch (e) {
  console.log('THROW', e?.message || e)
}

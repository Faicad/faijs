// fix-load-test.mjs — 修复 load.test.ts 中的 fileBlobStore import
import { readFileSync, writeFileSync } from 'node:fs'

const file = 'src/brep/ops/load.test.ts'
let content = readFileSync(file, 'utf-8')

// Replace all dynamic imports of FileBlobStore with our blob-store
content = content.replace(
  /await import\('[^']*FileBlobStore'\)/g,
  "await import('../../lib/blob-store')"
)

writeFileSync(file, content, 'utf-8')
console.log('Fixed load.test.ts')

/**
 * faijs-cli — CLI 入口（tsx 直跑，不发布）。
 *
 *   npx tsx scripts/faijs-cli.ts check <file.fai.js>
 *   npx tsx scripts/faijs-cli.ts run <file.fai.js> --out <output.stl|step> [--mode auto|brep|mesh]
 */
import { cliMain } from '../src/node-host/cli.ts'
import { createApiNamespace } from '../src/api/api-namespace.ts'

// P6/D1：cad 命名空间由 CLI 入口注入（L3 api/ 层，原 stdlib 取消）。
cliMain(process.argv, { cad: createApiNamespace() }).then((code) => process.exit(code))

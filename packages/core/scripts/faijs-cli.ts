/**
 * faijs-cli — CLI 入口（tsx 直跑，不发布）。
 *
 *   npx tsx scripts/faijs-cli.ts check <file.fai.js>
 *   npx tsx scripts/faijs-cli.ts run <file.fai.js> --out <output.stl|step> [--mode auto|brep|mesh]
 */
import { cliMain } from '../src/node-host/cli.ts'

// 不注入任何 libs：`cad` 是引擎内置的保留命名空间，createRuntime 已装配
// （传 `libs.cad` 会抛 E_CAD_RESERVED）。
cliMain(process.argv).then((code) => process.exit(code))

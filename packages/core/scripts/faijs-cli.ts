/**
 * faijs-cli — CLI 入口（tsx 直跑，不发布）。
 *
 *   npx tsx scripts/faijs-cli.ts check <file.faijs>
 *   npx tsx scripts/faijs-cli.ts run <file.faijs> --out <output.stl|step> [--mode auto|brep|mesh]
 */
import { cliMain } from '../src/node-host/cli.ts'
import { createInternalStdlib } from '@faicad/faijs-stdlib'

// P5/E-a-1：cad 命名空间由 CLI 入口注入（core 不默认装配库函数）。
cliMain(process.argv, { cad: createInternalStdlib() }).then((code) => process.exit(code))

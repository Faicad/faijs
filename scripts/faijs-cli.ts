#!/usr/bin/env node
/**
 * faijs-cli — 命令行入口
 *
 * 用法：
 *   npx tsx scripts/faijs-cli.ts check <file.faijs>
 *   npx tsx scripts/faijs-cli.ts run <file.faijs> --out <output.stl|step> [--mode auto|brep|mesh]
 */
import { cliMain } from '../src/node-host/cli.ts'

cliMain(process.argv).then((code) => process.exit(code))

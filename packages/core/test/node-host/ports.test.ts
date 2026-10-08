/**
 * createNodePorts — 宿主环境声明（导出命令宿主门，§2.5）。
 *
 * 导出命令（`cad.exportStl` / `cad.exportBrep`）只在 `'node'` 宿主开放：脚本可由
 * AI 生成任意代码、属不受信输入，导出把「往哪写、写几份、写什么」的决定权交给
 * 脚本文本；浏览器 / 小程序里要导出必须由宿主入口触发。node 侧落盘发生在用户自己
 * 的机器上，因此开放。
 *
 * 本文件是把该声明钉在**端口工厂**（而不是某个测试 harness）上：宿主装配走
 * `createNodePorts()` 的路径（CLI / executeScript / electron 主进程 `...base`
 * 继承）自动获得 `'node'`，不会被漏声明翻转成「非 node → 一律拒绝」。
 *
 * Run: npx vitest run test/node-host/ports.test.ts
 */

import { describe, it, expect } from 'vitest'
import { createNodePorts } from '../../src/node-host/index'

describe('createNodePorts — 宿主环境声明', () => {
  it("declares hostEnv 'node' (script-face export commands are open here)", () => {
    expect(createNodePorts().hostEnv).toBe('node')
  })
})

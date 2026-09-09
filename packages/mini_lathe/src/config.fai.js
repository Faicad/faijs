// mini_lathe 共享参数与辅助函数（对应 Python 原版 config.py）。
// 各零件以 `import * as config from '../config.fai.js'` 引用，避免逐文件内联副本。

import * as cq from '@faicad/cq-compat'

const EDGE_MARGIN = 12 // 用于装车刀的侧边的宽度
const OUTX = 100
const OUTY = OUTX

const TOL = 0.02 // 公差

const INX = OUTX - EDGE_MARGIN * 2
const INY = INX

const INX_FDM = INX - 0.1
const INY_FDM = INX_FDM

const C_RECT_LEN = OUTX - EDGE_MARGIN // 构造矩形，用于确定紧固车刀的螺丝孔的中心点

const MID_HOLE_D = 7.9 // M8的中心孔, 7.9确保紧配
const MID_HOLE_D_FDM = 8.2 // M8的中心孔, FDM打印要留有有公差

const EDGE_HOLE_D = 6 // M6的边孔，用于压住车刀
const M3_AUTO = 2.5
const M6_AUTO = 5 // 自动识别成M6螺纹孔的直径
const M8_AUTO = 6.8 // 自动识别成M8螺纹孔的直径

const TOP_CUT_H = 1.9 // 中间两层板嵌入上下底板的深度
const MID_H = 5 // 中间两层板互相嵌入的深度

const M6_F = 12 // M6螺丝的法兰盘直径

const C_RECT_R = C_RECT_LEN / 2

// 每5°钻一个孔，1/4圈，用于调节角度
//
// 半径 r 走参数而不是直接引用上面的 C_RECT_R：DirectExecutor 只把命名空间绑进
// 函数体，模块级常量不在函数作用域内（见 core cad-runtime/direct-executor.ts
// 的 transformFunction），函数体内引用 C_RECT_R 会报 not defined。
async function pin_holes(wp, r) {
  return await cq.hole(await cq.pushPoints(await cq.workplane(await cq.faces(wp, ">Z")), [0, 15, 30, 45, 60, 90, 120].map((a) => [(r * Math.cos(((a / 2) * Math.PI / 180))), (r * Math.sin(((a / 2) * Math.PI / 180)))])), 2.49)
}

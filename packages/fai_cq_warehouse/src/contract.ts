/**
 * contract — 本包行为契约版本（方案 §4.2.1）
 *
 * 标识「API 形状 + 参数表来源版本 + STEP 输出形态」组合；与内核契约对齐
 * （照 fai_cq_gears，勿硬编码）。改值必须显式改此文件，防止误改。
 */

import { CONTRACT_VERSION } from '@faicad/faijs-core'

/** 本包行为契约版本（方案 §4.2.1）：API 形状 + 参数表来源 + STEP 输出形态；与内核契约锁定。 */
export const contractVersion = CONTRACT_VERSION

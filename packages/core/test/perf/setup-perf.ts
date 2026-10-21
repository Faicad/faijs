/**
 * 性能探针专用装配：只注册 brepkit（端侧引擎），不加载 occt test-setup。
 *
 * registry 的 defaultBrepId 是"先注册先得"（registry.ts:70），默认 core 套件
 * 的 test-setup.ts 先注册 OCCT → 探针若沿用该 setup 会跑在 OCCT 上，网格密度与
 * weapp（brepkit）不一致（探针实测 head 1999 vs bundle 7908，探针数据作废一次）。
 * perf 场景要与端侧同一引擎，故本 setup 独立装配 brepkit。
 */
import { registerBrepkitBrepEngine } from '../../src/brep/engine/adapters/brepkit'

await registerBrepkitBrepEngine()

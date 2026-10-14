# Bug: bevel 齿轮稳定性测试 20/20 用例全部失败

> 方案出处：WorkBuddy + faijs 仓库（2026-10-14 由 Agent 整理，基于稳定性测试单线程实跑输出与当前源码）
> 状态：**待处理**（非本次 L1 spline/helix 接线任务引入，属预先存在的 bevel 几何/测试域问题）

| 字段 | 内容 |
|---|---|
| 严重度 | High（bevel 类在稳定性种子域内 0% 通过；其中含真实几何错误与测试域过宽两类） |
| 组件 | `packages/faijs-gears`（src + test） |
| 标签 | `faijs-gears`, `bevel`, `stability`, `pre-existing` |
| 发现时机 | 2026-10-13 L1 接线收尾、单线程跑 `test/stability/stability.test.ts` 时发现 |
| 与本任务关系 | **无关**：本次提交仅改 `GearKernel` 类型定义 + engine-compat harness；stability 在子进程中经 `getGearKernel()` → `initOcctWasm()` 走 raw occt-wasm，未触碰任何 bevel/几何运行时逻辑 |

---

## 1. 现象

单线程跑 `test/stability/stability.test.ts`，bevel 类 20 个种子用例**全部失败**。失败分三类，与另外 4 个通过类（ring / rack / herringbone-rack / worm）形成对照——说明核心库大体健康，问题集中在 bevel 构造链与/或种子参数域。

> 注：spur / herringbone / herringbone-ring 三类也有失败，但**全部是 `ETIMEDOUT`**（各 3–4/20 个重案例超 120s 墙钟预算），属环境超时，非代码/断言失败，不在此 ticket 讨论范围。

---

## 2. 失败样本（原始输出，seed=42）

来源：`gears-stability-ec.txt`（`vitest run --no-file-parallelism --pool=forks`，耗时 3633s）。

```
case 0  [VOLUME]    v=3686011.9219358005 not in (3977218.1307274, 4662957.651346406)
case 1  [BUILDING]  Twist angle is NaN
case 2  [BBOX_XY]   fcone_r*2=310.37578172768866 vs maxd=303.0180987962367
case 3  [BBOX_XY]   fcone_r*2=569.4956358300304 vs maxd=554.3577424310786
case 4  [BUILDING]  buildBevelGearSolid: result is not a solid (got shell)
case 5  [VOLUME]    v=626751.3017012753 not in (661260.4310541076, 1047510.4816316266)
case 6  [BUILDING]  Twist angle is NaN
case 7  [BUILDING]  buildBevelGearSolid: result is not a solid after trims
case 8  [BBOX_XY]   fcone_r*2=1284.7647925512506 vs maxd=1274.9674580450926
case 9  [BBOX_XY]   fcone_r*2=1279.8383715944153 vs maxd=1236.2940341303754
case 10 [BUILDING]  Twist angle is NaN
case 11 [BBOX_XY]   fcone_r*2=113.20244742146035 vs maxd=106.01335460431437
case 12 [VOLUME]    v=227031542.90011752 not in (295967171.7491007, 322523278.7820038)
case 13 [BBOX_XY]   fcone_r*2=89.11646526271109 vs maxd=12.527642310890652
case 14 [BUILDING]  spawnSync C:\Program Files\nodejs\node.exe ETIMEDOUT
case 15 [BBOX_XY]   fcone_r*2=546.2125670412662 vs maxd=489.32955351421987
case 16 [VOLUME]    v=33542243.492226627 not in (33705926.10255006, 43343342.6901226)
case 17 [VOLUME]    v=4286906.510166278 not in (4399903.901817158, 5107739.03359678)
case 18 [BBOX_XY]   fcone_r*2=409.6093922214906 vs maxd=405.7672561528008
case 19 [VOLUME]    v=17549945.704444807 not in (37515892.191391595, 51087401.330393754)
```

---

## 3. 根因分析

### A. `Twist angle is NaN`（case 1 / 6 / 10）

`packages/faijs-gears/src/profile.ts:617`（在 `bevelGearGeometry` 内）：

```ts
const beta = Math.atan((faceWidth * Math.tan(helixAngle)) / (2.0 * gsR - faceWidth))
twistAngle = Math.asin((gsR / rp) * Math.sin(beta)) * 2.0   // :617
// ...
if (Number.isNaN(twistAngle)) {                              // :623
  throw new Error('Twist angle is NaN')                      // :624
}
```

当 `(gsR / rp) * Math.sin(beta) > 1` 时 `Math.asin` 返回 `NaN` 并被抛出。触发条件：
- `gsR` = back-cone 距离，由 `bevelGearGeometry` 算出；对**小 `cone_angle` + 多齿**会非常大。
- 种子生成器 `cases.ts:315` 写 `p.face_width = bevelGearGeometry(p).gsR * r.next()`，使 `face_width` 可达成千上万（如 case 1 `face_width=5568`，而 `module≈4`），相对模数完全失配 → `beta` 失控 → `asin` 越界。

→ 本质是**种子域纳入了物理不可行的齿轮规格**。cq 原生 `test_bevel_gear.py` 的可行域可能更窄；本移植把 `cone_angle` 放到 1..80、`helix -70..70`、`teeth 3..200`，且 `face_width` 无上限，故落入不可行区。

### B. `result is not a solid`（case 4 / 7）

`packages/faijs-gears/src/bevel_gear.ts`：

```ts
const shell = kernel.sew(faces, build.shellSewingTol ?? GEAR_BASE_CONSTANTS.shell_sewing_tol) // :375
const solid = kernel.makeSolid(shell)                                                      // :376
let body = kernel.fixFaceOrientations(solid)                                               // :377
if (!kernel.isSolid(body)) {
  throw new Error(`buildBevelGearSolid: result is not a solid (got ${...})`)                 // :378-381
}
// ... 裁底 / 裁顶 ...
if (!kernel.isSolid(body)) {
  throw new Error('buildBevelGearSolid: result is not a solid after trims')                   // :391-392
}
```

齿面样条 loft（`buildBevelGearFaces`）+ `kernel.sew`（tol = `shell_sewing_tol`）在极端 `cone_angle` / `face_width` 下**未能闭合** → 漏缝 → 只是 shell 而非 solid。这是**真实的鲁棒性/几何 bug**：某些在可行域边界的参数也建不出封闭实体（需查 sew 容差与齿面朝向 `fixFaceOrientations`）。

### C. `[VOLUME]` / `[BBOX_XY]` 越界（case 0/2/3/5/8/9/11/12/13/15/16/17/18/19）

`packages/faijs-gears/test/stability/cases.ts:131-151` 的 `checkBevel` 把建成实体与**解析截锥模型**（半径 `fconeR = coneH·tan(gammaF)` 等）比对：

```ts
const fconeR = coneH * Math.tan(gammaF)
// ...
const vmax = (π * (coneH/3) * fconeR²) - (π * (tcH/3) * tfconeR²)
if (!(vmin < volume && volume < vmax)) throw new StabilityFailure('VOLUME', ...)
// ...
if (Math.abs(fconeR * 2 - maxd) > BBOX_CHECK_TOL) throw new StabilityFailure('BBOX_XY', ...)
```

- 多数案例偏差 **1–5%**（如 case 2：310.38 vs 303.02，约 2.4%），但 `BBOX_CHECK_TOL = 0.5` 是**绝对容差**，对大齿轮过严 → 应改相对容差。
- case 13 偏差 **7×**（`fcone_r*2=89.1` vs `maxd=12.5`），属**建成实体尺寸严重错误**（`teeth=4` + `cone_angle=58.7` 的极端组合下 builder 产出异常小的实体），是真正正确性问题。

---

## 4. 复现命令

⚠️ **必须单线程**：默认并行会 spawn 160 个子进程，在沙箱并发下会触发 `EBUSY` / `spawnSync ... EBUSY`（与本次 bug 无关，是环境资源限制）。单线程（`--no-file-parallelism --pool=forks`）下 EBUSY 消失。

```bash
cd packages/faijs-gears

# 仅 bevel（最快，单线程约 10–15 分钟）
npx vitest run -t "bevel" --no-file-parallelism --pool=forks test/stability/stability.test.ts

# 或全量 8 类（单线程约 60 分钟）
npx vitest run --no-file-parallelism --pool=forks test/stability/stability.test.ts
```

单用例直跑（绕过 vitest 调度，直接 spawn 子进程复现，最贴近失败现场）：

```bash
cd packages/faijs-gears/test/stability
node <repo>/node_modules/tsx/dist/cli.mjs runner-entry.ts bevel \
  '{"module":4.364576631924137,"teeth_number":173,"cone_angle":2.5755562498234212,"face_width":5568.23809186652,"pressure_angle":5.469842187245376,"helix_angle":25.758311562240124}'
# 退出码非 0，stderr 末行为 "BUILDING: Twist angle is NaN"
```

种子域约定（来自 `stability.test.ts`）：`SEED=42`（`:31`），bevel 用例用 `Rng(SEED+7)=Rng(49)`（`cases.ts:308`），取第 `i` 个即 case `i`。

---

## 5. 代表案例参数（根因佐证）

| case | 失败类型 | params（节选自 `genParams(42,20)`） |
|------|----------|--------------------------------------|
| 1 | Twist NaN | `module=4.36, teeth=173, cone=2.58, face_width=5568.24, pa=5.47, helix=25.76` |
| 4 | not solid | `module=5.46, teeth=178, cone=44.59, face_width=392.16, pa=10.47, helix=-29.91` |
| 7 | not solid after trims | `module=2.15, teeth=23, cone=71.32, face_width=21.42, pa=18.71, helix=-63.98` |
| 13 | BBOX 7× | `module=3.17, teeth=4, cone=58.71, face_width=6.20, pa=2.62, helix=-5.73` |

共同特征：case 1/4 的 `face_width` 高达数百~数千，明显与 `module` 失配；case 13 为极低齿数 + 大锥角组合。

---

## 6. 建议处理（按性价比排序）

1. **测试域收敛（最快止血）**：`cases.ts:315` 的 `face_width = gsR * r.next()` 改为相对上界（如 `min(gsR, K * module)`，K≈3），使种子规格物理自洽；同时收窄 `cone_angle` / `helix` / `teeth` 的极端组合范围，对齐 cq 可行域。
2. **容差改相对**：`BBOX_CHECK_TOL` 与 VOLUME 比对角落用**相对容差**（如 1–2%），避免大齿轮误报（覆盖 case 2/3/8/9/11/15/18 这类 1–5% 偏差）。
3. **builder 鲁棒性**：`buildBevelGearFaces` + `kernel.sew` 在极端 `cone_angle` 下闭合失败需排查 sew 容差与 `fixFaceOrientations`；`asin` 越界应**提前以"规格不可行"明确拒绝**并返回给测试做 skip，而非抛错中断。
4. **低齿数正确性问题**：`teeth=4` + 大 `cone_angle` 产出尺寸错误的实体（case 13，7× 偏差），需单独排查齿面生成路径。

---

## 7. 附注：EBUSY 与环境结论

- 本 bug 排查过程中确认：stability / fontRegistry 在**并行**下报 `EBUSY` / `spawnSync ... EBUSY`；**单线程**后 EBUSY 消失、`fontRegistry` 通过（1 passed）、stability 正常推进（仅剩本 ticket 的 bevel 断言失败与少量 `ETIMEDOUT`）。故 EBUSY 纯属沙箱并发 spawn 资源限制，**非代码缺陷、非本次提交引入**。
- bevel 全部失败**独立于** 2026-10-13 的 L1 接线提交：该提交 `git show --stat HEAD` 对 `faijs-gears` 仅改动 `src/kernel/gears.ts` 的 `GearKernel` **类型定义**（运行时擦除），未改任何 bevel/几何逻辑；stability 子进程走 raw occt-wasm，与改动路径无交集。

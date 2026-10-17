/**
 * DXF 导入（移植自 brepjs `src/io/dxfImportFns.ts`，2026-10-17）。
 *
 * 与 brepjs 相同的两个关键设计（对面 faijs-openscad 旧解析器的教训）：
 * 1. **严格两行一组配对遍历**（组码一行、值一行，游标 i += 2）——不做逐行
 *    扫描特判。DXF 组码流里任何一对（如 `999` 注释、HEADER 变量）都天然是
 *    一个 tag-value 对，配对遍历不会错位；逐行扫描遇格式细节（999 头、嵌套
 *    段）游标易漂移，导致实体漏读（faijs-openscad example013 的根因）。
 * 2. **不做端点拼线**：实体 → edge 后直接交给内核 `makeWire`
 *    （OCCT `BRepBuilderAPI_MakeWire` 按拓扑连续性自组），比 JS 侧端点
 *    容差匹配更健壮。polyline 仍在 JS 侧展开成连续 edge 序列。
 *
 * 支持实体：LINE / CIRCLE / ARC / LWPOLYLINE / POLYLINE。
 * 输出：闭合 wire 数组（调用方再 `makeFace` 面化）。
 */
import type { BrepEngineApi, BrepHandle, BrepVec3 } from '../engine/primitives';
import { ioError, BrepErrorCode, type BrepError } from '../../result/errors';
import { ok, err, type Result } from '../../result/result';
import { makeLine2d, makeArc2dThreePoints, type Curve2dObj } from '../../geometry2d/curve2d';
import { Blueprint } from '../../geometry2d/blueprint';
import { assembleWire } from '../../geometry2d/bridge/lift-on-plane';
import { classifyNested, computeSignedArea } from '../../geometry2d/nesting';

// ─── DXF 实体模型 ───

interface DxfEntity {
  readonly type: string;
  readonly layer: string;
  /** 组码 → 值（同一组码多次出现时保留**最后一个**；polyline 顶点例外，见 DxfPolyline） */
  readonly data: Map<number, string>;
}

/** LWPOLYLINE / POLYLINE 的顶点序列（组码 10/20 成对重复出现）。 */
interface DxfPolylineVertex {
  readonly x: number;
  readonly y: number;
  /** 凸度（bulge，组码 42）：0=直线，>0 逆时针圆弧，<0 顺时针圆弧 */
  readonly bulge: number;
}

interface DxfParsed {
  readonly lines: DxfEntity[];
  readonly circles: DxfEntity[];
  readonly arcs: DxfEntity[];
  readonly polylines: DxfPolylineVertex[][];
}

// ─── 解析器 ───

/**
 * 解析 ASCII DXF 的 BLOCKS + ENTITIES 段，把实体按类型分组。
 *
 * 结构约定（与 brepjs 一致 + 本仓扩展）：
 * - 严格两行一组配对遍历；
 * - `0 SECTION` / `2 NAME` 进入段，`0 ENDSEC` 退出（BLOCKS 与 ENTITIES 都扫）；
 * - `0 <TYPE>` 开启新实体，其后组码/值对存入该实体的 data。
 *
 * INSERT/BLOCKS 语义（2026-10-17，example013 根因）：dxflib 等工具把几何放进
 * BLOCKS 段的块定义，ENTITIES 段只留 INSERT 引用（带插入点/缩放/旋转/行列）。
 * 只扫 BLOCKS 会得到「一份未变换的块定义」，只扫 ENTITIES 会得到 0 实体——
 * 都不完整。本解析器：BLOCK 定义收集进块表，INSERT 按变换展开成具体实体；
 * 无 INSERT 引用时退回旧行为（块内几何直接作为图形输出）。
 *
 * @param text - ASCII DXF 文件全文
 * @returns 按类型分组的实体（LINE/CIRCLE/ARC 各自的组码表 + polyline 顶点序列）
 */
export function parseDxfEntities(text: string): DxfParsed {
  const lines = text.split(/\r?\n/);
  // 实体与（polyline 的）顶点序列在实体边界处配对收集——顶点不能挂共享变量
  // 在分组循环里引用：那样每条 polyline 都会拿到**最后一条**的顶点
  //（2026-10-17 实证：example「回」字形 DXF 两条 polyline 产出两个相同内圈 wire）。
  const collected: Array<{
    entity: DxfEntity;
    vertices?: DxfPolylineVertex[];
    section: 'BLOCKS' | 'ENTITIES' | undefined;
    /** 实体落在哪个块定义内（BLOCK…ENDBLK 之间）；块定义自身（type BLOCK/ENDBLK）除外 */
    blockName?: string;
  }> = [];

  let section: 'BLOCKS' | 'ENTITIES' | undefined;
  let pendingSection = false;
  let currentBlockName: string | undefined;
  let current: { type: string; layer: string; data: Map<number, string> } | undefined;
  // polyline 顶点的 10/20/42 组码成组重复，Map 会覆盖——单独收集。
  let polylineVertices: DxfPolylineVertex[] | undefined;
  let pendingVertex: { x?: number; y?: number; bulge: number } | undefined;

  const flushVertex = (): void => {
    if (pendingVertex && pendingVertex.x !== undefined && pendingVertex.y !== undefined) {
      polylineVertices!.push({
        x: pendingVertex.x,
        y: pendingVertex.y,
        bulge: pendingVertex.bulge,
      });
    }
    pendingVertex = undefined;
  };

  /** 把当前实体连同其顶点序列（若有）落库。落库后必须清空 current——
   *  跨段扫描（BLOCKS→ENTITIES）时 ENDSEC 不再 break，残留的 current 会被
   *  下一个 `0 <TYPE>` 再次 push（2026-10-17 实证：CIRCLE 双份）。
   *  BLOCK/ENDBLK 实体必须保留：后面的块收集循环靠它们开启/关闭块定义
   *  （2026-10-17 实证：过滤掉它们会让 blockDefs 恒空、INSERT 展开全部落空）。 */
  const flushEntity = (): void => {
    flushVertex();
    if (current) {
      collected.push({ entity: current, vertices: polylineVertices, section, blockName: currentBlockName });
    }
    current = undefined;
    polylineVertices = undefined;
  };

  for (let i = 0; i < lines.length - 1; i += 2) {
    const codeLine = lines[i];
    const valueLine = lines[i + 1];
    if (codeLine === undefined || valueLine === undefined) continue;
    const code = parseInt(codeLine.trim(), 10);
    const value = valueLine.trim();
    if (Number.isNaN(code)) continue;

    if (code === 0 && value === 'SECTION') {
      pendingSection = true;
      continue;
    }
    if (pendingSection && code === 2) {
      section = value === 'BLOCKS' || value === 'ENTITIES' ? (value as 'BLOCKS' | 'ENTITIES') : undefined;
      pendingSection = false;
      continue;
    }
    if (code === 0 && value === 'ENDSEC') {
      flushEntity();
      section = undefined;
      currentBlockName = undefined;
      continue;
    }
    if (code === 0 && value === 'EOF') {
      flushEntity();
      break;
    }
    if (section === undefined) continue;

    if (code === 0) {
      flushEntity();
      current = { type: value, layer: '0', data: new Map() };
      if (value === 'LWPOLYLINE' || value === 'POLYLINE') polylineVertices = [];
      // 进入/退出块定义：BLOCK 头本身记入 collected 前已跳过；用它的 data（下次
      // flush 时已填好）取块名——这里先把 currentBlockName 清掉，由 BLOCK 实体
      // 完成时（下一轮 flush）再设。简化：块定义内的实体打上「待定」标记，
      // 在分组后处理时按 BLOCK 实体名归属。
      if (value === 'ENDBLK') currentBlockName = undefined;
      continue;
    }

    if (!current) continue;

    if (code === 8) {
      current.layer = value;
      continue;
    }

    // LWPOLYLINE 顶点组码：10(x) 20(y) 42(bulge) 重复出现
    if ((current.type === 'LWPOLYLINE' || current.type === 'POLYLINE') && (code === 10 || code === 20 || code === 42)) {
      if (code === 10) {
        flushVertex();
        pendingVertex = { x: parseFloat(value), bulge: 0 };
      } else if (code === 20 && pendingVertex) {
        pendingVertex.y = parseFloat(value);
      } else if (code === 42 && pendingVertex) {
        pendingVertex.bulge = parseFloat(value);
      }
      continue;
    }

    current.data.set(code, value);
  }

  // ── 块定义收集与 INSERT 展开 ──
  interface BlockDef { base: { x: number; y: number }; members: Array<{ entity: DxfEntity; vertices?: DxfPolylineVertex[] }> }
  const blockDefs = new Map<string, BlockDef>();
  const placedEntities: Array<{ entity: DxfEntity; vertices?: DxfPolylineVertex[] }> = [];
  let hasInsert = false;

  // 先按顺序走一遍：BLOCK 实体（data 已含 2=块名、10/20=基点）开启一个块定义，
  // 其后直到 ENDBLK 的 collected 条目都归属该块；ENTITIES 段实体直接落 placed。
  {
    let currentDef: BlockDef | undefined;
    for (const entry of collected) {
      const t = entry.entity.type;
      if (entry.section === 'BLOCKS') {
        if (t === 'BLOCK') {
          const name = entry.entity.data.get(2);
          currentDef = name
            ? { base: { x: getNum(entry.entity.data, 10), y: getNum(entry.entity.data, 20) }, members: [] }
            : undefined;
          if (name && currentDef) blockDefs.set(name, currentDef);
          continue;
        }
        if (t === 'ENDBLK') { currentDef = undefined; continue; }
        if (currentDef && entry.blockName === undefined) {
          // BLOCK 与 ENDBLK 之间的成员——归属当前块定义
          currentDef.members.push({ entity: entry.entity, vertices: entry.vertices });
          continue;
        }
        // 不在 BLOCK…ENDBLK 定义内的裸实体（部分导出器不写块头）——按图纸几何输出
        placedEntities.push(entry);
        continue;
      }
      // ENTITIES 段
      if (t === 'INSERT') { hasInsert = true; placedEntities.push(entry); continue; }
      placedEntities.push(entry);
    }
  }

  /**
   * INSERT 展开：块成员实体按 (缩放 → 旋转 → 平移到插入点) 变换到图纸坐标。
   * 支持行列阵列（70/71 行列数 × 44/45 间距）。旋转/缩放对 bulge 无损
   * （相似变换保持圆弧凸度）。
   */
  const expandInsert = (insert: DxfEntity): Array<{ entity: DxfEntity; vertices?: DxfPolylineVertex[] }> => {
    const name = insert.data.get(2);
    const def = name ? blockDefs.get(name) : undefined;
    if (!def) return [];
    const insertPt = { x: getNum(insert.data, 10), y: getNum(insert.data, 20) };
    const sx = getNum(insert.data, 41, 1);
    const sy = getNum(insert.data, 42, 1);
    const rot = (getNum(insert.data, 50) * Math.PI) / 180;
    const rows = Math.max(1, getNum(insert.data, 70, 1));
    const cols = Math.max(1, getNum(insert.data, 71, 1));
    const rowSpacing = getNum(insert.data, 44, 0);
    const colSpacing = getNum(insert.data, 45, 0);
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const xf = (x: number, y: number, ox: number, oy: number): { x: number; y: number } => {
      const dx = (x - ox) * sx;
      const dy = (y - oy) * sy;
      return { x: insertPt.x + dx * cos - dy * sin, y: insertPt.y + dx * sin + dy * cos };
    };
    const out: Array<{ entity: DxfEntity; vertices?: DxfPolylineVertex[] }> = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const off = { x: c * colSpacing, y: r * rowSpacing };
        for (const member of def.members) {
          const e = member.entity;
          const T = (x: number, y: number): { x: number; y: number } => {
            const p = xf(x, y, def.base.x, def.base.y);
            return { x: p.x + off.x, y: p.y + off.y };
          };
          const data = new Map<number, string>();
          if (e.type === 'LINE') {
            const p1 = T(getNum(e.data, 10), getNum(e.data, 20));
            const p2 = T(getNum(e.data, 11), getNum(e.data, 21));
            data.set(10, String(p1.x)); data.set(20, String(p1.y)); data.set(30, '0');
            data.set(11, String(p2.x)); data.set(21, String(p2.y)); data.set(31, '0');
          } else if (e.type === 'CIRCLE' || e.type === 'ARC') {
            const c0 = T(getNum(e.data, 10), getNum(e.data, 20));
            data.set(10, String(c0.x)); data.set(20, String(c0.y)); data.set(30, '0');
            const uniformScale = Math.sqrt(Math.abs(sx * sy));
            data.set(40, String(getNum(e.data, 40) * uniformScale));
            if (e.type === 'ARC') {
              const rotDeg = getNum(insert.data, 50);
              data.set(50, String(getNum(e.data, 50) + rotDeg));
              data.set(51, String(getNum(e.data, 51) + rotDeg));
            }
          } else if (e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') {
            const vertices = (member.vertices ?? []).map((v) => {
              const p = T(v.x, v.y);
              return { x: p.x, y: p.y, bulge: v.bulge };
            });
            data.set(90, String(vertices.length));
            out.push({ entity: { type: e.type, layer: e.layer, data }, vertices });
            continue;
          } else {
            continue; // 其它类型暂不支持展开
          }
          out.push({ entity: { type: e.type, layer: e.layer, data } });
        }
      }
    }
    return out;
  };

  // ── 最终分组：ENTITIES 段 + INSERT 展开；无 INSERT 时块内几何直接输出（旧行为） ──
  const linesOut: DxfEntity[] = [];
  const circles: DxfEntity[] = [];
  const arcs: DxfEntity[] = [];
  const polylines: DxfPolylineVertex[][] = [];

  const pushEntry = (entry: { entity: DxfEntity; vertices?: DxfPolylineVertex[] }): void => {
    const e = entry.entity;
    if (e.type === 'LINE') linesOut.push(e);
    else if (e.type === 'CIRCLE') circles.push(e);
    else if (e.type === 'ARC') arcs.push(e);
    else if ((e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') && entry.vertices && entry.vertices.length > 0) {
      polylines.push(entry.vertices);
    }
  };

  if (hasInsert) {
    for (const entry of placedEntities) {
      if (entry.entity.type === 'INSERT') {
        for (const expanded of expandInsert(entry.entity)) pushEntry(expanded);
      } else {
        pushEntry(entry);
      }
    }
  } else {
    // 无 INSERT：块内几何直接输出（历史行为——部分导出器直接把图形放 BLOCKS）
    for (const entry of placedEntities) pushEntry(entry);
    for (const def of blockDefs.values()) {
      for (const member of def.members) pushEntry(member);
    }
  }

  return { lines: linesOut, circles, arcs, polylines };
}

// ─── 实体 → edge ───

function getNum(data: Map<number, string>, code: number, fallback = 0): number {
  const v = data.get(code);
  if (v === undefined) return fallback;
  const n = parseFloat(v);
  return Number.isNaN(n) ? fallback : n;
}

function vec3(x: number, y: number, z = 0): BrepVec3 {
  return { x, y, z };
}

/**
 * 把解析出的 DXF 实体转成内核 edge / wire。
 *
 * - LINE / CIRCLE / ARC → 单 edge；
 * - LWPOLYLINE / POLYLINE → 顶点折线 + bulge 圆弧（bulge≠0 的段用三点圆弧，
 *   圆心由弦中点 + bulge 几何求出），首尾相接成一条 edge 序列。
 *
 * wire 组装交给内核 `makeWire`（拓扑连续性自组）；个别实体转 edge 失败跳过，
 * 全部失败才报错。
 *
 * @param kernel - BREP 引擎契约面（makeLineEdge/makeCircleEdge/makeCircleArc/makeWire）
 * @param parsed - `parseDxfEntities` 的解析结果（按类型分组的实体）
 * @returns 组装出的 wire 数组；一条 wire 都没组出来时 `DXF_IMPORT_FAILED`
 */
export function dxfEntitiesToWires(kernel: BrepEngineApi, parsed: DxfParsed): Result<BrepHandle[], BrepError> {
  const polylineWires: BrepHandle[] = [];
  const circleWires: BrepHandle[] = [];

  // 圆：自身就是闭合环——单边成 wire，不进散边池（混入会破坏链式组环）。
  for (const e of parsed.circles) {
    try {
      circleWires.push(
        kernel.makeWire([
          kernel.makeCircleEdge(
            vec3(getNum(e.data, 10), getNum(e.data, 20), getNum(e.data, 30)),
            vec3(0, 0, 1),
            getNum(e.data, 40),
          ),
        ]),
      );
    } catch {
      // 跳过
    }
  }

  // LINE/ARC → 端点描述段（内核 edge 延迟到环确定后按链向创建——反向只是
  // 数据层面的方向翻转，不浪费内核调用，也避免 arc 反向时角度对调取到补弧）。
  interface DxfSeg { ax: number; ay: number; bx: number; by: number; entity: DxfEntity }
  const segs: DxfSeg[] = [];
  for (const e of parsed.lines) {
    segs.push({
      ax: getNum(e.data, 10), ay: getNum(e.data, 20),
      bx: getNum(e.data, 11), by: getNum(e.data, 21),
      entity: e,
    });
  }
  for (const e of parsed.arcs) {
    const cx = getNum(e.data, 10);
    const cy = getNum(e.data, 20);
    const r = getNum(e.data, 40);
    // DXF 圆弧固定从角 50 逆时针到角 51；51 < 50 时按 DXF 规范绕 360°
    const a0 = (getNum(e.data, 50) * Math.PI) / 180;
    let a1 = (getNum(e.data, 51) * Math.PI) / 180;
    if (a1 <= a0) a1 += 2 * Math.PI;
    segs.push({
      ax: cx + r * Math.cos(a0), ay: cy + r * Math.sin(a0),
      bx: cx + r * Math.cos(a1), by: cy + r * Math.sin(a1),
      entity: e,
    });
  }

  /**
   * 贪心端点链式组环（OpenSCAD DXF 导入同语义）：DXF 轮廓常被拆成一段段
   * LINE/ARC 散实体，把全部散边一次性丢给 makeWire 会因拓扑不连续产出错误
   * 形状（2026-10-17 实证：example013 的 16 条边一把梭 → 体积 86500 vs
   * 参考 61333）。链式：从任一段出发按端点匹配延伸，回到起点即成环。
   */
  const TOL = 1e-6;
  const dist = (x1: number, y1: number, x2: number, y2: number): number => Math.hypot(x1 - x2, y1 - y2);
  const arcPoint = (e: DxfEntity, angleRad: number): { x: number; y: number } => ({
    x: getNum(e.data, 10) + getNum(e.data, 40) * Math.cos(angleRad),
    y: getNum(e.data, 20) + getNum(e.data, 40) * Math.sin(angleRad),
  });
  const buildEdge = (s: DxfSeg, forward: boolean): BrepHandle => {
    const e = s.entity;
    if (e.type === 'LINE') {
      return forward
        ? kernel.makeLineEdge(vec3(s.ax, s.ay), vec3(s.bx, s.by))
        : kernel.makeLineEdge(vec3(s.bx, s.by), vec3(s.ax, s.ay));
    }
    // ARC：三点弧（makeArcEdge）——正向 (a0, mid, a1)，反向 (a1, mid, a0)。
    // 同一组三点，几何完全一致，只有端点序不同；避免 (a1,a0) 角度对调取到补弧。
    const a0 = (getNum(e.data, 50) * Math.PI) / 180;
    let a1 = (getNum(e.data, 51) * Math.PI) / 180;
    if (a1 <= a0) a1 += 2 * Math.PI;
    const p0 = arcPoint(e, a0);
    const pm = arcPoint(e, (a0 + a1) / 2);
    const p1 = arcPoint(e, a1);
    return forward
      ? kernel.makeArcEdge(vec3(p0.x, p0.y), vec3(pm.x, pm.y), vec3(p1.x, p1.y))
      : kernel.makeArcEdge(vec3(p1.x, p1.y), vec3(pm.x, pm.y), vec3(p0.x, p0.y));
  };

  const loopWires: BrepHandle[] = [];
  const chainEdges: BrepHandle[] = [];
  while (segs.length > 0) {
    const first = segs.shift()!;
    const chain: Array<{ seg: DxfSeg; forward: boolean }> = [{ seg: first, forward: true }];
    const start = { x: first.ax, y: first.ay };
    let endX = first.bx;
    let endY = first.by;
    let extended = true;
    while (extended && dist(endX, endY, start.x, start.y) > TOL) {
      extended = false;
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i]!;
        if (dist(s.ax, s.ay, endX, endY) <= TOL) {
          chain.push({ seg: s, forward: true });
          endX = s.bx; endY = s.by;
        } else if (dist(s.bx, s.by, endX, endY) <= TOL) {
          chain.push({ seg: s, forward: false });
          endX = s.ax; endY = s.ay;
        } else {
          continue;
        }
        segs.splice(i, 1);
        extended = true;
        break;
      }
    }
    for (const { seg, forward } of chain) {
      try {
        chainEdges.push(buildEdge(seg, forward));
      } catch {
        // 坏边跳过（环缺边 → makeWire 失败 → 整环丢弃）
      }
    }
    if (chainEdges.length > 0) {
      try {
        loopWires.push(kernel.makeWire(chainEdges));
      } catch {
        // 环不闭合/坏边 → 整环丢弃
      }
    }
    chainEdges.length = 0;
  }

  for (const vertices of parsed.polylines) {
    // polyline → Curve2dObj 序列（bulge≠0 的段是真实三点圆弧，不退化成弦线），
    // 经 geometry2d 桥 assembleWire 在 XY 平面落成 wire——与 sketch/profile 同一管线。
    const curves: Curve2dObj[] = [];
    for (let i = 0; i < vertices.length - 1; i++) {
      const a = vertices[i];
      const b = vertices[i + 1];
      if (a.bulge === 0) {
        curves.push(makeLine2d(a.x, a.y, b.x, b.y));
      } else {
        // bulge → 三点圆弧：拱点 = 弦中点沿行进方向左侧法向抬升 sagitta
        // （bulge>0 逆时针，弧凸向行进方向左侧）。|bulge|>1 时 θ>π，
        // 公式 sagitta = bulge·chord/2 依然成立。
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const chord = Math.hypot(dx, dy);
        if (chord === 0) continue;
        const sagitta = (a.bulge * chord) / 2;
        const apexX = mx + (-dy / chord) * sagitta;
        const apexY = my + (dx / chord) * sagitta;
        curves.push(makeArc2dThreePoints(a.x, a.y, apexX, apexY, b.x, b.y));
      }
    }
    if (curves.length > 0) {
      try {
        polylineWires.push(assembleWire(kernel, 'XY', new Blueprint(curves)));
      } catch {
        // 单条 polyline 组线失败跳过（内含坏段时 assembleWire 可能抛）
      }
    }
  }

  // polyline 已是成品 wire；圆是单边闭合 wire；LINE/ARC 已链式组环。
  const wires: BrepHandle[] = [...polylineWires, ...circleWires, ...loopWires];

  if (wires.length === 0) {
    return err(
      ioError(BrepErrorCode.DXF_IMPORT_FAILED, 'DXF entities produced no closed wires', undefined),
    );
  }
  return ok(wires);
}

/**
 * 导入 DXF 文本 → 内核 wire 数组。
 * @param kernel - BREP 引擎契约面
 * @param text   - ASCII DXF 文件全文
 * @param layer  - 可选图层过滤（组码 8）
 * @returns wire 数组；解析不出闭合 wire 时 `DXF_IMPORT_FAILED`
 */
export function importDxf(
  kernel: BrepEngineApi,
  text: string,
  layer?: string,
): Result<BrepHandle[], BrepError> {
  const parsed = parseDxfEntities(text);
  if (layer !== undefined) {
    const filtered: DxfParsed = {
      lines: parsed.lines.filter((e) => e.layer === layer),
      circles: parsed.circles.filter((e) => e.layer === layer),
      arcs: parsed.arcs.filter((e) => e.layer === layer),
      polylines: parsed.polylines,
    };
    return dxfEntitiesToWires(kernel, filtered);
  }
  return dxfEntitiesToWires(kernel, parsed);
}

/** 每个 wire 的采样点数（嵌套分类用：bbox/质心判定足够，不需高密度）。 */
const WIRE_SAMPLE_POINTS = 32;

/**
 * 从内核 wire 采样 2D 点集（XY 平面，忽略 Z）。
 *
 * 组合 `getSubShapes(wire,'edge')` + `curveParameters` + `curvePointAtParam`：
 * 每条边等参数取 `WIRE_SAMPLE_POINTS` 个点。点的环绕方向跟随边的参数方向，
 * 与 wire 拓扑序一致——分类只用绝对面积与包含关系，方向无关紧要。
 *
 * @param kernel - BREP 引擎契约面（需含 getSubShapes/curveParameters/curvePointAtParam）
 * @param wire - 待采样的闭合 wire
 * @returns 采样点列表（{x,y}，XY 平面）
 */
function sampleWirePoints(kernel: BrepEngineApi, wire: BrepHandle): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  const edges = kernel.getSubShapes(wire, 'edge');
  for (const edge of edges) {
    try {
      const { first, last } = kernel.curveParameters(edge);
      for (let s = 0; s < WIRE_SAMPLE_POINTS; s++) {
        const t = first + ((last - first) * s) / WIRE_SAMPLE_POINTS;
        const p = kernel.curvePointAtParam(edge, t);
        points.push({ x: p.x, y: p.y });
      }
    } catch {
      // 坏边跳过——采样点少一组不影响整体分类
    }
  }
  return points;
}

/**
 * 导入 DXF 文本 → **外轮廓/孔洞分组**的 wire（嵌套分类经 geometry2d/nesting）。
 *
 * 相比 `importDxf`（平面 wire 列表，不区分包含关系），本函数把每条 wire 采样成
 * 点集后做 evenodd 嵌套分组，返回 `{outer, holes}`——调用方直接
 * `makeFace(outer)` + `addHolesInFace(holes)`，无需自己判断包含关系。
 * 「回」字形（外圈 + 内孔）与孔中岛（深度 2 的独立外轮廓）都被正确分组。
 *
 * @param kernel - BREP 引擎契约面
 * @param text   - ASCII DXF 文件全文
 * @param layer  - 可选图层过滤（组码 8）
 * @returns 分组结果；解析不出闭合 wire 时 `DXF_IMPORT_FAILED`
 */
export function importDxfProfiles(
  kernel: BrepEngineApi,
  text: string,
  layer?: string,
): Result<{ outer: BrepHandle; holes: BrepHandle[] }[], BrepError> {
  const wiresResult = importDxf(kernel, text, layer);
  if (!wiresResult.ok) return wiresResult;
  const wires = wiresResult.value;

  // wire → 采样点 → ClassifiableSubpath
  const subpaths = wires.map((wire) => {
    const points = sampleWirePoints(kernel, wire);
    const bbox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const p of points) {
      if (p.x < bbox.minX) bbox.minX = p.x;
      if (p.y < bbox.minY) bbox.minY = p.y;
      if (p.x > bbox.maxX) bbox.maxX = p.x;
      if (p.y > bbox.maxY) bbox.maxY = p.y;
    }
    return { wire, points, bbox, signedArea: computeSignedArea(points) };
  });

  const groups = classifyNested(subpaths);
  const profiles = groups.map((g) => ({
    outer: subpaths[g.outerIdx].wire,
    holes: g.holes.map((h) => subpaths[h].wire),
  }));
  if (profiles.length === 0) {
    return err(
      ioError(BrepErrorCode.DXF_IMPORT_FAILED, 'DXF wires classified into no profiles', undefined),
    );
  }
  return ok(profiles);
}

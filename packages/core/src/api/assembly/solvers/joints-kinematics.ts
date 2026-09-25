/**
 * Kinematic joints + IK — core 自有实现（§5.6.3 移植：vendored jointFns + ikFns 逐字对齐）。
 *
 * 移植来源：packages/brepjs/src/operations/{jointFns,ikFns}.ts（纯算法零 kernel 依赖，
 * 仅用 quat 与 assembly-tree；Phase 5 随 brepjs 包删除前已做 parity 对拍）。
 */
import { quatFromAxisAngle, quatRotate, quatMultiply } from './quat'
import type { AssemblyNode, Vec3 } from './assembly-tree'
import { walkAssembly } from './assembly-tree'

/**
 * Drivable kinematic joints — built on the assembly tree. A joint connects a
 * `parent` (reference) body to a `child` (moving) body and carries one or more
 * drivable degrees of freedom (DOF), each clamped to its own range.
 *
 * Single-DOF joints (`revolute`, `prismatic`) are sugar over the Phase-1 mate
 * constraints — a revolute is concentric (axis alignment) plus an angle driver;
 * a prismatic is coincident plus a distance driver. Multi-DOF joints compose
 * several DOFs about a shared anchor: `cylindrical` (rotation + slide on one
 * axis, 2 DOF), `planar` (two in-plane translations + a rotation about the
 * normal, 3 DOF), and `spherical` (three rotations about a pivot, 3 DOF).
 *
 * The `dofs` array is the source of truth; `value`/`min`/`max`/`axis` mirror the
 * primary (first) DOF for single-DOF ergonomics and backward compatibility.
 * `joint.dofs` are the stored degrees of freedom, distinct from
 * `AssemblyNode.rotate` (a static structural transform).
 */


// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A joint axis: a point on the axis line plus a direction. */
export interface JointAxis {
  readonly origin: Vec3;
  readonly direction: Vec3;
}

export type JointType = 'revolute' | 'prismatic' | 'cylindrical' | 'planar' | 'spherical';

/**
 * A single drivable degree of freedom. A `rotation` DOF turns about the joint's
 * anchor point along `axis` (degrees); a `translation` DOF slides along `axis`
 * (length units). `value` is always clamped to `[min, max]`.
 */
export interface JointDOF {
  readonly kind: 'rotation' | 'translation';
  readonly axis: Vec3;
  readonly min: number;
  readonly max: number;
  readonly value: number;
}

export interface Joint {
  readonly type: JointType;
  /** Reference body (stays put); the child moves relative to it. */
  readonly parent: string;
  readonly child: string;
  /** Primary axis; `origin` is the anchor every rotation DOF pivots about. */
  readonly axis: JointAxis;
  /** Primary-DOF range bounds (mirror of `dofs[0]`). */
  readonly min: number;
  readonly max: number;
  /** Primary-DOF value (mirror of `dofs[0]`), always clamped to `[min, max]`. */
  readonly value: number;
  /** All drivable degrees of freedom, in composition order. */
  readonly dofs: readonly JointDOF[];
  /**
   * Optional fixed transform applied to the child frame *after* the joint
   * motion (`childWorld = parentWorld ∘ jointTransform ∘ offset`). Lets a single
   * joint carry a static link offset (e.g. a Denavit-Hartenberg link geometry)
   * without an extra body. Defaults to identity. See `jointsFromDH`.
   */
  readonly offset?: JointPose;
}

/** A rigid transform: translation + quaternion rotation `[w, x, y, z]`. */
export interface JointPose {
  readonly position: Vec3;
  readonly rotation: [number, number, number, number];
}

export interface JointOptions {
  /** Range lower bound. Default: -180 (revolute) / 0 (prismatic). */
  min?: number;
  /** Range upper bound. Default: 180 (revolute) / 100 (prismatic). */
  max?: number;
  /** Initial value, clamped to the range. Default: 0. */
  value?: number;
}

/** Per-DOF ranges for a cylindrical joint (rotation about + slide along one axis). */
export interface CylindricalOptions {
  /** Rotation DOF (degrees). Default range -180..180. */
  rotation?: JointOptions;
  /**
   * Translation DOF (length). Default range 0..100, matching `prismaticJoint`
   * (both model a slide along an axis). This is deliberately asymmetric with
   * `planarJoint`'s in-plane translations, which default to -100..100 because
   * an unanchored in-plane slide is naturally bidirectional.
   */
  translation?: JointOptions;
}

/** Per-DOF ranges for a planar joint (two in-plane translations + a rotation). */
export interface PlanarOptions {
  /** Translation along the in-plane `uDirection`. Default range -100..100. */
  u?: JointOptions;
  /** Translation along `normal × u`. Default range -100..100. */
  v?: JointOptions;
  /** Rotation about the plane normal (degrees). Default range -180..180. */
  rotation?: JointOptions;
  /**
   * In-plane reference direction for the `u` translation. Projected onto the
   * plane and normalized; defaults to an arbitrary perpendicular of the normal.
   */
  uDirection?: Vec3;
}

/** Per-DOF ranges for a spherical joint (three rotations about a pivot). */
export interface SphericalOptions {
  /** Rotation about local X through the pivot (degrees). Default range -180..180. */
  x?: JointOptions;
  /** Rotation about local Y through the pivot (degrees). Default range -180..180. */
  y?: JointOptions;
  /** Rotation about local Z through the pivot (degrees). Default range -180..180. */
  z?: JointOptions;
}

const DEG2RAD = Math.PI / 180;

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function unit(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** A unit vector perpendicular to `v` (for the unspecified-reference case). */
function anyPerpendicular(v: Vec3): Vec3 {
  const ref: Vec3 = Math.abs(v[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  return unit(cross(v, ref));
}

/** Build one DOF, normalizing an inverted range and clamping the initial value. */
function makeDof(
  kind: JointDOF['kind'],
  axis: Vec3,
  opts: JointOptions,
  defMin: number,
  defMax: number
): JointDOF {
  // Normalize the range so an inverted (min > max) input can't break the
  // "value is always within [min, max]" invariant.
  const a = opts.min ?? defMin;
  const b = opts.max ?? defMax;
  const min = Math.min(a, b);
  const max = Math.max(a, b);
  return { kind, axis: unit(axis), min, max, value: clamp(opts.value ?? 0, min, max) };
}

/** Assemble a Joint from its DOFs, mirroring the primary DOF into the top level. */
function buildJoint(
  type: JointType,
  parent: string,
  child: string,
  axis: JointAxis,
  dofs: readonly JointDOF[]
): Joint {
  const primary = dofs[0] ?? { kind: 'rotation', axis: [0, 0, 1], min: 0, max: 0, value: 0 };
  return {
    type,
    parent,
    child,
    axis: { origin: axis.origin, direction: unit(axis.direction) },
    min: primary.min,
    max: primary.max,
    value: primary.value,
    dofs,
  };
}

/** A revolute (hinge) joint — the child rotates about `axis` by `value` degrees. */
export function revoluteJoint(
  parent: string,
  child: string,
  axis: JointAxis,
  opts: JointOptions = {}
): Joint {
  return buildJoint('revolute', parent, child, axis, [
    makeDof('rotation', axis.direction, opts, -180, 180),
  ]);
}

/**
 * A prismatic (slider) joint — the child translates along `axis` by `value`
 * units. Only `axis.direction` is used; `axis.origin` is ignored (a pure
 * translation has no anchor point), unlike a revolute joint which rotates about
 * the axis line through `origin`.
 */
export function prismaticJoint(
  parent: string,
  child: string,
  axis: JointAxis,
  opts: JointOptions = {}
): Joint {
  return buildJoint('prismatic', parent, child, axis, [
    makeDof('translation', axis.direction, opts, 0, 100),
  ]);
}

/**
 * A cylindrical joint — the child both rotates about and slides along a single
 * `axis` (2 DOF). DOF order: `[rotation, translation]`. The two motions share
 * the axis, so they commute; rotation pivots about `axis.origin`.
 */
export function cylindricalJoint(
  parent: string,
  child: string,
  axis: JointAxis,
  opts: CylindricalOptions = {}
): Joint {
  return buildJoint('cylindrical', parent, child, axis, [
    makeDof('rotation', axis.direction, opts.rotation ?? {}, -180, 180),
    makeDof('translation', axis.direction, opts.translation ?? {}, 0, 100),
  ]);
}

/**
 * A planar joint — the child translates within a plane and rotates about its
 * normal (3 DOF). `plane.direction` is the normal; `plane.origin` the rotation
 * anchor. DOF order: `[u-translation, v-translation, rotation]`, where the
 * translations are applied in the plane frame (independent of the rotation).
 */
export function planarJoint(
  parent: string,
  child: string,
  plane: JointAxis,
  opts: PlanarOptions = {}
): Joint {
  const normal = unit(plane.direction);
  // Project a requested u-direction onto the plane; fall back to an arbitrary
  // in-plane axis. v completes a right-handed in-plane basis.
  let u: Vec3;
  if (opts.uDirection) {
    const d = opts.uDirection;
    const proj = d[0] * normal[0] + d[1] * normal[1] + d[2] * normal[2];
    const inPlane: Vec3 = [
      d[0] - proj * normal[0],
      d[1] - proj * normal[1],
      d[2] - proj * normal[2],
    ];
    u =
      Math.hypot(inPlane[0], inPlane[1], inPlane[2]) < 1e-9
        ? anyPerpendicular(normal)
        : unit(inPlane);
  } else {
    u = anyPerpendicular(normal);
  }
  const v = unit(cross(normal, u));
  return buildJoint('planar', parent, child, { origin: plane.origin, direction: normal }, [
    makeDof('translation', u, opts.u ?? {}, -100, 100),
    makeDof('translation', v, opts.v ?? {}, -100, 100),
    makeDof('rotation', normal, opts.rotation ?? {}, -180, 180),
  ]);
}

/**
 * A spherical (ball) joint — the child rotates freely about a pivot point
 * (3 DOF). DOF order: `[x, y, z]` rotations about the local axes through
 * `pivot`, composed as `Rx · Ry · Rz`.
 */
export function sphericalJoint(
  parent: string,
  child: string,
  pivot: Vec3,
  opts: SphericalOptions = {}
): Joint {
  return buildJoint('spherical', parent, child, { origin: pivot, direction: [0, 0, 1] }, [
    makeDof('rotation', [1, 0, 0], opts.x ?? {}, -180, 180),
    makeDof('rotation', [0, 1, 0], opts.y ?? {}, -180, 180),
    makeDof('rotation', [0, 0, 1], opts.z ?? {}, -180, 180),
  ]);
}

/**
 * Return a copy of `joint` with per-DOF values set (each clamped to its range).
 * Values are positional, matching `joint.dofs`; omitted entries keep their
 * stored value. The primary mirror (`value`) is kept in sync with `dofs[0]`.
 */
export function setJointValues(joint: Joint, values: readonly number[]): Joint {
  const dofs = joint.dofs.map((d, i) => {
    const v = values[i];
    return v === undefined ? d : { ...d, value: clamp(v, d.min, d.max) };
  });
  const primary = dofs[0];
  return primary ? { ...joint, dofs, value: primary.value } : { ...joint, dofs };
}

/** Return a copy of `joint` with its primary DOF set (clamped to range). */
export function setJointValue(joint: Joint, value: number): Joint {
  return setJointValues(joint, [value]);
}

// ---------------------------------------------------------------------------
// Kinematics
// ---------------------------------------------------------------------------

/** The local rigid transform contributed by a single DOF at `value`. */
function dofPose(origin: Vec3, dof: JointDOF, value: number): JointPose {
  if (dof.kind === 'translation') {
    // `origin` is intentionally unused: a pure translation has no pivot.
    return {
      position: [dof.axis[0] * value, dof.axis[1] * value, dof.axis[2] * value],
      rotation: [1, 0, 0, 0],
    };
  }
  // Rotation about the axis line through `origin`: p ↦ R·p + (origin − R·origin).
  const rotation = quatFromAxisAngle(dof.axis, value * DEG2RAD);
  const ro = quatRotate(rotation, origin);
  return { position: [origin[0] - ro[0], origin[1] - ro[1], origin[2] - ro[2]], rotation };
}

/**
 * The child's local rigid transform (relative to the parent) for given DOF
 * values. Defaults to each DOF's stored value. A single `number` overrides only
 * the primary DOF (single-DOF ergonomics); an array overrides positionally,
 * with omitted entries keeping their stored value. Each value is clamped to its
 * DOF range.
 *
 * DOFs are folded in array order via frame composition. For same-anchor
 * rotations (e.g. spherical) this composes to a single rotation about the pivot;
 * for a cylindrical axis the rotation and slide commute.
 */
export function jointTransform(
  joint: Joint,
  value: number | readonly number[] = joint.value
): JointPose {
  const overrides = Array.isArray(value) ? (value as readonly number[]) : undefined;
  const primary = overrides ? undefined : (value as number);
  const origin = joint.axis.origin;

  let pose = IDENTITY_POSE;
  for (let i = 0; i < joint.dofs.length; i++) {
    const dof = joint.dofs[i];
    if (!dof) continue;
    const raw = overrides
      ? (overrides[i] ?? dof.value)
      : i === 0
        ? (primary ?? dof.value)
        : dof.value;
    pose = composePose(pose, dofPose(origin, dof, clamp(raw, dof.min, dof.max)));
  }
  return pose;
}

// ---------------------------------------------------------------------------
// Assembly integration
// ---------------------------------------------------------------------------

/** Attach a joint to an assembly node. Returns a new node (immutable). */
export function addJoint(assembly: AssemblyNode, joint: Joint): AssemblyNode {
  const existing = (assembly.joints ?? []) as readonly Joint[];
  return { ...assembly, joints: [...existing, joint] };
}

// ---------------------------------------------------------------------------
// Forward kinematics
// ---------------------------------------------------------------------------

const IDENTITY_POSE: JointPose = { position: [0, 0, 0], rotation: [1, 0, 0, 0] };

/** Compose two poses: the result applies `b` in `a`'s frame (`a ∘ b`). */
function composePose(a: JointPose, b: JointPose): JointPose {
  const rb = quatRotate(a.rotation, b.position);
  return {
    position: [a.position[0] + rb[0], a.position[1] + rb[1], a.position[2] + rb[2]],
    rotation: quatMultiply(a.rotation, b.rotation),
  };
}

/** Collect every joint attached anywhere in the assembly tree. */
function collectJoints(assembly: AssemblyNode): Joint[] {
  const joints: Joint[] = [];
  walkAssembly(assembly, (node) => {
    if (node.joints) joints.push(...(node.joints as readonly Joint[]));
  });
  return joints;
}

/**
 * Forward kinematics: set joint values and propagate world poses down the
 * kinematic chain. Each joint's axis is interpreted in its **parent's** frame,
 * so a child's world pose is `parentWorld ∘ jointTransform(joint, value)`.
 *
 * Bodies not driven by a joint (chain roots) start at the origin. `jointValues`
 * overrides a joint's stored value, keyed by the **child** node name; omitted
 * joints use `joint.value`. Resolution is topological (reuses the Phase-0
 * ordering), so chains of any depth compose. Returns a world pose for every node.
 */
export function forwardKinematics(
  assembly: AssemblyNode,
  jointValues: Readonly<Record<string, number | readonly number[]>> = {}
): Map<string, JointPose> {
  // Single pass: gather joints and node names together.
  const joints: Joint[] = [];
  const names = new Set<string>();
  walkAssembly(assembly, (node) => {
    names.add(node.name);
    if (node.joints) joints.push(...(node.joints as readonly Joint[]));
  });
  const byChild = new Map<string, Joint>();
  for (const j of joints) {
    byChild.set(j.child, j);
    names.add(j.parent);
    names.add(j.child);
  }

  const poses = new Map<string, JointPose>();
  // Roots: any node not driven by a joint sits at the origin.
  for (const name of names) if (!byChild.has(name)) poses.set(name, IDENTITY_POSE);

  // Propagate down the joint graph: a joint resolves once its parent is placed.
  const pending = [...joints];
  let progress = true;
  while (progress && pending.length > 0) {
    progress = false;
    for (let i = pending.length - 1; i >= 0; i--) {
      const j = pending[i];
      if (!j) continue;
      const parentPose = poses.get(j.parent);
      if (!parentPose) continue; // parent not placed yet — defer
      pending.splice(i, 1);
      progress = true;
      if (poses.has(j.child)) continue; // already placed (duplicate/cycle) — skip
      const value = jointValues[j.child] ?? j.value;
      const local = j.offset
        ? composePose(jointTransform(j, value), j.offset)
        : jointTransform(j, value);
      poses.set(j.child, composePose(parentPose, local));
    }
  }
  // A joint whose parent never resolved (cycle/dangling) still gets an entry so
  // the map covers every node.
  for (const j of pending) if (!poses.has(j.child)) poses.set(j.child, IDENTITY_POSE);

  return poses;
}

/**
 * Open-chain mobility — the number of independent degrees of freedom, summing
 * each joint's DOF count (revolute/prismatic 1, cylindrical 2, planar/spherical
 * 3). For a serial chain this equals the total DOF. (Closed-loop
 * Grübler/Kutzbach analysis is future work.)
 */
export function mechanismDOF(assembly: AssemblyNode): number {
  return collectJoints(assembly).reduce((sum, j) => sum + j.dofs.length, 0);
}

/**
 * Inverse kinematics and motion trajectories for joint chains.
 *
 * `inverseKinematics` solves for the joint values that place an end-effector at
 * a target pose, using a damped-least-squares (Levenberg-Marquardt) update over
 * a numerically-differentiated Jacobian. Differentiating through
 * `forwardKinematics` keeps the solver agnostic to joint type — revolute,
 * prismatic, and the multi-DOF cylindrical/planar/spherical joints all
 * contribute their `dofs` uniformly — and respects each DOF's range by clamping
 * every iterate.
 *
 * `jointTrajectory` samples a straight-line path in joint space between two
 * configurations, returning the posed assembly (via forward kinematics) at each
 * step — the building block for animation and reachable-workspace sweeps.
 */


type Quat = readonly [number, number, number, number];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A target for the end-effector: a world position, optionally an orientation. */
export interface IKTarget {
  readonly position: Vec3;
  /** Target orientation `[w, x, y, z]`. Omit for position-only IK. */
  readonly rotation?: Quat;
}

export interface IKOptions {
  /** Maximum solver iterations. Default 200. */
  maxIterations?: number;
  /** Convergence threshold on the residual norm. Default 1e-5. */
  tolerance?: number;
  /** Damping factor λ for the least-squares step. Default 0.05. */
  damping?: number;
  /** Initial joint values, keyed by child node (number or per-DOF array). */
  seed?: Readonly<Record<string, number | readonly number[]>>;
  /** Local point on the end-effector node to drive to the target. Default origin. */
  tip?: Vec3;
}

export interface IKResult {
  /** Solved joint values, keyed by child node, one entry per DOF. */
  readonly values: Record<string, number[]>;
  readonly converged: boolean;
  readonly iterations: number;
  /** Final residual norm (position, plus orientation when targeted). */
  readonly error: number;
}

// ---------------------------------------------------------------------------
// Small vector / quaternion helpers
// ---------------------------------------------------------------------------

const IK_IDENTITY_POSE: JointPose = { position: [0, 0, 0], rotation: [1, 0, 0, 0] };

function applyPose(pose: JointPose, p: Vec3): Vec3 {
  const r = quatRotate(pose.rotation, p);
  return [r[0] + pose.position[0], r[1] + pose.position[1], r[2] + pose.position[2]];
}

function quatConjugate(q: Quat): Quat {
  return [q[0], -q[1], -q[2], -q[3]];
}

/**
 * The rotation vector (axis · angle) taking orientation `from` to `to`, i.e. the
 * angular error that drives `from` toward `to`. Returns the zero vector when the
 * orientations coincide.
 */
function rotationError(from: Quat, to: Quat): Vec3 {
  const d = quatMultiply(to, quatConjugate(from));
  let [w, x, y, z] = d;
  const norm = Math.hypot(w, x, y, z) || 1;
  w /= norm;
  x /= norm;
  y /= norm;
  z /= norm;
  if (w < 0) {
    // Shortest path: q and -q represent the same rotation.
    w = -w;
    x = -x;
    y = -y;
    z = -z;
  }
  const s = Math.hypot(x, y, z);
  if (s < 1e-12) return [0, 0, 0];
  const angle = 2 * Math.atan2(s, w);
  const k = angle / s;
  return [x * k, y * k, z * k];
}

// ---------------------------------------------------------------------------
// Chain extraction
// ---------------------------------------------------------------------------

/** Joints from the root down to `endEffector`, in root→leaf order. */
function chainTo(assembly: AssemblyNode, endEffector: string): Joint[] {
  const joints: Joint[] = [];
  walkAssembly(assembly, (n) => {
    if (n.joints) joints.push(...(n.joints as readonly Joint[]));
  });
  const byChild = new Map<string, Joint>();
  for (const j of joints) byChild.set(j.child, j);

  const chain: Joint[] = [];
  const seen = new Set<string>();
  let cur: string | undefined = endEffector;
  while (cur && byChild.has(cur) && !seen.has(cur)) {
    seen.add(cur);
    const j = byChild.get(cur);
    if (!j) break;
    chain.push(j);
    cur = j.parent;
  }
  return chain.reverse();
}

// ---------------------------------------------------------------------------
// Linear algebra (small dense systems, Float64Array to avoid index-undefined)
// ---------------------------------------------------------------------------

/** Read a Float64Array element as a definite number (dense matrices are full). */
function el(a: Float64Array, i: number): number {
  return a[i] ?? 0;
}

/** Solve `A x = b` for an `n×n` system by Gauss-Jordan with partial pivoting. */
function solveLinear(A: Float64Array, b: Float64Array, n: number): Float64Array | null {
  const w = n + 1;
  const M = new Float64Array(n * w);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) M[r * w + c] = el(A, r * n + c);
    M[r * w + n] = el(b, r);
  }
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(el(M, r * w + col)) > Math.abs(el(M, piv * w + col))) piv = r;
    }
    if (Math.abs(el(M, piv * w + col)) < 1e-12) return null;
    if (piv !== col) {
      for (let k = col; k < w; k++) {
        const tmp = el(M, col * w + k);
        M[col * w + k] = el(M, piv * w + k);
        M[piv * w + k] = tmp;
      }
    }
    const d = el(M, col * w + col);
    for (let k = col; k < w; k++) M[col * w + k] = el(M, col * w + k) / d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = el(M, r * w + col);
      if (f === 0) continue;
      for (let k = col; k < w; k++) M[r * w + k] = el(M, r * w + k) - f * el(M, col * w + k);
    }
  }
  const x = new Float64Array(n);
  for (let r = 0; r < n; r++) x[r] = el(M, r * w + n);
  return x;
}

// ---------------------------------------------------------------------------
// Inverse kinematics
// ---------------------------------------------------------------------------

interface FlatChain {
  /** Joint segments in root→leaf order, each owning `count` consecutive DOFs. */
  readonly segments: ReadonlyArray<{ child: string; count: number }>;
  /** Current parameter vector (one entry per DOF). */
  readonly q: Float64Array;
  /** Per-DOF lower and upper bounds. */
  readonly lo: Float64Array;
  readonly hi: Float64Array;
}

/** Flatten a chain's DOFs into a parameter vector with bounds, applying the seed. */
function flattenChain(
  chain: readonly Joint[],
  seed?: Readonly<Record<string, number | readonly number[]>>
): FlatChain {
  const segments: Array<{ child: string; count: number }> = [];
  const q: number[] = [];
  const lo: number[] = [];
  const hi: number[] = [];
  for (const j of chain) {
    const s = seed?.[j.child];
    segments.push({ child: j.child, count: j.dofs.length });
    j.dofs.forEach((dof, i) => {
      const seeded = Array.isArray(s) ? s[i] : i === 0 ? (s as number | undefined) : undefined;
      const v = seeded ?? dof.value;
      q.push(Math.min(dof.max, Math.max(dof.min, v)));
      lo.push(dof.min);
      hi.push(dof.max);
    });
  }
  return {
    segments,
    q: Float64Array.from(q),
    lo: Float64Array.from(lo),
    hi: Float64Array.from(hi),
  };
}

/** Slice a parameter vector back into per-joint value arrays keyed by child. */
function overridesOf(segments: FlatChain['segments'], q: Float64Array): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  let i = 0;
  for (const seg of segments) {
    const vals: number[] = [];
    for (let k = 0; k < seg.count; k++) vals.push(el(q, i++));
    out[seg.child] = vals;
  }
  return out;
}

/** Residual twist `e` (target − current) for a pose; returns its norm. */
function residualTwist(
  out: Float64Array,
  pose: JointPose,
  target: IKTarget,
  tip: Vec3,
  m: number
): number {
  const pos = applyPose(pose, tip);
  out[0] = target.position[0] - pos[0];
  out[1] = target.position[1] - pos[1];
  out[2] = target.position[2] - pos[2];
  if (m === 6 && target.rotation) {
    const r = rotationError(pose.rotation, target.rotation);
    out[3] = r[0];
    out[4] = r[1];
    out[5] = r[2];
  }
  let s = 0;
  for (let i = 0; i < m; i++) s += el(out, i) ** 2;
  return Math.sqrt(s);
}

/**
 * Finite-difference Jacobian: column `j` is the end-effector twist from δq[j].
 * The probe steps *inward* from a bound — `forwardKinematics` clamps each DOF to
 * its range, so a forward `+eps` at the upper limit would yield a zero column and
 * trap the solver at the ceiling. Stepping `-eps` there (and dividing by the
 * signed step) keeps every column a true one-sided derivative.
 */
function fillJacobian(
  J: Float64Array,
  q: Float64Array,
  n: number,
  m: number,
  lo: Float64Array,
  hi: Float64Array,
  base: JointPose,
  tip: Vec3,
  eps: number,
  tipPose: (s: Float64Array) => JointPose
): void {
  const basePos = applyPose(base, tip);
  for (let j = 0; j < n; j++) {
    const saved = el(q, j);
    // Step away from whichever bound we're against so the perturbation isn't
    // clamped to a no-op; default forward.
    const h = saved + eps > el(hi, j) && saved - eps >= el(lo, j) ? -eps : eps;
    q[j] = saved + h;
    const p2 = tipPose(q);
    q[j] = saved;
    const pos2 = applyPose(p2, tip);
    J[j] = (pos2[0] - basePos[0]) / h;
    J[n + j] = (pos2[1] - basePos[1]) / h;
    J[2 * n + j] = (pos2[2] - basePos[2]) / h;
    if (m === 6) {
      const dr = rotationError(base.rotation, p2.rotation);
      J[3 * n + j] = dr[0] / h;
      J[4 * n + j] = dr[1] / h;
      J[5 * n + j] = dr[2] / h;
    }
  }
}

/** One damped-least-squares step: `Δq = Jᵀ(JJᵀ + λ²I)⁻¹ e`. */
function dlsStep(
  J: Float64Array,
  e: Float64Array,
  n: number,
  m: number,
  lambda: number
): Float64Array | null {
  const A = new Float64Array(m * m);
  const lam2 = lambda * lambda;
  for (let r = 0; r < m; r++) {
    for (let c = 0; c < m; c++) {
      let s = 0;
      for (let k = 0; k < n; k++) s += el(J, r * n + k) * el(J, c * n + k);
      A[r * m + c] = s + (r === c ? lam2 : 0);
    }
  }
  const y = solveLinear(A, e, m);
  if (!y) return null;
  const dq = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    let v = 0;
    for (let r = 0; r < m; r++) v += el(J, r * n + j) * el(y, r);
    dq[j] = v;
  }
  return dq;
}

/**
 * Solve for the joint values that place `endEffector` (offset by `tip`) at
 * `target`, by damped-least-squares descent on a numerical Jacobian. Joint
 * ranges are honored: every iterate is clamped to each DOF's `[min, max]`.
 *
 * Returns the solved per-DOF values keyed by child node (ready to pass to
 * `forwardKinematics`), whether it converged, the iteration count, and the final
 * residual norm. An end-effector with no driving joints, or an unreachable
 * target, returns `converged: false` with the best configuration found.
 */
export function inverseKinematics(
  assembly: AssemblyNode,
  endEffector: string,
  target: IKTarget,
  options: IKOptions = {}
): IKResult {
  const maxIterations = options.maxIterations ?? 200;
  const tolerance = options.tolerance ?? 1e-5;
  const lambda = options.damping ?? 0.05;
  const tip: Vec3 = options.tip ?? [0, 0, 0];
  const m = target.rotation !== undefined ? 6 : 3;
  const eps = 1e-6;

  const { segments, q, lo, hi } = flattenChain(chainTo(assembly, endEffector), options.seed);
  const n = q.length;

  const tipPose = (state: Float64Array): JointPose =>
    forwardKinematics(assembly, overridesOf(segments, state)).get(endEffector) ?? IK_IDENTITY_POSE;

  const e = new Float64Array(m);
  const J = new Float64Array(m * n);

  let pose = tipPose(q);
  let err = residualTwist(e, pose, target, tip, m);
  let iter = 0;

  for (; iter < maxIterations && n > 0 && err > tolerance; iter++) {
    fillJacobian(J, q, n, m, lo, hi, pose, tip, eps, tipPose);
    const dq = dlsStep(J, e, n, m, lambda);
    if (!dq) break;
    for (let j = 0; j < n; j++) {
      const next = el(q, j) + el(dq, j);
      q[j] = Math.min(el(hi, j), Math.max(el(lo, j), next));
    }
    pose = tipPose(q);
    err = residualTwist(e, pose, target, tip, m);
  }

  return {
    values: overridesOf(segments, q),
    converged: err <= tolerance,
    iterations: iter,
    error: err,
  };
}

// ---------------------------------------------------------------------------
// Trajectories
// ---------------------------------------------------------------------------

export interface TrajectorySample {
  /** Normalized path parameter in `[0, 1]`. */
  readonly t: number;
  /** Interpolated joint values at this step, keyed by child node. */
  readonly values: Record<string, number[]>;
  /** Forward-kinematics world poses for every node at this step. */
  readonly poses: Map<string, JointPose>;
}

/** Resolve a value spec (number, array, or absent) to a per-DOF array. */
function valuesOf(joint: Joint, spec: number | readonly number[] | undefined): number[] {
  return joint.dofs.map((dof, i) => {
    const raw = Array.isArray(spec) ? spec[i] : i === 0 ? (spec as number | undefined) : undefined;
    const v = raw ?? dof.value;
    return Math.min(dof.max, Math.max(dof.min, v));
  });
}

/**
 * Sample a straight-line path in joint space from `from` to `to` over `steps`
 * segments, yielding `steps + 1` samples (inclusive of both endpoints). Each
 * sample carries the interpolated per-DOF values (clamped to range) and the
 * forward-kinematics poses of every node. Joints absent from `from`/`to` hold
 * their stored value at both ends.
 */
export function jointTrajectory(
  assembly: AssemblyNode,
  from: Readonly<Record<string, number | readonly number[]>>,
  to: Readonly<Record<string, number | readonly number[]>>,
  steps: number
): TrajectorySample[] {
  const joints: Joint[] = [];
  walkAssembly(assembly, (n) => {
    if (n.joints) joints.push(...(n.joints as readonly Joint[]));
  });

  const ends = joints.map((j) => ({
    child: j.child,
    a: valuesOf(j, from[j.child]),
    b: valuesOf(j, to[j.child]),
  }));

  const count = Math.max(1, Math.floor(steps));
  const samples: TrajectorySample[] = [];
  for (let s = 0; s <= count; s++) {
    const t = s / count;
    const values: Record<string, number[]> = {};
    for (const end of ends) {
      values[end.child] = end.a.map((a, i) => a + ((end.b[i] ?? a) - a) * t);
    }
    samples.push({ t, values, poses: forwardKinematics(assembly, values) });
  }
  return samples;
}

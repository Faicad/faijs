/**
 * faijs unit system — the single source of truth for dimensions and units.
 *
 * Every dimensioned value in faijs is stored in the **base unit** of its
 * dimension, and units are pure scale factors relative to that base. This
 * module is a zero-dependency leaf: it must not import `lang/`, any op
 * registry, `occt-kernel/*` or `brepkit-kernel/*`, because it feeds the
 * serialization pipeline (codegen), platform-neutral imports, and static
 * dimension checks without dragging in a WASM chain.
 *
 * Base units (user-裁定, 2026-09-28):
 *   length: mm | angle: degree | mass: gram | temperature: kelvin
 *   time: second | current: ampere
 *
 * `ValueWithUnits.value` is ALWAYS the base-unit numeric value. There is no
 * "this value remembers it is inches" — conversion happens only at construction
 * (`inch.mul(2)`) and extraction (`.as(mm)`), which mirrors Onshape's design
 * but with faijs's own base table (NOT Onshape's meter/radian — do not copy
 * those numeric values).
 */

/** Base dimensions of the system. Higher powers are built by exponents. */
export type BaseDimension =
  | 'length'
  | 'angle'
  | 'mass'
  | 'temperature'
  | 'time'
  | 'current'

/** A dim name is any base dimension. */
export type DimName = BaseDimension

/**
 * A unit name. `micron/mm/cm/m/inch/foot/meter` are the six legal values of
 * the 3MF `<model unit>` enum and must all be present in `UNIT_SCALE`.
 */
export type UnitName =
  | 'mm' | 'cm' | 'm' | 'micron' | 'inch' | 'foot' | 'yard'
  | 'degree' | 'radian' | 'gram' | 'kilogram' | 'second'

/**
 * A dimension = a sparse map of base dimension → exponent (absent ⇒ 0).
 * Implemented as a frozen plain object.
 */
export type UnitSpec = Readonly<Partial<Record<BaseDimension, number>>>

/**
 * True when two specs have identical exponents for every base dimension.
 * @param a - first spec.
 * @param b - second spec.
 * @returns `true` if every base-dimension exponent matches.
 */
export function unitEquals(a: UnitSpec, b: UnitSpec): boolean {
  for (const dim of ALL_DIMS) {
    const ea = a[dim] ?? 0
    const eb = b[dim] ?? 0
    if (ea !== eb) return false
  }
  return true
}

/** All base dimensions, in a stable order. */
const ALL_DIMS: readonly BaseDimension[] = [
  'length', 'angle', 'mass', 'temperature', 'time', 'current',
]

/** Dimension spec for length (length^1). */
export const LENGTH: UnitSpec = Object.freeze({ length: 1 })
/** Dimension spec for area (length^2). */
export const AREA: UnitSpec = Object.freeze({ length: 2 })
/** Dimension spec for volume (length^3). */
export const VOLUME: UnitSpec = Object.freeze({ length: 3 })
/** Dimension spec for angle (angle^1). */
export const ANGLE: UnitSpec = Object.freeze({ angle: 1 })
/** Dimension spec for mass (mass^1). */
export const MASS: UnitSpec = Object.freeze({ mass: 1 })
/** Dimension spec for temperature (temperature^1). */
export const TEMPERATURE: UnitSpec = Object.freeze({ temperature: 1 })
/** Dimension spec for time (time^1). */
export const TIME: UnitSpec = Object.freeze({ time: 1 })
/** Dimension spec for electric current (current^1). */
export const CURRENT: UnitSpec = Object.freeze({ current: 1 })

/**
 * The dimension spec of a named base dimension.
 * @param dim - a base dimension name.
 * @returns the corresponding `UnitSpec`.
 */
export function specOfDim(dim: DimName): UnitSpec {
  switch (dim) {
    case 'length': return LENGTH
    case 'angle': return ANGLE
    case 'mass': return MASS
    case 'temperature': return TEMPERATURE
    case 'time': return TIME
    case 'current': return CURRENT
  }
}

/**
 * A value carrying an immutable dimension. All arithmetic is method-style —
 * there is no operator overloading in TS. `value` is always expressed in the
 * base unit of its dimension.
 */
export class ValueWithUnits {
  /** The numeric magnitude, always expressed in the base unit of the dimension. */
  readonly value: number
  /** The dimension spec (which base dimensions are present and with what exponent). */
  readonly spec: UnitSpec

  constructor(value: number, spec: UnitSpec) {
    this.value = value
    this.spec = issueFrozen(spec)
  }

  /**
   * Add another value; both must share the same dimension.
   * @param rhs - the value to add (must have the same dimension).
   * @returns a new `ValueWithUnits` whose value is `this.value + rhs.value`.
   */
  add(rhs: ValueWithUnits): ValueWithUnits {
    requireSameDim(this, rhs, 'add')
    return new ValueWithUnits(this.value + rhs.value, this.spec)
  }

  /**
   * Subtract another value; both must share the same dimension.
   * @param rhs - the value to subtract (must have the same dimension).
   * @returns a new `ValueWithUnits` whose value is `this.value - rhs.value`.
   */
  sub(rhs: ValueWithUnits): ValueWithUnits {
    requireSameDim(this, rhs, 'sub')
    return new ValueWithUnits(this.value - rhs.value, this.spec)
  }

  /**
   * Negate.
   * @returns a new `ValueWithUnits` with the negated magnitude.
   */
  neg(): ValueWithUnits {
    return new ValueWithUnits(-this.value, this.spec)
  }

  /**
   * Scale by a dimensionless number.
   * @param n - a dimensionless scalar.
   * @returns a new `ValueWithUnits` with the scaled magnitude.
   */
  mul(n: number): ValueWithUnits {
    return new ValueWithUnits(this.value * n, this.spec)
  }

  /**
   * Divide by a dimensionless number.
   * @param n - a dimensionless scalar.
   * @returns a new `ValueWithUnits` with the divided magnitude.
   */
  div(n: number): ValueWithUnits {
    return new ValueWithUnits(this.value / n, this.spec)
  }

  /**
   * The ratio to another value of the same dimension (dimensionless result).
   * @param rhs - the divisor (must have the same dimension).
   * @returns the dimensionless ratio `this.value / rhs.value`.
   */
  divBy(rhs: ValueWithUnits): number {
    requireSameDim(this, rhs, 'divBy')
    return this.value / rhs.value
  }

  /**
   * Raise to an integer power; each exponent times n must stay an integer.
   * @param n - the integer power.
   * @returns a new `ValueWithUnits` with exponents multiplied by `n`.
   */
  pow(n: number): ValueWithUnits {
    if (!Number.isInteger(n)) {
      throw dimensionalError('pow exponent must be an integer', this)
    }
    const out: Record<BaseDimension, number> = { length: 0, angle: 0, mass: 0, temperature: 0, time: 0, current: 0 }
    for (const dim of ALL_DIMS) {
      const e = this.spec[dim] ?? 0
      const ne = e * n
      if (!Number.isInteger(ne)) {
        throw new Error(
          `[units] pow(${n}) would produce a non-integer exponent ${ne} for dimension ${dim}`,
        )
      }
      out[dim] = ne
    }
    return new ValueWithUnits(this.value ** n, normalizeSpec(out))
  }

  /**
   * Extract the numeric magnitude expressed in another unit (dimension must match).
   * @param unit - a `ValueWithUnits` representing 1 of the target unit.
   * @returns the magnitude in that unit.
   */
  as(unit: ValueWithUnits): number {
    requireSameDim(this, unit, 'as')
    return this.value / unit.value
  }

  /**
   * True when the magnitude is ~0 (within an optional same-dimension epsilon).
   * @param eps - optional same-dimension epsilon; defaults to 1e-9 base units.
   * @returns `true` when `|value| <= eps`.
   */
  eqZero(eps?: ValueWithUnits): boolean {
    if (eps === undefined) {
      // Default epsilon is one atomic stride of the base unit.
      return Math.abs(this.value) <= 1e-9
    }
    requireSameDim(this, eps, 'eqZero')
    return Math.abs(this.value) <= Math.abs(eps.value)
  }
}

/** Builder for an error that carries both dimensions of a mismatch. */
function dimensionalError(action: string, a: ValueWithUnits, b?: ValueWithUnits): Error {
  const extras = b === undefined ? '' : ` vs {${describeSpec(b.spec)}}`
  return new Error(
    `[units] dimension mismatch in \`${action}\`: {${describeSpec(a.spec)}}${extras}`,
  )
}

function requireSameDim(a: ValueWithUnits, b: ValueWithUnits, action: string): void {
  if (!unitEquals(a.spec, b.spec)) throw dimensionalError(action, a, b)
}

function describeSpec(spec: UnitSpec): string {
  const parts = ALL_DIMS.filter((d) => (spec[d] ?? 0) !== 0)
    .map((d) => `${d}^${spec[d]}`)
  return parts.length ? parts.join('·') : 'dimensionless'
}

/** Freeze a spec; never expose a mutable spec to callers. */
function issueFrozen(spec: UnitSpec): UnitSpec {
  return Object.freeze({ ...spec })
}

function normalizeSpec(spec: Record<BaseDimension, number>): UnitSpec {
  return Object.freeze({ ...spec })
}

// ── Single-source-of-truth tables ──────────────────────────────────────────
// `UNIT_SCALE` + `UNIT_DIM` are the only data. `UNIT_DIMS`, the typed
// constants, the pure-number constants and everything else derive from them.

/**
 * Unit name → base-unit scale factor. `length`: 1 mm; `angle`: 1 degree;
 * `mass`: 1 gram; `time`: 1 second.
 */
export const UNIT_SCALE: Readonly<Record<UnitName, number>> = Object.freeze({
  // length (base = mm)
  mm: 1,
  cm: 10,
  m: 1000,
  micron: 0.001,
  inch: 25.4,
  foot: 304.8,
  yard: 914.4,
  // angle (base = degree)
  degree: 1,
  radian: 180 / Math.PI,
  // mass (base = gram)
  gram: 1,
  kilogram: 1000,
  // time (base = second)
  second: 1,
})

/** Unit name → the dimension it measures. */
export const UNIT_DIM: Readonly<Record<UnitName, DimName>> = Object.freeze({
  mm: 'length', cm: 'length', m: 'length', micron: 'length',
  inch: 'length', foot: 'length', yard: 'length',
  degree: 'angle', radian: 'angle',
  gram: 'mass', kilogram: 'mass',
  second: 'time',
})

/** Derived: unit name → UnitSpec. */
export const UNIT_DIMS: Readonly<Record<UnitName, UnitSpec>> = Object.freeze(
  (Object.keys(UNIT_SCALE) as UnitName[]).reduce((acc, name) => {
    acc[name] = specOfDim(UNIT_DIM[name])
    return acc
  }, {} as Record<UnitName, UnitSpec>),
)

// ── Typed constants (ValueWithUnits) ────────────────────────────────────────

/** 1 mm — the base length unit. */
export const mm = new ValueWithUnits(1, LENGTH)
/** 1 cm = 10 mm. */
export const centimeter = new ValueWithUnits(10, LENGTH)
/** 1 m = 1000 mm. */
export const meter = new ValueWithUnits(1000, LENGTH)
/** 1 micron = 0.001 mm (one of the 3MF unit enum values). */
export const micron = new ValueWithUnits(0.001, LENGTH)
/** 1 inch = 25.4 mm. */
export const inch = new ValueWithUnits(25.4, LENGTH)
/** 1 foot = 304.8 mm. */
export const foot = new ValueWithUnits(304.8, LENGTH)
/** 1 yard = 914.4 mm. */
export const yard = new ValueWithUnits(914.4, LENGTH)

/** The base angle unit — 1 degree. */
export const degree = new ValueWithUnits(1, ANGLE)
/** 1 radian = 180/π degrees (base is degree). */
export const radian = new ValueWithUnits(180 / Math.PI, ANGLE)

/** 1 gram (base mass unit). */
export const gram = new ValueWithUnits(1, MASS)
/** 1 kilogram = 1000 gram. */
export const kilogram = new ValueWithUnits(1000, MASS)
/** 1 second (base time unit). */
export const second = new ValueWithUnits(1, TIME)

// ── Pure-number constants (number) = base-unit scale ────────────────────────
// TS library code that calls geometric ops directly uses these bare numbers
// (D4): `const L = 10 * INCH; cad.box({ size: [L, 20 * MM, 30 * MM] })`.

/** 1 (mm). */
export const MM = 1
/** 10 (mm). */
export const CM = 10
/** 1000 (mm). */
export const M = 1000
/** 0.001 (mm). */
export const MICRON = 0.001
/** 25.4 (mm). */
export const INCH = 25.4
/** 304.8 (mm). */
export const FOOT = 304.8
/** 914.4 (mm). */
export const YARD = 914.4
/** 1 (degree). */
export const DEGREE = 1
/** 180/π (degree). */
export const RADIAN = 180 / Math.PI

// ── System display unit ─────────────────────────────────────────────────────

/**
 * The system display unit context, owned by the host (never a module-level
 * global). Defaults to the base units.
 */
export interface UnitContext {
  length: UnitName
  angle: UnitName
}

/** Base display units (mm / degree). */
export const BASE_UNITS: UnitContext = Object.freeze({ length: 'mm', angle: 'degree' })

/**
 * The display unit for a dimension within a context. Only `length` and
 * `angle` are host-settable; all other dimensions fall back to their base unit.
 * @param dim - the dimension to look up.
 * @param ctx - the system unit context; defaults to base units.
 * @returns the unit name.
 */
export function unitFor(dim: DimName, ctx?: UnitContext): UnitName {
  if (dim === 'length' || dim === 'angle') {
    return (ctx ?? BASE_UNITS)[dim]
  }
  // mass / temperature / time / current have no display override → their base.
  switch (dim) {
    case 'mass': return 'gram'
    case 'temperature': return 'kelvin' as UnitName
    case 'time': return 'second'
    case 'current': return 'ampere' as UnitName
    default: return 'mm'
  }
}

/**
 * Scale factor of a unit name relative to the base unit.
 * @param name - the unit name.
 * @returns the scale factor (e.g. `inch` → `25.4`).
 */
export function unitScale(name: UnitName): number {
  return UNIT_SCALE[name]
}

/**
 * Convert a value given in a display unit to the base-unit value.
 * @param n - the value in `unitName`.
 * @param unitName - the source unit.
 * @param dimensionName - the dimension (for validation).
 * @returns the base-unit (mm/degree/...) value.
 */
export function toBase(n: number, unitName: UnitName, dimensionName: DimName): number {
  requireDim(unitName, dimensionName)
  return n * UNIT_SCALE[unitName]
}

/**
 * Convert a base-unit value into a display unit.
 * @param base - the base-unit (mm/degree/...) value.
 * @param unitName - the target unit.
 * @param dimensionName - the dimension (for validation).
 * @returns the value expressed in `unitName`.
 */
export function fromBase(base: number, unitName: UnitName, dimensionName: DimName): number {
  requireDim(unitName, dimensionName)
  return base / UNIT_SCALE[unitName]
}

/** Throw when a unit is not a member of a dimension. */
function requireDim(unitName: UnitName, dimensionName: DimName): void {
  if (UNIT_DIM[unitName] !== dimensionName) {
    throw new Error(`[units] unit '${unitName}' is ${UNIT_DIM[unitName]}; expected ${dimensionName}`)
  }
}

/**
 * True when the value has dimension length.
 * @param v - the value to check.
 * @returns `true` if `v.spec` equals `LENGTH`.
 */
export function isLength(v: ValueWithUnits): boolean {
  return unitEquals(v.spec, LENGTH)
}

/**
 * True when the value has dimension angle.
 * @param v - the value to check.
 * @returns `true` if `v.spec` equals `ANGLE`.
 */
export function isAngle(v: ValueWithUnits): boolean {
  return unitEquals(v.spec, ANGLE)
}
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CAM_MACHINE_PROFILE,
  DEFAULT_CAM_STOCK_PROFILE,
  mergeCamMachineProfile,
  mergeCamStockProfile,
  normalizeCamMachineProfile,
  normalizeCamStockProfile,
} from '../src/profile.js'

describe('normalizeCamMachineProfile', () => {
  it('returns the default profile for empty input', () => {
    expect(normalizeCamMachineProfile(null)).toEqual(DEFAULT_CAM_MACHINE_PROFILE)
    expect(normalizeCamMachineProfile({})).toEqual(DEFAULT_CAM_MACHINE_PROFILE)
  })

  it('normalizes controller flavor with fallback to grbl', () => {
    expect(normalizeCamMachineProfile({ controller: 'LINUXCNC' }).controller).toBe('linuxcnc')
    expect(normalizeCamMachineProfile({ controller: 'fanuc' }).controller).toBe('fanuc')
    expect(normalizeCamMachineProfile({ controller: 'weird' }).controller).toBe('grbl')
  })

  it('clamps negative maxSpindleRPM and defaultRapidRate', () => {
    const profile = normalizeCamMachineProfile({ maxSpindleRPM: -100, defaultRapidRate: -5 })
    expect(profile.maxSpindleRPM).toBe(0)
    expect(profile.defaultRapidRate).toBe(1)
  })

  it('keeps tokenSpacer true and stripComments false by default', () => {
    const profile = normalizeCamMachineProfile({})
    expect(profile.tokenSpacer).toBe(true)
    expect(profile.stripComments).toBe(false)
    expect(normalizeCamMachineProfile({ tokenSpacer: false, stripComments: true })).toMatchObject({
      tokenSpacer: false,
      stripComments: true,
    })
  })
})

describe('mergeCamMachineProfile', () => {
  it('picks up partial patches on top of defaults', () => {
    const merged = mergeCamMachineProfile(null, { name: 'My Mill', maxSpindleRPM: 30000 })
    expect(merged.name).toBe('My Mill')
    expect(merged.maxSpindleRPM).toBe(30000)
    expect(merged.safeParkZ).toBe(DEFAULT_CAM_MACHINE_PROFILE.safeParkZ)
  })
})

describe('normalizeCamStockProfile', () => {
  it('returns defaults for empty input', () => {
    expect(normalizeCamStockProfile(null)).toEqual(DEFAULT_CAM_STOCK_PROFILE)
  })

  it('infers fixed mode when a size is provided', () => {
    const profile = normalizeCamStockProfile({ sizeX: 60, sizeY: 40, sizeZ: 20 })
    expect(profile.mode).toBe('fixed')
    expect(profile.sizeX).toBe(60)
    expect(profile.sizeY).toBe(40)
    expect(profile.sizeZ).toBe(20)
  })

  it('rejects non-positive fixed sizes as null', () => {
    const profile = normalizeCamStockProfile({ sizeX: 0, sizeY: -1 })
    expect(profile.sizeX).toBeNull()
    expect(profile.sizeY).toBeNull()
  })

  it('keeps auto mode with margin when no size is given', () => {
    const profile = normalizeCamStockProfile({ mode: 'auto', margin: 2 })
    expect(profile.mode).toBe('auto')
    expect(profile.margin).toBe(2)
  })
})

describe('mergeCamStockProfile', () => {
  it('merges partial patches', () => {
    const merged = mergeCamStockProfile(null, { margin: 1.5 })
    expect(merged.margin).toBe(1.5)
    expect(merged.sizeX).toBeNull()
  })
})

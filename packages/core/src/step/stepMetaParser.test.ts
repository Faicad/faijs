import { describe, expect, it } from 'vitest'
import { parseStepHeaderMeta, parseStepPartMeta } from './stepMetaParser'

const SAMPLE = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('Gearbox step export','variant A'),'2;1');
FILE_NAME('Gearbox v1','2026-10-05T12:00:00',('Faicad'),('Engineering'),'faijs','cad');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));
ENDSEC;
DATA;
#1=PRODUCT('P1','Input housing assembly','',(#2));
#20=PROPERTY_DEFINITION('p20','Source',#1);
#10=GENERAL_PROPERTY('source','designed',#20);
ENDSEC;
END-ISO-10303-21;
`

describe('parseStepHeaderMeta', () => {
  it('maps FILE_NAME fields onto FileMeta', () => {
    const m = parseStepHeaderMeta(SAMPLE)
    expect(m.title).toBe('Gearbox v1')
    expect(m.creationDate).toBe('2026-10-05T12:00:00')
    expect(m.author).toBe('Faicad')
    expect(m.organization).toBe('Engineering')
    expect(m.application).toBe('faijs') // preprocessor → application
    expect(m.designer).toBe('cad') // originator → designer
    expect(m.description).toBe('Gearbox step export, variant A')
  })

  it('empty header → no fields', () => {
    expect(parseStepHeaderMeta('ISO-10303-21;HEADER;ENDSEC;DATA;')).toEqual({})
  })
})

describe('parseStepPartMeta', () => {
  it('extracts first PRODUCT description', () => {
    const m = parseStepPartMeta(SAMPLE)
    expect(m.description).toBe('Input housing assembly')
  })
})

it('asserts SAMPLE fixtures contain the tokens the parser targets', () => {
  expect(SAMPLE).toContain("FILE_NAME('Gearbox v1'")
  expect(SAMPLE).toContain("#1=PRODUCT('P1'")
})
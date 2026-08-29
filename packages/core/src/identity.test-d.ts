/**
 * identity.test-d.ts - brand type negative cases (@ts-expect-error).
 * Any stale @ts-expect-error (no longer an error) fails `tsc --noEmit`.
 */
import {
  asStmtId, asPartName, asScopedId, asFileId, asInnerId, asReferenceId,
  type StmtId, type PartName, type ScopedId, type FileId, type InnerId,
  type FaceId, type EdgeId, type OccurrenceId, type ReferenceId, type ShapeId,
} from './identity'

// bare string is not a brand
// @ts-expect-error bare string is not assignable to StmtId
const bad1: StmtId = 'part0'
// @ts-expect-error bare string is not assignable to PartName
const bad2: PartName = 'part0'
// @ts-expect-error bare string is not assignable to ScopedId
const bad3: ScopedId = 'file1:part0'

// brands are not mutually assignable
const stmtId: StmtId = asStmtId('part0')
const partName: PartName = asPartName('part0')
const scopedId: ScopedId = asScopedId('file1:part0')
const fileId: FileId = asFileId('file1')
const innerId: InnerId = asInnerId('part0')

// @ts-expect-error StmtId not assignable to PartName
const bad4: PartName = stmtId
// @ts-expect-error PartName not assignable to StmtId
const bad5: StmtId = partName
// @ts-expect-error ScopedId not assignable to FileId
const bad6: FileId = scopedId
// @ts-expect-error FileId not assignable to InnerId
const bad7: InnerId = fileId
// @ts-expect-error FileId not assignable to ScopedId
const bad8: ScopedId = fileId

// topology row brands are distinct
const faceId: FaceId = asReferenceId('topology|face|a') as unknown as FaceId
// @ts-expect-error FaceId not assignable to EdgeId
const bad9: EdgeId = faceId
// @ts-expect-error ScopedId not assignable to FaceId
const bad10: FaceId = scopedId

// positive: as* trust points are valid
const occOk: OccurrenceId = faceId as unknown as OccurrenceId
const shapeOk: ShapeId = occOk as unknown as ShapeId
const refOk: ReferenceId = shapeOk as unknown as ReferenceId
void [bad1, bad2, bad3, bad4, bad5, bad6, bad7, bad8, bad9, bad10]
void [stmtId, partName, scopedId, fileId, innerId]
void [faceId, occOk, shapeOk, refOk]
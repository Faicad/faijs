/**
 * pick — FSA 能力探测 + 目录句柄获取（folder 通道专用）。
 *
 * 全仓唯一接触 `window.*` 的模块；不碰状态栏（状态栏文案由调用方处理）。
 */
import type { FsDirectoryHandleLike } from './types'

/** 目录选择结果（含 name 显示；取消/拒绝 → null）。 */
export type PickedDirectory = FsDirectoryHandleLike & { name?: string }

/**
 * 能力缺失 → 抛 Error('File System Access API 不可用（需要 Chrome/Edge 或 localhost/HTTPS）')；
 * 用户取消 / 拒绝授权 / 任何 rejection → 返回 null（不抛）。
 * @returns the picked directory handle, or null when the user cancels/denies the picker.
 */
export async function pickProjectDirectory(): Promise<PickedDirectory | null> {
  const w = window as unknown as {
    showDirectoryPicker?: (opts?: { mode?: 'read' | 'readwrite' }) => Promise<PickedDirectory>
  }
  if (typeof w.showDirectoryPicker !== 'function') {
    throw new Error('File System Access API 不可用（需要 Chrome/Edge 或 localhost/HTTPS）')
  }
  try {
    return await w.showDirectoryPicker({ mode: 'read' })
  } catch {
    return null
  }
}
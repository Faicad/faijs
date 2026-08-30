/**
 * blob-store — 内存 Blob 存储（测试用）
 *
 * 简单的 Map<string, ArrayBuffer> 实现，替代浏览器端的 FileBlobStore。
 * 供测试中的 AssetResolver 使用。
 */

const _store = new Map<string, ArrayBuffer>()
let _nextId = 0

/** In-memory Blob store singleton used by tests, replacing the browser FileBlobStore. */
export const fileBlobStore = {
  get(key: string): ArrayBuffer | undefined {
    return _store.get(key)
  },
  put(buffer: ArrayBuffer): string {
    const key = `blob-${_nextId++}`
    _store.set(key, buffer)
    return key
  },
  release(key: string): void {
    _store.delete(key)
  },
  clear(): void {
    _store.clear()
  },
}

import type { HostPorts } from '@faicad/faijs/browser'

/** 引擎契约投影：不深导入 core 内部路径，也不引入新的包依赖。 */
export type ProjectLoader = NonNullable<HostPorts['projectLoader']>

/** 可枚举/可下钻的目录句柄最小接口（structurally 兼容 FileSystemDirectoryHandle 与 OPFS）。 */
export type FsDirectoryHandleLike = {
  kind?: string
  entries?: () => AsyncIterable<[string, FsEntryHandleLike]>
  getDirectoryHandle?: (name: string, opts?: { create?: boolean }) => Promise<FsDirectoryHandleLike>
  getFileHandle?: (name: string, opts?: { create?: boolean }) => Promise<FsFileHandleLike>
}

/** 文件句柄最小接口（`getFile()` 返回类 File 对象，只需 `.text()`）。 */
export type FsFileHandleLike = {
  kind?: string
  getFile?: () => Promise<{ text(): Promise<string> }>
}

/** 条目句柄（浏览器 `entries()` 产出的元素类型）。 */
export type FsEntryHandleLike = FsDirectoryHandleLike | FsFileHandleLike

/** demo 侧加载器：引擎契约 + 应用侧刷新能力。两个通道（folder / zip）都实现它。 */
export interface DemoProjectLoader extends ProjectLoader {
  /** 重新枚举模块清单（folder 通道需刷新；zip 通道为 no-op，见 zip-loader B4）。 */
  refresh(): Promise<void>
}
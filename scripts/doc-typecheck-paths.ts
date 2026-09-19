/** Map one workspace source alias target to its declaration-build target. */
export function builtDeclarationPath(candidate: string): string {
  // Two workspace path forms exist: whole-package entries end in /src, subpath
  // wildcards (the browser-safe /api and /client channels) in /src/*.
  if (candidate.endsWith('/src')) {
    return `${candidate.slice(0, -'/src'.length)}/dist`
  }
  if (candidate.endsWith('/src/*')) {
    return `${candidate.slice(0, -'/src/*'.length)}/dist/*`
  }
  const sourceFile = /^(.*)\/src\/(.+)\.ts$/.exec(candidate)
  if (sourceFile?.[1] && sourceFile[2]) {
    return `${sourceFile[1]}/dist/${sourceFile[2]}.d.ts`
  }
  // Directory subpath entries (for example, runtime's /client): the
  // source dir maps to the same dir under dist (index resolution applies).
  const sourceDir = /^(.*)\/src\/(.+)$/.exec(candidate)
  if (sourceDir?.[1] && sourceDir[2]) {
    return `${sourceDir[1]}/dist/${sourceDir[2]}`
  }
  throw new Error(`doc-typecheck: cannot map workspace source path to built declarations: ${candidate}`)
}

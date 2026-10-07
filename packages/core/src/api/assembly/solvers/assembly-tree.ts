/**
 * Assembly tree — core 自有实现（§5.6 移植：brepjs assemblyFns 逐字对齐，纯数据结构）。
 *
 * An assembly is a tree of nodes. Each node has an optional shape,
 * a local transform (translation + rotation), optional metadata,
 * and child nodes. This is a pure data structure with no kernel calls.
 *
 * Usage:
 *   const asm = createAssemblyNode('root')
 *     |> addChild(_, createAssemblyNode('part-a', { shape: boxShape, translate: [10, 0, 0] }))
 *     |> addChild(_, createAssemblyNode('part-b', { shape: cylShape }));
 */

import type { Shape } from '../../../mesh/types'

/** 3D vector（core 本地别名，§5.6 移植）。 */
export type Vec3 = readonly [number, number, number];

// ---------------------------------------------------------------------------
// Assembly types
// ---------------------------------------------------------------------------

/**
 * A node in an assembly tree: optional shape, local transform, metadata, and children.
 */
export interface AssemblyNode {
  readonly name: string;
  readonly shape?: Shape;
  readonly translate?: Vec3;
  readonly rotate?: { angle: number; axis?: Vec3 };
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly children: ReadonlyArray<AssemblyNode>;
  readonly mates?: readonly unknown[];
  /** Drivable kinematic joints (see jointFns). Typed loosely to avoid a cycle. */
  readonly joints?: readonly unknown[];
}

/** Optional properties for creating or updating an assembly node. */
export interface AssemblyNodeOptions {
  shape?: Shape;
  translate?: Vec3;
  rotate?: { angle: number; axis?: Vec3 };
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Constructors
// ---------------------------------------------------------------------------

/**
 * Create a new assembly node.
 * @param name - Name of the node.
 * @param options - Optional shape, transform, and metadata.
 * @returns The newly created assembly node.
 */
export function createAssemblyNode(name: string, options: AssemblyNodeOptions = {}): AssemblyNode {
  return {
    name,
    children: [],
    ...(options.shape !== undefined ? { shape: options.shape } : {}),
    ...(options.translate !== undefined ? { translate: options.translate } : {}),
    ...(options.rotate !== undefined ? { rotate: options.rotate } : {}),
    ...(options.metadata !== undefined ? { metadata: options.metadata } : {}),
  };
}

// ---------------------------------------------------------------------------
// Immutable tree operations
// ---------------------------------------------------------------------------

/**
 * Add a child node. Returns a new parent node.
 * @param parent - The parent node to extend.
 * @param child - The child node to append.
 * @returns A new parent node with the child added.
 */
export function addChild(parent: AssemblyNode, child: AssemblyNode): AssemblyNode {
  return { ...parent, children: [...parent.children, child] };
}

/**
 * Remove a child by name (first match). Returns a new parent node.
 * @param parent - The parent node to modify.
 * @param childName - Name of the child to remove.
 * @returns A new parent node with the child removed.
 */
export function removeChild(parent: AssemblyNode, childName: string): AssemblyNode {
  const idx = parent.children.findIndex((c) => c.name === childName);
  if (idx === -1) return parent;
  const children = [...parent.children];
  children.splice(idx, 1);
  return { ...parent, children };
}

/**
 * Update a node's properties. Returns a new node.
 * @param node - The node to update.
 * @param updates - Partial options to apply.
 * @returns A new node with the updates applied.
 */
export function updateNode(
  node: AssemblyNode,
  updates: Partial<AssemblyNodeOptions>
): AssemblyNode {
  return {
    ...node,
    ...(updates.shape !== undefined ? { shape: updates.shape } : {}),
    ...(updates.translate !== undefined ? { translate: updates.translate } : {}),
    ...(updates.rotate !== undefined ? { rotate: updates.rotate } : {}),
    ...(updates.metadata !== undefined ? { metadata: updates.metadata } : {}),
  };
}

// ---------------------------------------------------------------------------
// Traversal
// ---------------------------------------------------------------------------

/**
 * Find a node by name (depth-first). Returns undefined if not found.
 * @param root - Root of the subtree to search.
 * @param name - Name of the node to find.
 * @returns The first matching node, or undefined.
 */
export function findNode(root: AssemblyNode, name: string): AssemblyNode | undefined {
  if (root.name === name) return root;
  for (const child of root.children) {
    const found = findNode(child, name);
    if (found) return found;
  }
  return undefined;
}

/**
 * Walk the tree depth-first, calling visitor for each node.
 * @param root - Root node to walk from.
 * @param visitor - Callback invoked with each node and its depth.
 * @param depth - Starting depth (used internally for recursion).
 * @returns Nothing.
 */
export function walkAssembly(
  root: AssemblyNode,
  visitor: (node: AssemblyNode, depth: number) => void,
  depth = 0
): void {
  visitor(root, depth);
  for (const child of root.children) {
    walkAssembly(child, visitor, depth + 1);
  }
}

/**
 * Count all nodes in the tree.
 * @param root - Root node to count from.
 * @returns Total number of nodes including the root.
 */
export function countNodes(root: AssemblyNode): number {
  let count = 1;
  for (const child of root.children) {
    count += countNodes(child);
  }
  return count;
}

/**
 * Collect all shapes in the tree (depth-first).
 * @param root - Root node to collect from.
 * @returns All shapes found on nodes in the tree.
 */
export function collectShapes(root: AssemblyNode): Shape[] {
  const shapes: Shape[] = [];
  walkAssembly(root, (node) => {
    if (node.shape) shapes.push(node.shape);
  });
  return shapes;
}

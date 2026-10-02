"""Dump Python AST as JSON for the faijs CadQuery transpiler."""
import ast
import json
import sys


def _serialize(node):
    if isinstance(node, ast.AST):
        out = {"_type": node.__class__.__name__}
        for field, value in ast.iter_fields(node):
            out[field] = _serialize(value)
        return out
    if isinstance(node, list):
        return [_serialize(x) for x in node]
    if isinstance(node, (int, float, str, bool)) or node is None:
        return node
    return repr(node)


def main():
    path = sys.argv[1]
    with open(path, "r", encoding="utf-8") as f:
        source = f.read()
    tree = ast.parse(source, filename=path)
    print(json.dumps(_serialize(tree), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

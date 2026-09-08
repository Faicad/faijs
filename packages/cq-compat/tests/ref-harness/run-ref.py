"""run-ref.py — export CadQuery reference STEP assets from the locked baseline.

Reads ``tests/baseline.json``, materializes the locked CadQuery tag's tests/
into a cache directory (read-only w.r.t. the user's checkout: ``git archive``
never touches the working tree), and runs the modeling test suite through the
``cq_step_plugin`` pytest plugin to produce:

    out/ref/<module>__<Class>__<test>__<var>.step
    out/ref/manifest.json

Usage (from packages/cq-compat):
    python tests/ref-harness/run-ref.py [--modules test_cadquery,...] [--force]

See docs/plans/2026-09-08-cq-compat-cadquery-parity.md §4–§5.
"""

import argparse
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PKG = os.path.abspath(os.path.join(HERE, "..", ".."))  # packages/cq-compat
BASELINE = os.path.join(PKG, "tests", "baseline.json")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--modules", help="comma-separated module names (default: baseline.json targetModules)")
    ap.add_argument("--force", action="store_true", help="re-extract the tag snapshot even if cached")
    args = ap.parse_args()

    with open(BASELINE, encoding="utf-8") as f:
        baseline = json.load(f)

    src = baseline["cadquerySrc"]
    tag = baseline["cadqueryTag"]
    python = baseline["python"]
    modules = (
        args.modules.split(",") if args.modules else baseline["targetModules"]
    )

    cache = os.path.join(PKG, "out", "cache", tag)
    tests_dir = os.path.join(cache, "tests")
    if args.force or not os.path.isdir(tests_dir):
        os.makedirs(cache, exist_ok=True)
        print(f"[run-ref] extracting {tag} tests -> {cache}")
        git_archive = subprocess.run(
            ["git", "-C", src, "archive", tag, "tests"],
            capture_output=True,
            check=True,
        )
        tar = subprocess.run(["tar", "-xf", "-", "-C", cache], input=git_archive.stdout)
        if tar.returncode != 0:
            sys.exit(f"[run-ref] tar extraction failed ({tar.returncode})")
    else:
        print(f"[run-ref] using cached snapshot {cache}")

    step_out = os.path.join(PKG, "out", "ref")
    os.makedirs(step_out, exist_ok=True)

    env = dict(
        os.environ,
        CQ_TARGET_MODULES=json.dumps([f"tests.{m}" for m in modules]),
        CQ_SOURCE_DIRS=json.dumps([tests_dir.replace("\\", "/")]),
        CQ_STEP_OUT=step_out,
        PYTHONPATH=HERE.replace("\\", "/"),
    )
    test_files = [os.path.join(tests_dir, f"{m}.py") for m in modules]
    for tf in test_files:
        if not os.path.exists(tf):
            sys.exit(f"[run-ref] missing test module in snapshot: {tf}")

    print(f"[run-ref] running {len(test_files)} modeling test files -> {step_out}")
    cmd = [python, "-m", "pytest", "-p", "cq_step_plugin", "-q", *test_files]
    rc = subprocess.run(cmd, env=env, cwd=cache).returncode
    print(f"[run-ref] pytest exit code: {rc}")
    print(f"[run-ref] reference assets: {step_out}{os.sep}manifest.json")
    return rc


if __name__ == "__main__":
    sys.exit(main())

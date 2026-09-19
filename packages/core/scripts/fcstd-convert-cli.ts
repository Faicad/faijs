/**
 * fcstd-port B0 — batch CLI: .FCStd → .fai.zip with machine contract.
 *
 * Exit codes (plan §5.2):
 *   0 = converted; mapping final check passed (only translated /
 *       python-baked / preserved-only dispositions)
 *   2 = translation gaps (non-Python baked) — NO zip written
 *   1 = internal error (read/unpack/parse/codegen/container failure)
 *
 * stdout: exactly one JSON line (the summary). Human chatter is forbidden on
 * stdout; diagnostics go to stderr (which must stay empty on success).
 *
 * Run: node --import tsx packages/core/scripts/fcstd-convert-cli.ts <in.FCStd> [out.fai.zip]
 * With no <out>, acts as a dry audit (no file written).
 */
import { writeFileSync } from 'node:fs';
import { convertFcstdFile } from '../src/fcstd/convert.ts';

const [input, output] = process.argv.slice(2);
if (!input) {
  console.error('usage: fcstd-convert-cli <in.FCStd> [out.fai.zip]');
  process.exit(1);
}

const summary = await convertFcstdFile(input);
if (summary.ok && output && summary.zip) {
  writeFileSync(output, summary.zip);
}
// stdout contract: ONE json line, no binary payload — zip bytes are stripped
// before serialization (they are written to <out> above, never printed).
const { zip: _zip, ...report } = summary;
void _zip;
console.log(JSON.stringify(report));

if (!summary.ok) {
  process.exit(summary.gaps.length > 0 ? 2 : 1);
}

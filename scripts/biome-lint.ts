/**
 * Biome lint wrapper that treats all finding severities (info, warn, error) as failures.
 *
 * Biome's exit code only reflects `error` findings by default, and `--error-on-warnings`
 * covers `warn` but there is no equivalent for `info`. This wrapper runs biome with all
 * provided arguments, streams output through to the caller (preserving GitHub reporter
 * annotations in CI), and exits non-zero if any findings are detected in the output.
 *
 * Usage:
 *   bun scripts/biome-lint.ts check              # local QA
 *   bun scripts/biome-lint.ts ci --reporter=github  # CI
 */

import process from 'node:process';

/** Matches Biome's "Found N error(s)" / "Found N info" / "Found N warn" output. */
const RE_FOUND_FINDINGS = /Found \d+ (error|warn|info)/;

const args = process.argv.slice(2);

if (args.length === 0) {
	process.stderr.write(
		'Usage: bun scripts/biome-lint.ts <check|ci> [...biome flags]\n',
	);
	process.exit(1);
}

const proc = Bun.spawn(['bun', 'biome', ...args], {
	stdout: 'pipe',
	stderr: 'pipe',
});

const [stdout, stderr] = await Promise.all([
	new Response(proc.stdout).text(),
	new Response(proc.stderr).text(),
]);

const code = await proc.exited;

// Write buffered output so callers (QA script, CI) see it as-is
if (stdout) {
	process.stdout.write(stdout);
}
if (stderr) {
	process.stderr.write(stderr);
}

const combined = `${stdout}${stderr}`;
const hasFindings = RE_FOUND_FINDINGS.test(combined);

// Exit non-zero if biome failed OR any findings were detected
process.exit(code !== 0 || hasFindings ? 1 : 0);

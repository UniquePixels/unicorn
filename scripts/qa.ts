/**
 * Interactive QA runner with compact summary and expandable output.
 *
 * Runs all quality checks (format, lint, typecheck, test, coverage) sequentially,
 * captures output, and displays a color-coded summary. In TTY mode, provides an
 * interactive viewer to expand/collapse step output. In CI/piped mode, prints
 * the summary and any failed output, then exits.
 */

import process from 'node:process';

// ── ANSI helpers ──

const isTTY =
	Boolean(process.stdout.isTTY) &&
	Boolean(process.stdin?.isTTY) &&
	typeof process.stdin.setRawMode === 'function';

/** Wraps text in green ANSI escape (TTY only). */
const green = (t: string) => (isTTY ? `\x1b[32m${t}\x1b[0m` : t);
/** Wraps text in red ANSI escape (TTY only). */
const red = (t: string) => (isTTY ? `\x1b[31m${t}\x1b[0m` : t);
/** Wraps text in dim ANSI escape (TTY only). */
const dim = (t: string) => (isTTY ? `\x1b[2m${t}\x1b[0m` : t);
/** Wraps text in bold ANSI escape (TTY only). */
const bold = (t: string) => (isTTY ? `\x1b[1m${t}\x1b[0m` : t);
/** Wraps text in inverse ANSI escape (TTY only). */
const inverse = (t: string) => (isTTY ? `\x1b[7m${t}\x1b[0m` : `> ${t}`);

/** ANSI escape: clear entire line and return carriage. */
const CLEAR_LINE = '\x1b[2K\r';
/** ANSI escape: hide the terminal cursor. */
const HIDE_CURSOR = '\x1b[?25l';
/** ANSI escape: show the terminal cursor. */
const SHOW_CURSOR = '\x1b[?25h';

/** Braille spinner frames for the progress indicator. */
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

// ── Summary extraction patterns ──

/** Matches Biome's "Fixed N file(s)" output. */
const RE_FIXED_FILES = /Fixed (\d+) file/;
/** Matches Biome's "Formatted N file(s)" output. */
const RE_FORMATTED_FILES = /Formatted (\d+) file/;
/** Matches Biome's "Checked N file(s)" output. */
const RE_CHECKED_FILES = /Checked (\d+) file/;
/** Matches Biome's "Found N error(s)" output. */
const RE_FOUND_ERRORS = /Found (\d+) error/;
/** Matches all Biome "Found N info" or "Found N warn" occurrences in output. */
const RE_FOUND_INFO_WARN_G = /Found (\d+) (info|warn)/g;
/** Matches Bun test runner's "N pass" output. */
const RE_TEST_PASS = /(\d+) pass/;
/** Matches Bun test runner's "N fail" output. */
const RE_TEST_FAIL = /(\d+) fail/;
/** Matches check-coverage's "N source file(s)" output. */
const RE_UNCOVERED = /(\d+) source file/;

// ── Step definitions ──

/** Outcome of a single QA step after execution. */
interface StepResult {
	name: string;
	passed: boolean;
	summary: string;
	output: string;
	expanded: boolean;
}

/** Definition of a QA step: name, command, and output summarizer. */
interface StepDef {
	name: string;
	cmd: string[];
	summarize: (output: string, code: number) => string;
}

/** Ordered list of QA steps to execute. */
const steps: StepDef[] = [
	{
		name: 'Format',
		cmd: ['bun', 'qa:format'],
		summarize: (out, code) => {
			if (code !== 0) {
				return 'failed';
			}
			const fixed = RE_FIXED_FILES.exec(out);
			if (fixed) {
				return `fixed ${fixed[1]} file(s)`;
			}
			const formatted = RE_FORMATTED_FILES.exec(out);
			return formatted ? `${formatted[1]} files` : '';
		},
	},
	{
		name: 'Lint',
		cmd: ['bun', 'qa:lint'],
		summarize: (out, code) => {
			if (code === 0) {
				const checked = RE_CHECKED_FILES.exec(out);
				return checked ? `${checked[1]} files` : '';
			}
			const parts: string[] = [];
			const errors = RE_FOUND_ERRORS.exec(out);
			if (errors) {
				parts.push(`${errors[1]} error(s)`);
			}
			for (const match of out.matchAll(RE_FOUND_INFO_WARN_G)) {
				parts.push(`${match[1]} ${match[2]} finding(s)`);
			}
			return parts.length > 0 ? parts.join(', ') : 'failed';
		},
	},
	{
		name: 'Type Check',
		cmd: ['bun', 'qa:tsc'],
		summarize: (out, code) => {
			if (code === 0) {
				return '';
			}
			const lines = out.trim().split('\n').filter(Boolean);
			const errorCount = lines.filter((l) => l.includes('error TS')).length;
			return errorCount > 0 ? `${errorCount} error(s)` : 'failed';
		},
	},
	{
		name: 'Test',
		cmd: ['bun', 'test'],
		summarize: (out, code) => {
			const pass = RE_TEST_PASS.exec(out);
			const fail = RE_TEST_FAIL.exec(out);
			const parts: string[] = [];
			if (pass) {
				parts.push(`${pass[1]} passed`);
			}
			if (fail && fail[1] !== '0') {
				parts.push(`${fail[1]} failed`);
			}
			if (parts.length > 0) {
				return parts.join(', ');
			}
			return code === 0 ? '' : 'failed';
		},
	},
	{
		name: 'Coverage',
		cmd: ['bun', 'scripts/check-coverage.ts'],
		summarize: (out, code) => {
			if (code === 0) {
				if (out.includes('All source files')) {
					return 'all files covered';
				}
				return '';
			}
			const uncovered = RE_UNCOVERED.exec(out);
			return uncovered ? `${uncovered[1]} file(s) uncovered` : 'failed';
		},
	},
];

// ── Run steps ──

/** Runs a command and captures combined stdout+stderr. */
async function runStep(def: StepDef): Promise<StepResult> {
	const proc = Bun.spawn(def.cmd, {
		stdout: 'pipe',
		stderr: 'pipe',
	});

	const [stdout, stderr] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	const code = await proc.exited;
	const output = `${stdout}${stderr}`.trim();
	return {
		name: def.name,
		passed: code === 0,
		summary: def.summarize(output, code),
		output,
		expanded: false,
	};
}

// ── Display ──

/** Formats a single result line. */
function formatLine(result: StepResult, selected: boolean): string {
	const icon = result.passed ? green('✓') : red('✗');
	const name = result.passed ? result.name : red(result.name);
	const summary = result.summary ? dim(result.summary) : '';
	const expand = result.expanded ? '▼' : '▶';
	const marker = selected ? inverse(` ${icon} ${name} `) : ` ${icon} ${name} `;
	const padding = ' '.repeat(Math.max(0, 18 - result.name.length));
	return `${marker}${padding}${summary} ${dim(expand)}`;
}

/** Computes total rendered rows for the interactive view. */
function computeTotalRows(results: StepResult[]): number {
	return (
		2 +
		results.reduce(
			(sum, step) =>
				sum +
				1 +
				(step.expanded && step.output ? step.output.split('\n').length : 0),
			0,
		)
	);
}

/** Row count of the last rendered frame, used to rewind correctly. */
let prevTotalRows = 0;

/** Renders the full interactive view. */
function render(results: StepResult[], cursor: number, passed: boolean): void {
	// Rewind by previous frame height to clear stale lines when collapsing
	if (prevTotalRows > 0) {
		process.stdout.write(`\x1b[${prevTotalRows}A`);
	}
	// Clear old frame (including rows that may no longer be rendered)
	process.stdout.write('\x1b[J');

	for (const [i, step] of results.entries()) {
		process.stdout.write(`${CLEAR_LINE}${formatLine(step, i === cursor)}\n`);
		if (step.expanded && step.output) {
			for (const line of step.output.split('\n')) {
				process.stdout.write(`${CLEAR_LINE}${dim('  │ ')}${line}\n`);
			}
		}
	}

	const status = passed
		? green(bold('All checks passed'))
		: red(bold('Some checks failed'));
	process.stdout.write(`${CLEAR_LINE}\n`);
	process.stdout.write(
		`${CLEAR_LINE} ${status}  ${dim('↑↓ navigate · enter expand · q quit')}\n`,
	);

	prevTotalRows = computeTotalRows(results);
}

// ── Phases ──

/** Phase 1: Run all steps, show spinner in TTY mode. */
async function runAllSteps(): Promise<StepResult[]> {
	const stepResults: StepResult[] = [];

	for (const step of steps) {
		if (isTTY) {
			let frame = 0;
			const spinner = setInterval(() => {
				const icon = dim(SPINNER_FRAMES[frame % SPINNER_FRAMES.length] ?? '⠋');
				process.stdout.write(`${CLEAR_LINE} ${icon} ${step.name}...`);
				frame++;
			}, 80);

			try {
				// biome-ignore lint/performance/noAwaitInLoops: steps must run sequentially with per-step spinner
				const result = await runStep(step);
				stepResults.push(result);

				process.stdout.write(`${CLEAR_LINE}${formatLine(result, false)}\n`);
			} finally {
				clearInterval(spinner);
				process.stdout.write(CLEAR_LINE);
			}
		} else {
			const result = await runStep(step);
			stepResults.push(result);
		}
	}

	return stepResults;
}

/** Non-TTY: print summary and failed output, then exit. */
function printAndExit(results: StepResult[], passed: boolean): never {
	for (const result of results) {
		const icon = result.passed ? '✓' : '✗';
		const summary = result.summary ? `  ${result.summary}` : '';
		const padding = ' '.repeat(Math.max(0, 18 - result.name.length));
		// biome-ignore lint/suspicious/noConsole: CLI script output
		console.log(` ${icon} ${result.name}${padding}${summary}`);
	}
	// biome-ignore lint/suspicious/noConsole: CLI script output
	console.log('');

	for (const result of results) {
		if (!result.passed && result.output) {
			const separator = '─'.repeat(Math.max(0, 60 - result.name.length));
			// biome-ignore lint/suspicious/noConsole: CLI script output
			console.log(`── ${result.name} ${separator}`);
			// biome-ignore lint/suspicious/noConsole: CLI script output
			console.log(result.output);
			// biome-ignore lint/suspicious/noConsole: CLI script output
			console.log('');
		}
	}

	process.exit(passed ? 0 : 1);
}

/** CSI u prefix used by the Kitty keyboard protocol (`ESC [`). */
const CSI_PREFIX = '\x1b[';

/**
 * Normalizes Kitty keyboard protocol sequences to standard key values.
 *
 * Kitty protocol encodes keys as `ESC [ <code> ; <modifiers> u`. This converts
 * them to their standard equivalents so key handlers work across terminals.
 */
function normalizeKey(raw: string): string {
	if (!(raw.startsWith(CSI_PREFIX) && raw.endsWith('u'))) {
		return raw;
	}

	const inner = raw.slice(CSI_PREFIX.length, -1);
	const [codeStr, modStr] = inner.split(';');
	const code = Number(codeStr);
	const mods = modStr ? Number(modStr) - 1 : 0;

	// biome-ignore lint/suspicious/noBitwiseOperators: bitwise mask extracts Ctrl modifier flag per Kitty protocol spec
	const isCtrl = (mods & 4) !== 0;

	// Ctrl+letter → control character (e.g. Ctrl+C → 0x03)
	if (isCtrl && code >= 97 && code <= 122) {
		return String.fromCodePoint(code - 96);
	}

	return String.fromCodePoint(code);
}

/** Handles a single keypress in interactive mode. */
function handleKey(
	raw: string,
	state: { cursor: number },
	results: StepResult[],
	passed: boolean,
): void {
	const key = normalizeKey(raw);

	if (key === 'q' || key === '\x03') {
		process.stdout.write(SHOW_CURSOR);
		process.stdin.setRawMode(false);
		process.exit(passed ? 0 : 1);
	}

	if (key === '\x1b[A') {
		state.cursor = Math.max(0, state.cursor - 1);
		render(results, state.cursor, passed);
	}

	if (key === '\x1b[B') {
		state.cursor = Math.min(results.length - 1, state.cursor + 1);
		render(results, state.cursor, passed);
	}

	if (key === '\r' || key === '\n' || key === ' ') {
		const selected = results[state.cursor];
		if (selected) {
			selected.expanded = !selected.expanded;
			process.stdout.write('\x1b[J');
			render(results, state.cursor, passed);
		}
	}
}

/** TTY: interactive viewer with expand/collapse. */
function startInteractive(results: StepResult[], passed: boolean): void {
	process.stdout.write(HIDE_CURSOR);

	const status = passed
		? green(bold('All checks passed'))
		: red(bold('Some checks failed'));
	process.stdout.write(
		`\n ${status}  ${dim('↑↓ navigate · enter expand · q quit')}\n`,
	);

	const state = { cursor: 0 };
	prevTotalRows = computeTotalRows(results);
	render(results, state.cursor, passed);

	process.stdin.setRawMode(true);
	process.stdin.resume();
	process.stdin.on('data', (data: Buffer) => {
		handleKey(data.toString(), state, results, passed);
	});
}

// ── Main ──

/** Entry point: runs all QA steps and presents results. */
async function main(): Promise<void> {
	const results = await runAllSteps();
	const passed = results.every((r) => r.passed);

	if (isTTY) {
		startInteractive(results, passed);
	} else {
		printAndExit(results, passed);
	}
}

await main();

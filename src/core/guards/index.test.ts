import { describe, expect, mock, test } from 'bun:test';
import type { ExtendedLogger } from '@/core/lib/logger';
import { AppError } from '@/core/lib/logger';
import { assertDefined } from '@/core/lib/test-helpers';
import {
	createGuard,
	GUARD_META,
	type Guard,
	type GuardMeta,
	getGuardMeta,
	guardFail,
	guardPass,
	type NarrowedBy,
	processGuards,
	resolveGuards,
	runGuard,
	runGuards,
} from './index';

/** Shorthand for a pass-through guard with metadata. */
function namedGuard(name: string, meta?: Partial<GuardMeta>) {
	return createGuard((input: unknown) => guardPass(input), { name, ...meta });
}

describe('guardPass', () => {
	test('creates successful guard result', () => {
		const result = guardPass('test value');

		expect(result.ok).toBe(true);
		expect((result as { ok: true; value: string }).value).toBe('test value');
	});

	test('preserves complex object values', () => {
		const obj = { id: 1, name: 'test', nested: { deep: true } };
		const result = guardPass(obj);

		expect(result.ok).toBe(true);
		expect((result as { ok: true; value: typeof obj }).value).toEqual(obj);
	});

	test('works with null and undefined', () => {
		const nullResult = guardPass(null);
		const undefinedResult = guardPass(undefined);

		expect(nullResult.ok).toBe(true);
		expect((nullResult as { ok: true; value: null }).value).toBe(null);
		expect(undefinedResult.ok).toBe(true);
		expect((undefinedResult as { ok: true; value: undefined }).value).toBe(
			undefined,
		);
	});
});

describe('guardFail', () => {
	test('creates failed guard result', () => {
		const result = guardFail('Permission denied');

		expect(result.ok).toBe(false);
		expect((result as { ok: false; reason: string }).reason).toBe(
			'Permission denied',
		);
	});

	test('preserves reason message', () => {
		const reason = 'User must have admin permissions to use this command';
		const result = guardFail(reason);

		expect(result.ok).toBe(false);
		expect((result as { ok: false; reason: string }).reason).toBe(reason);
	});

	test('handles empty string reason', () => {
		const result = guardFail('');

		expect(result.ok).toBe(false);
		expect((result as { ok: false; reason: string }).reason).toBe('');
	});
});

describe('createGuard', () => {
	test('creates a synchronous guard function', async () => {
		const isPositive = createGuard<number, number>((input) => {
			if (input <= 0) {
				return guardFail('Number must be positive');
			}
			return guardPass(input);
		});

		const passResult = await isPositive(5);
		const failResult = await isPositive(-1);

		expect(passResult.ok).toBe(true);
		expect(failResult.ok).toBe(false);
	});

	test('creates an async guard function', async () => {
		const asyncValidator = createGuard<string, string>(async (input) => {
			await Promise.resolve();
			if (input.length < 3) {
				return guardFail('Input too short');
			}
			return guardPass(input);
		});

		const passResult = await asyncValidator('hello');
		const failResult = await asyncValidator('ab');

		expect(passResult.ok).toBe(true);
		expect(failResult.ok).toBe(false);
	});

	test('creates a type-narrowing guard', async () => {
		interface User {
			id: string;
			role?: 'admin' | 'user';
		}
		interface AdminUser extends User {
			role: 'admin';
		}

		const isAdmin = createGuard<User, AdminUser>((user) => {
			if (user.role !== 'admin') {
				return guardFail('User is not an admin');
			}
			return guardPass(user as AdminUser);
		});

		const adminResult = await isAdmin({ id: '1', role: 'admin' });
		const userResult = await isAdmin({ id: '2', role: 'user' });

		expect(adminResult.ok).toBe(true);
		expect(userResult.ok).toBe(false);
	});
});

describe('runGuard', () => {
	test('runs synchronous guard and returns result', async () => {
		const guard = createGuard<number, number>((n) =>
			n > 0 ? guardPass(n) : guardFail('Must be positive'),
		);

		const result = await runGuard(guard, 5);

		expect(result.ok).toBe(true);
	});

	test('runs async guard and returns promise', async () => {
		const asyncGuard = createGuard<string, string>(async (s) => {
			await Promise.resolve();
			return s.length > 0 ? guardPass(s) : guardFail('Must not be empty');
		});

		const result = await runGuard(asyncGuard, 'test');

		expect(result.ok).toBe(true);
	});
});

describe('runGuards', () => {
	test('runs empty guard array successfully', async () => {
		const result = await runGuards([], 'input');

		expect(result.ok).toBe(true);
		expect((result as { ok: true; value: string }).value).toBe('input');
	});

	test('runs single guard successfully', async () => {
		const notEmpty = createGuard<string, string>((s) =>
			s.length > 0 ? guardPass(s) : guardFail('Empty'),
		);

		const result = await runGuards([notEmpty], 'hello');

		expect(result.ok).toBe(true);
		expect((result as { ok: true; value: string }).value).toBe('hello');
	});

	test('runs multiple guards in sequence', async () => {
		const calls: string[] = [];

		const guard1 = createGuard<number, number>((n) => {
			calls.push('guard1');
			return guardPass(n);
		});

		const guard2 = createGuard<number, number>((n) => {
			calls.push('guard2');
			return guardPass(n);
		});

		const guard3 = createGuard<number, number>((n) => {
			calls.push('guard3');
			return guardPass(n);
		});

		await runGuards([guard1, guard2, guard3], 42);

		expect(calls).toEqual(['guard1', 'guard2', 'guard3']);
	});

	test('short-circuits on first failure', async () => {
		const calls: string[] = [];

		const pass = createGuard<number, number>((n) => {
			calls.push('pass');
			return guardPass(n);
		});

		const fail = createGuard<number, number>((_n) => {
			calls.push('fail');
			return guardFail('Failure');
		});

		const shouldNotRun = createGuard<number, number>((n) => {
			calls.push('shouldNotRun');
			return guardPass(n);
		});

		const result = await runGuards([pass, fail, shouldNotRun], 1);

		expect(result.ok).toBe(false);
		expect((result as { ok: false; reason: string }).reason).toBe('Failure');
		expect(calls).toEqual(['pass', 'fail']);
		expect(calls).not.toContain('shouldNotRun');
	});

	test('passes narrowed value between guards', async () => {
		interface Input {
			value: number;
		}
		interface Validated extends Input {
			validated: true;
		}
		interface Enriched extends Validated {
			enriched: true;
		}

		const validate = createGuard<Input, Validated>((input) => {
			if (input.value < 0) {
				return guardFail('Invalid value');
			}
			return guardPass({ ...input, validated: true as const });
		});

		const enrich = createGuard<Validated, Enriched>((input) =>
			guardPass({ ...input, enriched: true as const }),
		);

		const result = await runGuards([validate, enrich], { value: 5 });

		expect(result.ok).toBe(true);
		if (result.ok) {
			const value = result.value as Enriched;
			expect(value.validated).toBe(true);
			expect(value.enriched).toBe(true);
			expect(value.value).toBe(5);
		}
	});

	test('handles async guards in sequence', async () => {
		const asyncGuard1 = createGuard<number, number>(async (n) => {
			await Promise.resolve();
			return guardPass(n + 1);
		});

		const asyncGuard2 = createGuard<number, number>(async (n) => {
			await Promise.resolve();
			return guardPass(n * 2);
		});

		const result = await runGuards([asyncGuard1, asyncGuard2], 5);

		expect(result.ok).toBe(true);
		// Input 5 -> guard1 adds 1 = 6 -> guard2 multiplies by 2 = 12
		expect((result as { ok: true; value: number }).value).toBe(12);
	});

	test('handles mixed sync and async guards', async () => {
		const syncGuard = createGuard<number, number>((n) => guardPass(n + 1));

		const asyncGuard = createGuard<number, number>(async (n) => {
			await Promise.resolve();
			return guardPass(n * 2);
		});

		const result = await runGuards([syncGuard, asyncGuard, syncGuard], 1);

		expect(result.ok).toBe(true);
		// Input 1 -> sync adds 1 = 2 -> async multiplies by 2 = 4 -> sync adds 1 = 5
		expect((result as { ok: true; value: number }).value).toBe(5);
	});

	test('handles guard that throws error', async () => {
		const throwingGuard = createGuard<unknown, unknown>((_input) => {
			throw new Error('Guard threw an error');
		});

		await expect(runGuards([throwingGuard], 'test')).rejects.toThrow(
			'Guard threw an error',
		);
	});

	test('handles async guard rejection', async () => {
		// biome-ignore lint/suspicious/useAwait: async required to test Promise rejection path
		const rejectingGuard = createGuard<unknown, unknown>(async (_input) => {
			throw new Error('Async guard rejected');
		});

		await expect(runGuards([rejectingGuard], 'test')).rejects.toThrow(
			'Async guard rejected',
		);
	});
});

describe('type narrowing scenarios', () => {
	test('narrows union types', async () => {
		type Shape =
			| { kind: 'circle'; radius: number }
			| { kind: 'rectangle'; width: number; height: number };
		type Circle = Extract<Shape, { kind: 'circle' }>;

		const isCircle = createGuard<Shape, Circle>((shape) => {
			if (shape.kind !== 'circle') {
				return guardFail('Not a circle');
			}
			return guardPass(shape);
		});

		const circleResult = await runGuards([isCircle], {
			kind: 'circle',
			radius: 5,
		});
		const rectResult = await runGuards([isCircle], {
			kind: 'rectangle',
			width: 10,
			height: 20,
		});

		expect(circleResult.ok).toBe(true);
		expect(rectResult.ok).toBe(false);
	});

	test('narrows nullable types', async () => {
		type MaybeString = string | null | undefined;

		const notNullish = createGuard<MaybeString, string>((value) => {
			if (value === null || value === undefined) {
				return guardFail('Value is null or undefined');
			}
			return guardPass(value);
		});

		const stringResult = await runGuards([notNullish], 'hello');
		const nullResult = await runGuards([notNullish], null);
		const undefinedResult = await runGuards([notNullish], undefined);

		expect(stringResult.ok).toBe(true);
		expect(nullResult.ok).toBe(false);
		expect(undefinedResult.ok).toBe(false);
	});
});

// ── Guard Metadata ──────────────────────────────────────────────────

describe('GUARD_META', () => {
	test('is a unique symbol', () => {
		expect(typeof GUARD_META).toBe('symbol');
	});
});

describe('createGuard with metadata', () => {
	test('attaches metadata to guard function', () => {
		const guard = namedGuard('testGuard', {
			incompatibleWith: ['scheduled-event'],
		});

		const meta = getGuardMeta(guard);

		assertDefined(meta);
		expect(meta.name).toBe('testGuard');
		expect(meta.incompatibleWith).toEqual(['scheduled-event']);
	});

	test('guard without metadata returns undefined', () => {
		const guard = createGuard((input: string) => guardPass(input));

		expect(getGuardMeta(guard)).toBeUndefined();
	});

	test('preserves requires in metadata', () => {
		const dep = namedGuard('dep');
		const guard = namedGuard('main', { requires: [dep] });

		const meta = getGuardMeta(guard);
		assertDefined(meta);
		assertDefined(meta.requires);
		expect(meta.requires).toHaveLength(1);
		expect(meta.requires[0]).toBe(dep);
	});

	test('preserves channelResolver in metadata', () => {
		const resolver = () => null;
		const guard = namedGuard('withResolver', { channelResolver: resolver });

		const meta = getGuardMeta(guard);
		assertDefined(meta);
		expect(meta.channelResolver).toBe(resolver);
	});
});

describe('getGuardMeta', () => {
	test('returns metadata for guard with meta', () => {
		const guard = namedGuard('myGuard');

		const meta = getGuardMeta(guard);
		assertDefined(meta);
		expect(meta.name).toBe('myGuard');
	});

	test('returns undefined for plain function', () => {
		const plainGuard: Guard<string, string> = (input) => guardPass(input);

		expect(getGuardMeta(plainGuard)).toBeUndefined();
	});
});

// ── resolveGuards ───────────────────────────────────────────────────

describe('resolveGuards', () => {
	test('returns empty array for empty input', () => {
		expect(resolveGuards([], 'command')).toEqual([]);
	});

	test('passes through guards without metadata', () => {
		const g1: Guard<unknown, unknown> = (input) => guardPass(input);
		const g2: Guard<unknown, unknown> = (input) => guardPass(input);

		const result = resolveGuards([g1, g2], 'command');

		expect(result).toEqual([g1, g2]);
	});

	test('throws ERR_GUARD_INCOMPATIBLE for incompatible guard', () => {
		const guard = namedGuard('interactionOnly', {
			incompatibleWith: ['scheduled-event'],
		});

		expect(() => resolveGuards([guard], 'scheduled-event')).toThrow(AppError);

		try {
			resolveGuards([guard], 'scheduled-event');
		} catch (error) {
			const appErr = error as AppError;
			expect(appErr.code).toBe('ERR_GUARD_INCOMPATIBLE');
			expect(appErr.metadata['guard']).toBe('interactionOnly');
			expect(appErr.metadata['sparkType']).toBe('scheduled-event');
		}
	});

	test('auto-prepends dependencies for command sparks', () => {
		const dep = namedGuard('dep');
		const guard = namedGuard('main', { requires: [dep] });

		const result = resolveGuards([guard], 'command');

		expect(result).toEqual([dep, guard]);
	});

	test('auto-prepends dependencies for component sparks', () => {
		const dep = namedGuard('dep');
		const guard = namedGuard('main', { requires: [dep] });

		const result = resolveGuards([guard], 'component');

		expect(result).toEqual([dep, guard]);
	});

	test('skips dependency resolution for gateway-event', () => {
		const dep = namedGuard('dep');
		const guard = namedGuard('main', { requires: [dep] });

		const result = resolveGuards([guard], 'gateway-event');

		// Only the guard itself, dep not auto-prepended
		expect(result).toEqual([guard]);
	});

	test('skips dependency resolution for scheduled-event', () => {
		const guard = namedGuard('noIncompat');

		const result = resolveGuards([guard], 'scheduled-event');

		expect(result).toEqual([guard]);
	});

	test('deduplicates when dev already includes dependency', () => {
		const dep = namedGuard('dep');
		const guard = namedGuard('main', { requires: [dep] });

		// Dev already included dep
		const result = resolveGuards([dep, guard], 'command');

		expect(result).toEqual([dep, guard]);
		expect(result).toHaveLength(2);
	});

	test('corrects mis-ordered deps (dependent listed before its dependency)', () => {
		const dep = namedGuard('dep');
		const guard = namedGuard('main', { requires: [dep] });

		// Dev puts guard before dep — resolver should move dep ahead
		const result = resolveGuards([guard, dep], 'command');

		expect(result).toEqual([dep, guard]);
	});

	test('preserves developer-specified order with deps before dependents', () => {
		const dep = namedGuard('dep');
		const g1 = namedGuard('g1');
		const g2 = namedGuard('g2', { requires: [dep] });

		// Dev puts g1 before g2; dep should be inserted before g2
		const result = resolveGuards([g1, g2], 'command');

		expect(result).toEqual([g1, dep, g2]);
	});

	test('resolves recursive dependencies (A requires B requires C)', () => {
		const c = namedGuard('C');
		const b = namedGuard('B', { requires: [c] });
		const a = namedGuard('A', { requires: [b] });

		const result = resolveGuards([a], 'command');

		expect(result).toEqual([c, b, a]);
	});

	test('validates transitive dependency compatibility', () => {
		const incompatDep = namedGuard('incompatDep', {
			incompatibleWith: ['command'],
		});
		const guard = namedGuard('main', { requires: [incompatDep] });

		expect(() => resolveGuards([guard], 'command')).toThrow(AppError);

		try {
			resolveGuards([guard], 'command');
		} catch (error) {
			const appErr = error as AppError;
			expect(appErr.code).toBe('ERR_GUARD_INCOMPATIBLE');
			expect(appErr.metadata['guard']).toBe('incompatDep');
			expect(appErr.metadata['dependencyOf']).toBe('main');
		}
	});

	test('allows compatible guards in all valid spark types', () => {
		const guard = namedGuard('universal');

		expect(resolveGuards([guard], 'command')).toHaveLength(1);
		expect(resolveGuards([guard], 'component')).toHaveLength(1);
		expect(resolveGuards([guard], 'gateway-event')).toHaveLength(1);
		expect(resolveGuards([guard], 'scheduled-event')).toHaveLength(1);
	});

	test('deduplicates repeated guards for gateway-event', () => {
		const guard = namedGuard('repeated');

		const result = resolveGuards([guard, guard, guard], 'gateway-event');

		expect(result).toEqual([guard]);
		expect(result).toHaveLength(1);
	});

	test('deduplicates repeated guards for scheduled-event', () => {
		const guard = namedGuard('repeated');

		const result = resolveGuards([guard, guard], 'scheduled-event');

		expect(result).toEqual([guard]);
		expect(result).toHaveLength(1);
	});

	test('throws ERR_GUARD_CYCLE on cyclic requires (A -> B -> A)', () => {
		// Build cycle by attaching metadata with GUARD_META directly (bypasses freeze)
		const a = (input: unknown) => guardPass(input);
		const b = (input: unknown) => guardPass(input);
		(a as unknown as Record<symbol, unknown>)[GUARD_META] = {
			name: 'A',
			requires: [b],
		};
		(b as unknown as Record<symbol, unknown>)[GUARD_META] = {
			name: 'B',
			requires: [a],
		};

		expect(() => resolveGuards([a], 'command')).toThrow(AppError);

		try {
			resolveGuards([a], 'command');
		} catch (error) {
			const appErr = error as AppError;
			expect(appErr.code).toBe('ERR_GUARD_CYCLE');
			expect(appErr.metadata['guard']).toBe('B');
			expect(appErr.metadata['dependency']).toBe('A');
		}
	});
});

// ── processGuards ───────────────────────────────────────────────────

/** Creates a mock logger with all methods as mocks. */
function createMockLogger(): ExtendedLogger {
	return {
		debug: mock(() => {}),
		info: mock(() => {}),
		warn: mock(() => {}),
		error: mock(() => {}),
		fatal: mock(() => {}),
		trace: mock(() => {}),
		child: mock(() => createMockLogger()),
		silent: mock(() => {}),
		level: 'info',
	} as unknown as ExtendedLogger;
}

describe('processGuards', () => {
	test('returns pass-through result on success', async () => {
		const guard = createGuard((input: string) => guardPass(input));
		const logger = createMockLogger();

		const result = await processGuards([guard], 'hello', logger, 'test:ctx');

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toBe('hello');
		}
	});

	test('returns failure result on intentional guard fail', async () => {
		const guard = createGuard(() => guardFail('Denied'));
		const logger = createMockLogger();

		const result = await processGuards([guard], 'input', logger, 'test:ctx');

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe('Denied');
		}
	});

	test('logs at info level for user-facing guard failures', async () => {
		const guard = createGuard(() => guardFail('Not allowed'));
		const logger = createMockLogger();

		await processGuards([guard], 'input', logger, 'command:ping');

		expect(logger.info).toHaveBeenCalledWith(
			{ context: 'command:ping', reason: 'Not allowed' },
			'Guard check failed',
		);
	});

	test('logs at warn level for silent guard failures', async () => {
		const guard = createGuard(() => guardFail('Bot message'));
		const logger = createMockLogger();

		await processGuards([guard], 'input', logger, 'gateway:messageCreate', {
			silent: true,
		});

		expect(logger.warn).toHaveBeenCalledWith(
			{ context: 'gateway:messageCreate', reason: 'Bot message' },
			'Guard check failed',
		);
		expect(logger.info).not.toHaveBeenCalled();
	});

	test('catches guard exceptions and returns failure result', async () => {
		const throwingGuard = createGuard(() => {
			throw new Error('guard bug');
		});
		const logger = createMockLogger();

		const result = await processGuards(
			[throwingGuard],
			'input',
			logger,
			'command:test',
		);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe('An internal error occurred.');
		}
	});

	test('logs at error level with AppError wrapping for guard exceptions', async () => {
		const throwingGuard = createGuard(() => {
			throw new Error('guard bug');
		});
		const logger = createMockLogger();

		await processGuards([throwingGuard], 'input', logger, 'command:test');

		expect(logger.error).toHaveBeenCalledWith(
			expect.objectContaining({ context: 'command:test' }),
			'Guard exception',
		);

		// Verify the wrapped error
		const errorMock = logger.error as ReturnType<typeof mock>;
		expect(errorMock.mock.calls).toHaveLength(1);
		const [errorCall] = errorMock.mock.calls;
		assertDefined(errorCall);
		const logObj = errorCall[0] as { err: AppError };
		expect(logObj.err).toBeInstanceOf(AppError);
		expect(logObj.err.code).toBe('ERR_GUARD_EXCEPTION');
	});

	test('context string is included in log metadata', async () => {
		const guard = createGuard(() => guardFail('test reason'));
		const logger = createMockLogger();

		await processGuards([guard], 'input', logger, 'component:my-button');

		expect(logger.info).toHaveBeenCalledWith(
			expect.objectContaining({ context: 'component:my-button' }),
			'Guard check failed',
		);
	});

	test('does not log when all guards pass', async () => {
		const guard = createGuard((input: string) => guardPass(input));
		const logger = createMockLogger();

		await processGuards([guard], 'hello', logger, 'test:ctx');

		expect(logger.info).not.toHaveBeenCalled();
		expect(logger.warn).not.toHaveBeenCalled();
		expect(logger.error).not.toHaveBeenCalled();
	});

	test('handles empty guard array', async () => {
		const logger = createMockLogger();

		const result = await processGuards([], 'input', logger, 'test:ctx');

		expect(result.ok).toBe(true);
	});
});

// ── NarrowedBy type-level tests ─────────────────────────────────────
// These are compile-time assertions verified by `bun qa:tsc`.

describe('NarrowedBy', () => {
	test('empty guards tuple returns base type', () => {
		type Result = NarrowedBy<{ a: string }, readonly []>;
		const value: Result = { a: 'hello' };
		expect(value.a).toBe('hello');
	});

	test('single guard intersects output with base type', () => {
		type Base = { a: string };
		type Narrowed = Base & { b: number };
		type Result = NarrowedBy<Base, readonly [Guard<Base, Narrowed>]>;

		// If NarrowedBy works, Result has both `a` and `b`
		const value: Result = { a: 'hello', b: 42 };
		expect(value.a).toBe('hello');
		expect(value.b).toBe(42);
	});

	test('multiple guards chain intersections', () => {
		type Base = { a: string };
		type WithB = Base & { b: number };
		type WithC = WithB & { c: boolean };
		type Result = NarrowedBy<
			Base,
			readonly [Guard<Base, WithB>, Guard<WithB, WithC>]
		>;

		// Result should have a, b, and c
		const value: Result = { a: 'hello', b: 42, c: true };
		expect(value.a).toBe('hello');
		expect(value.b).toBe(42);
		expect(value.c).toBe(true);
	});

	test('preserves base type properties through narrowing', () => {
		type Base = { id: string; name: string; guild: { channel: null | string } };
		type Narrowed = { guild: { channel: string } };
		type Result = NarrowedBy<
			Base,
			readonly [Guard<{ guild: { channel: null | string } }, Narrowed>]
		>;

		// Result should have id, name, AND narrowed guild.channel
		const value: Result = {
			id: '1',
			name: 'test',
			guild: { channel: 'general' },
		};
		expect(value.id).toBe('1');
		expect(value.guild.channel).toBe('general');
	});
});

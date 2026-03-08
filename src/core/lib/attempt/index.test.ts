import { describe, expect, test } from 'bun:test';
import {
	attempt,
	Err,
	err,
	isErr,
	isOk,
	Ok,
	ok,
	type Result,
} from './index.ts';

describe('Ok', () => {
	const subject = new Ok(42);

	test('holds data', () => {
		expect(subject.data).toBe(42);
	});

	test('is instanceof Ok', () => {
		expect(subject).toBeInstanceOf(Ok);
	});

	test('isOk returns true', () => {
		expect(subject.isOk()).toBe(true);
	});

	test('isErr returns false', () => {
		expect(subject.isErr()).toBe(false);
	});

	test('map transforms data', () => {
		const mapped = subject.map((n) => n * 2);
		expect(mapped).toBeInstanceOf(Ok);
		expect(mapped.isOk() && mapped.data).toBe(84);
	});

	test('mapErr is a no-op', () => {
		const mapped = subject.mapErr(() => 'new error');
		expect(mapped).toBe(subject);
	});

	test('unwrap returns data', () => {
		expect(subject.unwrap()).toBe(42);
	});

	test('unwrapOr returns data', () => {
		expect(subject.unwrapOr(0)).toBe(42);
	});

	test('unwrapOrElse returns data', () => {
		expect(subject.unwrapOrElse(() => 0)).toBe(42);
	});

	test('match calls ok handler', () => {
		const result = subject.match({
			ok: (data) => `value: ${data}`,
			err: () => 'error',
		});
		expect(result).toBe('value: 42');
	});

	test('narrows type with isOk guard', () => {
		const result: Result<number, string> = subject;
		if (result.isOk()) {
			expect(result.data).toBe(42);
		}
	});
});

describe('Err', () => {
	const error = new Error('test error');
	const subject = new Err(error);

	test('holds error', () => {
		expect(subject.error).toBe(error);
	});

	test('is instanceof Err', () => {
		expect(subject).toBeInstanceOf(Err);
	});

	test('isOk returns false', () => {
		expect(subject.isOk()).toBe(false);
	});

	test('isErr returns true', () => {
		expect(subject.isErr()).toBe(true);
	});

	test('map is a no-op', () => {
		const mapped = subject.map((n: number) => n * 2);
		expect(mapped).toBe(subject);
	});

	test('mapErr transforms error', () => {
		const mapped = subject.mapErr((e) => `wrapped: ${e.message}`);
		expect(mapped).toBeInstanceOf(Err);
		expect(mapped.isErr() && mapped.error).toBe('wrapped: test error');
	});

	test('unwrap throws the error', () => {
		expect(() => subject.unwrap()).toThrow(error);
	});

	test('unwrapOr returns default value', () => {
		const result: Result<number> = subject;
		expect(result.unwrapOr(99)).toBe(99);
	});

	test('unwrapOrElse computes from error', () => {
		const result: Result<string> = subject;
		expect(result.unwrapOrElse((e) => e.message)).toBe('test error');
	});

	test('match calls err handler', () => {
		const result = subject.match({
			ok: () => 'ok',
			err: (e) => `error: ${e.message}`,
		});
		expect(result).toBe('error: test error');
	});

	test('narrows type with isErr guard', () => {
		const result: Result<number> = subject;
		if (result.isErr()) {
			expect(result.error.message).toBe('test error');
		}
	});
});

describe('attempt', () => {
	test('returns Ok for sync success', async () => {
		const result = await attempt(() => 'hello');
		expect(result).toBeInstanceOf(Ok);
		expect(result.isOk() && result.data).toBe('hello');
	});

	test('returns Ok for async success', async () => {
		const result = await attempt(async () => 'async hello');
		expect(result).toBeInstanceOf(Ok);
		expect(result.isOk() && result.data).toBe('async hello');
	});

	test('returns Err for sync throw', async () => {
		const result = await attempt(() => {
			throw new Error('sync error');
		});
		expect(result).toBeInstanceOf(Err);
		expect(result.isErr() && result.error.message).toBe('sync error');
	});

	test('returns Err for async rejection', async () => {
		const result = await attempt(async () => {
			await Promise.resolve();
			throw new Error('async error');
		});
		expect(result).toBeInstanceOf(Err);
		expect(result.isErr() && result.error.message).toBe('async error');
	});

	test('wraps non-Error throws in Error', async () => {
		const result = await attempt(() => {
			// biome-ignore lint/style/useThrowOnlyError: testing non-Error throw handling
			throw 'string error';
		});
		expect(result).toBeInstanceOf(Err);
		expect(result.isErr() && result.error.message).toContain('string error');
		expect(
			result.isErr() && (result.error as Error & { cause?: unknown }).cause,
		).toBe('string error');
	});

	test('wraps object throws in Error with JSON', async () => {
		const result = await attempt(() => {
			// biome-ignore lint/style/useThrowOnlyError: testing non-Error throw handling
			throw { code: 404, reason: 'not found' };
		});
		expect(result).toBeInstanceOf(Err);
		if (result.isErr()) {
			expect(result.error.message).toContain('404');
			expect(result.error.message).toContain('not found');
		}
	});
});

describe('standalone isOk / isErr', () => {
	test('isOk returns true for Ok', () => {
		expect(isOk(ok(1))).toBe(true);
	});

	test('isOk returns false for Err', () => {
		expect(isOk(err(new Error('fail')))).toBe(false);
	});

	test('isErr returns true for Err', () => {
		expect(isErr(err(new Error('fail')))).toBe(true);
	});

	test('isErr returns false for Ok', () => {
		expect(isErr(ok(1))).toBe(false);
	});

	test('works as array filter predicates', async () => {
		const results = await Promise.all([
			attempt(() => 1),
			attempt(() => {
				throw new Error('fail');
			}),
			attempt(() => 3),
		]);

		const succeeded = results.filter(isOk);
		const failed = results.filter(isErr);

		expect(succeeded).toHaveLength(2);
		expect(failed).toHaveLength(1);
		expect(succeeded.map((r) => r.data)).toEqual([1, 3]);
	});
});

describe('factory functions', () => {
	test('ok() produces Ok instance', () => {
		const result = ok('value');
		expect(result).toBeInstanceOf(Ok);
		expect(result.data).toBe('value');
	});

	test('err() produces Err instance', () => {
		const error = new Error('fail');
		const result = err(error);
		expect(result).toBeInstanceOf(Err);
		expect(result.error).toBe(error);
	});

	test('ok(undefined) is a valid Ok', () => {
		const result = ok(undefined);
		expect(result).toBeInstanceOf(Ok);
		expect(result.data).toBeUndefined();
	});

	test('ok(null) is a valid Ok', () => {
		const result = ok(null);
		expect(result).toBeInstanceOf(Ok);
		expect(result.data).toBeNull();
	});

	test('err() accepts non-Error types', () => {
		const result = err('string error');
		expect(result).toBeInstanceOf(Err);
		expect(result.error).toBe('string error');
	});
});

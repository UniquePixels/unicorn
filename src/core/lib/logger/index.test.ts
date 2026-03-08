import { beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import process from 'node:process';
import { Writable } from 'node:stream';
import pino from 'pino';
import {
	AppError,
	buildRedactPaths,
	CENSOR,
	censorSensitiveKeys,
	createLogger,
	DatabaseError,
	errorSerializer,
	HttpError,
	MAX_SERIALIZE_DEPTH,
	registerDebugSource,
	SENSITIVE_KEYS,
	sentryPinoIntegration,
	ValidationError,
} from './index.ts';
import type { SerializedError } from './types.ts';

/** Asserts that a value is not null or undefined, narrowing its type. */
function assertDefined<T>(val: T | undefined | null): asserts val is T {
	expect(val).not.toBeNull();
	expect(val).toBeDefined();
}

// ─── Helpers ────────────────────────────────────────────────────

function createTestLogger() {
	const lines: Record<string, unknown>[] = [];
	const stream = new Writable({
		write(chunk, _encoding, callback) {
			lines.push(JSON.parse(chunk.toString()));
			callback();
		},
	});
	const logger = pino(
		{
			level: 'trace',
			formatters: {
				level(label: string) {
					return { level: label };
				},
			},
		},
		stream,
	);
	return { logger, lines };
}

/** Runs `fn` with `process.stderr.write` suppressed, then restores it. */
function withSilentStderr<T>(fn: (spy: ReturnType<typeof spyOn>) => T): T {
	const spy = spyOn(process.stderr, 'write').mockImplementation(() => true);
	try {
		return fn(spy);
	} finally {
		spy.mockRestore();
	}
}

// ─── createLogger ───────────────────────────────────────────────

describe('createLogger', () => {
	// Pre-register global handlers with a silent logger so handler
	// tests don't write to stdout when exercising uncaughtException/unhandledRejection.
	beforeAll(() => {
		createLogger({ environment: 'test', disablePretty: true, level: 'silent' });
	});

	test('returns logger with standard pino methods', () => {
		const logger = createLogger({
			environment: 'development',
			disablePretty: true,
		});
		expect(typeof logger.info).toBe('function');
		expect(typeof logger.error).toBe('function');
		expect(typeof logger.debug).toBe('function');
		expect(typeof logger.warn).toBe('function');
		expect(typeof logger.fatal).toBe('function');
		expect(typeof logger.trace).toBe('function');
		expect(typeof logger.child).toBe('function');
	});

	test('has extended methods (registerDebugSource, shutdown)', () => {
		const logger = createLogger({
			environment: 'development',
			disablePretty: true,
		});
		expect(typeof logger.registerDebugSource).toBe('function');
		expect(typeof logger.shutdown).toBe('function');

		const emitter = new EventEmitter();
		const unsubscribe = logger.registerDebugSource({
			name: 'test-source',
			emitter,
			eventMap: { debug: 'debug' },
		});
		expect(typeof unsubscribe).toBe('function');
		unsubscribe();
	});

	test('dev mode sets level to trace', () => {
		const logger = createLogger({
			environment: 'development',
			disablePretty: true,
		});
		expect(logger.level).toBe('trace');
	});

	test('prod mode sets level to info', () => {
		const logger = createLogger({
			environment: 'production',
		});
		expect(logger.level).toBe('info');
	});

	test('custom level override works', () => {
		const logger = createLogger({
			environment: 'development',
			level: 'warn',
			disablePretty: true,
		});
		expect(logger.level).toBe('warn');
	});

	test('shutdown resolves without error', async () => {
		const logger = createLogger({
			environment: 'development',
			disablePretty: true,
		});
		await expect(logger.shutdown()).resolves.toBeUndefined();
	});

	test('log methods do not throw', () => {
		const { logger } = createTestLogger();
		expect(() => {
			logger.info('test info');
			logger.warn('test warn');
			logger.error(new Error('test error'));
			logger.flush();
		}).not.toThrow();
	});

	test('creates dev logger with pino-pretty transport', () => {
		const logger = createLogger({
			environment: 'development',
		});
		expect(logger).toBeDefined();
		expect(logger.level).toBe('trace');
	});

	test('registers uncaughtException handler that logs fatal', () => {
		const before = process.listeners('uncaughtException').length;
		createLogger({ environment: 'development', disablePretty: true });
		const after = process.listeners('uncaughtException');

		// First createLogger() in this process registers the handler;
		// subsequent calls are no-ops due to the module-level guard.
		const added = after.slice(before);
		if (added.length > 0) {
			const handler = added[0] as NonNullable<(typeof added)[0]>;
			expect(() =>
				handler(new Error('test exception'), 'uncaughtException'),
			).not.toThrow();
			process.removeListener(
				'uncaughtException',
				handler as (...args: unknown[]) => void,
			);
		} else {
			// Handler was already registered by an earlier createLogger() call —
			// verify it exists and exercise it via the last registered listener.
			expect(after.length).toBeGreaterThan(0);
			const lastHandler = after.at(-1) as NonNullable<(typeof after)[0]>;
			expect(() =>
				lastHandler(new Error('test exception'), 'uncaughtException'),
			).not.toThrow();
		}
	});

	test('registers unhandledRejection handler that logs fatal', () => {
		const before = process.listeners('unhandledRejection').length;
		createLogger({ environment: 'development', disablePretty: true });
		const after = process.listeners('unhandledRejection');

		const added = after.slice(before);
		expect(added.length > 0 || after.length > 0).toBe(true);
		const handler = (added.length > 0 ? added[0] : after.at(-1)) as NonNullable<
			(typeof after)[0]
		>;

		const dummyPromise = Promise.resolve();
		// Error reason
		expect(() =>
			handler(new Error('test rejection'), dummyPromise),
		).not.toThrow();
		// Non-Error reason (covers String(reason) branch)
		expect(() => handler('string reason', dummyPromise)).not.toThrow();

		if (added.length > 0) {
			process.removeListener(
				'unhandledRejection',
				handler as (...args: unknown[]) => void,
			);
		}
	});
});

// ─── errorSerializer ────────────────────────────────────────────

describe('errorSerializer', () => {
	test('serializes a standard Error', () => {
		const err = new Error('basic error');
		const result = errorSerializer(err) as SerializedError;
		expect(result['type']).toBe('Error');
		expect(result['message']).toBe('basic error');
		expect(result['stack']).toBeDefined();
	});

	test('serializes Error.cause chain', () => {
		const root = new Error('root cause');
		const wrapper = new Error('wrapper', { cause: root });
		const result = errorSerializer(wrapper) as SerializedError;

		expect(result['message']).toBe('wrapper');
		expect(result['cause']).toBeDefined();
		const cause = result['cause'] as SerializedError;
		expect(cause['type']).toBe('Error');
		expect(cause['message']).toBe('root cause');
	});

	test('serializes AggregateError with nested errors', () => {
		const inner1 = new Error('first');
		const inner2 = new Error('second');
		const aggregate = new AggregateError([inner1, inner2], 'multiple failures');
		const result = errorSerializer(aggregate) as SerializedError;

		expect(result['type']).toBe('AggregateError');
		expect(result['message']).toBe('multiple failures');
		expect(result['errors']).toHaveLength(2);
		const errors = result['errors'] as SerializedError[];
		expect(errors[0]?.message).toBe('first');
		expect(errors[1]?.message).toBe('second');
	});

	test('serializes AggregateError with mixed Error and non-Error items', () => {
		const inner = new Error('real error');
		const aggregate = new AggregateError(
			[inner, 'string failure', 42],
			'mixed errors',
		);
		const result = errorSerializer(aggregate) as SerializedError;

		expect(result['errors']).toHaveLength(3);
		const errors = result['errors'] as unknown[];
		expect((errors[0] as SerializedError).message).toBe('real error');
		expect(errors[1]).toBe('string failure');
		expect(errors[2]).toBe(42);
	});

	test('captures custom enumerable properties', () => {
		const error = new Error('discord error');
		Object.assign(error, { code: 50_013, status: 403, method: 'PATCH' });
		const result = errorSerializer(error) as SerializedError;

		expect(result['code']).toBe(50_013);
		expect(result['status']).toBe(403);
		expect(result['method']).toBe('PATCH');
	});

	test('redacts sensitive enumerable properties', () => {
		const error = new Error('auth failure');
		Object.assign(error, {
			token: 'secret-token-123',
			apiKey: 'key-456',
			password: 'hunter2',
			authorization: 'Bearer xyz',
			code: 401,
		});
		const result = errorSerializer(error) as SerializedError;

		expect(result['token']).toBe('[REDACTED]');
		expect(result['apiKey']).toBe('[REDACTED]');
		expect(result['password']).toBe('[REDACTED]');
		expect(result['authorization']).toBe('[REDACTED]');
		// Non-sensitive keys still pass through
		expect(result['code']).toBe(401);
	});

	test('redacts keys with separator variants (hyphens, underscores)', () => {
		const error = new Error('leak check');
		Object.assign(error, {
			['api_key']: 'key-1',
			['api-key']: 'key-2',
			['access_token']: 'tok-1',
			['set-cookie']: 'session=abc',
			['Set_Cookie']: 'session=def',
		});
		const result = errorSerializer(error) as SerializedError;

		expect(result['api_key']).toBe('[REDACTED]');
		expect(result['api-key']).toBe('[REDACTED]');
		expect(result['access_token']).toBe('[REDACTED]');
		expect(result['set-cookie']).toBe('[REDACTED]');
		expect(result['Set_Cookie']).toBe('[REDACTED]');
	});

	test('respects max depth to prevent infinite recursion', () => {
		let error: Error = new Error('deepest');
		for (let i = 0; i < 7; i++) {
			error = new Error(`level-${i}`, { cause: error });
		}
		const result = errorSerializer(error) as SerializedError;

		// Walk down the chain — should truncate at depth 5
		let current: SerializedError | undefined = result;
		let depth = 0;
		while (
			current?.cause &&
			typeof current.cause === 'object' &&
			'type' in current.cause
		) {
			current = current.cause as SerializedError;
			depth++;
		}
		expect(depth).toBeLessThanOrEqual(MAX_SERIALIZE_DEPTH);
		expect(current).toBeDefined();
	});

	test('preserves named error types', () => {
		const error = new TypeError('not a function');
		const result = errorSerializer(error) as SerializedError;

		expect(result['type']).toBe('TypeError');
		expect(result['message']).toBe('not a function');
	});

	test('handles errors with circular references', () => {
		const err = new Error('circular');
		(err as unknown as Record<string, unknown>)['self'] = err;
		const result = errorSerializer(err);
		expect(result['message']).toBe('circular');
	});

	test('serializes AppError with all fields', () => {
		const err = new AppError('app error', {
			code: 'ERR_TEST',
			statusCode: 422,
			metadata: { key: 'value' },
			isOperational: true,
		});
		const result = errorSerializer(err);
		expect(result['code']).toBe('ERR_TEST');
		expect(result['statusCode']).toBe(422);
		expect(result['metadata']).toEqual({ key: 'value' });
		expect(result['isOperational']).toBe(true);
		expect(result['type']).toBe('AppError');
		expect(result['timestamp']).toBeDefined();
	});

	test('serializes AppError cause chain recursively', () => {
		const root = new Error('root');
		const mid = new AppError('middle', { cause: root, code: 'ERR_MID' });
		const top = new AppError('top', { cause: mid, code: 'ERR_TOP' });
		const result = errorSerializer(top);
		expect(result['code']).toBe('ERR_TOP');
		const midResult = result['cause'] as Record<string, unknown>;
		expect(midResult['code']).toBe('ERR_MID');
		const rootResult = midResult['cause'] as Record<string, unknown>;
		expect(rootResult['message']).toBe('root');
	});

	test('selectively redacts sensitive headers while preserving safe ones', () => {
		const error = new Error('http error');
		Object.assign(error, {
			headers: {
				authorization: 'Bearer secret-token',
				'content-type': 'application/json',
				cookie: 'session=abc123',
				'x-api-key': 'sk-secret-key',
				'x-request-id': 'req-789',
			},
		});
		const result = errorSerializer(error) as SerializedError;
		const headers = result['headers'] as Record<string, unknown>;

		expect(headers['authorization']).toBe(CENSOR);
		expect(headers['cookie']).toBe(CENSOR);
		expect(headers['x-api-key']).toBe(CENSOR);
		expect(headers['content-type']).toBe('application/json');
		expect(headers['x-request-id']).toBe('req-789');
	});

	test('serializes error with non-Error cause', () => {
		const err = new Error('wrapper', {
			cause: 'string reason' as unknown as Error,
		});
		const result = errorSerializer(err);
		// Non-Error cause is not recursed into — original value preserved by pino/serialize-error
		expect(result['message']).toBe('wrapper');
	});

	test('handles null input gracefully', () => {
		const result = errorSerializer(null);
		expect(result['message']).toBe('Unknown error');
		expect(result['truncated']).toBe(false);
	});

	test('handles undefined input gracefully', () => {
		const result = errorSerializer(undefined);
		expect(result['message']).toBe('Unknown error');
		expect(result['truncated']).toBe(false);
	});

	test('handles string input gracefully', () => {
		const result = errorSerializer('some string');
		expect(result['message']).toBe('some string');
		expect(result['type']).toBe('String');
		expect(result['truncated']).toBe(false);
	});

	test('handles number input gracefully', () => {
		const result = errorSerializer(42);
		expect(result['message']).toBe('42');
		expect(result['type']).toBe('Number');
	});

	test('handles plain object input with JSON stringification', () => {
		const result = errorSerializer({ foo: 'bar', count: 1 });
		expect(result['message']).toBe('{"foo":"bar","count":1}');
		expect(result['type']).toBe('Object');
		expect(result['truncated']).toBe(false);
	});

	test('handles circular plain object input gracefully', () => {
		const obj: Record<string, unknown> = { name: 'loop' };
		obj['self'] = obj;
		const result = errorSerializer(obj);
		expect(result['message']).toBe('Unknown error');
		expect(result['type']).toBe('Object');
	});

	test('marks depth-truncated errors with truncated flag', () => {
		let error: Error = new Error('deepest');
		for (let i = 0; i < 7; i++) {
			error = new Error(`level-${i}`, { cause: error });
		}
		const result = errorSerializer(error) as SerializedError;

		// Walk to the deepest serialized cause
		let current: Record<string, unknown> = result;
		while (
			current['cause'] &&
			typeof current['cause'] === 'object' &&
			'type' in (current['cause'] as Record<string, unknown>)
		) {
			current = current['cause'] as Record<string, unknown>;
		}
		expect(current['truncated']).toBe(true);
	});
});

// ─── AppError classes ───────────────────────────────────────────

describe('AppError', () => {
	test('has correct defaults', () => {
		const err = new AppError('test error');
		expect(err.message).toBe('test error');
		expect(err.name).toBe('AppError');
		expect(err.code).toBe('ERR_UNKNOWN');
		expect(err.statusCode).toBe(500);
		expect(err.isOperational).toBe(true);
		expect(err.metadata).toEqual({});
		expect(err.stack).toBeDefined();
		expect(err.timestamp).toBeDefined();
		expect(err instanceof Error).toBe(true);
		expect(err instanceof AppError).toBe(true);
	});

	test('accepts all options', () => {
		const err = new AppError('custom', {
			code: 'ERR_CUSTOM',
			statusCode: 422,
			metadata: { key: 'value' },
			isOperational: false,
		});
		expect(err.code).toBe('ERR_CUSTOM');
		expect(err.statusCode).toBe(422);
		expect(err.metadata).toEqual({ key: 'value' });
		expect(err.isOperational).toBe(false);
	});

	test('preserves cause chain', () => {
		const cause = new Error('root cause');
		const err = new AppError('wrapper', { cause });
		expect(err.cause).toBe(cause);
		const json = err.toJSON();
		expect((json['cause'] as Record<string, unknown>)['message']).toBe(
			'root cause',
		);
	});

	test('toJSON serializes nested AppError causes', () => {
		const inner = new AppError('inner', { code: 'ERR_INNER' });
		const outer = new AppError('outer', { cause: inner, code: 'ERR_OUTER' });
		const json = outer.toJSON();
		const causeJson = json['cause'] as Record<string, unknown>;
		expect(causeJson['code']).toBe('ERR_INNER');
		expect(causeJson['name']).toBe('AppError');
	});
});

describe('HttpError', () => {
	test('sets statusCode and is operational', () => {
		const err = new HttpError('Not found', 404, { code: 'ERR_NOT_FOUND' });
		expect(err.statusCode).toBe(404);
		expect(err.code).toBe('ERR_NOT_FOUND');
		expect(err.isOperational).toBe(true);
		expect(err instanceof AppError).toBe(true);
		expect(err instanceof HttpError).toBe(true);
		expect(err.name).toBe('HttpError');
	});

	test('throws RangeError for invalid statusCode', () => {
		expect(() => new HttpError('bad', 0)).toThrow(RangeError);
		expect(() => new HttpError('bad', 99)).toThrow(RangeError);
		expect(() => new HttpError('bad', 600)).toThrow(RangeError);
		expect(() => new HttpError('bad', 200.5)).toThrow(RangeError);
		expect(() => new HttpError('bad', Number.NaN)).toThrow(RangeError);
	});
});

describe('ValidationError', () => {
	test('captures fields', () => {
		const err = new ValidationError('Invalid input', {
			email: ['required', 'must be valid'],
			age: ['must be positive'],
		});
		expect(err.fields['email']).toEqual(['required', 'must be valid']);
		expect(err.statusCode).toBe(400);
		expect(err.code).toBe('ERR_VALIDATION');
		expect(err.name).toBe('ValidationError');
	});
});

describe('DatabaseError', () => {
	test('defaults to non-operational', () => {
		const err = new DatabaseError('Connection lost');
		expect(err.isOperational).toBe(false);
		expect(err.statusCode).toBe(503);
		expect(err.code).toBe('ERR_DATABASE');
		expect(err.name).toBe('DatabaseError');
	});
});

// ─── registerDebugSource ────────────────────────────────────────

describe('registerDebugSource', () => {
	test('routes string events to correct level', () => {
		const { logger, lines } = createTestLogger();
		const emitter = new EventEmitter();

		registerDebugSource(logger, {
			name: 'test-lib',
			emitter,
			eventMap: { debug: 'debug', warn: 'warn' },
		});

		emitter.emit('debug', 'hello debug');
		emitter.emit('warn', 'hello warn');

		expect(lines).toHaveLength(2);
		const [debugLine, warnLine] = lines;
		assertDefined(debugLine);
		assertDefined(warnLine);
		expect(debugLine['level']).toBe('debug');
		expect(debugLine['msg']).toBe('hello debug');
		expect(debugLine['source']).toBe('test-lib');
		expect(warnLine['level']).toBe('warn');
	});

	test('applies redaction patterns', () => {
		const { logger, lines } = createTestLogger();
		const emitter = new EventEmitter();

		registerDebugSource(logger, {
			name: 'discord',
			emitter,
			eventMap: { debug: 'debug' },
			redactPatterns: [/Bot\s+[\w-]+\.[\w-]+\.[\w-]+/g],
		});

		emitter.emit('debug', 'Identified as Bot MTk4.NjE5.abc123');

		const [entry] = lines;
		assertDefined(entry);
		expect(entry['msg']).toBe('Identified as [REDACTED]');
	});

	test('unsubscribe removes listeners', () => {
		const { logger } = createTestLogger();
		const emitter = new EventEmitter();

		const unsub = registerDebugSource(logger, {
			name: 'test-lib-unsub',
			emitter,
			eventMap: { debug: 'debug' },
		});

		expect(emitter.listenerCount('debug')).toBe(1);
		unsub();
		expect(emitter.listenerCount('debug')).toBe(0);
	});

	test('handles Error events with serialization', () => {
		const { logger, lines } = createTestLogger();
		const emitter = new EventEmitter();

		registerDebugSource(logger, {
			name: 'test-lib-err',
			emitter,
			eventMap: { error: 'error' },
		});

		emitter.emit('error', new Error('something broke'));

		const [entry] = lines;
		assertDefined(entry);
		expect(entry['level']).toBe('error');
		expect(entry['msg']).toBe('something broke');
		expect((entry['err'] as Record<string, unknown>)?.['message']).toBe(
			'something broke',
		);
	});

	test('re-registering same name tears down previous listeners', () => {
		const { logger } = createTestLogger();
		const emitter = new EventEmitter();

		registerDebugSource(logger, {
			name: 'dupe-source',
			emitter,
			eventMap: { debug: 'debug' },
		});
		expect(emitter.listenerCount('debug')).toBe(1);

		registerDebugSource(logger, {
			name: 'dupe-source',
			emitter,
			eventMap: { debug: 'debug', warn: 'warn' },
		});
		expect(emitter.listenerCount('debug')).toBe(1);
		expect(emitter.listenerCount('warn')).toBe(1);
	});

	test('handles object events as context', () => {
		const { logger, lines } = createTestLogger();
		const emitter = new EventEmitter();

		registerDebugSource(logger, {
			name: 'obj-source',
			emitter,
			eventMap: { data: 'info' },
		});

		emitter.emit('data', { userId: 42 }, 'User connected');

		const [entry] = lines;
		assertDefined(entry);
		expect(entry['msg']).toBe('User connected');
		expect(entry['userId']).toBe(42);
	});

	test('handles primitive (non-string, non-object, non-error) events', () => {
		const { logger, lines } = createTestLogger();
		const emitter = new EventEmitter();

		registerDebugSource(logger, {
			name: 'prim-source',
			emitter,
			eventMap: { data: 'info' },
		});

		emitter.emit('data', 42);

		expect(lines).toHaveLength(1);
		const [entry] = lines;
		assertDefined(entry);
		expect(entry['msg']).toBe('prim-source:data 42');
	});

	test('catches logging errors without crashing the emitter', () => {
		withSilentStderr((stderrSpy) => {
			const { logger } = createTestLogger();
			const emitter = new EventEmitter();

			registerDebugSource(logger, {
				name: 'broken-source',
				emitter,
				eventMap: { data: 'info' },
			});

			// Proxy that throws on any property access — pino will blow up trying to serialize it
			const bomb = new Proxy(
				{},
				{
					get() {
						throw new Error('serialization boom');
					},
				},
			);

			// Should not throw — the catch block swallows it and writes to stderr
			expect(() => emitter.emit('data', bomb)).not.toThrow();
			expect(stderrSpy).toHaveBeenCalled();
		});
	});

	test('handles non-removable emitters gracefully', () => {
		withSilentStderr((stderrSpy) => {
			const { logger } = createTestLogger();
			const emitter = {
				on: (_e: string, _l: (...args: unknown[]) => void) => {},
			};

			const unsub = registerDebugSource(logger, {
				name: 'no-remove',
				emitter,
				eventMap: { debug: 'debug' },
			});

			// Unsubscribe should warn but not throw
			expect(() => unsub()).not.toThrow();
			expect(stderrSpy).toHaveBeenCalled();

			// Re-registering same name returns noop when marked non-removable
			const unsub2 = registerDebugSource(logger, {
				name: 'no-remove',
				emitter,
				eventMap: { debug: 'debug' },
			});
			expect(() => unsub2()).not.toThrow();
		});
	});
});

// ─── redaction ──────────────────────────────────────────────────

describe('redaction', () => {
	test('SENSITIVE_KEYS contains expected key variants', () => {
		expect(SENSITIVE_KEYS).toContain('token');
		expect(SENSITIVE_KEYS).toContain('password');
		expect(SENSITIVE_KEYS).toContain('apiKey');
		expect(SENSITIVE_KEYS).toContain('api_key');
		expect(SENSITIVE_KEYS).toContain('authorization');
		expect(SENSITIVE_KEYS).toContain('Authorization');
		expect(SENSITIVE_KEYS).toContain('secret');
		expect(SENSITIVE_KEYS).toContain('accessToken');
		expect(SENSITIVE_KEYS).toContain('access_token');
		expect(SENSITIVE_KEYS).toContain('apiToken');
		expect(SENSITIVE_KEYS).toContain('api_token');
		expect(SENSITIVE_KEYS).toContain('refreshToken');
		expect(SENSITIVE_KEYS).toContain('refresh_token');
		expect(SENSITIVE_KEYS).toContain('clientSecret');
		expect(SENSITIVE_KEYS).toContain('client_secret');
		expect(SENSITIVE_KEYS).toContain('connectionString');
		expect(SENSITIVE_KEYS).toContain('connection_string');
	});

	test('buildRedactPaths returns root and wildcard paths', () => {
		const paths = buildRedactPaths();
		expect(paths).toContain('password');
		expect(paths).toContain('*.password');
		expect(paths).toContain('token');
		expect(paths).toContain('*.token');
	});

	test('buildRedactPaths includes selective header paths', () => {
		const paths = buildRedactPaths();
		expect(paths).toContain('headers.authorization');
		expect(paths).toContain('*.headers.authorization');
		expect(paths).toContain('headers.cookie');
		expect(paths).toContain('*.headers.cookie');
	});

	test('buildRedactPaths merges additional paths', () => {
		const paths = buildRedactPaths(['custom.path', 'another.path']);
		expect(paths).toContain('custom.path');
		expect(paths).toContain('another.path');
		// Still contains defaults
		expect(paths).toContain('password');
	});

	test('buildRedactPaths deduplicates paths', () => {
		const paths = buildRedactPaths(['password', 'token']);
		const passwordCount = paths.filter((p) => p === 'password').length;
		expect(passwordCount).toBe(1);
	});

	test('censorSensitiveKeys censors nested sensitive keys', () => {
		const obj = {
			user: 'alice',
			auth: { token: 'secret-123', role: 'admin' },
		};
		const result = censorSensitiveKeys(obj);
		expect(result['user']).toBe('alice');
		expect((result['auth'] as Record<string, unknown>)['token']).toBe(CENSOR);
		expect((result['auth'] as Record<string, unknown>)['role']).toBe('admin');
	});

	test('censorSensitiveKeys censors sensitive keys inside arrays', () => {
		const obj = {
			attempts: [
				{ token: 'secret-1', status: 401 },
				{ apiKey: 'key-2', url: '/login' },
				'plain-string',
				42,
				null,
			],
		};
		censorSensitiveKeys(obj as Record<string, unknown>);

		const attempts = obj.attempts as unknown[];
		expect((attempts[0] as Record<string, unknown>)['token']).toBe(CENSOR);
		expect((attempts[0] as Record<string, unknown>)['status']).toBe(401);
		expect((attempts[1] as Record<string, unknown>)['apiKey']).toBe(CENSOR);
		expect((attempts[1] as Record<string, unknown>)['url']).toBe('/login');
		// Non-object items are left untouched
		expect(attempts[2]).toBe('plain-string');
		expect(attempts[3]).toBe(42);
		expect(attempts[4]).toBeNull();
	});

	test('censorSensitiveKeys stops at MAX_CENSOR_DEPTH', () => {
		// Build an object nested 12 levels deep with a sensitive key at the bottom
		type Nested = { inner?: Nested; password?: string; safe?: string };
		let obj: Nested = { password: 'deep-secret', safe: 'visible' };
		for (let i = 0; i < 12; i++) {
			obj = { inner: obj };
		}
		censorSensitiveKeys(obj as Record<string, unknown>);

		// Walk down to the leaf
		let current: Nested = obj;
		while (current.inner) {
			current = current.inner;
		}
		// Beyond depth 10, the key should NOT have been censored
		expect(current.password).toBe('deep-secret');
		expect(current.safe).toBe('visible');
	});

	test('pino logger redacts sensitive context keys in output', () => {
		const lines: Record<string, unknown>[] = [];
		const stream = new Writable({
			write(chunk, _encoding, callback) {
				lines.push(JSON.parse(chunk.toString()));
				callback();
			},
		});
		const logger = pino(
			{
				level: 'info',
				redact: { paths: buildRedactPaths(), censor: CENSOR },
			},
			stream,
		);

		logger.info({ password: 'hunter2', user: 'alice' }, 'login attempt');

		const [entry] = lines;
		assertDefined(entry);
		expect(entry['password']).toBe(CENSOR);
		expect(entry['user']).toBe('alice');
	});

	test('pino logger selectively redacts headers in context', () => {
		const lines: Record<string, unknown>[] = [];
		const stream = new Writable({
			write(chunk, _encoding, callback) {
				lines.push(JSON.parse(chunk.toString()));
				callback();
			},
		});
		const logger = pino(
			{
				level: 'info',
				redact: { paths: buildRedactPaths(), censor: CENSOR },
			},
			stream,
		);

		logger.info(
			{
				headers: {
					authorization: 'Bearer secret',
					'content-type': 'application/json',
				},
			},
			'request received',
		);

		const [entry] = lines;
		assertDefined(entry);
		const headers = entry['headers'] as Record<string, unknown>;
		expect(headers['authorization']).toBe(CENSOR);
		expect(headers['content-type']).toBe('application/json');
	});
});

// ─── sentryPinoIntegration ──────────────────────────────────────

describe('sentryPinoIntegration', () => {
	test('returns an integration object', () => {
		const integration = sentryPinoIntegration();
		expect(integration).toBeDefined();
		expect(typeof integration).toBe('object');
	});

	test('accepts custom options', () => {
		const integration = sentryPinoIntegration({
			logLevels: ['error', 'fatal'],
			errorLevels: ['fatal'],
			errorsHandled: false,
		});
		expect(integration).toBeDefined();
	});
});

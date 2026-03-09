import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as z from 'zod';
import { COMMAND_SCOPES } from '@/core/sparks/command-scope';
import { createConfigSchema } from './schema.ts';
import { envMap, MiscValue, Secret, Snowflake } from './schema-helpers.ts';

/** Creates a restore function that resets `Bun.env` to its state at call time. */
function makeEnvRestorer() {
	const snapshot = { ...Bun.env };
	return () => {
		for (const key of Object.keys(Bun.env)) {
			if (!(key in snapshot)) {
				Reflect.deleteProperty(Bun.env, key);
			}
		}
		for (const [key, value] of Object.entries(snapshot)) {
			Bun.env[key] = value;
		}
	};
}

describe('Snowflake', () => {
	test('accepts valid 17-digit snowflake', () => {
		const result = Snowflake.safeParse('12345678901234567');

		expect(result.success).toBe(true);
		expect(result.data).toBe('12345678901234567');
	});

	test('accepts valid 18-digit snowflake', () => {
		const result = Snowflake.safeParse('123456789012345678');

		expect(result.success).toBe(true);
	});

	test('accepts valid 19-digit snowflake', () => {
		const result = Snowflake.safeParse('1234567890123456789');

		expect(result.success).toBe(true);
	});

	test('rejects snowflake shorter than 17 digits', () => {
		const result = Snowflake.safeParse('1234567890123456');

		expect(result.success).toBe(false);
	});

	test('rejects snowflake longer than 19 digits', () => {
		const result = Snowflake.safeParse('12345678901234567890');

		expect(result.success).toBe(false);
	});

	test('rejects non-numeric strings', () => {
		const result = Snowflake.safeParse('1234567890123456a');

		expect(result.success).toBe(false);
	});

	test('rejects numbers', () => {
		const result = Snowflake.safeParse(12_345_678_901_234_568);

		expect(result.success).toBe(false);
	});

	test('rejects null', () => {
		const result = Snowflake.safeParse(null);

		expect(result.success).toBe(false);
	});
});

describe('Secret', () => {
	const restoreEnv = makeEnvRestorer();

	beforeEach(() => {
		Bun.env['TEST_SECRET'] = 'secret_value_123';
	});

	afterEach(restoreEnv);

	test('resolves secret from environment variable', () => {
		const result = Secret.safeParse('secret://TEST_SECRET');

		expect(result.success).toBe(true);
		expect(result.data).toBe('secret_value_123');
	});

	test('rejects invalid secret format', () => {
		const result = Secret.safeParse('not-a-secret');

		expect(result.success).toBe(false);
	});

	test('rejects secret:// with no key', () => {
		const result = Secret.safeParse('secret://');

		expect(result.success).toBe(false);
	});

	test('fails when environment variable is not set', () => {
		const result = Secret.safeParse('secret://NONEXISTENT_VAR');

		expect(result.success).toBe(false);
		if (!result.success) {
			const firstIssue = result.error.issues[0];
			expect(firstIssue).toBeDefined();
			expect(firstIssue?.message).toContain('NONEXISTENT_VAR');
		}
	});

	test.each([
		'secret://invalid-key',
		'secret://invalid.key',
		'secret://123_STARTS_WITH_DIGIT',
		'secret://key with spaces',
	])('rejects invalid env var key name: %s', (input) => {
		const result = Secret.safeParse(input);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues[0]?.message).toContain(
				'Invalid environment variable name',
			);
		}
	});
});

describe('MiscValue', () => {
	const restoreEnv = makeEnvRestorer();

	beforeEach(() => {
		Bun.env['MISC_TEST_KEY'] = 'resolved_value';
	});

	afterEach(restoreEnv);

	test('resolves secret:// strings from environment', () => {
		const result = MiscValue.safeParse('secret://MISC_TEST_KEY');

		expect(result.success).toBe(true);
		expect(result.data).toBe('resolved_value');
	});

	test('fails for unset secret:// references', () => {
		const result = MiscValue.safeParse('secret://UNSET_KEY');

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues[0]?.message).toBe(
				'Environment variable "UNSET_KEY" is not set',
			);
		}
	});

	test('rejects secret:// with no key', () => {
		const result = MiscValue.safeParse('secret://');

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues[0]?.message).toBe(
				'Invalid secret reference (must be in the format `secret://key`)',
			);
		}
	});

	test('passes through non-secret strings unchanged', () => {
		const result = MiscValue.safeParse('plain-string');

		expect(result.success).toBe(true);
		expect(result.data).toBe('plain-string');
	});

	test('rejects invalid env var key name', () => {
		const result = MiscValue.safeParse('secret://invalid-key');

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues[0]?.message).toContain(
				'Invalid environment variable name',
			);
		}
	});

	test('passes through non-string values unchanged', () => {
		const numberResult = MiscValue.safeParse(42);
		expect(numberResult.success).toBe(true);
		expect(numberResult.data).toBe(42);

		const boolResult = MiscValue.safeParse(true);
		expect(boolResult.success).toBe(true);
		expect(boolResult.data).toBe(true);
	});
});

describe('envMap', () => {
	test('accepts single value', () => {
		const schema = envMap(z.string(), false);
		const result = schema.safeParse('single');

		expect(result.success).toBe(true);
		expect(result.data).toBe('single');
	});

	test('accepts single-element tuple', () => {
		const schema = envMap(z.string(), false);
		const result = schema.safeParse(['prod-only']);

		expect(result.success).toBe(true);
		expect(result.data).toBe('prod-only');
	});

	test('selects prod value when isProduction is true', () => {
		const schema = envMap(z.string(), true);
		const result = schema.safeParse(['prod', 'dev']);

		expect(result.success).toBe(true);
		expect(result.data).toBe('prod');
	});

	test('selects dev value when isProduction is false', () => {
		const schema = envMap(z.string(), false);
		const result = schema.safeParse(['prod', 'dev']);

		expect(result.success).toBe(true);
		expect(result.data).toBe('dev');
	});

	test('works with Snowflake schema', () => {
		const schema = envMap(Snowflake, false);

		const singleResult = schema.safeParse('12345678901234567');
		expect(singleResult.success).toBe(true);

		const tupleResult = schema.safeParse([
			'12345678901234567',
			'98765432109876543',
		]);
		expect(tupleResult.success).toBe(true);
	});

	test('rejects invalid values in tuple', () => {
		const schema = envMap(z.number(), false);
		const result = schema.safeParse(['not-a-number', 123]);

		expect(result.success).toBe(false);
	});

	test('rejects tuple with more than 2 elements', () => {
		const schema = envMap(z.string(), false);
		const result = schema.safeParse(['one', 'two', 'three']);

		expect(result.success).toBe(false);
	});
});

/** Minimal valid config for testing the commands sub-object. */
function minimalConfig(commandsOverride?: unknown) {
	return {
		discord: {
			appID: '12345678901234567',
			apiToken: 'secret://apiKey',
			intents: [],
			enabledPartials: [],
			enforceNonce: true,
			defaultPresence: { status: 'online', activities: [] },
			...(commandsOverride === undefined ? {} : { commands: commandsOverride }),
		},
		healthCheckPort: 3000,
		misc: {},
		ids: { role: {}, channel: {}, emoji: {} },
	};
}

/**
 * Minimal config with envMap tuples for testing production/dev selection.
 * Uses [prod, dev] tuples for appID and apiToken.
 */
function minimalTupleConfig() {
	return {
		discord: {
			appID: ['11111111111111111', '22222222222222222'],
			apiToken: ['secret://PROD_TOKEN', 'secret://DEV_TOKEN'],
			intents: [],
			enabledPartials: [],
			enforceNonce: true,
			defaultPresence: { status: 'online', activities: [] },
		},
		healthCheckPort: 3000,
		misc: {},
		ids: { role: {}, channel: {}, emoji: {} },
	};
}

describe('createConfigSchema(false) discord.commands', () => {
	const restoreEnv = makeEnvRestorer();

	afterEach(restoreEnv);

	test('defaults commands to { defaultScope: "guild" } when omitted', () => {
		Bun.env['apiKey'] = 'test-token';
		const result = createConfigSchema(false).safeParse(minimalConfig());

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.discord.commands).toEqual({
				defaultScope: 'guild',
			});
		}
	});

	test.each([
		...COMMAND_SCOPES,
	])('accepts valid defaultScope value: %s', (scope) => {
		Bun.env['apiKey'] = 'test-token';
		const result = createConfigSchema(false).safeParse(
			minimalConfig({ defaultScope: scope }),
		);
		expect(result.success).toBe(true);
	});

	test('rejects invalid defaultScope', () => {
		Bun.env['apiKey'] = 'test-token';
		const result = createConfigSchema(false).safeParse(
			minimalConfig({ defaultScope: 'invalid' }),
		);

		expect(result.success).toBe(false);
	});

	test('accepts valid devGuildId snowflake', () => {
		Bun.env['apiKey'] = 'test-token';
		const result = createConfigSchema(false).safeParse(
			minimalConfig({
				defaultScope: 'guild',
				devGuildId: '12345678901234567',
			}),
		);

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.discord.commands.devGuildId).toBe('12345678901234567');
		}
	});

	test('rejects invalid devGuildId', () => {
		Bun.env['apiKey'] = 'test-token';
		const result = createConfigSchema(false).safeParse(
			minimalConfig({ defaultScope: 'guild', devGuildId: 'not-a-snowflake' }),
		);

		expect(result.success).toBe(false);
	});

	test('devGuildId is optional', () => {
		Bun.env['apiKey'] = 'test-token';
		const result = createConfigSchema(false).safeParse(
			minimalConfig({ defaultScope: 'guild' }),
		);

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.discord.commands.devGuildId).toBeUndefined();
		}
	});
});

describe('createConfigSchema(true) production tuple selection', () => {
	const restoreEnv = makeEnvRestorer();

	afterEach(restoreEnv);

	test('selects production appID from tuple', () => {
		Bun.env['PROD_TOKEN'] = 'prod-token-value';
		Bun.env['DEV_TOKEN'] = 'dev-token-value';
		const result = createConfigSchema(true).safeParse(minimalTupleConfig());

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.discord.appID).toBe('11111111111111111');
		}
	});

	test('selects production apiToken from tuple', () => {
		Bun.env['PROD_TOKEN'] = 'prod-token-value';
		Bun.env['DEV_TOKEN'] = 'dev-token-value';
		const result = createConfigSchema(true).safeParse(minimalTupleConfig());

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.discord.apiToken).toBe('prod-token-value');
		}
	});

	test('selects production IDs from tuples', () => {
		Bun.env['PROD_TOKEN'] = 'prod-token-value';
		Bun.env['DEV_TOKEN'] = 'dev-token-value';
		const config = {
			...minimalTupleConfig(),
			ids: {
				role: { admin: ['11111111111111111', '22222222222222222'] },
				channel: {},
				emoji: {},
			},
		};
		const result = createConfigSchema(true).safeParse(config);

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.ids.role['admin']).toBe('11111111111111111');
		}
	});
});

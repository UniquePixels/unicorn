import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ActivityType, GatewayIntentBits, Partials } from 'discord.js';
import { AppError } from '@/core/lib/logger';
import { parseConfig } from './index.ts';

describe('parseConfig', () => {
	const originalEnv = { ...Bun.env };

	beforeEach(() => {
		Bun.env['DISCORD_TOKEN'] = 'test_token_value';
	});

	afterEach(() => {
		for (const key of Object.keys(Bun.env)) {
			if (!(key in originalEnv)) {
				Reflect.deleteProperty(Bun.env, key);
			}
		}
	});

	const validConfig = {
		discord: {
			appID: '12345678901234567',
			apiToken: 'secret://DISCORD_TOKEN' as const,
			intents: [GatewayIntentBits.Guilds],
			enabledPartials: [Partials.Channel],
			enforceNonce: true,
			defaultPresence: {
				status: 'online' as const,
				activities: [{ type: ActivityType.Playing, name: 'Test' }],
			},
		},
		misc: {},
		ids: {
			role: {
				admin: '11111111111111111',
				moderator: '22222222222222222',
			},
			channel: {
				general: '33333333333333333',
			},
			emoji: {},
		},
	};

	test('parses valid configuration', () => {
		const result = parseConfig(validConfig);

		expect(result.discord.appID).toBe('12345678901234567');
		expect(result.discord.apiToken).toBe('test_token_value');
		expect(result.discord.enforceNonce).toBe(true);
	});

	test('preserves literal keys in ids.role', () => {
		const result = parseConfig(validConfig);

		// These should be accessible with literal keys
		expect(result.ids.role['admin']).toBe('11111111111111111');
		expect(result.ids.role['moderator']).toBe('22222222222222222');
	});

	test('preserves literal keys in ids.channel', () => {
		const result = parseConfig(validConfig);

		expect(result.ids.channel['general']).toBe('33333333333333333');
	});

	test('handles envMap with tuple values', () => {
		const configWithTuple = {
			...validConfig,
			discord: {
				...validConfig.discord,
				appID: ['12345678901234567', '98765432109876543'] as [string, string],
			},
		};

		const result = parseConfig(configWithTuple);

		// Should select based on NODE_ENV (prod or dev value)
		expect(typeof result.discord.appID).toBe('string');
		expect(result.discord.appID.length).toBeGreaterThanOrEqual(17);
	});

	test('throws AppError with ERR_CONFIG_PARSE for invalid snowflake', () => {
		const invalidConfig = {
			...validConfig,
			discord: {
				...validConfig.discord,
				appID: 'invalid',
			},
		};

		let caughtError: unknown;
		try {
			parseConfig(invalidConfig);
			expect.unreachable('Expected parseConfig to throw');
		} catch (error) {
			caughtError = error;
		}

		expect(caughtError).toBeInstanceOf(AppError);
		const appErr = caughtError as AppError;
		expect(appErr.code).toBe('ERR_CONFIG_PARSE');
		expect(appErr.isOperational).toBe(false);
		expect(appErr.metadata['issues']).toBeDefined();
		expect(appErr.cause).toBeInstanceOf(Error);
	});

	test('throws AppError with ERR_CONFIG_PARSE for missing required fields', () => {
		const incompleteConfig = {
			discord: {
				appID: '12345678901234567',
			},
			misc: {},
			ids: { role: {}, channel: {}, emoji: {} },
		};

		let caughtError: unknown;
		try {
			parseConfig(incompleteConfig as never);
			expect.unreachable('Expected parseConfig to throw');
		} catch (error) {
			caughtError = error;
		}

		expect(caughtError).toBeInstanceOf(AppError);
		expect((caughtError as AppError).code).toBe('ERR_CONFIG_PARSE');
	});

	test('throws AppError when secret environment variable is missing', () => {
		Reflect.deleteProperty(Bun.env, 'DISCORD_TOKEN');

		let caughtError: unknown;
		try {
			parseConfig(validConfig);
			expect.unreachable('Expected parseConfig to throw');
		} catch (error) {
			caughtError = error;
		}

		expect(caughtError).toBeInstanceOf(AppError);
		const appErr = caughtError as AppError;
		expect(appErr.code).toBe('ERR_CONFIG_PARSE');
		expect(appErr.isOperational).toBe(false);
	});

	test('allows optional oAuth2 to be omitted', () => {
		const result = parseConfig(validConfig);

		expect(result.discord.oAuth2).toBeUndefined();
	});

	test('parses oAuth2 when provided', () => {
		Bun.env['OAUTH_TOKEN'] = 'oauth_secret';

		const configWithOAuth = {
			...validConfig,
			discord: {
				...validConfig.discord,
				oAuth2: {
					apiToken: 'secret://OAUTH_TOKEN' as const,
					url: 'https://example.com/oauth',
				},
			},
		};

		const result = parseConfig(configWithOAuth);

		expect(result.discord.oAuth2?.apiToken).toBe('oauth_secret');
		expect(result.discord.oAuth2?.url).toBe('https://example.com/oauth');
	});

	test('allows arbitrary misc data', () => {
		const configWithMisc = {
			...validConfig,
			misc: {
				customKey: 'customValue',
				nested: { deep: true },
				number: 42,
			},
		};

		const result = parseConfig(configWithMisc);

		expect(result.misc['customKey']).toBe('customValue');
		expect(result.misc['nested']).toEqual({ deep: true });
	});

	test('injects isProduction into parsed config', () => {
		const result = parseConfig(validConfig);

		expect(typeof result.isProduction).toBe('boolean');
	});

	test('isProduction is synced from NODE_ENV at parse time', () => {
		const originalNodeEnv = Bun.env.NODE_ENV ?? 'test';

		try {
			Bun.env.NODE_ENV = 'production';
			const prodResult = parseConfig(validConfig);

			Bun.env.NODE_ENV = 'test';
			const devResult = parseConfig(validConfig);

			expect(prodResult.isProduction).toBe(true);
			expect(devResult.isProduction).toBe(false);
		} finally {
			Bun.env.NODE_ENV = originalNodeEnv;
		}
	});

	test('envMap uses NODE_ENV for tuple resolution', () => {
		const originalNodeEnv = Bun.env.NODE_ENV ?? 'test';

		const configWithTuple = {
			...validConfig,
			discord: {
				...validConfig.discord,
				appID: ['11111111111111111', '99999999999999999'] as [string, string],
			},
		};

		try {
			Bun.env.NODE_ENV = 'production';
			const prodResult = parseConfig(configWithTuple);

			Bun.env.NODE_ENV = 'test';
			const devResult = parseConfig(configWithTuple);

			expect(prodResult.discord.appID).toBe('11111111111111111');
			expect(devResult.discord.appID).toBe('99999999999999999');
		} finally {
			Bun.env.NODE_ENV = originalNodeEnv;
		}
	});
});

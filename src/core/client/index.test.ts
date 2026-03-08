import { describe, expect, mock, test } from 'bun:test';
import { Client, Collection, GatewayIntentBits } from 'discord.js';
import type { ExtendedLogger } from '@/core/lib/logger';
import { initializeClient, isInitializedClient } from './index';

// ─── Test Helpers ────────────────────────────────────────────────

function createRealClient(): Client {
	return new Client({ intents: [GatewayIntentBits.Guilds] });
}

function createMockLogger(): ExtendedLogger {
	return {
		debug: mock(() => {}),
		info: mock(() => {}),
		warn: mock(() => {}),
		error: mock(() => {}),
		registerDebugSource: mock(() => mock(() => {})),
		shutdown: mock(async () => {}),
	} as unknown as ExtendedLogger;
}

function createMockConfig(): Client['config'] {
	return {
		discord: {
			appID: '123456789012345678',
			apiToken: 'mock-token',
			intents: [GatewayIntentBits.Guilds],
			enabledPartials: [],
			enforceNonce: false,
		},
		misc: {},
		ids: { role: {}, channel: {}, emoji: {} },
	} as unknown as Client['config'];
}

// ─── Tests ───────────────────────────────────────────────────────

describe('initializeClient', () => {
	test('attaches logger to client', () => {
		const client = createRealClient();
		const logger = createMockLogger();
		const config = createMockConfig();

		const result = initializeClient(client, logger, config);

		expect(result.logger).toBe(logger);
	});

	test('attaches parsed config to client', () => {
		const client = createRealClient();
		const logger = createMockLogger();
		const config = createMockConfig();

		const result = initializeClient(client, logger, config);

		expect(result.config).toBe(config);
	});

	test('creates empty commands Collection', () => {
		const client = createRealClient();
		const result = initializeClient(
			client,
			createMockLogger(),
			createMockConfig(),
		);

		expect(result.commands).toBeInstanceOf(Collection);
		expect(result.commands.size).toBe(0);
	});

	test('creates empty components Collection', () => {
		const client = createRealClient();
		const result = initializeClient(
			client,
			createMockLogger(),
			createMockConfig(),
		);

		expect(result.components).toBeInstanceOf(Collection);
		expect(result.components.size).toBe(0);
	});

	test('creates empty scheduledJobs Collection', () => {
		const client = createRealClient();
		const result = initializeClient(
			client,
			createMockLogger(),
			createMockConfig(),
		);

		expect(result.scheduledJobs).toBeInstanceOf(Collection);
		expect(result.scheduledJobs.size).toBe(0);
	});

	test('returns the same client reference (augmented)', () => {
		const client = createRealClient();
		const result = initializeClient(
			client,
			createMockLogger(),
			createMockConfig(),
		);

		// Cast both to unknown to compare identity without type mismatch
		expect(result as unknown).toBe(client as unknown);
	});
});

describe('isInitializedClient', () => {
	test('returns true for initialized Client', () => {
		const client = createRealClient();
		const initialized = initializeClient(
			client,
			createMockLogger(),
			createMockConfig(),
		);

		expect(isInitializedClient(initialized)).toBe(true);
	});

	test('returns false for plain Discord.js Client', () => {
		const client = createRealClient();

		expect(isInitializedClient(client)).toBe(false);
	});

	test('returns false for partially-augmented client (only logger)', () => {
		const client = createRealClient() as unknown as Client;
		// Only set logger — missing config, commands, components, scheduledJobs
		(client as unknown as Record<string, unknown>)['logger'] =
			createMockLogger();

		expect(isInitializedClient(client)).toBe(false);
	});

	test('returns false when logger is not an object', () => {
		const client = createRealClient() as unknown as Record<string, unknown>;
		client['logger'] = 'not-an-object';
		client['config'] = createMockConfig();
		client['commands'] = new Collection();
		client['components'] = new Collection();
		client['scheduledJobs'] = new Collection();

		expect(isInitializedClient(client as unknown as Client)).toBe(false);
	});

	test('returns false when logger lacks ExtendedLogger methods', () => {
		const client = createRealClient() as unknown as Record<string, unknown>;
		client['logger'] = { info: () => {} };
		client['config'] = createMockConfig();
		client['commands'] = new Collection();
		client['components'] = new Collection();
		client['scheduledJobs'] = new Collection();

		expect(isInitializedClient(client as unknown as Client)).toBe(false);
	});

	test('returns false when collections are wrong types', () => {
		const client = createRealClient() as unknown as Record<string, unknown>;
		client['logger'] = createMockLogger();
		client['config'] = createMockConfig();
		client['commands'] = new Map(); // wrong type — should be Collection
		client['components'] = new Collection();
		client['scheduledJobs'] = new Collection();

		expect(isInitializedClient(client as unknown as Client)).toBe(false);
	});
});

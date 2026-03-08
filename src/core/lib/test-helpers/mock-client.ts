/** biome-ignore-all lint/suspicious/noEmptyBlockStatements: Test mocks */
import { mock } from 'bun:test';
import type { CronJob } from 'cron';
import { type Client, Collection } from 'discord.js';
import type { BaseCommandSpark } from '@/core/sparks/command';
import type { BaseComponentSpark } from '@/core/sparks/component';

interface MockClientOverrides {
	commands?: Collection<string, BaseCommandSpark>;
	components?: Collection<string, BaseComponentSpark>;
	scheduledJobs?: Collection<string, CronJob>;
	on?: ReturnType<typeof mock>;
	once?: ReturnType<typeof mock>;
	isReady?: boolean;
	ws?: { ping: number };
	config?: Partial<Client['config']>;
	logger?: Partial<{
		debug: ReturnType<typeof mock>;
		info: ReturnType<typeof mock>;
		warn: ReturnType<typeof mock>;
		error: ReturnType<typeof mock>;
		registerDebugSource: ReturnType<typeof mock>;
		shutdown: ReturnType<typeof mock>;
	}>;
}

/**
 * Creates a mock Client for testing.
 *
 * Returns a mock client with all required augmented properties populated with
 * mock functions and empty collections. Useful for unit testing sparks and guards
 * without requiring a real Discord.js client.
 *
 * @param overrides - Optional overrides for specific client properties
 * @returns A mock Client instance
 *
 * @example
 * ```ts
 * const client = createMockClient({
 *   commands: new Collection([['ping', pingCommandSpark]]),
 *   isReady: true,
 * });
 *
 * expect(client.commands.get('ping')).toBe(pingCommandSpark);
 * expect(client.isReady()).toBe(true);
 * ```
 */
export function createMockClient(overrides: MockClientOverrides = {}): Client {
	const config = overrides.config ?? {
		discord: {
			appID: '000000000000000000',
			apiToken: 'mock-token',
			intents: [],
			enabledPartials: [],
			enforceNonce: false,
		},
		misc: {},
		ids: { role: {}, channel: {}, emoji: {} },
	};

	return {
		commands: overrides.commands ?? new Collection(),
		components: overrides.components ?? new Collection(),
		scheduledJobs: overrides.scheduledJobs ?? new Collection(),
		on: overrides.on ?? mock(() => {}),
		once: overrides.once ?? mock(() => {}),
		isReady: mock(() => overrides.isReady ?? true),
		destroy: mock(() => {}),
		ws: overrides.ws ?? { ping: 0 },
		config,
		logger: {
			debug: overrides.logger?.debug ?? mock(() => {}),
			info: overrides.logger?.info ?? mock(() => {}),
			warn: overrides.logger?.warn ?? mock(() => {}),
			error: overrides.logger?.error ?? mock(() => {}),
			registerDebugSource:
				overrides.logger?.registerDebugSource ?? mock(() => mock(() => {})),
			shutdown: overrides.logger?.shutdown ?? mock(async () => {}),
		},
	} as unknown as Client;
}

import { describe, expect, mock, test } from 'bun:test';
import { Events } from 'discord.js';
import { createMockClient } from '@/core/lib/test-helpers';
import type { ReadyClient } from '@/core/sparks';
import { ready } from './ready';

/**
 * Creates a mock client that doubles as a ReadyClient.
 * The real ClientReady event arg IS the client instance typed as Client<true>,
 * so the mock needs both framework properties (logger) and ready properties (user, guilds).
 */
function createReadyClient(
	overrides: { guildCount?: number; emojiFetchSucceeds?: boolean } = {},
) {
	const client = createMockClient();
	const emojiFetch = overrides.emojiFetchSucceeds
		? mock(() => Promise.resolve([]))
		: mock(() => Promise.reject(new Error('mock: no emojis')));
	const readyClient = Object.assign(client, {
		user: { tag: 'TestBot#1234' },
		guilds: { cache: { size: overrides.guildCount ?? 0 } },
		application: { emojis: { fetch: emojiFetch } },
	}) as unknown as ReadyClient;
	return { client, readyClient };
}

describe('ready spark', () => {
	test('has correct type, event, and once flag', () => {
		expect(ready.type).toBe('gateway-event');
		expect(ready.event).toBe(Events.ClientReady);
		expect(ready.once).toBe(true);
	});

	test('logs bot tag and guild count on ready', async () => {
		const { client, readyClient } = createReadyClient({ guildCount: 5 });

		await ready.execute([readyClient], client);

		expect(client.logger.info).toHaveBeenCalledWith(
			{ user: 'TestBot#1234', guilds: 5, emojiCacheReady: false },
			'Bot is ready',
		);
	});

	test('logs correctly when bot is in zero guilds', async () => {
		const { client, readyClient } = createReadyClient({ guildCount: 0 });

		await ready.execute([readyClient], client);

		expect(client.logger.info).toHaveBeenCalledWith(
			{ user: 'TestBot#1234', guilds: 0, emojiCacheReady: false },
			'Bot is ready',
		);
	});

	test('reports emojiCacheReady true when emoji fetch succeeds', async () => {
		const { client, readyClient } = createReadyClient({
			guildCount: 1,
			emojiFetchSucceeds: true,
		});

		await ready.execute([readyClient], client);

		expect(client.logger.info).toHaveBeenCalledWith(
			{ user: 'TestBot#1234', guilds: 1, emojiCacheReady: true },
			'Bot is ready',
		);
		expect(client.logger.warn).not.toHaveBeenCalled();
	});

	test('logs warning when emoji fetch fails', async () => {
		const { client, readyClient } = createReadyClient({
			guildCount: 1,
			emojiFetchSucceeds: false,
		});

		await ready.execute([readyClient], client);

		expect(client.logger.warn).toHaveBeenCalledWith(
			expect.objectContaining({ err: expect.any(Error) }),
			expect.any(String),
		);
	});
});

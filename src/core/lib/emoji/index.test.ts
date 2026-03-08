import { describe, expect, test } from 'bun:test';
import type { ApplicationEmoji, Client } from 'discord.js';
import { Collection } from 'discord.js';
import { resolveAppEmoji } from './index.ts';

/** Creates a mock Client with the given emojis in the application emoji cache. */
function makeClient(emojis: Array<{ id: string; name: string }>): Client {
	const cache = new Collection<string, ApplicationEmoji>();
	for (const e of emojis) {
		cache.set(e.id, e as unknown as ApplicationEmoji);
	}
	return { application: { emojis: { cache } } } as unknown as Client;
}

describe('resolveAppEmoji', () => {
	test('returns emoji ID when name matches', () => {
		const client = makeClient([{ id: '123', name: 'moderator' }]);

		expect(resolveAppEmoji(client, 'moderator', '🛡️')).toBe('123');
	});

	test('returns fallback when no emoji matches', () => {
		const client = makeClient([]);

		expect(resolveAppEmoji(client, 'moderator', '🛡️')).toBe('🛡️');
	});

	test('returns fallback when application is null', () => {
		const client = { application: null } as unknown as Client;

		expect(resolveAppEmoji(client, 'moderator', '🛡️')).toBe('🛡️');
	});

	test('matches exact name among multiple emojis', () => {
		const client = makeClient([
			{ id: '100', name: 'banhammer' },
			{ id: '200', name: 'moderator' },
			{ id: '300', name: 'checkmark' },
		]);

		expect(resolveAppEmoji(client, 'banhammer', '🔨')).toBe('100');
		expect(resolveAppEmoji(client, 'moderator', '🛡️')).toBe('200');
		expect(resolveAppEmoji(client, 'checkmark', '✅')).toBe('300');
	});
});

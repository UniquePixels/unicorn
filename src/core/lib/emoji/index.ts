import type { Client } from 'discord.js';

/**
 * Resolves an application emoji by name, returning its ID or a Unicode fallback.
 *
 * @remarks The application emoji cache must be pre-populated via
 * `client.application.emojis.fetch()` before calling this function.
 * If the cache is empty, `fallback` is always returned silently.
 */
export function resolveAppEmoji(
	client: Client,
	name: string,
	fallback: string,
): string {
	return (
		client.application?.emojis.cache.find((e) => e.name === name)?.id ??
		fallback
	);
}

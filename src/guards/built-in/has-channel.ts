import type { Guild, GuildBasedChannel } from 'discord.js';
import {
	createGuard,
	type Guard,
	getGuardMeta,
	guardFail,
	guardPass,
} from '@/core/guards';
import { inCachedGuild } from './in-cached-guild';

/**
 * Creates a guard that checks if a channel with the given ID exists in the guild cache.
 * Carries `channelResolver` metadata so `*PermissionIn` guards can read the target channel.
 *
 * Accepts either a static ID string or a function that resolves the ID at execution time.
 *
 * @param channelIdOrFn - Static channel ID, or a function resolving the ID from input
 *
 * @example
 * ```ts
 * // Static ID known at module scope
 * const logChannel = hasChannel('123456789012345678');
 *
 * // Dynamic ID from client config at execution time
 * const logChannel = hasChannel((input) => input.client.config.ids.channel.logs);
 *
 * export const logCommand = defineCommand({
 *   command: builder,
 *   guards: [botHasPermissionIn(PermissionFlagsBits.SendMessages, logChannel)],
 *   action: async (interaction) => { // ...
 *   },
 * });
 * ```
 */
export function hasChannel<T extends { guild: Guild }>(
	channelIdOrFn: string | ((input: T) => string),
): Guard<T, T> {
	const resolveId =
		typeof channelIdOrFn === 'function' ? channelIdOrFn : () => channelIdOrFn;

	const guard = createGuard(
		(input: T) => {
			const id = resolveId(input);
			const channel = input.guild.channels.cache.get(id);

			if (!channel) {
				return guardFail(`Channel ${id} was not found in this server.`);
			}

			return guardPass(input);
		},
		{
			name: 'hasChannel',
			requires: [inCachedGuild],
			incompatibleWith: ['scheduled-event'],
			channelResolver: (input) => {
				const typed = input as T;
				const id = resolveId(typed);
				return typed.guild.channels.cache.get(id) ?? null;
			},
		},
	);

	return guard;
}

/**
 * Reads the `channelResolver` from a guard's metadata.
 * Used internally by `*PermissionIn` guards to resolve target channels.
 */
export function resolveChannelFromGuard(
	// biome-ignore lint/suspicious/noExplicitAny: Guard<any, any> required for reading metadata from any guard
	guard: Guard<any, any>,
	input: unknown,
): GuildBasedChannel | null {
	const meta = getGuardMeta(guard);
	return meta?.channelResolver?.(input) ?? null;
}

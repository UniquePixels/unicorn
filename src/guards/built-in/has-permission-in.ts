import type {
	GuildBasedChannel,
	GuildMember,
	PermissionResolvable,
} from 'discord.js';
import { PermissionsBitField } from 'discord.js';
import {
	createGuard,
	type Guard,
	type GuardMeta,
	guardFail,
	guardPass,
} from '@/core/guards';
import { resolveChannelFromGuard } from './has-channel';
import { inCachedGuild } from './in-cached-guild';

/**
 * Creates a guard that checks if the user has the specified permissions in a channel.
 *
 * When `channelGuard` is omitted, checks the interaction channel (`input.channel`).
 * When provided, reads the target channel from the guard's `channelResolver` metadata
 * and auto-adds the guard to `requires`.
 *
 * @param permissions - Permission(s) to check for
 * @param channelGuard - Optional channel guard whose `channelResolver` metadata identifies the target channel
 * @param message - Optional custom error message
 *
 * @example
 * ```ts
 * // Check perms in the interaction channel
 * guards: [hasPermissionIn(PermissionFlagsBits.ManageMessages)]
 *
 * // Check perms in a specific channel
 * guards: [hasPermissionIn(PermissionFlagsBits.ManageMessages, hasSystemChannel)]
 * ```
 */
export function hasPermissionIn<
	T extends { member: GuildMember; channel: GuildBasedChannel | null },
>(
	permissions: PermissionResolvable,
	// biome-ignore lint/suspicious/noExplicitAny: Guard<any, any> required for heterogeneous channel guard types
	channelGuard?: Guard<any, any>,
	message?: string,
): Guard<T, T> {
	const permBits = new PermissionsBitField(permissions);
	const permNames = permBits.toArray().join(', ');

	const requires: GuardMeta['requires'] = channelGuard
		? [inCachedGuild, channelGuard]
		: [inCachedGuild];

	return createGuard(
		(input) => {
			const channel = channelGuard
				? resolveChannelFromGuard(channelGuard, input)
				: input.channel;

			if (!channel) {
				return guardFail('Unable to resolve channel for permission check.');
			}

			const perms = input.member.permissionsIn(channel);

			if (!perms.has(permissions)) {
				return guardFail(
					message ?? `You need the following permission(s): ${permNames}`,
				);
			}

			return guardPass(input);
		},
		{
			name: 'hasPermissionIn',
			requires,
			incompatibleWith: ['scheduled-event'],
		},
	);
}

import type { Guild, PermissionResolvable } from 'discord.js';
import { PermissionsBitField } from 'discord.js';
import { createGuard, type Guard, guardFail, guardPass } from '@/core/guards';
import { inCachedGuild } from './in-cached-guild';

/**
 * Creates a guard that checks if the bot has the specified permissions at the guild level.
 * Must be used after inCachedGuild to ensure guild is available.
 *
 * For channel-level permission checks, use `botHasPermissionIn` instead.
 *
 * @param permissions - Permission(s) to check for
 * @param message - Optional custom error message
 *
 * @example
 * ```ts
 * import { PermissionFlagsBits } from 'discord.js';
 *
 * export const modCommand = defineCommand({
 *   command: builder,
 *   guards: [botHasPermission(PermissionFlagsBits.ManageRoles)],
 *   action: async (interaction) => { // ...
 *   },
 * });
 * ```
 */
export function botHasPermission<T extends { guild: Guild }>(
	permissions: PermissionResolvable,
	message?: string,
): Guard<T, T> {
	const permBits = new PermissionsBitField(permissions);
	const permNames = permBits.toArray().join(', ');

	return createGuard(
		(input) => {
			const botMember = input.guild.members.me;

			if (!botMember) {
				return guardFail('Unable to verify bot permissions.');
			}

			if (!botMember.permissions.has(permissions)) {
				return guardFail(
					message ?? `I need the following permission(s): ${permNames}`,
				);
			}

			return guardPass(input);
		},
		{
			name: 'botHasPermission',
			requires: [inCachedGuild],
			incompatibleWith: ['scheduled-event'],
		},
	);
}

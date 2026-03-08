import type { GuildMember, PermissionResolvable } from 'discord.js';
import { PermissionsBitField } from 'discord.js';
import { createGuard, type Guard, guardFail, guardPass } from '@/core/guards';
import { inCachedGuild } from './in-cached-guild';

/**
 * Creates a guard that checks if the user has the specified permissions.
 * Must be used after inCachedGuild to ensure member is available.
 *
 * @param permissions - Permission(s) to check for
 * @param message - Optional custom error message
 *
 * @example
 * ```ts
 * import { PermissionFlagsBits } from 'discord.js';
 * import { defineCommand } from '@/core/sparks';
 * import * as g from '@/guards/built-in';
 *
 * export const modCommand = defineCommand({
 *   command: builder,
 *   guards: [g.inCachedGuild, g.hasPermission(PermissionFlagsBits.ManageMessages)],
 *   action: async (interaction) => { // ...
 *   },
 * });
 * ```
 */
export function hasPermission<T extends { member: GuildMember }>(
	permissions: PermissionResolvable,
	message?: string,
): Guard<T, T> {
	const permBits = new PermissionsBitField(permissions);
	const permNames = permBits.toArray().join(', ');

	return createGuard(
		(input) => {
			const { member } = input;

			if (!member.permissions.has(permissions)) {
				return guardFail(
					message ?? `You need the following permission(s): ${permNames}`,
				);
			}

			return guardPass(input);
		},
		{
			name: 'hasPermission',
			requires: [inCachedGuild],
			incompatibleWith: ['scheduled-event'],
		},
	);
}

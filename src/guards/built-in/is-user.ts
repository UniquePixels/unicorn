import type { Interaction } from 'discord.js';
import { createGuard, type Guard, guardFail, guardPass } from '@/core/guards';

/**
 * Creates a guard that checks if the user is in a list of allowed user IDs.
 * Useful for owner-only commands or admin whitelists.
 *
 * @param userIds - Array of allowed user IDs
 * @param message - Optional custom error message
 *
 * @example
 * ```ts
 * export const ownerCommand = defineCommand({
 *   command: builder,
 *   guards: [isUser(['123456789012345678'])],
 *   action: async (interaction) => { // ...
 *   },
 * });
 * ```
 */
export function isUser<T extends Interaction>(
	userIds: string[],
	message?: string,
): Guard<T, T> {
	const userIdSet = new Set(userIds);

	return createGuard(
		(input) => {
			if (!userIdSet.has(input.user.id)) {
				return guardFail(
					message ?? 'You do not have permission to use this command.',
				);
			}

			return guardPass(input);
		},
		{ name: 'isUser', incompatibleWith: ['scheduled-event'] },
	);
}

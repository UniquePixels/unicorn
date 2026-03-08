import { ChannelType, type Interaction } from 'discord.js';
import { createGuard, type Guard, guardFail, guardPass } from '@/core/guards';

/**
 * Interaction narrowed to a specific channel type.
 */
export type ChannelTypedInteraction<
	T extends Interaction,
	C extends ChannelType,
> = T & {
	channel: Extract<T['channel'], { type: C }>;
};

/**
 * Creates a guard that ensures the interaction is in a channel of the specified type(s).
 *
 * @param types - Allowed channel type(s)
 *
 * @example
 * ```ts
 * export const threadCommand = defineCommand({
 *   command: builder,
 *   guards: [channelType(ChannelType.PublicThread, ChannelType.PrivateThread)],
 *   action: async (interaction) => { // ...
 *   },
 * });
 * ```
 */
export function channelType<T extends Interaction, C extends ChannelType>(
	...types: C[]
): Guard<T, ChannelTypedInteraction<T, C>> {
	const typeSet = new Set(types);
	const typeNames = types.map((t) => ChannelType[t]).join(', ');

	return createGuard(
		(input) => {
			if (!(input.channel && typeSet.has(input.channel.type as C))) {
				return guardFail(`This command can only be used in: ${typeNames}`);
			}

			return guardPass(input as ChannelTypedInteraction<T, C>);
		},
		{ name: 'channelType', incompatibleWith: ['scheduled-event'] },
	);
}

import { ChannelType, type DMChannel, type Interaction } from 'discord.js';
import { createGuard, type Guard, guardFail, guardPass } from '@/core/guards';

/**
 * Interaction narrowed to guarantee a DM channel context.
 */
export type DMInteraction<T extends Interaction = Interaction> = T & {
	channel: DMChannel;
};

/**
 * Guard that ensures the interaction is in a DM channel.
 * Standalone — does not require `inCachedGuild`.
 *
 * @example
 * ```ts
 * import { defineCommand } from '@/core/sparks';
 * import * as g from '@/guards/built-in';
 *
 * export const dmOnly = defineCommand({
 *   command: builder,
 *   guards: [g.isDMChannel],
 *   action: async (interaction) => {
 *     // interaction.channel is narrowed to DMChannel
 *     await interaction.reply('This is a DM!');
 *   },
 * });
 * ```
 */
export const isDMChannel: Guard<Interaction, DMInteraction> = createGuard<
	Interaction,
	DMInteraction
>(
	(interaction) => {
		if (interaction.channel?.type !== ChannelType.DM) {
			return guardFail('This can only be used in a direct message.');
		}
		return guardPass(interaction as DMInteraction);
	},
	{
		name: 'isDMChannel',
		incompatibleWith: ['scheduled-event'],
	},
);

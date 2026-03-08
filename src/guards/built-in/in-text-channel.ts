import type {
	Guild,
	GuildBasedChannel,
	GuildMember,
	Interaction,
	TextBasedChannel,
} from 'discord.js';
import { createGuard, type Guard, guardFail, guardPass } from '@/core/guards';
import type { GuildInteraction } from './in-cached-guild';
import { inCachedGuild } from './in-cached-guild';

/**
 * Interaction narrowed to guarantee a non-null, text-based guild channel.
 *
 * Use after `inCachedGuild` when your action needs `interaction.channel`
 * to be present and sendable.
 */
export type TextChannelInteraction<T extends Interaction = Interaction> = T & {
	guild: Guild;
	guildId: string;
	member: GuildMember;
	channel: GuildBasedChannel & TextBasedChannel;
};

/**
 * Guard that ensures the interaction has a non-null, text-based guild channel.
 * Requires `inCachedGuild` (auto-resolved).
 *
 * @example
 * ```ts
 * import { defineCommand } from '@/core/sparks';
 * import * as g from '@/guards/built-in';
 *
 * export const myCommand = defineCommand({
 *   command: builder,
 *   guards: [g.inTextChannel],
 *   action: async (interaction) => {
 *     // interaction.channel is guaranteed non-null and text-based
 *     await interaction.channel.send('Hello!');
 *   },
 * });
 * ```
 */
export const inTextChannel: Guard<GuildInteraction, TextChannelInteraction> =
	createGuard<GuildInteraction, TextChannelInteraction>(
		(input) => {
			if (!input.channel?.isTextBased()) {
				return guardFail('This can only be used in a text channel.');
			}
			return guardPass(input as unknown as TextChannelInteraction);
		},
		{
			name: 'inTextChannel',
			requires: [inCachedGuild],
			incompatibleWith: ['scheduled-event'],
		},
	);

import type {
	Guild,
	GuildBasedChannel,
	GuildMember,
	Interaction,
	TextBasedChannel,
} from 'discord.js';
import { createGuard, type Guard, guardFail, guardPass } from '@/core/guards';

/**
 * Interaction that is guaranteed to be in a cached guild.
 * Provides access to guild, member, and other guild-specific properties.
 */
export type GuildInteraction<T extends Interaction = Interaction> = T & {
	guild: Guild;
	guildId: string;
	member: GuildMember;
	channel: (GuildBasedChannel & TextBasedChannel) | null;
};

/**
 * Guard that ensures an interaction is in a cached guild.
 * Narrows the type to include guild, member, and guildId.
 *
 * @example
 * ```ts
 * export const myCommand = defineCommand({
 *   command: builder,
 *   guards: [inCachedGuild],
 *   action: async (interaction) => {
 *     // interaction is narrowed to GuildInteraction — guild, member, guildId guaranteed
 *   },
 * });
 * ```
 */
export const inCachedGuild: Guard<Interaction, GuildInteraction> = createGuard<
	Interaction,
	GuildInteraction
>(
	(interaction) => {
		if (!interaction.inCachedGuild()) {
			return guardFail('This can only be used in a server.');
		}
		return guardPass(interaction as GuildInteraction);
	},
	{ name: 'inCachedGuild', incompatibleWith: ['scheduled-event'] },
);

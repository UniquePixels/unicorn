import type { Guild } from 'discord.js';
import { createGuard, type Guard, guardFail, guardPass } from '@/core/guards';
import { inCachedGuild } from './in-cached-guild';

/**
 * Narrowed type that includes a guaranteed non-null special channel.
 */
type WithSpecialChannel<T, K extends keyof Guild> = T & {
	guild: Guild & { [P in K]: NonNullable<Guild[K]> };
};

/** Guild properties that correspond to special channels. */
type SpecialChannelKey =
	| 'systemChannel'
	| 'publicUpdatesChannel'
	| 'rulesChannel'
	| 'safetyAlertsChannel';

/**
 * Creates a constant guard for a special guild channel.
 * Checks existence only — use `botHasPermissionIn` for permission checks.
 */
function createSpecialChannelGuard<K extends SpecialChannelKey>(
	channelKey: K,
	channelName: string,
	guardName: string,
): Guard<{ guild: Guild }, WithSpecialChannel<{ guild: Guild }, K>> {
	return createGuard(
		(input: { guild: Guild }) => {
			const channel = input.guild[channelKey];

			if (!channel) {
				return guardFail(
					`This server does not have a ${channelName} configured.`,
				);
			}

			return guardPass(input as WithSpecialChannel<{ guild: Guild }, K>);
		},
		{
			name: guardName,
			requires: [inCachedGuild],
			incompatibleWith: ['scheduled-event'],
			channelResolver: (input) =>
				(input as { guild: Guild }).guild[channelKey] ?? null,
		},
	);
}

/**
 * Guard that ensures the guild has a system channel configured.
 * The system channel is used for welcome messages, boost notifications, and other system events.
 *
 * Must be used with input that has a guild property (e.g., after inCachedGuild).
 *
 * @example
 * ```ts
 * export const notifyCommand = defineCommand({
 *   command: builder,
 *   guards: [inCachedGuild, hasSystemChannel],
 *   action: async (interaction) => {
 *     // interaction.guild.systemChannel is guaranteed to exist
 *     await interaction.guild.systemChannel.send('Hello!');
 *   },
 * });
 * ```
 */
export const hasSystemChannel = createSpecialChannelGuard(
	'systemChannel',
	'system channel',
	'hasSystemChannel',
);

/**
 * Guard that ensures the guild has a public updates channel configured.
 * This channel is used for community server announcements and updates.
 *
 * Must be used with input that has a guild property (e.g., after inCachedGuild).
 *
 * @example
 * ```ts
 * export const announceEvent = defineGatewayEvent({
 *   event: Events.GuildMemberAdd,
 *   guards: [hasPublicUpdatesChannel],
 *   action: async (member) => {
 *     // member.guild.publicUpdatesChannel is guaranteed to exist
 *     await member.guild.publicUpdatesChannel.send(`Welcome ${member}!`);
 *   },
 * });
 * ```
 */
export const hasPublicUpdatesChannel = createSpecialChannelGuard(
	'publicUpdatesChannel',
	'public updates channel',
	'hasPublicUpdatesChannel',
);

/**
 * Guard that ensures the guild has a rules channel configured.
 * This channel displays server rules to members.
 *
 * Must be used with input that has a guild property (e.g., after inCachedGuild).
 *
 * @example
 * ```ts
 * export const updateRulesCommand = defineCommand({
 *   command: builder,
 *   guards: [inCachedGuild, hasRulesChannel],
 *   action: async (interaction) => {
 *     // interaction.guild.rulesChannel is guaranteed to exist
 *     await interaction.guild.rulesChannel.send('Updated rules...');
 *   },
 * });
 * ```
 */
export const hasRulesChannel = createSpecialChannelGuard(
	'rulesChannel',
	'rules channel',
	'hasRulesChannel',
);

/**
 * Guard that ensures the guild has a safety alerts channel configured.
 * This channel is used for Discord's safety and moderation alerts.
 *
 * Must be used with input that has a guild property (e.g., after inCachedGuild).
 *
 * @example
 * ```ts
 * export const safetyAlert = defineGatewayEvent({
 *   event: Events.AutoModerationActionExecution,
 *   guards: [hasSafetyAlertsChannel],
 *   action: async (execution) => {
 *     // execution.guild.safetyAlertsChannel is guaranteed to exist
 *     await execution.guild.safetyAlertsChannel.send('Safety alert...');
 *   },
 * });
 * ```
 */
export const hasSafetyAlertsChannel = createSpecialChannelGuard(
	'safetyAlertsChannel',
	'safety alerts channel',
	'hasSafetyAlertsChannel',
);

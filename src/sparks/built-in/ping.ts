import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { attempt } from '@/core/lib/attempt';
import { defineCommand } from '@/core/sparks';
import * as g from '@/guards/built-in';

/**
 * Built-in /ping command for checking bot latency.
 *
 * Restricted to administrators at both the Discord registration level
 * (setDefaultMemberPermissions) and runtime (hasPermission guard).
 *
 * @example
 * User: /ping
 * Bot: Pong! Roundtrip: 42ms | WebSocket: 38ms
 */
export const ping = defineCommand({
	command: new SlashCommandBuilder()
		.setName('ping')
		.setDescription('Check bot latency and responsiveness')
		.setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

	scope: 'guild',

	guards: [g.inCachedGuild, g.hasPermission(PermissionFlagsBits.Administrator)],

	action: async (interaction) => {
		const replyResult = await attempt(() =>
			interaction.reply({ content: 'Pinging...' }),
		);
		if (replyResult.isErr()) {
			interaction.client.logger.error(
				{ err: replyResult.error },
				'Ping reply failed',
			);
			return;
		}

		const fetchResult = await attempt(() => interaction.fetchReply());
		if (fetchResult.isErr()) {
			interaction.client.logger.error(
				{ err: fetchResult.error },
				'Ping fetchReply failed',
			);
			return;
		}

		const roundTrip =
			fetchResult.data.createdTimestamp - interaction.createdTimestamp;
		const wsLatency = interaction.client.ws.ping;

		const editResult = await attempt(() =>
			interaction.editReply(
				`Pong! Roundtrip: ${roundTrip}ms | WebSocket: ${wsLatency}ms`,
			),
		);
		if (editResult.isErr()) {
			interaction.client.logger.error(
				{ err: editResult.error },
				'Ping editReply failed',
			);
		}
	},
});

import { Events } from 'discord.js';
import { attempt } from '@/core/lib/attempt';
import { defineGatewayEvent, type GatewayEventSpark } from '@/core/sparks';

/**
 * Built-in spark that handles the ClientReady event.
 *
 * This spark fires once when the bot successfully logs in to Discord.
 * It logs the bot's username and performs any necessary post-login setup.
 */
export const ready: GatewayEventSpark<typeof Events.ClientReady> =
	defineGatewayEvent({
		event: Events.ClientReady,
		once: true,
		action: async (client) => {
			// Fetch all app emojis to cache them, so name lookup works
			const emojiResult = await attempt(() =>
				client.application.emojis.fetch(),
			);
			if (emojiResult.isErr()) {
				client.logger.warn(
					{ err: emojiResult.error },
					'Failed to fetch emojis on ready — emoji resolution will use fallbacks',
				);
			}

			client.logger.info(
				{
					user: client.user.tag,
					guilds: client.guilds.cache.size,
					emojiCacheReady: emojiResult.isOk(),
				},
				'Bot is ready',
			);
		},
	});

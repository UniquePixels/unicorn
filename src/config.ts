// coverage-ignore-file — static config wiring; shape validated by `satisfies UnicornConfig`
import { ActivityType, GatewayIntentBits, Partials } from 'discord.js';
import type { UnicornConfig } from '@/core/configuration';

/**
 * Main application configuration for the Unicorn Discord bot.
 *
 * This configuration object satisfies the UnicornConfig schema and provides:
 * - Discord client settings (intents, partials, presence)
 * - Health check server port
 * - Type-safe access to Discord IDs (roles, channels, emojis)
 *
 * The config uses `secret://` prefix for sensitive values like the API token,
 * which are resolved from environment variables during parsing.
 */
export const appConfig = {
	discord: {
		appID: '1225958405542383747', // Note: App IDs are not secrets.
		apiToken: 'secret://apiKey',
		intents: [GatewayIntentBits.Guilds],
		enabledPartials: [Partials.Channel],
		enforceNonce: true,
		defaultPresence: {
			status: 'online',
			activities: [
				{ type: ActivityType.Watching, name: 'fabulous communities.' },
			],
		},
		commands: {
			defaultScope: 'guild',
		},
	},
	healthCheckPort: 3000,
	misc: {},
	ids: {
		role: {},
		channel: {},
		emoji: {},
	},
} satisfies UnicornConfig;

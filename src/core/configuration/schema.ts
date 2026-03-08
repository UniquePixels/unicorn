import { ActivityType, GatewayIntentBits, Partials } from 'discord.js';
import * as z from 'zod';
import { COMMAND_SCOPES } from '@/core/sparks/command-scope';
import * as u from './schema-helpers.ts';

/**
 * Creates the Unicorn config schema with environment-aware tuple resolution.
 *
 * @param isProduction - Whether to select production values from envMap tuples
 */
export function createConfigSchema(isProduction: boolean) {
	return z.object({
		discord: z.object({
			appID: u.envMap(u.Snowflake, isProduction),
			apiToken: u.envMap(u.Secret, isProduction),
			intents: z.array(z.enum(GatewayIntentBits)),
			enabledPartials: z.array(z.enum(Partials)),
			enforceNonce: z.boolean(),
			defaultPresence: z.object({
				status: z.enum(['online', 'idle', 'dnd', 'invisible']),
				activities: z.array(
					z.object({
						name: z.string(),
						type: z.enum(ActivityType),
					}),
				),
			}),
			oAuth2: z
				.object({
					apiToken: u.envMap(u.Secret, isProduction),
					url: u.envMap(z.url(), isProduction),
				})
				.optional(),
			commands: z
				.object({
					defaultScope: z.enum(COMMAND_SCOPES).default('guild'),
					devGuildId: u.Snowflake.optional(),
				})
				.default({ defaultScope: 'guild' }),
		}),
		healthCheckPort: z.number().int().min(1).max(65_535).optional(),
		misc: z.record(z.string(), u.MiscValue),
		ids: z.object({
			role: z.record(z.string(), u.envMap(u.Snowflake, isProduction)),
			channel: z.record(z.string(), u.envMap(u.Snowflake, isProduction)),
			emoji: z.record(z.string(), u.envMap(u.Snowflake, isProduction)),
		}),
	});
}

/** The schema type, for deriving input/output types. */
export type ConfigSchema = ReturnType<typeof createConfigSchema>;

import { ApplicationIntegrationType, InteractionContextType } from 'discord.js';

/**
 * Named presets for command visibility across Discord surfaces.
 */
export const COMMAND_SCOPES = [
	'guild',
	'guild+bot-dm',
	'user',
	'everywhere',
] as const;

/**
 * A command scope preset name.
 */
export type CommandScope = (typeof COMMAND_SCOPES)[number];

/**
 * Resolved integration types and interaction contexts for a scope preset.
 */
export interface ResolvedScope {
	readonly integrationTypes: readonly ApplicationIntegrationType[];
	readonly contexts: readonly InteractionContextType[];
}

/** Maps each scope preset to its Discord enum values. */
const SCOPE_MAP: Record<CommandScope, ResolvedScope> = {
	guild: {
		integrationTypes: [ApplicationIntegrationType.GuildInstall],
		contexts: [InteractionContextType.Guild],
	},
	'guild+bot-dm': {
		integrationTypes: [ApplicationIntegrationType.GuildInstall],
		contexts: [InteractionContextType.Guild, InteractionContextType.BotDM],
	},
	user: {
		integrationTypes: [ApplicationIntegrationType.UserInstall],
		contexts: [
			InteractionContextType.Guild,
			InteractionContextType.PrivateChannel,
		],
	},
	everywhere: {
		integrationTypes: [
			ApplicationIntegrationType.GuildInstall,
			ApplicationIntegrationType.UserInstall,
		],
		contexts: [
			InteractionContextType.Guild,
			InteractionContextType.BotDM,
			InteractionContextType.PrivateChannel,
		],
	},
};

/**
 * Resolves a scope preset name to its Discord integration types and contexts.
 *
 * @param scope - The scope preset name
 * @returns The resolved integration types and interaction contexts
 */
export function resolveScope(scope: CommandScope): ResolvedScope {
	return SCOPE_MAP[scope];
}

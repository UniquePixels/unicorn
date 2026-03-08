import type { Client } from 'discord.js';
import { REST, Routes } from 'discord.js';
import { attempt } from '@/core/lib/attempt';
import type { CommandBuilder } from './command';
import { type CommandScope, resolveScope } from './command-scope';

/**
 * Registers all loaded commands with the Discord API.
 *
 * Applies scope (integration types + contexts) to each command builder,
 * resolves the registration route (global or dev guild), and PUTs the
 * command data via REST.
 *
 * @param client - The initialized Discord client with commands loaded
 */
export async function registerCommands(client: Client): Promise<void> {
	const commands = Array.from(client.commands.values());

	if (commands.length === 0) {
		client.logger.debug('No commands to register, skipping');
		return;
	}

	const config = client.config;
	const defaultScope = config.discord.commands.defaultScope;

	// Apply scope to each command builder
	for (const spark of commands) {
		const scope = spark.scope ?? defaultScope;
		applyScope(spark.command, scope);
	}

	// Resolve registration route
	const route = resolveRoute(config);
	const commandData = commands.map((cmd) => cmd.command.toJSON());

	client.logger.info(
		{ commands: commands.map((c) => c.id) },
		`Registering ${commands.length} commands...`,
	);

	const rest = new REST({ version: '10' }).setToken(config.discord.apiToken);
	const result = await attempt(() => rest.put(route, { body: commandData }));

	if (result.isErr()) {
		client.logger.error({ err: result.error }, 'Failed to register commands');
		throw result.error;
	}

	client.logger.info('Commands registered successfully');
}

/**
 * Applies scope integration types and contexts to a command builder.
 */
function applyScope(builder: CommandBuilder, scope: CommandScope): void {
	const { integrationTypes, contexts } = resolveScope(scope);

	// Duck-type check: ContextMenuCommandBuilder and some Omit<SlashCommandBuilder, ...>
	// variants in the CommandBuilder union lack setIntegrationTypes/setContexts methods.
	if (
		'setIntegrationTypes' in builder &&
		typeof builder.setIntegrationTypes === 'function'
	) {
		builder.setIntegrationTypes(...integrationTypes);
	}
	if ('setContexts' in builder && typeof builder.setContexts === 'function') {
		builder.setContexts(...contexts);
	}
}

/**
 * Resolves whether to register globally or to a dev guild.
 */
function resolveRoute(config: Client['config']): `/${string}` {
	const devGuildId = config.discord.commands.devGuildId;

	if (!config.isProduction && devGuildId) {
		return Routes.applicationGuildCommands(config.discord.appID, devGuildId);
	}

	return Routes.applicationCommands(config.discord.appID);
}

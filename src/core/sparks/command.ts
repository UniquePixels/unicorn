import type {
	AutocompleteInteraction,
	ChatInputCommandInteraction,
	Client,
	CommandInteraction,
	ContextMenuCommandBuilder,
	SlashCommandBuilder,
	SlashCommandSubcommandsOnlyBuilder,
} from 'discord.js';
import type { Guard, GuardResult, NarrowedBy } from '@/core/guards';
import { processGuards, resolveGuards } from '@/core/guards';
import { attempt } from '@/core/lib/attempt';
import type { CommandScope } from './command-scope';

/**
 * Union of all command builder types.
 */
export type CommandBuilder =
	| SlashCommandBuilder
	| SlashCommandSubcommandsOnlyBuilder
	| Omit<SlashCommandBuilder, 'addSubcommand' | 'addSubcommandGroup'>
	| ContextMenuCommandBuilder;

/**
 * Action function for commands.
 * Receives the (possibly narrowed) interaction. Access client via `interaction.client`.
 */
export type CommandAction<T = ChatInputCommandInteraction> = (
	interaction: T,
) => void | Promise<void>;

/**
 * Options for defining a command spark.
 */
export interface CommandOptions<
	TGuarded extends CommandInteraction = ChatInputCommandInteraction,
> {
	/** The slash command builder */
	command: CommandBuilder;
	/** Command visibility scope preset (optional, falls back to config defaultScope) */
	scope?: CommandScope;
	/** Guards to run before the action (optional, defaults to []) */
	// biome-ignore lint/suspicious/noExplicitAny: Guard chains have heterogeneous input/output types; type safety is enforced by runGuards at runtime
	guards?: readonly Guard<any, any>[];
	/** The action to run when the command is invoked */
	action: CommandAction<TGuarded>;
}

/**
 * Options for a command with autocomplete support.
 */
export interface CommandWithAutocompleteOptions<
	TGuarded extends ChatInputCommandInteraction = ChatInputCommandInteraction,
> extends CommandOptions<TGuarded> {
	/** Handler for autocomplete interactions */
	autocomplete: (interaction: AutocompleteInteraction) => void | Promise<void>;
}

/**
 * Base command spark interface used for storage in collections.
 * Omits variance-sensitive properties to allow storing any CommandSpark.
 */
export interface BaseCommandSpark {
	readonly type: 'command';
	readonly id: string;
	readonly command: CommandBuilder;
	readonly scope?: CommandScope;
	readonly autocomplete?: (
		interaction: AutocompleteInteraction,
	) => void | Promise<void>;

	/**
	 * Execute the command (runs guards then action).
	 *
	 * Accepts `CommandInteraction` (the common base of `ChatInputCommandInteraction`
	 * and `ContextMenuCommandInteraction`). Callers must ensure the interaction type
	 * matches the command builder — the router guarantees this via unique command names.
	 */
	execute(interaction: CommandInteraction): Promise<GuardResult<unknown>>;

	/** Execute autocomplete handler */
	executeAutocomplete?(interaction: AutocompleteInteraction): Promise<void>;

	/** Register this spark with the client */
	register(client: Client): void;
}

/**
 * A command spark instance with typed guards and action.
 */
export interface CommandSpark<
	TGuarded extends CommandInteraction = ChatInputCommandInteraction,
> {
	readonly type: 'command';
	readonly id: string;
	readonly command: CommandBuilder;
	readonly scope?: CommandScope;
	// biome-ignore lint/suspicious/noExplicitAny: Guard chains have heterogeneous input/output types; type safety is enforced by runGuards at runtime
	readonly guards: readonly Guard<any, any>[];
	readonly action: CommandAction<TGuarded>;
	readonly autocomplete?: (
		interaction: AutocompleteInteraction,
	) => void | Promise<void>;

	/**
	 * Execute the command (runs guards then action).
	 *
	 * Accepts `CommandInteraction` (the common base of `ChatInputCommandInteraction`
	 * and `ContextMenuCommandInteraction`). The action receives `TGuarded` after
	 * runtime validation that the interaction type matches the command builder.
	 */
	execute(interaction: CommandInteraction): Promise<GuardResult<TGuarded>>;

	/** Execute autocomplete handler */
	executeAutocomplete?(interaction: AutocompleteInteraction): Promise<void>;

	/** Register this spark with the client */
	register(client: Client): void;
}

/**
 * Creates a command spark.
 *
 * @example
 * ```ts
 * // Simple command
 * export const ping = defineCommand({
 *   command: new SlashCommandBuilder()
 *     .setName('ping')
 *     .setDescription('Check latency'),
 *   action: async (interaction) => {
 *     await interaction.reply(`Pong! ${interaction.client.ws.ping}ms`);
 *   },
 * });
 *
 * // Command with guards - interaction type is narrowed
 * export const kick = defineCommand({
 *   command: new SlashCommandBuilder()
 *     .setName('kick')
 *     .setDescription('Kick a member'),
 *   guards: [inCachedGuild, hasPermission(PermissionFlagsBits.KickMembers)],
 *   action: async (interaction) => {
 *     // interaction.guild is guaranteed to exist
 *     await interaction.guild.members.kick(targetId);
 *   },
 * });
 * ```
 */
/** Overload: when guards are provided, auto-narrow the action parameter type. */
export function defineCommand<
	// biome-ignore lint/suspicious/noExplicitAny: Guard<any, any> required for const tuple inference
	const Guards extends readonly Guard<any, any>[],
>(
	options: CommandOptions<NarrowedBy<ChatInputCommandInteraction, Guards>> & {
		guards: Guards;
	},
): CommandSpark<NarrowedBy<ChatInputCommandInteraction, Guards>>;

/** Overload: without guards or with explicit TGuarded — backward compatible. */
export function defineCommand<
	TGuarded extends CommandInteraction = ChatInputCommandInteraction,
>(options: CommandOptions<TGuarded>): CommandSpark<TGuarded>;

export function defineCommand<
	TGuarded extends CommandInteraction = ChatInputCommandInteraction,
>(options: CommandOptions<TGuarded>): CommandSpark<TGuarded> {
	const { command, action } = options;
	const guards = resolveGuards(options.guards ?? [], 'command');

	const spark: CommandSpark<TGuarded> = {
		type: 'command',
		id: command.name,
		command,
		...(options.scope !== undefined && { scope: options.scope }),
		guards,
		action,

		async execute(
			interaction: CommandInteraction,
		): Promise<GuardResult<TGuarded>> {
			const client = interaction.client;

			// Validate interaction type matches command builder.
			// 'type' is present on ContextMenuCommandBuilder but not SlashCommandBuilder.
			// Optional chaining safely skips the check for test mocks lacking these methods.
			const isContextMenuBuilder = 'type' in command;
			const isContextMenuInteraction =
				interaction.isContextMenuCommand?.() === true;

			if (isContextMenuBuilder !== isContextMenuInteraction) {
				client.logger.warn(
					{ command: command.name },
					'Interaction type does not match command registration',
				);
				return { ok: false, reason: 'Interaction type mismatch.' };
			}

			// Run guards with centralized error handling
			const guardResult = await processGuards(
				guards,
				interaction,
				client.logger,
				`command:${command.name}`,
			);

			if (!guardResult.ok) {
				return guardResult as GuardResult<TGuarded>;
			}

			// Execute action with error handling
			const actionResult = await attempt(() =>
				action(guardResult.value as TGuarded),
			);

			if (actionResult.isErr()) {
				client.logger.error(
					{ err: actionResult.error, command: command.name },
					'Command action failed',
				);
				return { ok: false, reason: 'An internal error occurred.' };
			}

			return guardResult as GuardResult<TGuarded>;
		},

		register(client: Client): void {
			// Safe cast: CommandSpark satisfies BaseCommandSpark structurally for storage.
			// Type narrowing happens at runtime via guards in execute().
			registerCommandSpark(client, spark as BaseCommandSpark);
		},
	};

	return spark;
}

/**
 * Creates a command spark with autocomplete support.
 *
 * @example
 * ```ts
 * export const search = defineCommandWithAutocomplete({
 *   command: new SlashCommandBuilder()
 *     .setName('search')
 *     .setDescription('Search for something')
 *     .addStringOption(opt =>
 *       opt.setName('query').setDescription('Search query').setAutocomplete(true)
 *     ),
 *   autocomplete: async (interaction) => {
 *     const query = interaction.options.getFocused();
 *     const results = await searchDatabase(query);
 *     await interaction.respond(results.slice(0, 25));
 *   },
 *   action: async (interaction) => {
 *     const query = interaction.options.getString('query', true);
 *     // Handle the search
 *   },
 * });
 * ```
 */
/** Overload: when guards are provided, auto-narrow the action parameter type. */
export function defineCommandWithAutocomplete<
	// biome-ignore lint/suspicious/noExplicitAny: Guard<any, any> required for const tuple inference
	const Guards extends readonly Guard<any, any>[],
>(
	options: CommandWithAutocompleteOptions<
		NarrowedBy<ChatInputCommandInteraction, Guards>
	> & { guards: Guards },
): CommandSpark<NarrowedBy<ChatInputCommandInteraction, Guards>>;

/** Overload: without guards or with explicit TGuarded — backward compatible. */
export function defineCommandWithAutocomplete<
	TGuarded extends ChatInputCommandInteraction = ChatInputCommandInteraction,
>(options: CommandWithAutocompleteOptions<TGuarded>): CommandSpark<TGuarded>;

export function defineCommandWithAutocomplete<
	TGuarded extends ChatInputCommandInteraction = ChatInputCommandInteraction,
>(options: CommandWithAutocompleteOptions<TGuarded>): CommandSpark<TGuarded> {
	const base = defineCommand(options);

	const spark: CommandSpark<TGuarded> = {
		...base,
		autocomplete: options.autocomplete,

		async executeAutocomplete(
			interaction: AutocompleteInteraction,
		): Promise<void> {
			const result = await attempt(() => options.autocomplete(interaction));

			if (result.isErr()) {
				interaction.client.logger.warn(
					{ err: result.error, command: base.id },
					'Autocomplete handler failed',
				);
			}
		},

		register(client: Client): void {
			registerCommandSpark(client, spark as BaseCommandSpark);
		},
	};

	return spark;
}

/**
 * Registers a command spark on the client, checking for name collisions.
 * Returns true if registration succeeded, false if a collision was detected.
 */
export function registerCommandSpark(
	client: Client,
	spark: BaseCommandSpark,
): boolean {
	const existing = client.commands.get(spark.id);
	if (existing) {
		client.logger.error(
			{ command: spark.id, existingId: existing.id },
			'Command name collision — skipping duplicate',
		);
		return false;
	}

	client.commands.set(spark.id, spark);
	client.logger.debug({ command: spark.id }, 'Registered command');
	return true;
}

/**
 * Type guard to check if a command spark has autocomplete.
 */
export function hasAutocomplete(
	spark: BaseCommandSpark,
): spark is BaseCommandSpark & {
	autocomplete: NonNullable<BaseCommandSpark['autocomplete']>;
	executeAutocomplete: NonNullable<BaseCommandSpark['executeAutocomplete']>;
} {
	return (
		spark.autocomplete !== undefined && spark.executeAutocomplete !== undefined
	);
}

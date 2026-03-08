/** biome-ignore-all lint/suspicious/noEmptyBlockStatements: Test mocking */
import { mock } from 'bun:test';
import type {
	AutocompleteInteraction,
	ChatInputCommandInteraction,
	Client,
	Interaction,
	Message,
	SlashCommandBuilder,
} from 'discord.js';
import type { AnyComponentInteraction } from '@/core/sparks/component';
import { createMockClient } from './mock-client';

/**
 * Creates a mock ChatInputCommandInteraction for testing slash commands.
 *
 * Provides a minimal mock of Discord.js ChatInputCommandInteraction with
 * configurable properties and mocked methods for reply, editReply, etc.
 * The `options` object supports all Discord option getters (getString, getInteger, etc.).
 *
 * @param overrides - Optional overrides for interaction properties and methods
 * @returns A mock ChatInputCommandInteraction instance
 *
 * @example
 * ```ts
 * const interaction = createMockChatInputInteraction({
 *   commandName: 'ping',
 *   userId: '123456789012345678',
 *   options: { message: 'Hello world' },
 * });
 *
 * expect(interaction.commandName).toBe('ping');
 * expect(interaction.options.getString('message')).toBe('Hello world');
 * ```
 */
export function createMockChatInputInteraction(
	overrides: {
		commandName?: string;
		userId?: string;
		replied?: boolean;
		deferred?: boolean;
		options?: Record<string, unknown>;
		createdTimestamp?: number;
		reply?: ReturnType<typeof mock>;
		editReply?: ReturnType<typeof mock>;
		fetchReply?: ReturnType<typeof mock>;
		client?: Client;
	} = {},
): ChatInputCommandInteraction {
	const optionsData = overrides.options ?? {};

	return {
		commandName: overrides.commandName ?? 'test',
		user: { id: overrides.userId ?? '123456789012345678' },
		replied: overrides.replied ?? false,
		deferred: overrides.deferred ?? false,
		createdTimestamp: overrides.createdTimestamp ?? Date.now(),
		reply: overrides.reply ?? mock(async () => {}),
		editReply: overrides.editReply ?? mock(async () => {}),
		fetchReply: overrides.fetchReply ?? mock(async () => ({})),
		client: overrides.client ?? createMockClient(),
		options: {
			getString: mock((name: string) => optionsData[name] ?? null),
			getInteger: mock((name: string) => optionsData[name] ?? null),
			getNumber: mock((name: string) => optionsData[name] ?? null),
			getBoolean: mock((name: string) => optionsData[name] ?? null),
			getUser: mock((name: string) => optionsData[name] ?? null),
			getChannel: mock((name: string) => optionsData[name] ?? null),
			getRole: mock((name: string) => optionsData[name] ?? null),
			getMentionable: mock((name: string) => optionsData[name] ?? null),
			getAttachment: mock((name: string) => optionsData[name] ?? null),
			getSubcommand: mock(() => optionsData['subcommand'] ?? null),
			getSubcommandGroup: mock(() => optionsData['subcommandGroup'] ?? null),
		},
	} as unknown as ChatInputCommandInteraction;
}

/**
 * Creates a mock AutocompleteInteraction for testing command autocomplete handlers.
 *
 * Provides a minimal mock with configurable focused value and respond method.
 *
 * @param overrides - Optional overrides for interaction properties
 * @returns A mock AutocompleteInteraction instance
 *
 * @example
 * ```ts
 * const interaction = createMockAutocompleteInteraction({
 *   commandName: 'search',
 *   focusedValue: 'part',
 * });
 *
 * expect(interaction.options.getFocused()).toBe('part');
 * ```
 */
export function createMockAutocompleteInteraction(
	overrides: {
		commandName?: string;
		focusedValue?: string;
		userId?: string;
		client?: Client;
	} = {},
): AutocompleteInteraction {
	return {
		commandName: overrides.commandName ?? 'test',
		user: { id: overrides.userId ?? '123456789012345678' },
		client: overrides.client ?? createMockClient(),
		options: {
			getFocused: mock(() => overrides.focusedValue ?? ''),
		},
		respond: mock(async () => {}),
	} as unknown as AutocompleteInteraction;
}

/**
 * Creates a mock component interaction (button/select/modal) for testing ComponentSparks.
 *
 * Provides mocked methods for reply, update, deferUpdate, etc. Used to test
 * button clicks, select menu choices, and modal submissions.
 *
 * @param customId - The custom ID of the component (required)
 * @param overrides - Optional overrides for interaction properties
 * @returns A mock component interaction instance
 *
 * @example
 * ```ts
 * const interaction = createMockComponentInteraction('delete-button', {
 *   userId: '123456789012345678',
 *   replied: false,
 * });
 *
 * expect(interaction.customId).toBe('delete-button');
 * expect(interaction.replied).toBe(false);
 * ```
 */
export function createMockComponentInteraction(
	customId: string,
	overrides: {
		userId?: string;
		replied?: boolean;
		deferred?: boolean;
		client?: Client;
	} = {},
): AnyComponentInteraction {
	return {
		customId,
		user: { id: overrides.userId ?? '123456789012345678' },
		replied: overrides.replied ?? false,
		deferred: overrides.deferred ?? false,
		client: overrides.client ?? createMockClient(),
		reply: mock(async () => {}),
		deferUpdate: mock(async () => {}),
		update: mock(async () => {}),
		deferReply: mock(async () => {}),
		editReply: mock(async () => {}),
	} as unknown as AnyComponentInteraction;
}

/**
 * Creates a generic mock Interaction with configurable type guards.
 *
 * Useful for testing interaction routing logic. Use `overrides` to set
 * type guard methods (isChatInputCommand, isAutocomplete, etc.) to true.
 *
 * @param overrides - Optional overrides for any interaction property
 * @returns A mock base Interaction instance
 *
 * @example
 * ```ts
 * const interaction = createMockBaseInteraction({
 *   isChatInputCommand: mock(() => true),
 *   commandName: 'test',
 * });
 *
 * expect(interaction.isChatInputCommand()).toBe(true);
 * ```
 */
export function createMockBaseInteraction(
	overrides: Record<string, unknown> = {},
): Interaction {
	return {
		isChatInputCommand: mock(() => false),
		isAutocomplete: mock(() => false),
		isContextMenuCommand: mock(() => false),
		isMessageComponent: mock(() => false),
		isModalSubmit: mock(() => false),
		user: { id: '123456789012345678' },
		replied: false,
		deferred: false,
		reply: mock(async () => {}),
		client: createMockClient(),
		...overrides,
	} as unknown as Interaction;
}

/**
 * Creates a mock Discord Message for testing message-based guards and handlers.
 *
 * Provides configurable guild status and author properties.
 *
 * @param overrides - Optional overrides for message properties
 * @returns A mock Message instance
 *
 * @example
 * ```ts
 * const message = createMockMessage({
 *   inGuild: true,
 *   isBot: false,
 *   authorId: '123456789012345678',
 * });
 *
 * expect(message.inGuild()).toBe(true);
 * expect(message.author.bot).toBe(false);
 * ```
 */
export function createMockMessage(
	overrides: { inGuild?: boolean; isBot?: boolean; authorId?: string } = {},
): Message {
	const inGuild = overrides.inGuild ?? true;
	return {
		inGuild: () => inGuild,
		author: {
			id: overrides.authorId ?? '123456789012345678',
			bot: overrides.isBot ?? false,
		},
		guildId: inGuild ? '987654321098765432' : null,
	} as unknown as Message;
}

/**
 * Creates a mock SlashCommandBuilder with a given name.
 *
 * Useful for testing command and command group spark definitions
 * without constructing a full Discord.js builder.
 *
 * @param name - The command name
 * @returns A mock SlashCommandBuilder instance
 */
export function createMockCommand(name: string): SlashCommandBuilder {
	return { name } as unknown as SlashCommandBuilder;
}

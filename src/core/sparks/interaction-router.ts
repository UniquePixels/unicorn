import {
	type AutocompleteInteraction,
	type Client,
	type CommandInteraction,
	Events,
	type Interaction,
	MessageFlags,
} from 'discord.js';
import { attempt } from '@/core/lib/attempt';
import { hasAutocomplete } from './command';
import type { AnyComponentInteraction } from './component';
import { findComponentSpark } from './component';
import { defineGatewayEvent, type GatewayEventSpark } from './gateway-event';

/** Minimal repliable interaction shape shared by commands and components. */
interface RepliableInteraction {
	replied: boolean;
	deferred: boolean;
	reply(options: { content: string; flags?: number }): Promise<unknown>;
	editReply(options: { content: string }): Promise<unknown>;
}

/** Spark execute result — either ok or a failure with a reason. */
type ExecuteResult = { ok: true } | { ok: false; reason: string };

/**
 * Handles the post-execute reply logic shared by commands and components.
 *
 * - If the guard/action failed and the interaction hasn't been replied to, sends the failure reason.
 * - If the action succeeded but the interaction was never replied to, sends a fallback warning.
 */
async function replyWithResult(
	interaction: RepliableInteraction,
	result: ExecuteResult,
	label: string,
	logMeta: Record<string, unknown>,
	logger: Client['logger'],
): Promise<void> {
	if (!(result.ok || interaction.replied)) {
		if (interaction.deferred) {
			await interaction.editReply({ content: result.reason });
		} else {
			await interaction.reply({
				content: result.reason,
				flags: MessageFlags.Ephemeral,
			});
		}
	} else if (result.ok && !interaction.replied) {
		logger.warn(
			logMeta,
			interaction.deferred
				? `${label} deferred but never replied`
				: `${label} succeeded but never responded`,
		);
		if (interaction.deferred) {
			await interaction.editReply({
				content: 'Something went wrong. Please try again.',
			});
		} else {
			await interaction.reply({
				content: 'Something went wrong. Please try again.',
				flags: MessageFlags.Ephemeral,
			});
		}
	}
}

/**
 * Routes slash command and context menu interactions to the appropriate CommandSpark.
 */
async function handleCommand(
	interaction: CommandInteraction,
	label: string,
): Promise<void> {
	const client = interaction.client;
	const spark = client.commands.get(interaction.commandName);

	if (!spark) {
		client.logger.warn(
			{ command: interaction.commandName, user: interaction.user.id },
			`Received interaction for unknown ${label}`,
		);

		await interaction.reply({
			content: 'This command is not available.',
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	const result = await spark.execute(interaction);
	await replyWithResult(
		interaction,
		result,
		label,
		{ command: interaction.commandName, user: interaction.user.id },
		client.logger,
	);
}

/**
 * Routes autocomplete interactions to the appropriate CommandSpark.
 */
async function handleAutocomplete(
	interaction: AutocompleteInteraction,
): Promise<void> {
	const client = interaction.client;
	const spark = client.commands.get(interaction.commandName);

	if (!spark) {
		client.logger.debug(
			{ command: interaction.commandName },
			'Autocomplete for unknown command',
		);
		return;
	}

	if (!hasAutocomplete(spark)) {
		client.logger.debug(
			{ command: interaction.commandName },
			'Command does not support autocomplete',
		);
		return;
	}

	await spark.executeAutocomplete(interaction);
}

/**
 * Routes component (button/select) and modal submit interactions to ComponentSpark.
 */
async function handleComponent(
	interaction: AnyComponentInteraction,
	label: string,
	notFoundMessage: string,
): Promise<void> {
	const client = interaction.client;
	const spark = findComponentSpark(
		client.components,
		interaction.customId,
		client.logger,
	);

	if (!spark) {
		client.logger.debug(
			{ customId: interaction.customId, user: interaction.user.id },
			`Received interaction for unknown ${label}`,
		);

		await interaction.reply({
			content: notFoundMessage,
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	const result = await spark.execute(interaction);
	await replyWithResult(
		interaction,
		result,
		label,
		{ customId: interaction.customId, user: interaction.user.id },
		client.logger,
	);
}

/**
 * Safely runs an async handler, logging any errors.
 */
async function safeHandle(
	handler: () => Promise<void>,
	context: string,
	client: Client,
): Promise<void> {
	const result = await attempt(handler);
	if (result.isErr()) {
		client.logger.error(
			{ err: result.error, context },
			'Interaction handler failed',
		);
	}
}

/**
 * Built-in framework-level spark that routes interactions to the appropriate handler.
 *
 * This spark listens for the InteractionCreate event and dispatches
 * interactions to the registered CommandSpark or ComponentSpark based
 * on the interaction type and identifier.
 *
 * It is automatically registered by `loadSparks()` — user sparks do not
 * need to include it in their sparks directory.
 *
 * Routing logic:
 * - Chat commands → CommandSpark by command name
 * - Autocomplete → CommandSparkWithAutocomplete.autocomplete()
 * - Context menus → CommandSpark by command name (user/message commands)
 * - Buttons/Selects → ComponentSpark by customId (supports patterns)
 * - Modal submits → ComponentSpark by customId (supports patterns)
 */
export const interactionRouter: GatewayEventSpark<
	typeof Events.InteractionCreate
> = defineGatewayEvent({
	event: Events.InteractionCreate,
	once: false,
	action: async (interaction: Interaction, client: Client) => {
		// Route based on interaction type, wrapped in safe error handling
		if (interaction.isChatInputCommand()) {
			await safeHandle(
				() => handleCommand(interaction, 'command'),
				`command:${interaction.commandName}`,
				client,
			);
		} else if (interaction.isAutocomplete()) {
			await safeHandle(
				() => handleAutocomplete(interaction),
				`autocomplete:${interaction.commandName}`,
				client,
			);
		} else if (interaction.isContextMenuCommand()) {
			await safeHandle(
				() => handleCommand(interaction, 'context menu command'),
				`context-menu:${interaction.commandName}`,
				client,
			);
		} else if (interaction.isMessageComponent()) {
			await safeHandle(
				() =>
					handleComponent(
						interaction,
						'component',
						'This button/menu is no longer available.',
					),
				`component:${interaction.customId}`,
				client,
			);
		} else if (interaction.isModalSubmit()) {
			await safeHandle(
				() =>
					handleComponent(
						interaction,
						'modal',
						'This form is no longer available.',
					),
				`modal:${interaction.customId}`,
				client,
			);
		} else {
			client.logger.warn(
				{ type: interaction.type, user: interaction.user.id },
				'Received unhandled interaction type',
			);
		}
	},
});

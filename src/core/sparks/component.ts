import type {
	ButtonInteraction,
	ChannelSelectMenuInteraction,
	Client,
	MentionableSelectMenuInteraction,
	ModalSubmitInteraction,
	RoleSelectMenuInteraction,
	StringSelectMenuInteraction,
	UserSelectMenuInteraction,
} from 'discord.js';
import type { Guard, GuardResult, NarrowedBy } from '@/core/guards';
import { processGuards, resolveGuards } from '@/core/guards';
import { attempt } from '@/core/lib/attempt';
import type { ExtendedLogger } from '@/core/lib/logger';
import { AppError } from '@/core/lib/logger';

/**
 * Union of all select menu interaction types.
 */
export type SelectMenuInteraction =
	| StringSelectMenuInteraction
	| UserSelectMenuInteraction
	| RoleSelectMenuInteraction
	| MentionableSelectMenuInteraction
	| ChannelSelectMenuInteraction;

/**
 * Union of all component interaction types (excluding modals).
 */
export type ComponentInteraction = ButtonInteraction | SelectMenuInteraction;

/**
 * All component types including modals.
 */
export type AnyComponentInteraction =
	| ComponentInteraction
	| ModalSubmitInteraction;

/** Parsed exact component ID — the full string is the lookup key. */
export interface ExactComponentId {
	readonly type: 'exact';
	readonly key: string;
}

/** Parsed parameterized component ID with compiled regex and routeKey. */
export interface ParameterizedComponentId {
	readonly type: 'parameterized';
	readonly key: string;
	readonly regex: RegExp;
	readonly params: readonly string[];
}

/** Result of parsing a component ID string at define-time. */
export type ParsedComponentId = ExactComponentId | ParameterizedComponentId;

/**
 * Action function for components.
 * Access client via `interaction.client`.
 * For parameterized components, `params` contains extracted route parameters.
 */
export type ComponentAction<
	T,
	P extends Record<string, string> = Record<string, never>,
> = (interaction: T, params: P) => void | Promise<void>;

/**
 * Options for defining a component spark.
 */
export interface ComponentOptions<
	TInput extends AnyComponentInteraction = ButtonInteraction,
	TGuarded extends TInput = TInput,
> {
	/**
	 * ID pattern to match custom IDs against.
	 * - Exact string: `'confirm-button'`
	 * - Parameterized: `'{ban-:userId}'`
	 */
	id: string;
	/** Guards to run before the action (optional) */
	// biome-ignore lint/suspicious/noExplicitAny: Guard chains have heterogeneous input/output types; type safety is enforced by runGuards at runtime
	guards?: readonly Guard<any, any>[];
	/** The action to run when the component is interacted with */
	action: ComponentAction<TGuarded, Record<string, string>>;
}

/**
 * Base component spark interface used for storage in collections.
 * Uses `never` for input types to allow any ComponentSpark to be assigned to it.
 */
export interface BaseComponentSpark {
	readonly type: 'component';
	readonly id: string;
	readonly key: string;
	readonly parsed: ParsedComponentId;

	/** Execute the component handler (runs guards then action) */
	execute(interaction: AnyComponentInteraction): Promise<GuardResult<unknown>>;

	/** Register this spark with the client */
	register(client: Client): void;
}

/**
 * A component spark instance with typed guards and action.
 */
export interface ComponentSpark<
	TInput extends AnyComponentInteraction = ButtonInteraction,
	TGuarded extends TInput = TInput,
> {
	readonly type: 'component';
	readonly id: string;
	readonly key: string;
	readonly parsed: ParsedComponentId;
	// biome-ignore lint/suspicious/noExplicitAny: Guard chains have heterogeneous input/output types; type safety is enforced by runGuards at runtime
	readonly guards: readonly Guard<any, any>[];
	readonly action: ComponentAction<TGuarded, Record<string, string>>;

	/** Execute the component handler (runs guards then action) */
	execute(interaction: TInput): Promise<GuardResult<TGuarded>>;

	/** Register this spark with the client */
	register(client: Client): void;
}

/** Regex to find `:paramName` segments in a parameterized pattern. */
const PARAM_REGEX = /:([a-zA-Z]\w*)/g;

/**
 * Parses a component ID string into an exact or parameterized descriptor.
 *
 * - Plain strings return `{ type: 'exact', key: id }`.
 * - Strings wrapped in `{...}` with `:paramName` markers return a
 *   parameterized descriptor with a compiled regex and routeKey.
 *
 * **Note:** Parameter values cannot contain dashes — dashes are segment
 * delimiters used by the dash-walk lookup algorithm. For example,
 * `'{ban-:userId}'` matches `ban-123` but not `ban-123-456`.
 *
 * @throws {AppError} If braces are unclosed, no params are found, or prefix is missing/invalid.
 */
export function parseComponentId(id: string): ParsedComponentId {
	if (!id.startsWith('{')) {
		return { type: 'exact', key: id };
	}

	if (!id.endsWith('}')) {
		throw new AppError('Unclosed brace in component ID pattern', {
			code: 'ERR_COMPONENT_PATTERN',
			metadata: { id },
		});
	}

	const inner = id.slice(1, -1);
	const paramNames: string[] = [];
	let firstParamIndex = -1;

	for (const match of inner.matchAll(PARAM_REGEX)) {
		if (firstParamIndex === -1) {
			firstParamIndex = match.index;
		}
		paramNames.push(match[1] as string);
	}

	if (paramNames.length === 0) {
		throw new AppError(
			'Parameterized component ID must contain at least one :param marker',
			{
				code: 'ERR_COMPONENT_PATTERN',
				metadata: { id },
			},
		);
	}

	const routeKey = inner.slice(0, firstParamIndex);

	if (routeKey === '' || !routeKey.endsWith('-')) {
		throw new AppError(
			'Parameterized component ID must have a non-empty prefix ending with "-"',
			{
				code: 'ERR_COMPONENT_PATTERN',
				metadata: { id, routeKey },
			},
		);
	}

	// Escape regex-special characters in static segments before interpolation
	const escaped = inner.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
	// Use a local regex to avoid shared lastIndex state from the module-level PARAM_REGEX
	const regexSource = escaped.replaceAll(/:([a-zA-Z]\w*)/g, '(?<$1>[^-]+)');
	const regex = new RegExp(`^${regexSource}$`);

	return {
		type: 'parameterized',
		key: routeKey,
		regex,
		params: paramNames,
	};
}

/**
 * Creates a component spark.
 *
 * @example
 * ```ts
 * // Exact match button
 * export const confirmButton = defineComponent({
 *   id: 'confirm-action',
 *   action: async (interaction) => {
 *     await interaction.reply('Confirmed!');
 *   },
 * });
 *
 * // Parameterized — extracts userId from customId
 * export const ban = defineComponent({
 *   id: '{ban-:userId}',
 *   action: async (interaction, params) => {
 *     await interaction.guild.members.ban(params.userId);
 *   },
 * });
 * ```
 */
/** Overload: when guards are provided, auto-narrow the action parameter type. */
export function defineComponent<
	TInput extends AnyComponentInteraction = ButtonInteraction,
	// biome-ignore lint/suspicious/noExplicitAny: Guard<any, any> required for const tuple inference
	const Guards extends readonly Guard<any, any>[] = readonly [],
>(
	options: ComponentOptions<TInput, NarrowedBy<TInput, Guards>> & {
		guards: Guards;
	},
): ComponentSpark<TInput, NarrowedBy<TInput, Guards>>;

/** Overload: without guards or with explicit TGuarded — backward compatible. */
export function defineComponent<
	TInput extends AnyComponentInteraction = ButtonInteraction,
	TGuarded extends TInput = TInput,
>(
	options: ComponentOptions<TInput, TGuarded>,
): ComponentSpark<TInput, TGuarded>;

export function defineComponent<
	TInput extends AnyComponentInteraction = ButtonInteraction,
	TGuarded extends TInput = TInput,
>(
	options: ComponentOptions<TInput, TGuarded>,
): ComponentSpark<TInput, TGuarded> {
	const { id, action } = options;
	const guards = resolveGuards(options.guards ?? [], 'component');
	const parsed = parseComponentId(id);
	const key = parsed.key;

	const spark: ComponentSpark<TInput, TGuarded> = {
		type: 'component',
		id,
		key,
		parsed,
		guards,
		action,

		async execute(interaction: TInput): Promise<GuardResult<TGuarded>> {
			const client = interaction.client;

			// Run guards with centralized error handling
			const guardResult = await processGuards(
				guards,
				interaction,
				client.logger,
				`component:${key}`,
			);

			if (!guardResult.ok) {
				return guardResult as GuardResult<TGuarded>;
			}

			// Extract params if parameterized
			let params: Record<string, string> = {};
			if (parsed.type === 'parameterized') {
				const regexMatch = parsed.regex.exec(interaction.customId);
				if (regexMatch?.groups) {
					params = regexMatch.groups;
				} else {
					client.logger.warn(
						{ component: key, customId: interaction.customId },
						'Parameterized component matched but regex failed to extract params',
					);
				}
			}

			// Execute action with error handling
			const actionResult = await attempt(() =>
				action(guardResult.value as TGuarded, params),
			);

			if (actionResult.isErr()) {
				client.logger.error(
					{ err: actionResult.error, component: key },
					'Component action failed',
				);
				return { ok: false, reason: 'An internal error occurred.' };
			}

			return guardResult as GuardResult<TGuarded>;
		},

		register(client: Client): void {
			// Safe cast: ComponentSpark satisfies BaseComponentSpark structurally for storage.
			// Type narrowing happens at runtime via guards in execute().
			const baseSpark = spark as BaseComponentSpark;

			const existing = client.components.get(key);
			if (existing) {
				throw new AppError(
					`Component key "${key}" is already registered by "${existing.id}"`,
					{
						code: 'ERR_COMPONENT_CONFLICT',
						metadata: { existingId: existing.id, newId: id, key },
					},
				);
			}

			client.components.set(key, baseSpark);
			client.logger.debug(
				{ component: key, type: parsed.type },
				'Registered component',
			);
		},
	};

	return spark;
}

/**
 * Finds a component spark that matches the given custom ID.
 *
 * Lookup order:
 * 1. **Exact match** — O(1) lookup in the components Map.
 * 2. **Parameterized** — Walk dashes right-to-left, testing each prefix
 *    against the Map and verifying via the compiled regex.
 */
export function findComponentSpark(
	components: Map<string, BaseComponentSpark>,
	customId: string,
	logger?: ExtendedLogger,
): BaseComponentSpark | undefined {
	// 1. Exact match — O(1)
	const candidate = components.get(customId);
	if (candidate) {
		if (candidate.parsed.type === 'exact') {
			return candidate;
		}
		// Parameterized spark whose key happens to equal the full customId — verify via regex
		if (
			candidate.parsed.type === 'parameterized' &&
			candidate.parsed.regex.test(customId)
		) {
			return candidate;
		}
	}

	// 2. Parameterized — walk dashes right-to-left
	for (
		let dashIndex = customId.lastIndexOf('-');
		dashIndex > 0;
		dashIndex = customId.lastIndexOf('-', dashIndex - 1)
	) {
		const prefix = customId.slice(0, dashIndex + 1); // include trailing dash
		const prefixCandidate = components.get(prefix);
		if (
			prefixCandidate?.parsed.type === 'parameterized' &&
			prefixCandidate.parsed.regex.test(customId)
		) {
			logger?.debug(
				{ component: prefix, customId },
				'Component matched via parameterized routing',
			);
			return prefixCandidate;
		}
	}

	return undefined;
}

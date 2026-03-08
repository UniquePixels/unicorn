import type { GuildBasedChannel } from 'discord.js';
import type { ExtendedLogger } from '@/core/lib/logger';
import { AppError } from '@/core/lib/logger';

/**
 * Result of a guard check - either success with the (possibly narrowed) value,
 * or failure with a reason string.
 */
export type GuardResult<T> =
	| { ok: true; value: T }
	| { ok: false; reason: string };

/**
 * A guard function that validates input and optionally narrows its type.
 *
 * Guards receive a single input value and return a result indicating success
 * or failure. Guards that need client access can use `input.client` when
 * the input is a Discord.js object (interaction, message, etc.).
 *
 * @example
 * ```ts
 * const inGuild: Guard<Interaction, Interaction & { guild: Guild }> = (interaction) => {
 *   if (!interaction.inCachedGuild()) {
 *     return { ok: false, reason: 'Command must be used in a server' };
 *   }
 *   return { ok: true, value: interaction };
 * };
 * ```
 */
export type Guard<TInput, TOutput extends TInput = TInput> = (
	input: TInput,
) => GuardResult<TOutput> | Promise<GuardResult<TOutput>>;

/**
 * Extracts the output type from a Guard.
 */
export type GuardOutput<G> =
	G extends Guard<unknown, infer TOutput> ? TOutput : never;

/**
 * Computes the intersection of a base type with all guard output types.
 * Preserves the base type while overlaying each guard's narrowing.
 *
 * Unlike a replacement-based approach (where each guard replaces the previous type),
 * this intersects — so `GuildMember` stays `GuildMember` with extra constraints.
 *
 * @example
 * ```ts
 * // Guard narrows { guild: Guild } → { guild: Guild & { systemChannel: TextChannel } }
 * type Result = NarrowedBy<GuildMember, [typeof hasSystemChannel]>;
 * // → GuildMember & { guild: Guild & { systemChannel: TextChannel } }
 * ```
 */
export type NarrowedBy<
	TBase,
	// biome-ignore lint/suspicious/noExplicitAny: Guard<any, any> required for heterogeneous guard tuples
	Guards extends readonly Guard<any, any>[],
> = Guards extends readonly []
	? TBase
	: Guards extends readonly [
				// biome-ignore lint/suspicious/noExplicitAny: Guard<any, infer TOut> extracts output from any guard
				Guard<any, infer TOut>,
				// biome-ignore lint/suspicious/noExplicitAny: Guard<any, any> required for recursive tuple matching
				...infer Rest extends readonly Guard<any, any>[],
			]
		? NarrowedBy<TBase & TOut, Rest>
		: TBase;

// ── Guard Metadata ──────────────────────────────────────────────────

/** Spark type identifiers used for guard compatibility checks. */
export type SparkType =
	| 'command'
	| 'component'
	| 'gateway-event'
	| 'scheduled-event';

/** Unique symbol for attaching metadata to guard functions. */
export const GUARD_META: unique symbol = Symbol('guard-meta');

/** Metadata attached to a guard via {@link createGuard}. */
export interface GuardMeta {
	/** Human-readable guard name (e.g. "inCachedGuild", "hasPermission"). */
	name: string;
	/** Guards that must run before this one. Automatically resolved at define-time. */
	// biome-ignore lint/suspicious/noExplicitAny: Guard<any, any> required for heterogeneous dependency chains
	requires?: readonly Guard<any, any>[];
	/** Spark types this guard is incompatible with. Validated at define-time. */
	incompatibleWith?: readonly SparkType[];
	/** Resolves the target channel from the guard's narrowed input. Used by `*PermissionIn` guards. */
	channelResolver?: (input: unknown) => GuildBasedChannel | null;
}

/** Guard function with optional metadata property. */
// biome-ignore lint/suspicious/noExplicitAny: Guard functions have heterogeneous type parameters
type GuardWithMeta = Guard<any, any> & {
	[GUARD_META]?: GuardMeta;
};

/** Reads metadata from a guard, or `undefined` if none is attached. */
// biome-ignore lint/suspicious/noExplicitAny: Guard<any, any> required for reading metadata from any guard
export function getGuardMeta(guard: Guard<any, any>): GuardMeta | undefined {
	return (guard as GuardWithMeta)[GUARD_META];
}

// ── Guard Creation ──────────────────────────────────────────────────

/**
 * Helper to create a guard with proper type inference and optional metadata.
 *
 * @example
 * ```ts
 * const myGuard = createGuard<Interaction, CommandInteraction>(
 *   (input) => {
 *     if (!input.isCommand()) return guardFail('Not a command interaction');
 *     return guardPass(input);
 *   },
 *   { name: 'myGuard', incompatibleWith: ['scheduled-event'] },
 * );
 * ```
 */
export function createGuard<TInput, TOutput extends TInput = TInput>(
	guardFn: Guard<TInput, TOutput>,
	meta?: GuardMeta,
): Guard<TInput, TOutput> {
	if (meta) {
		const frozen: GuardMeta = { name: meta.name };
		if (meta.requires) {
			frozen.requires = Object.freeze([...meta.requires]);
		}
		if (meta.incompatibleWith) {
			frozen.incompatibleWith = Object.freeze([...meta.incompatibleWith]);
		}
		if (meta.channelResolver) {
			frozen.channelResolver = meta.channelResolver;
		}
		(guardFn as GuardWithMeta)[GUARD_META] = Object.freeze(frozen);
	}
	return guardFn;
}

/**
 * Creates a successful guard result.
 */
export function guardPass<T>(value: T): GuardResult<T> {
	return { ok: true, value };
}

/**
 * Creates a failed guard result.
 */
export function guardFail(reason: string): GuardResult<never> {
	return { ok: false, reason };
}

/**
 * Runs a single guard and returns the result.
 * Handles both sync and async guards.
 */
export function runGuard<TInput, TOutput extends TInput>(
	guard: Guard<TInput, TOutput>,
	input: TInput,
): GuardResult<TOutput> | Promise<GuardResult<TOutput>> {
	return guard(input);
}

// ── Guard Composition ───────────────────────────────────────────────

/**
 * Type helper for composing guards - chains the output of one guard as input to the next.
 */
type ChainedGuardOutput<
	TInput,
	Guards extends readonly Guard<unknown, unknown>[],
> = Guards extends readonly []
	? TInput
	: Guards extends readonly [
				Guard<unknown, infer TOut>,
				...infer Rest extends readonly Guard<unknown, unknown>[],
			]
		? ChainedGuardOutput<TOut, Rest>
		: never;

/**
 * Runs multiple guards in sequence, passing the narrowed output of each guard
 * to the next. Short-circuits on the first failure.
 *
 * @param guards - Array of guards to run in sequence
 * @param input - Initial input value
 * @returns The final narrowed value if all guards pass, or failure result
 *
 * @example
 * ```ts
 * const result = await runGuards(
 *   [inGuildGuard, hasPermissionGuard(PermissionFlagsBits.ManageMessages)],
 *   interaction,
 * );
 *
 * if (!result.ok) {
 *   await interaction.reply({ content: result.reason, ephemeral: true });
 *   return;
 * }
 *
 * // result.value is now typed as the narrowed interaction
 * const guild = result.value.guild; // TypeScript knows guild exists
 * ```
 */
export async function runGuards<
	TInput,
	// biome-ignore lint/suspicious/noExplicitAny: Guard<any, any> required due to contravariance in T
	const Guards extends readonly Guard<any, any>[],
>(
	guards: Guards,
	input: TInput,
): Promise<GuardResult<ChainedGuardOutput<TInput, Guards>>> {
	let currentValue: unknown = input;

	// Sequential execution is intentional: each guard's output feeds into the next,
	// and we short-circuit on first failure.
	for (const guard of guards) {
		// biome-ignore lint/performance/noAwaitInLoops: guards must run sequentially for type narrowing and short-circuit
		const result = await guard(currentValue);

		if (!result.ok) {
			return result;
		}

		currentValue = result.value;
	}

	return { ok: true, value: currentValue } as GuardResult<
		ChainedGuardOutput<TInput, Guards>
	>;
}

// ── resolveGuards ───────────────────────────────────────────────────

/**
 * Collects all transitive dependencies for a guard, deduplicating by reference.
 * Detects cyclic `requires` chains and throws `ERR_GUARD_CYCLE`.
 */
function collectDeps(
	// biome-ignore lint/suspicious/noExplicitAny: Guard<any, any> required for heterogeneous dependency chains
	guard: Guard<any, any>,
	// biome-ignore lint/suspicious/noExplicitAny: Guard<any, any> required for heterogeneous dependency chains
	seen: Set<Guard<any, any>>,
	sparkType: SparkType,
	// biome-ignore lint/suspicious/noExplicitAny: Guard<any, any> required for heterogeneous dependency chains
	visiting: Set<Guard<any, any>> = new Set(),
): void {
	const meta = getGuardMeta(guard);
	if (!meta?.requires) {
		return;
	}

	visiting.add(guard);

	for (const dep of meta.requires) {
		// Detect cyclic dependency
		if (visiting.has(dep)) {
			const depName = getGuardMeta(dep)?.name ?? '(anonymous)';
			throw new AppError(
				`Cyclic guard dependency detected: "${meta.name}" requires "${depName}" which eventually requires "${meta.name}"`,
				{
					code: 'ERR_GUARD_CYCLE',
					isOperational: false,
					metadata: {
						guard: meta.name,
						dependency: depName,
					},
				},
			);
		}

		// Validate transitive dep compatibility
		const depMeta = getGuardMeta(dep);
		if (depMeta?.incompatibleWith?.includes(sparkType)) {
			throw new AppError(
				`Guard "${depMeta.name}" (dependency of "${meta.name}") is incompatible with spark type "${sparkType}"`,
				{
					code: 'ERR_GUARD_INCOMPATIBLE',
					isOperational: false,
					metadata: {
						guard: depMeta.name,
						dependencyOf: meta.name,
						sparkType,
						incompatibleWith: depMeta.incompatibleWith,
					},
				},
			);
		}

		if (!seen.has(dep)) {
			// Recurse first to ensure transitive deps come before this dep
			collectDeps(dep, seen, sparkType, visiting);
			seen.add(dep);
		}
	}

	visiting.delete(guard);
}

/**
 * Validates that no guard is incompatible with the given spark type.
 * Throws `AppError('ERR_GUARD_INCOMPATIBLE')` on violation.
 */
function validateGuardCompatibility(
	// biome-ignore lint/suspicious/noExplicitAny: Guard<any, any> required for heterogeneous guard chains
	guards: readonly Guard<any, any>[],
	sparkType: SparkType,
): void {
	for (const guard of guards) {
		const meta = getGuardMeta(guard);
		if (meta?.incompatibleWith?.includes(sparkType)) {
			throw new AppError(
				`Guard "${meta.name}" is incompatible with spark type "${sparkType}"`,
				{
					code: 'ERR_GUARD_INCOMPATIBLE',
					isOperational: false,
					metadata: {
						guard: meta.name,
						sparkType,
						incompatibleWith: meta.incompatibleWith,
					},
				},
			);
		}
	}
}

/**
 * Resolves guard dependencies for command/component sparks.
 * Walks guards left-to-right, recursively prepending missing deps.
 */
function resolveDeps(
	// biome-ignore lint/suspicious/noExplicitAny: Guard<any, any> required for heterogeneous guard chains
	guards: readonly Guard<any, any>[],
	sparkType: SparkType,
	// biome-ignore lint/suspicious/noExplicitAny: Guard<any, any> required for heterogeneous guard chains
): Guard<any, any>[] {
	// biome-ignore lint/suspicious/noExplicitAny: Guard<any, any> required for heterogeneous guard chains
	const resolved: Guard<any, any>[] = [];
	// biome-ignore lint/suspicious/noExplicitAny: Guard<any, any> required for heterogeneous guard chains
	const resolvedSet = new Set<Guard<any, any>>();
	// biome-ignore lint/suspicious/noExplicitAny: Guard<any, any> required for heterogeneous guard chains
	const seen = new Set<Guard<any, any>>();

	for (const guard of guards) {
		collectDeps(guard, seen, sparkType);

		for (const dep of seen) {
			if (!resolvedSet.has(dep)) {
				resolved.push(dep);
				resolvedSet.add(dep);
			}
		}

		if (!seen.has(guard)) {
			seen.add(guard);
		}
		if (!resolvedSet.has(guard)) {
			resolved.push(guard);
			resolvedSet.add(guard);
		}
	}

	return resolved;
}

/**
 * Validates guard compatibility and resolves dependencies at define-time.
 *
 * - Throws `AppError('ERR_GUARD_INCOMPATIBLE')` if any guard is incompatible with the spark type.
 * - For `command` and `component` sparks, auto-prepends missing dependencies declared in guard metadata.
 * - For `gateway-event` and `scheduled-event` sparks, skips dependency resolution.
 * - Deduplicates guards by reference identity.
 *
 * @param guards - Developer-specified guard array
 * @param sparkType - The spark type being defined
 * @returns Resolved guard array with dependencies prepended
 */
export function resolveGuards(
	// biome-ignore lint/suspicious/noExplicitAny: Guard<any, any> required for heterogeneous guard chains
	guards: readonly Guard<any, any>[],
	sparkType: SparkType,
	// biome-ignore lint/suspicious/noExplicitAny: Guard<any, any> required for heterogeneous guard chains
): Guard<any, any>[] {
	if (guards.length === 0) {
		return [];
	}

	// 1. Validate compatibility for all guards
	validateGuardCompatibility(guards, sparkType);

	// 2. Skip dependency resolution for non-interaction spark types (still dedup)
	if (sparkType === 'gateway-event' || sparkType === 'scheduled-event') {
		// biome-ignore lint/suspicious/noExplicitAny: Guard<any, any> required for heterogeneous guard chains
		const seen = new Set<Guard<any, any>>();
		return guards.filter((g) => {
			if (seen.has(g)) {
				return false;
			}
			seen.add(g);
			return true;
		});
	}

	// 3. Resolve dependencies for command/component sparks
	return resolveDeps(guards, sparkType);
}

// ── processGuards ───────────────────────────────────────────────────

/** Options controlling how processGuards reports outcomes. */
export interface ProcessGuardsOptions {
	/** When true, failures are silent (no user to notify) — logged at `warn` instead of `info`. */
	silent?: boolean;
}

/**
 * Runs guards with centralized error handling and logging.
 *
 * Called internally by each spark's `execute()` method — developers never call this directly.
 *
 * - Intentional failures (`{ ok: false }`) are logged at `info` (user-facing) or `warn` (silent).
 * - Guard exceptions (bugs) are caught, wrapped in `AppError`, and logged at `error`.
 *
 * @param guards - Resolved guard array
 * @param input - The input value to pass through guards
 * @param logger - Logger instance for structured logging
 * @param context - Human-readable context string (e.g. "command:ping")
 * @param options - Optional configuration for logging behavior
 */
export async function processGuards(
	// biome-ignore lint/suspicious/noExplicitAny: Guard<any, any> required for heterogeneous guard chains
	guards: readonly Guard<any, any>[],
	input: unknown,
	logger: ExtendedLogger,
	context: string,
	options: ProcessGuardsOptions = {},
): Promise<GuardResult<unknown>> {
	try {
		const result = await runGuards(
			guards as readonly Guard<unknown, unknown>[],
			input,
		);

		if (!result.ok) {
			const level = options.silent ? 'warn' : 'info';
			logger[level]({ context, reason: result.reason }, 'Guard check failed');
		}

		return result;
	} catch (error) {
		const wrappedError = new AppError('Guard threw an unexpected error', {
			code: 'ERR_GUARD_EXCEPTION',
			isOperational: false,
			metadata: { context },
			cause: error instanceof Error ? error : new Error(String(error)),
		});

		logger.error({ err: wrappedError, context }, 'Guard exception');

		return {
			ok: false,
			reason: 'An internal error occurred.',
		};
	}
}

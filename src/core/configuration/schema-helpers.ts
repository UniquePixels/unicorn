import * as z from 'zod';

/**
 * A schema that accepts either a single value or a tuple of [prod, dev?].
 * Selects the appropriate value based on the `isProduction` flag.
 *
 * @param schema - The Zod schema to wrap
 * @param isProduction - Whether to select the production (first) or dev (second) tuple value
 *
 * @example
 * ```ts
 * const GuildId = envMap(Snowflake, true);
 * GuildId.parse("123456789012345678"); // single value - used everywhere
 * GuildId.parse(["123456789012345678"]); // prod only - used everywhere
 * GuildId.parse(["123456789012345678", "987654321098765432"]); // selects first (prod)
 * ```
 */
export function envMap<T extends z.ZodTypeAny>(
	schema: T,
	isProduction: boolean,
) {
	return z
		.union([schema, z.tuple([schema]), z.tuple([schema, schema])])
		.transform((input): z.output<T> => {
			if (!Array.isArray(input)) {
				return input;
			}
			const tuple = input as [z.output<T>] | [z.output<T>, z.output<T>];
			if (tuple.length === 1) {
				return tuple[0];
			}
			return isProduction ? tuple[0] : tuple[1];
		});
}

/**
 * A Discord Snowflake ID.
 *
 * A unique 64-bit identifier represented as a 17-19 digit numeric string.
 * @see https://discord.com/developers/docs/reference#snowflakes
 */
export type Snowflake = string & {};

/** Matches a string of only digits (used for Snowflake validation). */
const DIGITS_ONLY = /^\d+$/;

export const Snowflake = z.custom<Snowflake>((val): val is Snowflake => {
	if (typeof val !== 'string') {
		return false;
	}
	if (val.length < 17 || val.length > 19) {
		return false;
	}
	return DIGITS_ONLY.test(val);
}, 'Invalid Snowflake ID (must be a 17-19 digit numeric string)');

/**
 * A secret reference in the format `secret://key`.
 * During parsing, this will be resolved to the actual secret value.
 */
export type Secret = `secret://${string}` & {};

const SECRET_PREFIX = 'secret://';

export const Secret = z
	.custom<Secret>((value): value is Secret => {
		if (typeof value !== 'string') {
			return false;
		}
		return (
			value.startsWith(SECRET_PREFIX) && value.length > SECRET_PREFIX.length
		);
	}, 'Invalid secret reference (must be in the format `secret://key`)')
	.transform((value, ctx): string => resolveSecret(value, ctx));

/** Valid environment variable key pattern (alphanumeric + underscores). */
const ENV_KEY_PATTERN = /^[A-Za-z_]\w*$/;

/** Resolves a `secret://` key to its environment variable value. */
function resolveSecret(value: string, ctx: z.RefinementCtx): string {
	const key = value.substring(SECRET_PREFIX.length);
	if (!ENV_KEY_PATTERN.test(key)) {
		ctx.addIssue({
			code: 'custom',
			message: `Invalid environment variable name "${key}" (must match [A-Za-z_][A-Za-z0-9_]*)`,
		});
		return z.NEVER;
	}
	const secret = Bun.env[key];
	if (secret === undefined) {
		ctx.addIssue({
			code: 'custom',
			message: `Environment variable "${key}" is not set`,
		});
		return z.NEVER;
	}
	return secret;
}

/**
 * A flexible value for the `misc` config bag.
 * Strings matching `secret://key` are resolved from environment variables.
 * All other values pass through unchanged.
 */
export const MiscValue = z.unknown().transform((value, ctx) => {
	if (typeof value === 'string' && value.startsWith(SECRET_PREFIX)) {
		if (value.length <= SECRET_PREFIX.length) {
			ctx.addIssue({
				code: 'custom',
				message:
					'Invalid secret reference (must be in the format `secret://key`)',
			});
			return z.NEVER;
		}
		return resolveSecret(value, ctx);
	}
	return value;
});

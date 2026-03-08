import type { Interaction } from 'discord.js';
import { createGuard, type Guard, guardFail, guardPass } from '@/core/guards';

/**
 * Rate limit state stored per key.
 */
interface RateLimitEntry {
	count: number;
	resetAt: number;
}

/**
 * Maximum number of entries in the rate limit store.
 * Prevents unbounded memory growth from malicious actors.
 */
let maxRateLimitEntries = 100_000;

/**
 * Number of entries to evict when the store reaches capacity.
 * Evicting in batches is more efficient than one-by-one.
 */
let evictionBatchSize = 1000;

/**
 * In-memory rate limit storage with LRU eviction.
 * Uses Map's insertion order for LRU tracking - entries are moved to end on access.
 * For production use with multiple instances, consider Redis.
 */
const rateLimitStore: Map<string, RateLimitEntry> = new Map<
	string,
	RateLimitEntry
>();

/**
 * Testing utilities for rate limit guard.
 * @internal Only use in tests.
 */
export const _testing = {
	/** Get direct access to the rate limit store */
	getStore: (): Map<string, RateLimitEntry> => rateLimitStore,
	/** Clear all entries from the store */
	clearStore: (): void => {
		rateLimitStore.clear();
	},
	/** Configure max entries threshold (for testing LRU eviction) */
	setMaxEntries: (max: number): void => {
		maxRateLimitEntries = max;
	},
	/** Configure eviction batch size */
	setEvictionBatchSize: (size: number): void => {
		evictionBatchSize = size;
	},
	/** Reset to default configuration */
	resetConfig: (): void => {
		maxRateLimitEntries = 100_000;
		evictionBatchSize = 1000;
	},
};

/**
 * Evicts the least recently used entries when the store exceeds capacity.
 * Returns the number of entries evicted.
 */
function evictLRUEntries(): number {
	const excess = rateLimitStore.size - maxRateLimitEntries;
	if (excess <= 0) {
		return 0;
	}

	const toEvict = Math.min(excess + evictionBatchSize, rateLimitStore.size);
	let evicted = 0;

	// Map iterates in insertion order - oldest entries first
	for (const key of rateLimitStore.keys()) {
		if (evicted >= toEvict) {
			break;
		}
		rateLimitStore.delete(key);
		evicted++;
	}

	return evicted;
}

/**
 * Moves an entry to the end of the Map to mark it as recently used.
 * This is done by deleting and re-inserting the entry.
 */
function touchEntry(key: string, entry: RateLimitEntry): void {
	rateLimitStore.delete(key);
	rateLimitStore.set(key, entry);
}

/**
 * Default key function for rate limiting - uses user ID.
 * Pre-defined to avoid creating a new closure on every guard invocation.
 */
const defaultRateLimitKeyFn = <T extends Interaction>(input: T): string =>
	input.user.id;

/**
 * Creates a rate limiting guard.
 *
 * @param options - Rate limit configuration
 * @param options.limit - Maximum number of uses
 * @param options.window - Time window in milliseconds
 * @param options.keyFn - Function to generate the rate limit key (default: user ID)
 * @param options.message - Optional custom error message
 *
 * @example
 * ```ts
 * // 5 uses per minute per user
 * export const expensiveCommand = defineCommand({
 *   command: builder,
 *   guards: [rateLimit({ limit: 5, window: 60_000 })],
 *   action: async (interaction) => { // ...
 *   },
 * });
 *
 * // Per-guild rate limit
 * export const guildCommand = defineCommand({
 *   command: builder,
 *   guards: [
 *     inCachedGuild,
 *     rateLimit({
 *       limit: 10,
 *       window: 60_000,
 *       keyFn: (i) => `${i.guildId}:${i.user.id}`,
 *     }),
 *   ],
 *   action: async (interaction) => { // ...
 *   },
 * });
 * ```
 */
export function rateLimit<T extends Interaction>(options: {
	limit: number;
	window: number;
	keyFn?: (input: T) => string;
	message?: string;
}): Guard<T, T> {
	if (options.limit < 1) {
		throw new Error('rateLimit: limit must be >= 1');
	}
	if (options.window <= 0) {
		throw new Error('rateLimit: window must be > 0');
	}

	const { limit, window, message } = options;
	const keyFn = options.keyFn ?? defaultRateLimitKeyFn;

	return createGuard(
		(input) => {
			const key = keyFn(input);
			const now = Date.now();
			const entry = rateLimitStore.get(key);

			if (!entry || now >= entry.resetAt) {
				// New entry or expired - create fresh entry
				const newEntry = { count: 1, resetAt: now + window };
				rateLimitStore.set(key, newEntry);

				// Evict LRU entries if we've exceeded capacity
				evictLRUEntries();

				return guardPass(input);
			}

			if (entry.count >= limit) {
				const remainingSeconds = Math.ceil((entry.resetAt - now) / 1000);
				return guardFail(
					message ?? `Rate limited. Try again in ${remainingSeconds} seconds.`,
				);
			}

			// Increment and move to end of map (mark as recently used)
			entry.count++;
			touchEntry(key, entry);

			return guardPass(input);
		},
		{ name: 'rateLimit', incompatibleWith: ['scheduled-event'] },
	);
}

/** Returns the current number of entries in the rate limit store. */
export function getRateLimitStoreSize(): number {
	return rateLimitStore.size;
}

/** Warning threshold — 75% of default max capacity (100,000). */
export const RATE_LIMIT_WARN_THRESHOLD = 75_000;

/** Critical threshold — 90% of default max capacity (100,000). */
export const RATE_LIMIT_CRITICAL_THRESHOLD = 90_000;

/**
 * Clears expired rate limit entries. Call periodically to prevent memory leaks.
 * Returns the number of entries cleared.
 */
export function cleanupRateLimits(): number {
	const now = Date.now();
	let cleared = 0;

	for (const [key, entry] of rateLimitStore) {
		if (now >= entry.resetAt) {
			rateLimitStore.delete(key);
			cleared++;
		}
	}

	return cleared;
}

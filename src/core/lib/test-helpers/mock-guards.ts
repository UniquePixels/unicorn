import { mock } from 'bun:test';
import type { Guard } from '@/core/guards';

/**
 * Creates a mock guard that always passes, returning the input value unchanged.
 *
 * Useful for testing sparks when you want to bypass guard validation.
 *
 * @returns A mocked guard that always returns `{ ok: true, value: input }`
 *
 * @example
 * ```ts
 * const spark = defineCommand({
 *   guards: [passThroughGuard()],
 *   action: async (interaction) => { ... }
 * });
 * ```
 */
// biome-ignore lint/suspicious/noExplicitAny: test helpers use any for flexible typing
export function passThroughGuard(): Guard<any, any> {
	return mock((input: unknown) => ({ ok: true as const, value: input }));
}

/**
 * Creates a mock guard that always fails with the specified reason.
 *
 * Useful for testing error handling and guard failure scenarios.
 *
 * @param reason - The failure message to return
 * @returns A mocked guard that always returns `{ ok: false, reason }`
 *
 * @example
 * ```ts
 * const spark = defineCommand({
 *   guards: [failGuard('Test failure')],
 *   action: async (interaction) => { ... }
 * });
 *
 * const result = await spark.execute(interaction);
 * expect(result.ok).toBe(false);
 * expect(result.reason).toBe('Test failure');
 * ```
 */
// biome-ignore lint/suspicious/noExplicitAny: test helpers use any for flexible typing
export function failGuard(reason: string): Guard<any, any> {
	return mock(() => ({ ok: false as const, reason }));
}

/**
 * Shared test helpers for hasPermissionIn and botHasPermissionIn guard tests.
 * Reduces duplication in channelGuard and metadata test patterns.
 */
import { expect } from 'bun:test';
import type { GuildBasedChannel } from 'discord.js';
import { PermissionsBitField } from 'discord.js';
import {
	createGuard,
	type Guard,
	getGuardMeta,
	guardPass,
} from '@/core/guards';
import { inCachedGuild } from '@/guards/built-in/in-cached-guild';

/** Creates a mock channel guard with a custom resolver. */
export function mockChannelGuard(
	resolver: () => GuildBasedChannel | null,
): Guard<unknown, unknown> {
	return createGuard((input: unknown) => guardPass(input), {
		name: 'testChannel',
		channelResolver: resolver,
	});
}

/** Creates a mock channel guard whose resolver returns null. */
export function nullChannelGuard(): Guard<unknown, unknown> {
	return createGuard((input: unknown) => guardPass(input), {
		name: 'nullChannel',
		channelResolver: () => null,
	});
}

/** A mock target channel for channelResolver tests. */
export const targetChannel = {
	id: 'target-channel',
} as unknown as GuildBasedChannel;

/** Asserts standard metadata for a permission guard (name, incompatibleWith, requires). */
export function expectPermissionGuardMeta(
	// biome-ignore lint/suspicious/noExplicitAny: Guard<any, any> required for test assertions
	guard: Guard<any, any>,
	expectedName: string,
) {
	const meta = getGuardMeta(guard);

	// biome-ignore lint/suspicious/noMisplacedAssertion: helper wraps assertions for DRY test code
	expect(meta).toBeDefined();
	// biome-ignore lint/suspicious/noMisplacedAssertion: helper wraps assertions for DRY test code
	expect(meta?.name).toBe(expectedName);
	// biome-ignore lint/suspicious/noMisplacedAssertion: helper wraps assertions for DRY test code
	expect(meta?.incompatibleWith).toContain('scheduled-event');
	// biome-ignore lint/suspicious/noMisplacedAssertion: helper wraps assertions for DRY test code
	expect(meta?.requires).toHaveLength(1);
	// biome-ignore lint/suspicious/noMisplacedAssertion: helper wraps assertions for DRY test code
	expect(meta?.requires?.[0]).toBe(inCachedGuild);
}

/** Asserts that a channelGuard is included in the guard's requires metadata. */
export function expectChannelGuardInRequires(
	// biome-ignore lint/suspicious/noExplicitAny: Guard<any, any> required for test assertions
	guard: Guard<any, any>,
	// biome-ignore lint/suspicious/noExplicitAny: Guard<any, any> required for test assertions
	channelGuard: Guard<any, any>,
) {
	const meta = getGuardMeta(guard);

	// biome-ignore lint/suspicious/noMisplacedAssertion: helper wraps assertions for DRY test code
	expect(meta?.requires).toHaveLength(2);
	// biome-ignore lint/suspicious/noMisplacedAssertion: helper wraps assertions for DRY test code
	expect(meta?.requires?.[0]).toBe(inCachedGuild);
	// biome-ignore lint/suspicious/noMisplacedAssertion: helper wraps assertions for DRY test code
	expect(meta?.requires?.[1]).toBe(channelGuard);
}

/** Standard permissions used across permission guard tests. */
export const Perms = PermissionsBitField.Flags;

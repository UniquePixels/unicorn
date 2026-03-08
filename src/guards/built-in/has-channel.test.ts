import { describe, expect, test } from 'bun:test';
import type { Guild, GuildBasedChannel } from 'discord.js';
import { getGuardMeta } from '@/core/guards';
import { hasChannel, resolveChannelFromGuard } from './has-channel';
import { inCachedGuild } from './in-cached-guild';

// ─── Test Helpers ────────────────────────────────────────────────

/** Assert a value is defined (non-null, non-undefined). */
function assertDefined<T>(val: T | undefined | null): asserts val is T {
	expect(val).not.toBeNull();
	expect(val).toBeDefined();
}

/** Create mock guild with a channel cache. */
function createMockGuildInput(channels: Record<string, unknown>) {
	return {
		guild: {
			channels: {
				cache: new Map(Object.entries(channels)),
			},
		} as unknown as Guild,
	};
}

// ─── Tests ───────────────────────────────────────────────────────

describe('hasChannel', () => {
	describe('with static ID', () => {
		test('passes when channel exists in cache', async () => {
			const guard = hasChannel('123456789012345678');
			const input = createMockGuildInput({
				'123456789012345678': { id: '123456789012345678' },
			});

			const result = await guard(input);

			expect(result.ok).toBe(true);
		});

		test('fails when channel is not found', async () => {
			const guard = hasChannel('123456789012345678');
			const input = createMockGuildInput({});

			const result = await guard(input);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.reason).toContain('123456789012345678');
				expect(result.reason).toContain('not found');
			}
		});
	});

	describe('with dynamic resolver', () => {
		test('passes when resolved channel exists', async () => {
			const guard = hasChannel(() => '999888777666555444');
			const input = createMockGuildInput({
				'999888777666555444': { id: '999888777666555444' },
			});

			const result = await guard(input);

			expect(result.ok).toBe(true);
		});

		test('fails when resolved channel is not found', async () => {
			const guard = hasChannel(() => '999888777666555444');
			const input = createMockGuildInput({});

			const result = await guard(input);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.reason).toContain('999888777666555444');
			}
		});

		test('resolver receives the input', async () => {
			let receivedInput: unknown;
			const guard = hasChannel((guardInput) => {
				receivedInput = guardInput;
				return '123';
			});
			const input = createMockGuildInput({ '123': { id: '123' } });

			await guard(input);

			expect(receivedInput).toBe(input);
		});
	});

	describe('metadata', () => {
		test('has correct metadata', () => {
			const guard = hasChannel('123');
			const meta = getGuardMeta(guard);

			assertDefined(meta);
			expect(meta.name).toBe('hasChannel');
			expect(meta.incompatibleWith).toContain('scheduled-event');
			assertDefined(meta.requires);
			expect(meta.requires).toHaveLength(1);
			const firstRequire = meta.requires[0];
			assertDefined(firstRequire);
			expect(firstRequire).toBe(inCachedGuild);
		});

		test('channelResolver returns the channel from cache', () => {
			const guard = hasChannel('123456');
			const meta = getGuardMeta(guard);
			const channel = { id: '123456' };
			const input = createMockGuildInput({ '123456': channel });

			assertDefined(meta);
			assertDefined(meta.channelResolver);
			const resolved = meta.channelResolver(input);

			expect(resolved === channel).toBe(true);
		});

		test('channelResolver returns null when channel absent', () => {
			const guard = hasChannel('123456');
			const meta = getGuardMeta(guard);
			const input = createMockGuildInput({});

			assertDefined(meta);
			assertDefined(meta.channelResolver);
			const resolved = meta.channelResolver(input);

			expect(resolved).toBeNull();
		});
	});
});

describe('resolveChannelFromGuard', () => {
	test('reads channelResolver from guard metadata', () => {
		const guard = hasChannel('123');
		const channel = { id: '123' };
		const input = createMockGuildInput({ '123': channel });

		const resolved = resolveChannelFromGuard(guard, input);

		expect(resolved === (channel as unknown as GuildBasedChannel)).toBe(true);
	});

	test('returns null for guard without metadata', () => {
		const plainGuard = (input: unknown) => ({
			ok: true as const,
			value: input,
		});

		const resolved = resolveChannelFromGuard(plainGuard, {});

		expect(resolved).toBeNull();
	});
});

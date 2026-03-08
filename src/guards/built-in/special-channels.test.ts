import { describe, expect, test } from 'bun:test';
import type { Guild } from 'discord.js';
import type { GuardResult } from '@/core/guards';
import { getGuardMeta } from '@/core/guards';
import { assertDefined } from '@/core/lib/test-helpers';
import {
	hasPublicUpdatesChannel,
	hasRulesChannel,
	hasSafetyAlertsChannel,
	hasSystemChannel,
} from './special-channels';

type SpecialChannelKey =
	| 'systemChannel'
	| 'publicUpdatesChannel'
	| 'rulesChannel'
	| 'safetyAlertsChannel';

/** Extract failure reason from guard result. */
function getFailureReason(result: GuardResult<unknown>): string {
	if (result.ok) {
		throw new Error('Expected failure result but got success');
	}
	return result.reason;
}

/** Create mock input with a guild containing the specified special channel. */
function createMockGuildInput(
	channelKey: SpecialChannelKey,
	channelExists: boolean,
) {
	const channel = channelExists ? { id: '123' } : null;

	return {
		guild: {
			[channelKey]: channel,
		} as unknown as Guild,
	};
}

// Test cases for all special channel guards
const guardTestCases = [
	{
		name: 'hasSystemChannel',
		guard: hasSystemChannel,
		channelKey: 'systemChannel' as const,
		channelName: 'system channel',
	},
	{
		name: 'hasPublicUpdatesChannel',
		guard: hasPublicUpdatesChannel,
		channelKey: 'publicUpdatesChannel' as const,
		channelName: 'public updates channel',
	},
	{
		name: 'hasRulesChannel',
		guard: hasRulesChannel,
		channelKey: 'rulesChannel' as const,
		channelName: 'rules channel',
	},
	{
		name: 'hasSafetyAlertsChannel',
		guard: hasSafetyAlertsChannel,
		channelKey: 'safetyAlertsChannel' as const,
		channelName: 'safety alerts channel',
	},
] as const;

// Run the same test suite for each special channel guard
for (const { name, guard, channelKey, channelName } of guardTestCases) {
	describe(name, () => {
		test('passes when channel exists', async () => {
			const input = createMockGuildInput(channelKey, true);

			const result = await guard(input);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.guild[channelKey]).toBeDefined();
			}
		});

		test('fails when channel is not configured', async () => {
			const input = createMockGuildInput(channelKey, false);

			const result = await guard(input);

			expect(result.ok).toBe(false);
			const reason = getFailureReason(result);
			expect(reason).toContain(channelName);
			expect(reason).toContain('not have');
		});

		test('has correct metadata', () => {
			const meta = getGuardMeta(guard);

			assertDefined(meta);
			expect(meta.name).toBe(name);
			expect(meta.incompatibleWith).toContain('scheduled-event');
			expect(meta.channelResolver).toBeInstanceOf(Function);
		});

		test('channelResolver returns the channel from input', () => {
			const meta = getGuardMeta(guard);
			const channel = { id: '456' };
			const input = { guild: { [channelKey]: channel } };

			assertDefined(meta);
			assertDefined(meta.channelResolver);
			const resolved = meta.channelResolver(input);

			// Reference equality — same object
			expect(resolved === channel).toBe(true);
		});

		test('channelResolver returns null when channel is absent', () => {
			const meta = getGuardMeta(guard);
			const input = { guild: { [channelKey]: null } };

			assertDefined(meta);
			assertDefined(meta.channelResolver);
			const resolved = meta.channelResolver(input);

			expect(resolved).toBeNull();
		});
	});
}

// Integration tests
describe('special channel guards with different input types', () => {
	test('works with interaction-like input', async () => {
		const interaction = {
			guild: {
				systemChannel: { id: '123' },
			} as unknown as Guild,
			member: {},
			channel: {},
		};

		const result = await hasSystemChannel(interaction);

		expect(result.ok).toBe(true);
	});

	test('works with gateway event input', async () => {
		const event = {
			guild: {
				rulesChannel: { id: '789' },
			} as unknown as Guild,
		};

		const result = await hasRulesChannel(event);

		expect(result.ok).toBe(true);
	});
});

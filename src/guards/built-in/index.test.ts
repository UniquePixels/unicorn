import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import {
	ChannelType,
	type Guild,
	type GuildMember,
	type Interaction,
	PermissionsBitField,
} from 'discord.js';
import { createMockMessage } from '@/core/lib/test-helpers';
import {
	_rateLimitTesting,
	botHasPermission,
	channelType,
	cleanupRateLimits,
	getRateLimitStoreSize,
	hasPermission,
	inCachedGuild,
	inTextChannel,
	isDMChannel,
	isUser,
	messageInGuild,
	notBot,
	RATE_LIMIT_CRITICAL_THRESHOLD,
	RATE_LIMIT_WARN_THRESHOLD,
	rateLimit,
} from './index';

// Helper to create mock interaction with guard-specific properties
function createMockInteraction(options: {
	inCachedGuild?: boolean;
	userId?: string;
	guildId?: string | null;
	channelType?: ChannelType;
	memberPermissions?: bigint;
}) {
	const {
		inCachedGuild: isInCachedGuild = true,
		userId = '123456789012345678',
		guildId = '987654321098765432',
		channelType: chType = ChannelType.GuildText,
		memberPermissions = 0n,
	} = options;

	return {
		inCachedGuild: () => isInCachedGuild,
		user: { id: userId },
		guildId,
		guild: isInCachedGuild ? { id: guildId, members: { me: null } } : null,
		member: isInCachedGuild
			? {
					permissions: new PermissionsBitField(memberPermissions),
				}
			: null,
		channel: {
			type: chType,
			isTextBased: () =>
				chType === ChannelType.GuildText ||
				chType === ChannelType.DM ||
				chType === ChannelType.PublicThread ||
				chType === ChannelType.PrivateThread ||
				chType === ChannelType.GuildAnnouncement,
		},
	} as unknown as Interaction;
}

describe('inCachedGuild', () => {
	test('passes for interaction in cached guild', async () => {
		const interaction = createMockInteraction({ inCachedGuild: true });

		const result = await inCachedGuild(interaction);

		expect(result.ok).toBe(true);
	});

	test('fails for interaction not in cached guild', async () => {
		const interaction = createMockInteraction({ inCachedGuild: false });

		const result = await inCachedGuild(interaction);

		expect(result.ok).toBe(false);
		expect((result as { ok: false; reason: string }).reason).toContain(
			'server',
		);
	});

	test('fails for DM interaction', async () => {
		const interaction = createMockInteraction({
			inCachedGuild: false,
			guildId: null,
		});

		const result = await inCachedGuild(interaction);

		expect(result.ok).toBe(false);
	});
});

describe('hasPermission', () => {
	test('passes when user has required permission', async () => {
		const guard = hasPermission(PermissionsBitField.Flags.SendMessages);

		const input = {
			member: {
				permissions: new PermissionsBitField([
					PermissionsBitField.Flags.SendMessages,
				]),
			} as GuildMember,
		};

		const result = await guard(input);

		expect(result.ok).toBe(true);
	});

	test('fails when user lacks required permission', async () => {
		const guard = hasPermission(PermissionsBitField.Flags.Administrator);

		const input = {
			member: {
				permissions: new PermissionsBitField([
					PermissionsBitField.Flags.SendMessages,
				]),
			} as GuildMember,
		};

		const result = await guard(input);

		expect(result.ok).toBe(false);
	});

	test('passes when user has all required permissions', async () => {
		const guard = hasPermission([
			PermissionsBitField.Flags.SendMessages,
			PermissionsBitField.Flags.EmbedLinks,
		]);

		const input = {
			member: {
				permissions: new PermissionsBitField([
					PermissionsBitField.Flags.SendMessages,
					PermissionsBitField.Flags.EmbedLinks,
					PermissionsBitField.Flags.AttachFiles,
				]),
			} as GuildMember,
		};

		const result = await guard(input);

		expect(result.ok).toBe(true);
	});

	test('fails when user is missing one required permission', async () => {
		const guard = hasPermission([
			PermissionsBitField.Flags.SendMessages,
			PermissionsBitField.Flags.ManageMessages,
		]);

		const input = {
			member: {
				permissions: new PermissionsBitField([
					PermissionsBitField.Flags.SendMessages,
				]),
			} as GuildMember,
		};

		const result = await guard(input);

		expect(result.ok).toBe(false);
	});

	test('uses custom error message when provided', async () => {
		const customMessage = 'You need to be a moderator';
		const guard = hasPermission(
			PermissionsBitField.Flags.ManageMessages,
			customMessage,
		);

		const input = {
			member: {
				permissions: new PermissionsBitField([]),
			} as GuildMember,
		};

		const result = await guard(input);

		expect(result.ok).toBe(false);
		expect((result as { ok: false; reason: string }).reason).toBe(
			customMessage,
		);
	});
});

describe('botHasPermission', () => {
	test('passes when bot has required permission at guild level', async () => {
		const guard = botHasPermission(PermissionsBitField.Flags.SendMessages);

		const botMember = {
			permissions: new PermissionsBitField([
				PermissionsBitField.Flags.SendMessages,
			]),
		};

		const input = {
			guild: { members: { me: botMember } } as unknown as Guild,
		};

		const result = await guard(input);

		expect(result.ok).toBe(true);
	});

	test('fails when bot lacks required permission at guild level', async () => {
		const guard = botHasPermission(PermissionsBitField.Flags.ManageMessages);

		const botMember = {
			permissions: new PermissionsBitField([
				PermissionsBitField.Flags.SendMessages,
			]),
		};

		const input = {
			guild: { members: { me: botMember } } as unknown as Guild,
		};

		const result = await guard(input);

		expect(result.ok).toBe(false);
	});

	test('fails when bot member is not available', async () => {
		const guard = botHasPermission(PermissionsBitField.Flags.SendMessages);

		const input = {
			guild: { members: { me: null } } as unknown as Guild,
		};

		const result = await guard(input);

		expect(result.ok).toBe(false);
		expect((result as { ok: false; reason: string }).reason).toContain(
			'Unable to verify',
		);
	});

	test('uses custom error message when provided', async () => {
		const customMessage = 'Bot needs embed permissions';
		const guard = botHasPermission(
			PermissionsBitField.Flags.EmbedLinks,
			customMessage,
		);

		const botMember = {
			permissions: new PermissionsBitField([]),
		};

		const input = {
			guild: { members: { me: botMember } } as unknown as Guild,
		};

		const result = await guard(input);

		expect(result.ok).toBe(false);
		expect((result as { ok: false; reason: string }).reason).toBe(
			customMessage,
		);
	});
});

describe('isUser', () => {
	test('passes for user in allowed list', async () => {
		const guard = isUser(['123456789012345678', '234567890123456789']);
		const interaction = createMockInteraction({ userId: '123456789012345678' });

		const result = await guard(interaction);

		expect(result.ok).toBe(true);
	});

	test('fails for user not in allowed list', async () => {
		const guard = isUser(['123456789012345678']);
		const interaction = createMockInteraction({ userId: '999999999999999999' });

		const result = await guard(interaction);

		expect(result.ok).toBe(false);
	});

	test('uses custom error message when provided', async () => {
		const customMessage = 'Only bot owners can use this';
		const guard = isUser(['123456789012345678'], customMessage);
		const interaction = createMockInteraction({ userId: '999999999999999999' });

		const result = await guard(interaction);

		expect(result.ok).toBe(false);
		expect((result as { ok: false; reason: string }).reason).toBe(
			customMessage,
		);
	});

	test('handles empty allowed list', async () => {
		const guard = isUser([]);
		const interaction = createMockInteraction({ userId: '123456789012345678' });

		const result = await guard(interaction);

		expect(result.ok).toBe(false);
	});
});

describe('channelType', () => {
	test('passes for matching channel type', async () => {
		const guard = channelType(ChannelType.GuildText);
		const interaction = createMockInteraction({
			channelType: ChannelType.GuildText,
		});

		const result = await guard(interaction);

		expect(result.ok).toBe(true);
	});

	test('fails for non-matching channel type', async () => {
		const guard = channelType(ChannelType.GuildVoice);
		const interaction = createMockInteraction({
			channelType: ChannelType.GuildText,
		});

		const result = await guard(interaction);

		expect(result.ok).toBe(false);
	});

	test('passes when channel matches one of multiple types', async () => {
		const guard = channelType(ChannelType.GuildText, ChannelType.GuildVoice);
		const interaction = createMockInteraction({
			channelType: ChannelType.GuildVoice,
		});

		const result = await guard(interaction);

		expect(result.ok).toBe(true);
	});

	test('includes channel type names in error message', async () => {
		const guard = channelType(
			ChannelType.PublicThread,
			ChannelType.PrivateThread,
		);
		const interaction = createMockInteraction({
			channelType: ChannelType.GuildText,
		});

		const result = await guard(interaction);

		expect(result.ok).toBe(false);
		const reason = (result as { ok: false; reason: string }).reason;
		expect(reason).toContain('PublicThread');
		expect(reason).toContain('PrivateThread');
	});
});

describe('rateLimit', () => {
	beforeEach(() => {
		// Clean up any existing rate limits before each test
		cleanupRateLimits();
	});

	afterEach(() => {
		cleanupRateLimits();
	});

	test('throws when limit is less than 1', () => {
		expect(() => rateLimit({ limit: 0, window: 60_000 })).toThrow(
			'rateLimit: limit must be >= 1',
		);
	});

	test('throws when window is zero or negative', () => {
		expect(() => rateLimit({ limit: 1, window: 0 })).toThrow(
			'rateLimit: window must be > 0',
		);
		expect(() => rateLimit({ limit: 1, window: -1 })).toThrow(
			'rateLimit: window must be > 0',
		);
	});

	test('allows first request', async () => {
		const guard = rateLimit({ limit: 5, window: 60_000 });
		const interaction = createMockInteraction({ userId: 'rate-test-1' });

		const result = await guard(interaction);

		expect(result.ok).toBe(true);
	});

	test('allows requests up to limit', async () => {
		const guard = rateLimit({ limit: 3, window: 60_000 });
		const interaction = createMockInteraction({ userId: 'rate-test-2' });

		expect((await guard(interaction)).ok).toBe(true);
		expect((await guard(interaction)).ok).toBe(true);
		expect((await guard(interaction)).ok).toBe(true);
	});

	test('blocks requests after limit exceeded', async () => {
		const guard = rateLimit({ limit: 2, window: 60_000 });
		const interaction = createMockInteraction({ userId: 'rate-test-3' });

		await guard(interaction);
		await guard(interaction);
		const result = await guard(interaction);

		expect(result.ok).toBe(false);
		expect((result as { ok: false; reason: string }).reason).toContain(
			'Rate limited',
		);
	});

	test('rate limits are per-user by default', async () => {
		const guard = rateLimit({ limit: 1, window: 60_000 });

		const user1 = createMockInteraction({ userId: 'user-1' });
		const user2 = createMockInteraction({ userId: 'user-2' });

		expect((await guard(user1)).ok).toBe(true);
		expect((await guard(user2)).ok).toBe(true);

		// User1's second request should be blocked
		expect((await guard(user1)).ok).toBe(false);
		// User2's second request should also be blocked
		expect((await guard(user2)).ok).toBe(false);
	});

	test('uses custom keyFn for rate limiting', async () => {
		const guard = rateLimit({
			limit: 1,
			window: 60_000,
			keyFn: (i) => i.guildId ?? 'dm',
		});

		const guild1User1 = createMockInteraction({
			userId: 'user-1',
			guildId: 'guild-1',
		});
		const guild1User2 = createMockInteraction({
			userId: 'user-2',
			guildId: 'guild-1',
		});
		const guild2User1 = createMockInteraction({
			userId: 'user-1',
			guildId: 'guild-2',
		});

		expect((await guard(guild1User1)).ok).toBe(true);
		// Different user, same guild - should be blocked
		expect((await guard(guild1User2)).ok).toBe(false);
		// Same user, different guild - should pass
		expect((await guard(guild2User1)).ok).toBe(true);
	});

	test('uses custom error message', async () => {
		const customMessage = 'Slow down!';
		const guard = rateLimit({
			limit: 1,
			window: 60_000,
			message: customMessage,
		});
		const interaction = createMockInteraction({ userId: 'rate-custom' });

		await guard(interaction);
		const result = await guard(interaction);

		expect(result.ok).toBe(false);
		expect((result as { ok: false; reason: string }).reason).toBe(
			customMessage,
		);
	});

	test('resets after window expires', async () => {
		let now = 1000;
		const dateSpy = spyOn(Date, 'now').mockImplementation(() => now);

		const guard = rateLimit({ limit: 1, window: 50 }); // 50ms window
		const interaction = createMockInteraction({ userId: 'rate-expire' });

		await guard(interaction);
		expect((await guard(interaction)).ok).toBe(false);

		// Advance past window expiration
		now = 1060;
		expect((await guard(interaction)).ok).toBe(true);

		dateSpy.mockRestore();
	});
});

describe('cleanupRateLimits', () => {
	beforeEach(() => {
		cleanupRateLimits();
	});

	test('returns 0 when no rate limits exist', () => {
		const cleared = cleanupRateLimits();
		expect(cleared).toBe(0);
	});

	test('clears expired rate limits', async () => {
		let now = 1000;
		const dateSpy = spyOn(Date, 'now').mockImplementation(() => now);

		const guard = rateLimit({ limit: 1, window: 20 });
		const interaction = createMockInteraction({ userId: 'cleanup-test' });

		await guard(interaction);

		// Advance past window expiration
		now = 1030;

		const cleared = cleanupRateLimits();
		expect(cleared).toBe(1);

		dateSpy.mockRestore();
	});

	test('does not clear unexpired rate limits', async () => {
		const guard = rateLimit({ limit: 1, window: 60_000 });
		const interaction = createMockInteraction({ userId: 'cleanup-test-2' });

		await guard(interaction);

		const cleared = cleanupRateLimits();
		expect(cleared).toBe(0);
	});
});

describe('messageInGuild', () => {
	test('passes for message in guild', async () => {
		const message = createMockMessage({ inGuild: true });

		const result = await messageInGuild(message);

		expect(result.ok).toBe(true);
	});

	test('fails for DM message', async () => {
		const message = createMockMessage({ inGuild: false });

		const result = await messageInGuild(message);

		expect(result.ok).toBe(false);
		expect((result as { ok: false; reason: string }).reason).toContain(
			'server',
		);
	});
});

describe('notBot', () => {
	test('passes for human user message', async () => {
		const message = createMockMessage({ isBot: false });

		const result = await notBot(message);

		expect(result.ok).toBe(true);
	});

	test('fails for bot message', async () => {
		const message = createMockMessage({ isBot: true });

		const result = await notBot(message);

		expect(result.ok).toBe(false);
		expect((result as { ok: false; reason: string }).reason).toContain('Bots');
	});
});

describe('rateLimit _testing utilities', () => {
	beforeEach(() => {
		_rateLimitTesting.clearStore();
		_rateLimitTesting.resetConfig();
	});

	afterEach(() => {
		_rateLimitTesting.clearStore();
		_rateLimitTesting.resetConfig();
	});

	test('getStore returns the internal rate limit map', async () => {
		const store = _rateLimitTesting.getStore();
		expect(store).toBeInstanceOf(Map);
		expect(store.size).toBe(0);

		// After a guard invocation, the store should have an entry
		const guard = rateLimit({ limit: 5, window: 60_000 });
		await guard(createMockInteraction({ userId: 'store-user' }));

		expect(store.size).toBe(1);
	});
});

describe('getRateLimitStoreSize', () => {
	beforeEach(() => {
		_rateLimitTesting.clearStore();
	});

	afterEach(() => {
		_rateLimitTesting.clearStore();
	});

	test('returns 0 for empty store', () => {
		expect(getRateLimitStoreSize()).toBe(0);
	});

	test('reflects store size after guard invocations', async () => {
		const guard = rateLimit({ limit: 5, window: 60_000 });
		await guard(createMockInteraction({ userId: 'size-user-1' }));
		await guard(createMockInteraction({ userId: 'size-user-2' }));

		expect(getRateLimitStoreSize()).toBe(2);
	});
});

describe('rate limit threshold constants', () => {
	test('warn threshold is 75000', () => {
		expect(RATE_LIMIT_WARN_THRESHOLD).toBe(75_000);
	});

	test('critical threshold is 90000', () => {
		expect(RATE_LIMIT_CRITICAL_THRESHOLD).toBe(90_000);
	});
});

describe('rateLimit LRU eviction', () => {
	beforeEach(() => {
		_rateLimitTesting.clearStore();
		_rateLimitTesting.resetConfig();
	});

	afterEach(() => {
		_rateLimitTesting.clearStore();
		_rateLimitTesting.resetConfig();
	});

	test('evicted users get a fresh request count', async () => {
		_rateLimitTesting.setMaxEntries(5);
		_rateLimitTesting.setEvictionBatchSize(2);

		// limit: 2 so second request still passes, third would fail
		const guard = rateLimit({ limit: 2, window: 60_000 });

		// Add 6 entries (exceeds max of 5 → evicts oldest 3)
		for (let i = 0; i < 6; i++) {
			const interaction = createMockInteraction({ userId: `evict-user-${i}` });
			// biome-ignore lint/performance/noAwaitInLoops: sequential state accumulation for rate limiter test
			await guard(interaction);
		}

		// Evicted user-0 should pass with a fresh count (count resets to 1)
		const evictedRetry = createMockInteraction({ userId: 'evict-user-0' });
		const evictedResult = await guard(evictedRetry);
		expect(evictedResult.ok).toBe(true);

		// Surviving user-5 already used 1 of 2 — second request still passes
		const survivingRetry = createMockInteraction({ userId: 'evict-user-5' });
		const survivingResult = await guard(survivingRetry);
		expect(survivingResult.ok).toBe(true);

		// Surviving user-5 now at 2/2 — third request should be rate limited
		const survivingThird = createMockInteraction({ userId: 'evict-user-5' });
		const thirdResult = await guard(survivingThird);
		expect(thirdResult.ok).toBe(false);
	});

	test('does not evict when under capacity', async () => {
		_rateLimitTesting.setMaxEntries(10);

		// limit: 1 so second request is rate limited if entry still exists
		const guard = rateLimit({ limit: 1, window: 60_000 });

		// Add 5 entries (under max of 10)
		for (let i = 0; i < 5; i++) {
			const interaction = createMockInteraction({
				userId: `no-evict-user-${i}`,
			});
			// biome-ignore lint/performance/noAwaitInLoops: sequential state accumulation for rate limiter test
			await guard(interaction);
		}

		// All users should still be tracked — second request fails for each
		for (let i = 0; i < 5; i++) {
			const retry = createMockInteraction({ userId: `no-evict-user-${i}` });
			// biome-ignore lint/performance/noAwaitInLoops: sequential state accumulation for rate limiter test
			const result = await guard(retry);
			expect(result.ok).toBe(false);
		}
	});

	test('recently accessed user survives eviction over older untouched user', async () => {
		_rateLimitTesting.setMaxEntries(3);
		_rateLimitTesting.setEvictionBatchSize(1);

		// limit: 10 so we can verify preserved entry by hitting it multiple times
		const guard = rateLimit({ limit: 10, window: 60_000 });

		// Add initial entries: insertion order is user0, user1, user2
		await guard(createMockInteraction({ userId: 'lru-user-0' }));
		await guard(createMockInteraction({ userId: 'lru-user-1' }));
		await guard(createMockInteraction({ userId: 'lru-user-2' }));

		// Touch user0 → LRU order becomes: user1, user2, user0
		await guard(createMockInteraction({ userId: 'lru-user-0' }));

		// Add user3 → triggers eviction of 1 entry (user1 is oldest)
		await guard(createMockInteraction({ userId: 'lru-user-3' }));

		// user1 was evicted → gets a fresh start (limit: 10, so passes easily)
		const user1Retry = await guard(
			createMockInteraction({ userId: 'lru-user-1' }),
		);
		expect(user1Retry.ok).toBe(true);

		// user0 survived (was touched) → should have count=2 from earlier access
		// Adding more requests proves it kept its state (count goes up, not reset)
		// We can verify by checking user0 still has accumulated count
		// With limit: 10, all pass, but the key point is user0 was NOT evicted
		// Let's verify user0's entry was preserved by hitting it 8 more times (total 10)
		for (let i = 0; i < 8; i++) {
			// biome-ignore lint/performance/noAwaitInLoops: sequential state accumulation for rate limiter test
			const result = await guard(
				createMockInteraction({ userId: 'lru-user-0' }),
			);
			expect(result.ok).toBe(true);
		}
		// Now at limit — 11th request should fail (proves entry was preserved)
		const user0Limited = await guard(
			createMockInteraction({ userId: 'lru-user-0' }),
		);
		expect(user0Limited.ok).toBe(false);
	});
});

describe('inTextChannel', () => {
	test('passes when channel is present', async () => {
		const interaction = createMockInteraction({ inCachedGuild: true });

		const result = await inTextChannel(
			interaction as unknown as Parameters<typeof inTextChannel>[0],
		);

		expect(result.ok).toBe(true);
	});

	test('fails when channel is null', async () => {
		const interaction = {
			...createMockInteraction({ inCachedGuild: true }),
			channel: null,
		};

		const result = await inTextChannel(
			interaction as unknown as Parameters<typeof inTextChannel>[0],
		);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toContain('text channel');
		}
	});

	test('fails when channel is not text-based', async () => {
		const interaction = {
			...createMockInteraction({ inCachedGuild: true }),
			channel: { type: ChannelType.GuildVoice, isTextBased: () => false },
		};

		const result = await inTextChannel(
			interaction as unknown as Parameters<typeof inTextChannel>[0],
		);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toContain('text channel');
		}
	});
});

describe('isDMChannel', () => {
	test('passes when channel is DM', async () => {
		const interaction = createMockInteraction({
			inCachedGuild: false,
			channelType: ChannelType.DM,
		});

		const result = await isDMChannel(interaction);

		expect(result.ok).toBe(true);
	});

	test('fails when channel is guild text', async () => {
		const interaction = createMockInteraction({
			inCachedGuild: true,
			channelType: ChannelType.GuildText,
		});

		const result = await isDMChannel(interaction);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toContain('direct message');
		}
	});

	test('fails when channel is null', async () => {
		const interaction = {
			...createMockInteraction({ inCachedGuild: false }),
			channel: null,
		} as unknown as Interaction;

		const result = await isDMChannel(interaction);

		expect(result.ok).toBe(false);
	});
});

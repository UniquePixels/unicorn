import { describe, expect, mock, test } from 'bun:test';
import type { Guild, GuildBasedChannel } from 'discord.js';
import { PermissionsBitField } from 'discord.js';
import {
	expectChannelGuardInRequires,
	expectPermissionGuardMeta,
	mockChannelGuard,
	nullChannelGuard,
	Perms,
	targetChannel,
} from '@/core/lib/test-helpers';
import { botHasPermissionIn } from './bot-has-permission-in';

// ─── Test Helpers ────────────────────────────────────────────────

/** Create mock input with guild, bot member, and channel for permission checks. */
function createMockInput(
	botPerms: bigint[],
	channel?: object,
	botAvailable = true,
) {
	return {
		guild: {
			members: {
				me: botAvailable
					? {
							permissionsIn: () => new PermissionsBitField(botPerms),
						}
					: null,
			},
		} as unknown as Guild,
		channel: (channel ?? { id: 'default-channel' }) as GuildBasedChannel,
	};
}

// ─── Tests ───────────────────────────────────────────────────────

describe('botHasPermissionIn', () => {
	describe('default (interaction channel)', () => {
		test('passes when bot has required permission', async () => {
			const guard = botHasPermissionIn(Perms.SendMessages);
			const input = createMockInput([Perms.SendMessages]);

			const result = await guard(input);

			expect(result.ok).toBe(true);
		});

		test('fails when bot lacks required permission', async () => {
			const guard = botHasPermissionIn(Perms.ManageMessages);
			const input = createMockInput([Perms.SendMessages]);

			const result = await guard(input);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.reason).toContain('ManageMessages');
			}
		});

		test('fails when bot member is not available', async () => {
			const guard = botHasPermissionIn(Perms.SendMessages);
			const input = createMockInput([], undefined, false);

			const result = await guard(input);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.reason).toContain('Unable to verify');
			}
		});

		test('uses custom error message', async () => {
			const customMessage = 'Bot needs embed links';
			const guard = botHasPermissionIn(
				Perms.EmbedLinks,
				undefined,
				customMessage,
			);
			const input = createMockInput([]);

			const result = await guard(input);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.reason).toBe(customMessage);
			}
		});
	});

	describe('with channelGuard', () => {
		test('calls permissionsIn with the resolved channel', async () => {
			const guard = botHasPermissionIn(
				Perms.SendMessages,
				mockChannelGuard(() => targetChannel),
			);

			const permissionsIn = mock(
				(_channel: GuildBasedChannel) =>
					new PermissionsBitField([Perms.SendMessages]),
			);
			const input = {
				guild: {
					members: {
						me: { permissionsIn },
					},
				} as unknown as Guild,
				channel: {
					id: 'interaction-channel',
				} as unknown as GuildBasedChannel,
			};

			const result = await guard(input);

			expect(result.ok).toBe(true);
			expect(permissionsIn).toHaveBeenCalledWith(targetChannel);
		});

		test('fails when channelResolver returns null', async () => {
			const guard = botHasPermissionIn(Perms.SendMessages, nullChannelGuard());
			const input = createMockInput([Perms.SendMessages]);

			const result = await guard(input);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.reason).toContain('Unable to resolve channel');
			}
		});
	});

	describe('metadata', () => {
		test('has correct metadata without channelGuard', () => {
			const guard = botHasPermissionIn(Perms.SendMessages);

			expectPermissionGuardMeta(guard, 'botHasPermissionIn');
		});

		test('includes channelGuard in requires when provided', () => {
			const channelGuard = mockChannelGuard(() => targetChannel);
			const guard = botHasPermissionIn(Perms.SendMessages, channelGuard);

			expectChannelGuardInRequires(guard, channelGuard);
		});
	});
});

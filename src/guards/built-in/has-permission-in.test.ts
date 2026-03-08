import { describe, expect, mock, test } from 'bun:test';
import type { GuildBasedChannel, GuildMember } from 'discord.js';
import { PermissionsBitField } from 'discord.js';
import {
	expectChannelGuardInRequires,
	expectPermissionGuardMeta,
	mockChannelGuard,
	nullChannelGuard,
	Perms,
	targetChannel,
} from '@/core/lib/test-helpers';
import { hasPermissionIn } from './has-permission-in';

// ─── Test Helpers ────────────────────────────────────────────────

/** Create mock input with member and channel for permission checks. */
function createMockInput(memberPerms: bigint[], channel?: object) {
	return {
		member: {
			permissionsIn: () => new PermissionsBitField(memberPerms),
		} as unknown as GuildMember,
		channel: (channel ?? { id: 'default-channel' }) as GuildBasedChannel,
	};
}

// ─── Tests ───────────────────────────────────────────────────────

describe('hasPermissionIn', () => {
	describe('default (interaction channel)', () => {
		test('passes when user has required permission', async () => {
			const guard = hasPermissionIn(Perms.SendMessages);
			const input = createMockInput([Perms.SendMessages]);

			const result = await guard(input);

			expect(result.ok).toBe(true);
		});

		test('fails when user lacks required permission', async () => {
			const guard = hasPermissionIn(Perms.ManageMessages);
			const input = createMockInput([Perms.SendMessages]);

			const result = await guard(input);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.reason).toContain('ManageMessages');
			}
		});

		test('uses custom error message', async () => {
			const customMessage = 'You need moderator permissions';
			const guard = hasPermissionIn(
				Perms.ManageMessages,
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

		test('checks multiple permissions', async () => {
			const guard = hasPermissionIn([Perms.SendMessages, Perms.EmbedLinks]);
			const input = createMockInput([Perms.SendMessages, Perms.EmbedLinks]);

			const result = await guard(input);

			expect(result.ok).toBe(true);
		});
	});

	describe('with channelGuard', () => {
		test('calls permissionsIn with the resolved channel', async () => {
			const guard = hasPermissionIn(
				Perms.SendMessages,
				mockChannelGuard(() => targetChannel),
			);

			const permissionsIn = mock(
				(_channel: GuildBasedChannel) =>
					new PermissionsBitField([Perms.SendMessages]),
			);
			const input = {
				member: { permissionsIn } as unknown as GuildMember,
				channel: {
					id: 'interaction-channel',
				} as unknown as GuildBasedChannel,
			};

			const result = await guard(input);

			expect(result.ok).toBe(true);
			expect(permissionsIn).toHaveBeenCalledWith(targetChannel);
		});

		test('fails when channelResolver returns null', async () => {
			const guard = hasPermissionIn(Perms.SendMessages, nullChannelGuard());
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
			const guard = hasPermissionIn(Perms.SendMessages);

			expectPermissionGuardMeta(guard, 'hasPermissionIn');
		});

		test('includes channelGuard in requires when provided', () => {
			const channelGuard = mockChannelGuard(() => targetChannel);
			const guard = hasPermissionIn(Perms.SendMessages, channelGuard);

			expectChannelGuardInRequires(guard, channelGuard);
		});
	});
});

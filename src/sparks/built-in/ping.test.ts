import { describe, expect, mock, test } from 'bun:test';
import { PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import {
	createMockChatInputInteraction,
	createMockClient,
} from '@/core/lib/test-helpers';
import { ping } from './ping';

/** Creates a mock that rejects with a Discord API error. */
const rejectingMock = () =>
	mock(() => Promise.reject(new Error('Discord API error')));

/** Creates a guild member mock with Administrator permissions. */
function adminMember() {
	return {
		permissions: new PermissionsBitField(PermissionFlagsBits.Administrator),
	};
}

/** Creates a mock interaction that passes guild + admin guards. */
function createAdminInteraction(overrides: Record<string, unknown> = {}) {
	const client =
		(overrides['client'] as ReturnType<typeof createMockClient>) ??
		createMockClient();
	return createMockChatInputInteraction({
		commandName: 'ping',
		client,
		...overrides,
		// biome-ignore lint/suspicious/noExplicitAny: test mock — inCachedGuild narrowing needs a function mock
	} as any);
}

/** Adds guild context to an interaction's underlying object. */
function withGuildContext(
	interaction: ReturnType<typeof createAdminInteraction>,
) {
	const obj = interaction as unknown as Record<string, unknown>;
	obj['inCachedGuild'] = mock(() => true);
	obj['guild'] = { id: '111', members: { ban: mock(), kick: mock() } };
	obj['guildId'] = '111';
	obj['member'] = adminMember();
	obj['channel'] = { id: '222' };
	return interaction;
}

describe('ping spark', () => {
	test('has correct type and command name', () => {
		expect(ping.type).toBe('command');
		expect(ping.id).toBe('ping');
	});

	test('has admin guards', () => {
		expect(ping.guards).toHaveLength(2);
	});

	test('requires Administrator in command builder', () => {
		const json = ping.command.toJSON();
		expect(json.default_member_permissions).toBe(
			PermissionFlagsBits.Administrator.toString(),
		);
	});

	test('rejects non-guild interaction', async () => {
		const client = createMockClient();
		const interaction = createAdminInteraction({ client });
		const obj = interaction as unknown as Record<string, unknown>;
		obj['inCachedGuild'] = mock(() => false);

		const result = await ping.execute(interaction);

		expect(result.ok).toBe(false);
	});

	test('logs error when reply fails', async () => {
		const client = createMockClient();
		const interaction = withGuildContext(
			createAdminInteraction({ reply: rejectingMock(), client }),
		);

		await ping.execute(interaction);

		expect(client.logger.error).toHaveBeenCalledWith(
			expect.objectContaining({ err: expect.any(Error) }),
			'Ping reply failed',
		);
		expect(interaction.fetchReply).not.toHaveBeenCalled();
		expect(interaction.editReply).not.toHaveBeenCalled();
	});

	test('logs error when fetchReply fails', async () => {
		const client = createMockClient();
		const interaction = withGuildContext(
			createAdminInteraction({
				reply: mock(() => Promise.resolve()),
				fetchReply: rejectingMock(),
				client,
			}),
		);

		await ping.execute(interaction);

		expect(client.logger.error).toHaveBeenCalledWith(
			expect.objectContaining({ err: expect.any(Error) }),
			'Ping fetchReply failed',
		);
		expect(interaction.editReply).not.toHaveBeenCalled();
	});

	test('logs error when editReply fails', async () => {
		const client = createMockClient();
		const interaction = withGuildContext(
			createAdminInteraction({
				createdTimestamp: 1_000_000,
				reply: mock(() => Promise.resolve()),
				fetchReply: mock(() =>
					Promise.resolve({ createdTimestamp: 1_000_042 }),
				),
				editReply: rejectingMock(),
				client,
			}),
		);

		await ping.execute(interaction);

		expect(client.logger.error).toHaveBeenCalledWith(
			expect.objectContaining({ err: expect.any(Error) }),
			'Ping editReply failed',
		);
	});

	test('replies with latency calculation', async () => {
		const client = createMockClient({ ws: { ping: 38 } });

		const reply = mock(() => Promise.resolve());
		const editReply = mock(() => Promise.resolve());
		const interaction = withGuildContext(
			createAdminInteraction({
				createdTimestamp: 1_000_000,
				reply,
				fetchReply: mock(() =>
					Promise.resolve({ createdTimestamp: 1_000_042 }),
				),
				editReply,
				client,
			}),
		);

		const result = await ping.execute(interaction);

		expect(result.ok).toBe(true);
		expect(reply).toHaveBeenCalledWith({ content: 'Pinging...' });
		expect(editReply).toHaveBeenCalledWith(
			'Pong! Roundtrip: 42ms | WebSocket: 38ms',
		);
	});
});

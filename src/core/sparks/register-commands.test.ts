import {
	afterEach,
	beforeEach,
	describe,
	expect,
	mock,
	spyOn,
	test,
} from 'bun:test';
import {
	ApplicationIntegrationType,
	Collection,
	InteractionContextType,
	REST,
	Routes,
	SlashCommandBuilder,
} from 'discord.js';
import { createMockClient } from '@/core/lib/test-helpers';
import type { BaseCommandSpark } from './command';
import { registerCommands } from './register-commands';

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/** Shared mock for REST.prototype.put. */
let putMock: ReturnType<typeof mock>;

/** Shared mock for REST.prototype.setToken — returns the REST instance. */
let setTokenMock: ReturnType<typeof mock>;

/** Creates a mock command spark with a real SlashCommandBuilder. */
function createCommandSpark(
	name: string,
	scope?: BaseCommandSpark['scope'],
): BaseCommandSpark {
	const builder = new SlashCommandBuilder()
		.setName(name)
		.setDescription(`${name} command`);

	return {
		type: 'command',
		id: name,
		command: builder,
		...(scope !== undefined && { scope }),
		execute() {
			return Promise.resolve({ ok: true, value: {} as never });
		},
		register() {},
	} as BaseCommandSpark;
}

/** Extracts the first command JSON from the REST.put() call body. */
function getFirstPutCommand(
	mockFn: ReturnType<typeof mock>,
): Record<string, unknown> {
	if (mockFn.mock.calls.length === 0) {
		throw new Error('Expected REST.put to be called but it was not');
	}
	const call = mockFn.mock.calls[0] as [
		string,
		{ body: Record<string, unknown>[] },
	];
	return call[1].body[0] as Record<string, unknown>;
}

/** Creates a mock client with the commands config populated. */
function createTestClient(
	overrides: {
		isProduction?: boolean;
		defaultScope?: string;
		devGuildId?: string;
		sparks?: BaseCommandSpark[];
	} = {},
) {
	const {
		isProduction = false,
		defaultScope = 'guild',
		devGuildId,
		sparks = [],
	} = overrides;
	const commands = new Collection<string, BaseCommandSpark>();

	for (const spark of sparks) {
		commands.set(spark.id, spark);
	}

	return createMockClient({
		commands,
		config: {
			isProduction,
			discord: {
				appID: '123456789012345678',
				apiToken: 'mock-token',
				intents: [],
				enabledPartials: [],
				enforceNonce: false,
				commands: {
					defaultScope,
					...(devGuildId !== undefined && { devGuildId }),
				},
			},
			misc: {},
			ids: { role: {}, channel: {}, emoji: {} },
		} as never,
	});
}

/* ------------------------------------------------------------------ */
/*  Setup                                                             */
/* ------------------------------------------------------------------ */

let putSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
	putMock = mock(() => Promise.resolve([]));
	setTokenMock = spyOn(REST.prototype, 'setToken');
	setTokenMock.mockReturnThis();
	putSpy = spyOn(REST.prototype, 'put').mockImplementation(putMock);
});

afterEach(() => {
	setTokenMock.mockRestore();
	putSpy.mockRestore();
});

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

describe('registerCommands', () => {
	describe('early return', () => {
		test('does nothing when no commands are registered', async () => {
			const client = createTestClient();

			await registerCommands(client);

			expect(putMock).not.toHaveBeenCalled();
		});
	});

	describe('scope application', () => {
		test('applies config defaultScope to commands without explicit scope', async () => {
			const spark = createCommandSpark('ping');
			const client = createTestClient({
				defaultScope: 'everywhere',
				sparks: [spark],
			});

			await registerCommands(client);

			const cmd = getFirstPutCommand(putMock);
			expect(cmd['integration_types']).toEqual([
				ApplicationIntegrationType.GuildInstall,
				ApplicationIntegrationType.UserInstall,
			]);
			expect(cmd['contexts']).toEqual([
				InteractionContextType.Guild,
				InteractionContextType.BotDM,
				InteractionContextType.PrivateChannel,
			]);
		});

		test('per-command scope overrides config defaultScope', async () => {
			const spark = createCommandSpark('ping', 'user');
			const client = createTestClient({
				defaultScope: 'guild',
				sparks: [spark],
			});

			await registerCommands(client);

			const cmd = getFirstPutCommand(putMock);
			expect(cmd['integration_types']).toEqual([
				ApplicationIntegrationType.UserInstall,
			]);
			expect(cmd['contexts']).toEqual([
				InteractionContextType.Guild,
				InteractionContextType.PrivateChannel,
			]);
		});
	});

	describe('route resolution', () => {
		test('registers to global route in production', async () => {
			const spark = createCommandSpark('ping');
			const client = createTestClient({
				isProduction: true,
				sparks: [spark],
			});

			await registerCommands(client);

			expect(putMock).toHaveBeenCalledWith(
				Routes.applicationCommands('123456789012345678'),
				expect.anything(),
			);
		});

		test('uses dev guild route when devGuildId set and not production', async () => {
			const spark = createCommandSpark('ping');
			const client = createTestClient({
				isProduction: false,
				devGuildId: '987654321098765432',
				sparks: [spark],
			});

			await registerCommands(client);

			expect(putMock).toHaveBeenCalledWith(
				Routes.applicationGuildCommands(
					'123456789012345678',
					'987654321098765432',
				),
				expect.anything(),
			);
		});

		test('falls back to global route when not production and no devGuildId', async () => {
			const spark = createCommandSpark('ping');
			const client = createTestClient({
				isProduction: false,
				sparks: [spark],
			});

			await registerCommands(client);

			expect(putMock).toHaveBeenCalledWith(
				Routes.applicationCommands('123456789012345678'),
				expect.anything(),
			);
		});

		test('ignores devGuildId in production', async () => {
			const spark = createCommandSpark('ping');
			const client = createTestClient({
				isProduction: true,
				devGuildId: '987654321098765432',
				sparks: [spark],
			});

			await registerCommands(client);

			expect(putMock).toHaveBeenCalledWith(
				Routes.applicationCommands('123456789012345678'),
				expect.anything(),
			);
		});
	});

	describe('mixed scopes', () => {
		test('commands with and without explicit scope both register', async () => {
			const explicitScope = createCommandSpark('admin', 'user');
			const defaultScope = createCommandSpark('help');
			const client = createTestClient({
				defaultScope: 'guild',
				sparks: [explicitScope, defaultScope],
			});

			await registerCommands(client);

			expect(putMock).toHaveBeenCalledTimes(1);
			const call = putMock.mock.calls[0] as [
				string,
				{ body: Record<string, unknown>[] },
			];
			expect(call[1].body).toHaveLength(2);
		});
	});

	describe('logging', () => {
		test('logs command names during registration', async () => {
			const spark1 = createCommandSpark('ping');
			const spark2 = createCommandSpark('help');
			const client = createTestClient({ sparks: [spark1, spark2] });

			await registerCommands(client);

			expect(client.logger.info).toHaveBeenCalledWith(
				{ commands: ['ping', 'help'] },
				'Registering 2 commands...',
			);
			expect(client.logger.info).toHaveBeenCalledWith(
				'Commands registered successfully',
			);
		});
	});

	describe('error handling', () => {
		test('throws and logs when REST put fails', async () => {
			putMock.mockRejectedValue(new Error('REST failure'));
			const spark = createCommandSpark('ping');
			const client = createTestClient({ sparks: [spark] });

			await expect(registerCommands(client)).rejects.toThrow('REST failure');
			expect(client.logger.error).toHaveBeenCalledWith(
				expect.objectContaining({ err: expect.any(Error) }),
				'Failed to register commands',
			);
		});
	});
});

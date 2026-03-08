import { describe, expect, test } from 'bun:test';
import { ApplicationIntegrationType, InteractionContextType } from 'discord.js';
import { COMMAND_SCOPES, resolveScope } from './command-scope';

describe('COMMAND_SCOPES', () => {
	test('contains all four presets', () => {
		expect(COMMAND_SCOPES).toEqual([
			'guild',
			'guild+bot-dm',
			'user',
			'everywhere',
		]);
	});
});

describe('resolveScope', () => {
	test('guild maps to GuildInstall + Guild context', () => {
		const result = resolveScope('guild');

		expect(result.integrationTypes).toEqual([
			ApplicationIntegrationType.GuildInstall,
		]);
		expect(result.contexts).toEqual([InteractionContextType.Guild]);
	});

	test('guild+bot-dm maps to GuildInstall + Guild,BotDM contexts', () => {
		const result = resolveScope('guild+bot-dm');

		expect(result.integrationTypes).toEqual([
			ApplicationIntegrationType.GuildInstall,
		]);
		expect(result.contexts).toEqual([
			InteractionContextType.Guild,
			InteractionContextType.BotDM,
		]);
	});

	test('user maps to UserInstall + Guild,PrivateChannel contexts', () => {
		const result = resolveScope('user');

		expect(result.integrationTypes).toEqual([
			ApplicationIntegrationType.UserInstall,
		]);
		expect(result.contexts).toEqual([
			InteractionContextType.Guild,
			InteractionContextType.PrivateChannel,
		]);
	});

	test('everywhere maps to both install types + all contexts', () => {
		const result = resolveScope('everywhere');

		expect(result.integrationTypes).toEqual([
			ApplicationIntegrationType.GuildInstall,
			ApplicationIntegrationType.UserInstall,
		]);
		expect(result.contexts).toEqual([
			InteractionContextType.Guild,
			InteractionContextType.BotDM,
			InteractionContextType.PrivateChannel,
		]);
	});
});

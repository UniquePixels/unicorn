import { type Client, Collection } from 'discord.js';
import type { ExtendedLogger } from '@/core/lib/logger';

// Re-export the registry interface for module augmentation
export type { UnicornClientRegistry } from './augmentation';

/**
 * Runtime type guard to check if a Client has been initialized with Unicorn properties.
 *
 * Validates that all required properties exist with correct types: Collections for
 * commands/components/scheduledJobs, and the logger satisfies the ExtendedLogger
 * contract (has `shutdown` and `registerDebugSource` methods).
 */
export function isInitializedClient(client: Client): boolean {
	if (
		!(
			'logger' in client &&
			'config' in client &&
			'commands' in client &&
			'components' in client &&
			'scheduledJobs' in client
		)
	) {
		return false;
	}

	// Validate collection and array types
	if (
		!(
			client.commands instanceof Collection &&
			client.components instanceof Collection &&
			client.scheduledJobs instanceof Collection
		)
	) {
		return false;
	}

	// Validate the ExtendedLogger contract
	const { logger } = client as { logger: unknown };
	if (typeof logger !== 'object' || logger === null) {
		return false;
	}
	const obj = logger as Record<string, unknown>;
	return (
		typeof obj['shutdown'] === 'function' &&
		typeof obj['registerDebugSource'] === 'function'
	);
}

/**
 * Attaches Unicorn-specific collections and services to the Discord.js client.
 * This should be called during client initialization before loading sparks.
 */
export function initializeClient(
	client: Client,
	logger: ExtendedLogger,
	config: Client['config'],
): Client {
	client.logger = logger;
	client.config = config;
	client.commands = new Collection();
	client.components = new Collection();
	client.scheduledJobs = new Collection();

	return client;
}

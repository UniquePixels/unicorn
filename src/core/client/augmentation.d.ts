import type { CronJob } from 'cron';
import type { Collection } from 'discord.js';
import type { ParsedConfig, UnicornConfig } from '@/core/configuration';
import type { ExtendedLogger } from '@/core/lib/logger';
import type { BaseCommandSpark } from '@/core/sparks/command';
import type { BaseComponentSpark } from '@/core/sparks/component';

/**
 * Registry interface for declaring the app's configuration type.
 *
 * Override this via module augmentation in your app to get type-safe config
 * access (e.g. `client.config.ids.role.admin`) across all sparks and guards:
 *
 * ```ts
 * // src/client.d.ts
 * import type { appConfig } from './config.ts';
 *
 * declare module '@/core/client' {
 *   interface UnicornClientRegistry {
 *     config: typeof appConfig;
 *   }
 * }
 * ```
 */
// biome-ignore lint/suspicious/noEmptyInterface: Designed to be extended via module augmentation
export interface UnicornClientRegistry {}

/** Merges the registry with the base config type so a fallback always exists. */
type RegistryWithFallback = UnicornClientRegistry & { config: UnicornConfig };

/** Resolves the registered config type, falling back to the base UnicornConfig. */
type RegisteredConfig = RegistryWithFallback['config'];

declare module 'discord.js' {
	interface Client {
		/** Extended pino logger with Sentry integration and debug source registration. */
		logger: ExtendedLogger;

		/** Parsed configuration with type-safe access to IDs */
		config: ParsedConfig<RegisteredConfig>;

		/** Collection of command sparks keyed by command name */
		commands: Collection<string, BaseCommandSpark>;

		/** Collection of component sparks keyed by custom ID (exact and parameterized) */
		components: Collection<string, BaseComponentSpark>;

		/** Collection of active cron jobs keyed by spark ID + schedule */
		scheduledJobs: Collection<string, CronJob>;
	}
}

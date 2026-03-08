import type { appConfig } from './config.ts';

/**
 * Registers the app's configuration type with the Unicorn framework.
 * Enables type-safe `client.config.ids.role.<key>` access across all
 * sparks, guards, and helpers without threading generics.
 */
declare module '@/core/client' {
	/** Overrides the default registry to supply this app's config type. */
	interface UnicornClientRegistry {
		/** The app-level config object whose literal ID keys are preserved. */
		config: typeof appConfig;
	}
}

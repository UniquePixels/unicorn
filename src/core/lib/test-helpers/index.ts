/** biome-ignore-all lint/suspicious/noMisplacedAssertion: test utility helpers use expect() outside test() */
import { expect } from 'bun:test';

export { createMockClient } from './mock-client';
export { failGuard, passThroughGuard } from './mock-guards';
export {
	createMockAutocompleteInteraction,
	createMockBaseInteraction,
	createMockChatInputInteraction,
	createMockCommand,
	createMockComponentInteraction,
	createMockMessage,
} from './mock-interaction';
export {
	expectChannelGuardInRequires,
	expectPermissionGuardMeta,
	mockChannelGuard,
	nullChannelGuard,
	Perms,
	targetChannel,
} from './mock-permissions';

/**
 * Asserts a value is defined (not null or undefined).
 * Use in tests to narrow types before making assertions on the value.
 */
export function assertDefined<T>(
	val: T | undefined | null,
): asserts val is NonNullable<T> {
	expect(val).not.toBeNull();
	expect(val).toBeDefined();
}

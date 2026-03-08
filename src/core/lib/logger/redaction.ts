/** Censor string used to replace sensitive values. */
export const CENSOR = '[REDACTED]';

/**
 * Sensitive key names with common casing variants.
 *
 * Redaction is case-sensitive, so each variant must be listed explicitly.
 * This is more verbose than implicit normalization but makes the exact
 * set of redacted keys auditable.
 */
export const SENSITIVE_KEYS: readonly string[] = [
	'token',
	'Token',
	'password',
	'Password',
	'secret',
	'Secret',
	'authorization',
	'Authorization',
	'cookie',
	'Cookie',
	'setCookie',
	'set-cookie',
	'set_cookie',
	'Set-Cookie',
	'Set_Cookie',
	'apiKey',
	'api_key',
	'api-key',
	'ApiKey',
	'accessToken',
	'access_token',
	'access-token',
	'AccessToken',
	'apiToken',
	'api_token',
	'api-token',
	'ApiToken',
	'refreshToken',
	'refresh_token',
	'refresh-token',
	'RefreshToken',
	'clientSecret',
	'client_secret',
	'client-secret',
	'ClientSecret',
	'connectionString',
	'connection_string',
	'connection-string',
	'ConnectionString',
	'x-api-key',
	'X-Api-Key',
];

/** Header names selectively redacted within `headers` objects. */
export const SENSITIVE_HEADERS: readonly string[] = [
	'authorization',
	'Authorization',
	'cookie',
	'Cookie',
	'set-cookie',
	'Set-Cookie',
	'x-api-key',
	'X-Api-Key',
];

/**
 * Maximum nesting depth for wildcard redaction patterns.
 * Generates patterns from depth 0 (root) through N levels of `*` prefixes.
 */
const MAX_REDACT_DEPTH = 3;

/** Builds wildcard-prefixed variants of a key up to {@link MAX_REDACT_DEPTH}. */
function expandKey(key: string): string[] {
	const paths = [key];
	let prefix = '*';
	for (let i = 0; i < MAX_REDACT_DEPTH; i++) {
		paths.push(`${prefix}.${key}`);
		prefix = `*.${prefix}`;
	}
	return paths;
}

/** Set of sensitive keys for O(1) lookup during recursive censoring. */
const sensitiveKeySet = new Set<string>(SENSITIVE_KEYS);

/** Maximum recursion depth for {@link censorSensitiveKeys}. */
const MAX_CENSOR_DEPTH = 10;

/** Recurses into a nested value (object or array of objects). */
function censorValue(value: unknown, depth: number): void {
	if (value === null || typeof value !== 'object') {
		return;
	}
	if (Array.isArray(value)) {
		for (const item of value) {
			if (item !== null && typeof item === 'object') {
				censorSensitiveKeys(item as Record<string, unknown>, depth);
			}
		}
	} else {
		censorSensitiveKeys(value as Record<string, unknown>, depth);
	}
}

/**
 * Recursively censors sensitive keys in an object in-place.
 *
 * Walks object properties and replaces values whose keys appear in
 * {@link SENSITIVE_KEYS} with {@link CENSOR}. Depth-limited to prevent
 * stack overflow on deeply nested or circular structures.
 *
 * The error serializer already recurses into cause chains, so each
 * level is censored independently.
 */
export function censorSensitiveKeys(
	obj: Record<string, unknown>,
	depth = 0,
): Record<string, unknown> {
	if (depth >= MAX_CENSOR_DEPTH) {
		return obj;
	}

	for (const key of Object.keys(obj)) {
		if (sensitiveKeySet.has(key)) {
			obj[key] = CENSOR;
		} else {
			censorValue(obj[key], depth + 1);
		}
	}

	return obj;
}

/**
 * Builds the redact path array for Pino's `redact` option.
 *
 * Covers:
 * - Sensitive keys at multiple nesting depths (root through {@link MAX_REDACT_DEPTH})
 * - Selective header paths at multiple nesting depths
 *
 * @param additional - Extra paths merged with defaults (consumer customization).
 */
export function buildRedactPaths(additional: string[] = []): string[] {
	const paths = new Set<string>();

	for (const key of SENSITIVE_KEYS) {
		for (const expanded of expandKey(key)) {
			paths.add(expanded);
		}
	}

	for (const header of SENSITIVE_HEADERS) {
		for (const expanded of expandKey(`headers.${header}`)) {
			paths.add(expanded);
		}
	}

	for (const path of additional) {
		paths.add(path);
	}

	return [...paths];
}

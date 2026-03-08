# Logger

Unicorn's logger wraps [pino](https://getpino.io/) with structured error serialization, debug source routing, and Sentry integration. It lives at `src/core/lib/logger/`.

## Creating a Logger

```ts
import { createLogger } from '@/core/lib/logger';

const logger = createLogger();
```

`createLogger()` returns an `ExtendedLogger` — a pino `Logger` with two additional methods: `registerDebugSource()` and `shutdown()`.

### Configuration

Pass a partial `LoggerConfig` to override defaults:

```ts
const logger = createLogger({
  level: 'debug',
  serviceName: 'my-bot',
  defaultContext: { version: '1.0.0' },
});
```

| Option | Default (dev) | Default (prod) | Description |
|---|---|---|---|
| `level` | `'trace'` | `'info'` | Minimum log level |
| `serviceName` | `'app'` | `'app'` | Added to every log entry as `service` |
| `defaultContext` | `{}` | `{}` | Extra fields merged into every log entry |
| `disablePretty` | `false` | — | Disable `pino-pretty` in dev (production always outputs JSON) |
| `serializers` | — | — | Custom pino serializers (merged with defaults) |
| `redactPaths` | `[]` | `[]` | Additional `@pinojs/redact` paths merged with defaults |
| `environment` | auto-detected | auto-detected | Override `Bun.env.NODE_ENV` detection |

### Environment Detection

The logger checks `Bun.env.NODE_ENV`:

- **`'development'`** — trace level, pretty output
- **anything else** — info level, JSON to stdout (suitable for log aggregation)

## Logging

Use pino's standard API. Always pass structured metadata as the first argument:

```ts
logger.info({ user: readyClient.user.tag, guilds: 5 }, 'Bot is ready');
logger.debug({ command: 'ping' }, 'Command executed');
logger.error({ err: error, command: 'ban' }, 'Command action failed');
```

> [!IMPORTANT]
> Use the key `err` or `error` when logging Error objects. Both trigger the error serializer which extracts stack traces, cause chains, and AppError metadata. Convention in this codebase is `err`.

## Debug Source Routing

Route events from any `EventEmitter` through the logger using `registerDebugSource()`:

```ts
logger.registerDebugSource({
  name: 'discord.js',
  emitter: client,
  eventMap: { debug: 'debug', warn: 'warn', error: 'error' },
  redactPatterns: [/Bot\s+[\w-]+\.[\w-]+\.[\w-]+/g],
});
```

| Option | Type | Description |
|---|---|---|
| `name` | `string` | Label added to log entries as `source` |
| `emitter` | `DebugEmitter` | Any object with `on(event, listener)` and `removeListener(event, listener)` |
| `eventMap` | `Record<string, LogLevel>` | Maps emitter events to pino log levels |
| `redactPatterns` | `RegExp[]` | Patterns replaced with `[REDACTED]` in string payloads |

Returns an unsubscribe function:

```ts
const unsub = logger.registerDebugSource({ ... });
unsub(); // removes all listeners
```

## Redaction

Sensitive values are automatically replaced with `[REDACTED]`. Redaction operates at two layers:

- **Pino context** — log calls (`logger.info({ password })`) are redacted via Pino's built-in `redact` option
- **Error serializer** — sensitive keys on error objects (including recursive cause chains) are censored by a lightweight recursive key walker

### Default sensitive keys

`token`, `password`, `secret`, `authorization`, `cookie`, `setCookie`, `apiKey`, `apiToken`, `accessToken`, `refreshToken`, `clientSecret`, `connectionString` — plus common casing variants (`Token`, `api_key`, `api-key`, `Set-Cookie`, `refresh_token`, etc.).

> [!NOTE]
> In production, [Sentry's server-side data scrubbing](https://docs.sentry.io/security-legal-pii/scrubbing/server-side-scrubbing/) (enabled by default) provides additional substring-based redaction that catches compound key names automatically. The Pino-level redaction serves as a safety net for non-Sentry log outputs.

### Selective header redaction

Only sensitive headers (`authorization`, `cookie`, `set-cookie`) are redacted within `headers` objects. Non-sensitive headers like `content-type` and `x-request-id` pass through for debugging.

### Custom paths

Add extra redact paths via `redactPaths`:

```ts
const logger = createLogger({
  redactPaths: ['ssn', '*.creditCard'],
});
```

Paths use Pino's redact syntax — dot notation, bracket notation, and `*` wildcards.

## Error Serialization

The built-in error serializer (registered for both the `err` and `error` keys) handles:

- Standard `Error` properties (name, message, stack)
- ES2022 `cause` chains (recursive)
- `AggregateError.errors` arrays
- `AppError` fields (code, statusCode, metadata, isOperational)
- Circular references (via `serialize-error`)
- Sensitive key redaction (recursive key censoring)
- Depth limiting (max 5 levels) to prevent runaway recursion

## Sentry Integration

### Setup

In your Sentry preload file, use `sentryPinoIntegration()`:

```ts
import * as Sentry from '@sentry/bun';
import { sentryPinoIntegration } from '@/core/lib/logger';

Sentry.init({
  dsn: Bun.env['sentryDSN'],
  integrations: [sentryPinoIntegration()],
});
```

This configures two Sentry capture layers:

- **Sentry Logs** — `info` level and above are sent as structured Sentry logs
- **Sentry Events** — `warn` level and above are captured as Sentry error events

### Custom Options

```ts
sentryPinoIntegration({
  logLevels: ['warn', 'error', 'fatal'],
  eventLevels: ['error', 'fatal'],
});
```

### Flushing

Call `logger.shutdown()` before process exit to flush both pino buffers and pending Sentry events:

```ts
await logger.shutdown(); // flushes pino + Sentry (5s timeout)
```

This is automatically called during Unicorn's graceful shutdown sequence.

## Type Reference

```ts
import type {
  ExtendedLogger,    // pino Logger + registerDebugSource + shutdown
  LoggerConfig,      // createLogger() options
  LogLevel,          // 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'
  DebugSourceOptions, // registerDebugSource() options
  DebugEmitter,      // EventEmitter-like interface
  SerializedError,   // Shape of serialized error objects
  ErrorMetadata,     // Record<string, unknown>
} from '@/core/lib/logger';
```

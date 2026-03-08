# Error Handling

Unicorn provides structured error classes and a layered error-handling strategy. Import everything from `@/core/lib/logger`:

```ts
import { AppError, HttpError, ValidationError, DatabaseError } from '@/core/lib/logger';
```

## Error Classes

### AppError

Base error class with structured metadata. All other error classes extend it.

```ts
throw new AppError('User not found', {
  code: 'ERR_USER_NOT_FOUND',
  statusCode: 404,
  metadata: { userId: '123' },
  isOperational: true,
  cause: originalError,
});
```

| Property | Type | Default | Description |
|---|---|---|---|
| `code` | `string` | `'ERR_UNKNOWN'` | Machine-readable error code |
| `statusCode` | `number` | `500` | HTTP status hint |
| `metadata` | `Record<string, unknown>` | `{}` | Arbitrary context for debugging |
| `isOperational` | `boolean` | `true` | `true` = expected failure, `false` = bug |
| `timestamp` | `string` | — | ISO timestamp of when the error was created |
| `cause` | `Error` | — | Native ES2022 error cause |

All `AppError` fields are serialized by the logger and appear in Sentry issue context — enabling filtering by error code and distinguishing operational errors from bugs.

### HttpError

For HTTP API call failures. Always operational.

```ts
throw new HttpError('Discord API rate limited', 429, {
  code: 'ERR_RATE_LIMITED',
  metadata: { retryAfter: 5000 },
});
```

### ValidationError

For input validation failures. Always 400, always operational. The second argument is a `fields` record mapping field names to arrays of error messages.

```ts
throw new ValidationError(
  'Invalid input',
  {
    username: ['Required', 'Must be at least 3 characters'],
    email: ['Invalid format'],
  },
);
```

### DatabaseError

For database failures. Defaults to non-operational (statusCode 503).

```ts
throw new DatabaseError('Connection timeout', {
  code: 'ERR_DB_TIMEOUT',
  metadata: { host: 'db.example.com' },
  cause: originalError,
});
```

## Error Codes

Framework error codes used internally:

| Code | Source | Description |
|---|---|---|
| `ERR_CONFIG_PARSE` | `parseConfig()` | Configuration validation failed |
| `ERR_SPARK_LOAD` | `loadSparks()` | Failed to load a spark file |
| `ERR_COMMAND_GROUP_EMPTY` | `defineCommandGroup()` | No subcommands or groups provided |

When writing sparks, use descriptive codes prefixed with `ERR_`:

```ts
new AppError('Queue is full', {
  code: 'ERR_QUEUE_FULL',
  metadata: { queueSize: 100, maxSize: 100 },
});
```

## Error Handling Strategy

Unicorn uses a layered approach:

### Startup — Throw and Terminate

Configuration parsing, spark loading, and Discord login throw on failure. The process cannot function without these succeeding.

```ts
// These throw AppError on failure — intentionally unhandled
const config = parseConfig(appConfig);
await loadSparks(client, sparksDir);
await client.login(config.discord.apiToken);
```

### Runtime — Log and Recover

Spark actions use `attempt()` for Result-based error handling. Errors are logged but never terminate the process.

```ts
import { attempt } from '@/core/lib/attempt';

action: async (interaction) => {
  const result = await attempt(() => fetchUserData(interaction.user.id));
  if (result.isErr()) {
    interaction.client.logger.error({ err: result.error, user: interaction.user.id }, 'Failed to fetch user');
    await interaction.reply({ content: 'Something went wrong.', flags: MessageFlags.Ephemeral });
    return;
  }
  // use result.data
}
```

> [!TIP]
> The framework's `execute()` wrapper catches any unhandled errors from your action as a safety net. But you should still use `attempt()` for all fallible operations — it lets you make decisions about how to respond to the user.

### Shutdown — Warn and Continue

Each cleanup step runs independently. A failure in one step doesn't prevent the others from running.

## Best Practices for Spark Authors

1. **Always use `attempt()` for fallible operations** — never let promises go unhandled
2. **Use `{ err: error }` or `{ error }` key** when logging errors — both trigger the serializer
3. **Use AppError with codes** for domain errors — searchable in Sentry, filterable
4. **Use `metadata` for context, not the message** — structured data > interpolated strings
5. **Use `cause` when wrapping** — preserves the full error chain
6. **`isOperational: true`** (default) for expected failures (rate limits, not found, validation)
7. **`isOperational: false`** for bugs or system failures that should trigger alerts
8. **Don't create subclasses** unless adding new structured fields — use `code` instead
9. **Startup code should throw** (fast-fail) — runtime spark code should log and recover

```ts
// Good — structured context in metadata
const result = await attempt(() => api.getUser(userId));
if (result.isErr()) {
  throw new AppError('Failed to fetch user', {
    code: 'ERR_USER_FETCH',
    metadata: { userId },
    cause: result.error,
  });
}

// Bad — context baked into message string
throw new Error(`Failed to fetch user ${userId}: ${error.message}`);
```

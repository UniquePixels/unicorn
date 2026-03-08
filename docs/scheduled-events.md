# Scheduled Events

Scheduled events in Unicorn are built using the Spark system. Every scheduled task is a `ScheduledEventSpark` created via `defineScheduledEvent()` and auto-registered through the loader. They run on cron schedules using the `cron` library.

## Basic Usage

Use `defineScheduledEvent` to create a task that runs on a cron schedule:

```ts
import { defineScheduledEvent } from '@/core/sparks';

export const dailyCleanup = defineScheduledEvent({
  id: 'daily-cleanup',
  schedule: '0 0 * * *',
  action: async (ctx) => {
    ctx.client.logger.info('Running daily cleanup...');
    await cleanupOldData();
  },
});
```

The `action` receives a `ScheduledContext` object with the bot client, the cron job instance, and the time the tick fired.

## Cron Expressions

The `schedule` option accepts a cron expression string. Cron expressions follow the standard five-field format:

```text
 ┌────────── minute (0-59)
 │ ┌──────── hour (0-23)
 │ │ ┌────── day of month (1-31)
 │ │ │ ┌──── month (1-12)
 │ │ │ │ ┌── day of week (0-7, 0 and 7 are Sunday)
 │ │ │ │ │
 * * * * *
```

See [crontab.guru](https://crontab.guru) for an interactive editor.

### Common Patterns

```ts
// Every day at midnight UTC
schedule: '0 0 * * *'

// Every 5 minutes
schedule: '*/5 * * * *'

// Weekday mornings at 9:00 AM
schedule: '0 9 * * 1-5'

// Every hour on the hour
schedule: '0 * * * *'

// First day of every month at noon
schedule: '0 12 1 * *'

// Every Sunday at 3:00 AM
schedule: '0 3 * * 0'
```

## Multiple Schedules

Pass an array to `schedule` to run the same action on multiple cron expressions. Each expression creates its own cron job:

```ts
export const healthCheck = defineScheduledEvent({
  id: 'health-check',
  schedule: ['0 9 * * 1-5', '0 17 * * 1-5'],
  timezone: 'America/New_York',
  action: async (ctx) => {
    ctx.client.logger.debug('Health check tick');
    await runHealthCheck(ctx.client);
  },
});
```

This runs the health check at 9:00 AM and 5:00 PM Eastern on weekdays.

## Timezone

The `timezone` option defaults to `'UTC'`. Use [IANA timezone names](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones) to run schedules in a specific timezone:

```ts
export const morningReport = defineScheduledEvent({
  id: 'morning-report',
  schedule: '0 8 * * *',
  timezone: 'Europe/London',
  action: async (ctx) => {
    ctx.client.logger.info('Sending morning report (London time)');
    await sendReport(ctx.client);
  },
});
```

Common timezone values:
- `'UTC'` (default)
- `'America/New_York'`
- `'America/Los_Angeles'`
- `'Europe/London'`
- `'Asia/Tokyo'`

## Guards

Guards on scheduled events receive `ScheduledContext` as input. They run before the action on every tick. If a guard fails, the action is skipped and the failure reason is logged at debug level:

```ts
import { createGuard, guardFail, guardPass } from '@/core/guards';
import { defineScheduledEvent } from '@/core/sparks';
import type { ScheduledContext } from '@/core/sparks/scheduled-event';

const onlyWeekdays = createGuard<ScheduledContext>((ctx) => {
  const day = ctx.fireDate.getDay();
  if (day === 0 || day === 6) {
    return guardFail('Skipping weekend');
  }
  return guardPass(ctx);
});

export const weekdayTask = defineScheduledEvent({
  id: 'weekday-task',
  schedule: '0 12 * * *',
  guards: [onlyWeekdays],
  action: async (ctx) => {
    ctx.client.logger.info('Running weekday-only task');
  },
});
```

## Lifecycle

### Registration

Jobs start automatically when the spark is registered during startup. Each cron expression in the `schedule` creates a separate `CronJob` that begins ticking immediately.

### Shutdown

During graceful shutdown, `stopAllScheduledJobs()` is called to stop all registered cron jobs and clear them from the client. Individual sparks also expose a `stop(client)` method for stopping their own jobs.

### Error Handling

If the action throws, the error is logged but the cron job continues running. The bot does not crash on scheduled event failures:

```text
Scheduled tick fires
  -> runGuards(guards, ctx)
  -> if guards fail: log reason at debug level, skip action
  -> action(ctx)
  -> if action throws: log error (don't crash, job keeps running)
```

## Job Keys

Each cron job is stored in `client.scheduledJobs` with a composite key of `id:cronExpr`. For a scheduled event with multiple schedules, each expression gets its own entry:

```ts
// Given:
defineScheduledEvent({
  id: 'health-check',
  schedule: ['0 9 * * 1-5', '0 17 * * 1-5'],
  // ...
});

// client.scheduledJobs contains:
//   'health-check:0 9 * * 1-5'  -> CronJob
//   'health-check:0 17 * * 1-5' -> CronJob
```

This allows you to inspect or manipulate individual jobs at runtime via the `client.scheduledJobs` collection.

## API Reference

### `defineScheduledEvent(options)`

Creates a scheduled event spark.

| Option | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | Yes | Unique identifier for this scheduled spark |
| `schedule` | `string \| string[]` | Yes | Cron expression(s) defining when to run |
| `timezone` | `string` | No | IANA timezone name (default: `'UTC'`) |
| `guards` | `Guard[]` | No | Guards to run before the action on each tick |
| `action` | `(ctx: ScheduledContext) => void \| Promise<void>` | Yes | Handler function called on each tick |

### `ScheduledContext`

The context object passed to scheduled event actions and guards.

| Property | Type | Description |
|---|---|---|
| `client` | `Client` | The bot client instance |
| `job` | `CronJob` | The cron job instance that fired this tick |
| `fireDate` | `Date` | The time this tick was scheduled to fire |

### `stopAllScheduledJobs(client)`

Stops all registered scheduled jobs and clears the `client.scheduledJobs` collection. Called automatically during graceful shutdown.

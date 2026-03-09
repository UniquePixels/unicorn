<p align="center">
  <img src=".github/assets/logo.png" alt="Unicorn" width="480" />
</p>

<p align="center">
  A type-safe Discord bot framework built on <a href="https://discord.js.org/">Discord.js</a> and TypeScript, designed to run on <a href="https://bun.sh/">Bun</a>.
</p>

<p align="center">
  <a href="https://github.com/uniquepixels/unicorn/actions/workflows/ci-codeql.yml"><img src="https://img.shields.io/github/actions/workflow/status/uniquepixels/unicorn/ci-codeql.yml?style=for-the-badge&label=CodeQL" alt="CodeQL" /></a>
  <a href="https://sonarcloud.io/summary/overall?id=UniquePixels_unicorn"><img src="https://img.shields.io/sonar/quality_gate/UniquePixels_unicorn?server=https%3A%2F%2Fsonarcloud.io&style=for-the-badge&label=SonarCloud" alt="SonarCloud" /></a>
  <a href="https://securityscorecards.dev/viewer/?uri=github.com/uniquepixels/unicorn"><img src="https://img.shields.io/ossf-scorecard/github.com/UniquePixels/unicorn?style=for-the-badge&label=OpenSSF%20Scorecard" alt="OpenSSF Scorecard" /></a>
  <a href="https://www.bestpractices.dev/projects/12120"><img src="https://img.shields.io/cii/summary/12120?style=for-the-badge&label=OpenSSF%20Best%20Practices" alt="OpenSSF Best Practices" /></a>
  <a href="https://discord.gg/Dk8P8h3e9u"><img src="https://img.shields.io/badge/Discord-Join-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord" /></a>
  <a href="https://github.com/uniquepixels/unicorn"><img src="https://img.shields.io/badge/built_with-Unicorn-6366f1?style=for-the-badge&logo=data:image/svg%2bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjM1MCAyODAgMjgwIDM1MCI+PHBhdGggZmlsbD0id2hpdGUiIGQ9Ik01MjQuMzEsNjA4LjQ1Yy0uODkuMDQtMS43OS4wNC0yLjY4LjA0LTkuNDIsMC0xOC42NC0uOC0yNy42MS0yLjM4LTQyLjA1LTE0LjE1LTcyLjM0LTUzLjktNzIuMzQtMTAwLjc0LDAtMi4xNC4wNy00LjI3LjItNi4zOC45NS0xNi4xMiw1LjQ5LTMxLjI2LDEyLjg1LTQ0LjY2LTIuNjMsNS40My00LjA5LDExLjUxLTQuMDksMTcuOTQsMCwxOS42NiwxMy43MywzNi4xNCwzMi4xMiw0MC4zNGwuMDIuMDIsMTUuNzEsNS4yNGMtMi4xMyw2Ljg0LTMuMjksMTQuMTQtMy4yOSwyMS43LDAsMzEuOTIsMjAuNTUsNTkuMDUsNDkuMTMsNjguOVoiLz48cGF0aCBmaWxsPSJ3aGl0ZSIgZD0iTTU2OS42OSw0ODcuODVjMy4zNCw1LjgxLDQuOTQsMTIuNzcsNC4xNCwyMC4xMi0xLjg1LDE3LjA3LTE2Ljk3LDI5Ljk1LTM0LjEzLDI5LjMzLTEuNC0uMDUtMi43OC0uMTktNC4xMy0uNDFoLS4wMmMtMy40OC0uNTktNi43Ny0xLjctOS44MS0zLjI3di0uMDJsLTQ3LjI3LTE1Ljc1LTE1LjcxLTUuMjQtLjAyLS4wMmMtMTguMzktNC4yLTMyLjEyLTIwLjY4LTMyLjEyLTQwLjM0LDAtNi40MywxLjQ3LTEyLjUxLDQuMDktMTcuOTQtNy4zNiwxMy40LTExLjksMjguNTQtMTIuODUsNDQuNjYtLjEyLDIuMTEtLjIsNC4yNC0uMiw2LjM4LDAsNDYuODQsMzAuMjksODYuNTksNzIuMzQsMTAwLjc0LTY2LjItMTEuNTEtMTE4LjQ3LTYzLjY4LTEzMC4xMi0xMjkuODQsMTEuMDUtNTMuNCw1OC4zMy05My41NCwxMTUtOTMuNTQsMS40MSwwLDIuODIuMDIsNC4yNC4wOSw2LjEzLjIsMTIuMTUuODksMTguMDEsMi4wMmguMDJsODUuMzYtNDAuNzMtNDguNjYsNTQuNDctLjc5Ljg5LTIwLjkxLDIzLjQxLDM2LjIzLDQzLjk2LDEwLjE5LDEyLjM1di4wMmMyLjgyLDIuNDMsNS4yNCw1LjM2LDcuMTEsOC42MXYuMDJaIi8+PC9zdmc+" alt="Built with Unicorn" /></a>
  <a href="https://github.com/UniquePixels/OpenCommunities"><img src=".github/assets/badge.svg" alt="open communities: aligned" /></a>
</p>

---

Unicorn gives you a structured system to build Discord bots for your communities using a **Spark** system for modular command and event handling, composable **Guards** for validation and gating, and type-safe configuration — so you can focus on building great communities, not plumbing. 🦄

## Features

- **Sparks** — modular handlers for slash commands, components (buttons/selects/modals), gateway events, and cron-scheduled tasks
- **Guards** — chainable validation with automatic TypeScript type narrowing. 15 built-in guards included
- **Type-safe config** — Zod-validated configuration with secret resolution and typed Snowflake IDs
- **Component pattern matching** — exact and parameterized matching for interactive components with automatic parameter extraction
- **Command scoping** — control where commands appear: guild, DMs, user-installed, or everywhere
- **Structured logging** — Pino-based logger with automatic redaction and optional Sentry integration
- **Health checks** — liveness and readiness endpoints for container orchestration
- **Graceful shutdown** — coordinated cleanup of cron jobs, health server, and the Discord client
- **[Lagniappe](https://github.com/uniquepixels/unicorn-lagniappe)** — a growing collection of drop-in sparks, guards, and utilities

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/) v1.3+
- A [Discord bot token](https://discord.com/developers/applications)

### Setup

```bash
bun install
```

Update `src/config.ts` with your bot's application ID and desired intents:

```ts
export const appConfig = {
  discord: {
    appID: 'your-application-id',
    apiToken: 'secret://apiKey',
    intents: [GatewayIntentBits.Guilds],
    // ...
  },
} satisfies UnicornConfig;
```

Add your bot token to `.env` — Bun loads it automatically, no dotenv needed:

```env
apiKey=your-bot-token
```

```bash
bun start
```

## Sparks

Sparks are the building blocks of your bot. Each spark is a self-contained module that defines its trigger, optional guards, and action handler.

### Commands

```ts
import { SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '@/core/sparks';

export const ping = defineCommand({
  command: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check bot latency'),
  action: async (interaction) => {
    await interaction.reply(`Pong! ${interaction.client.ws.ping}ms`);
  },
});
```

Unicorn also supports [autocomplete](docs/commands.md#with-autocomplete), [subcommand groups](docs/commands.md#command-groups), and [context menu commands](docs/commands.md#context-menu-commands).

### Components

Handle buttons, select menus, and modals with pattern-matched IDs:

```ts
import { defineComponent } from '@/core/sparks';

export const confirmButton = defineComponent({
  id: 'confirm-action',       // exact match (O(1) lookup)
  action: async (interaction) => {
    await interaction.reply('Confirmed!');
  },
});
```

Supports exact and parameterized matching with automatic parameter extraction. See [Components](docs/components.md).

### Gateway Events

```ts
import { Events } from 'discord.js';
import { defineGatewayEvent } from '@/core/sparks';

export const memberJoin = defineGatewayEvent({
  event: Events.GuildMemberAdd,
  action: async (member, client) => {
    client.logger.info({ userId: member.id }, 'New member joined');
  },
});
```

Supports `once` mode, guards, and more. See [Gateway Events](docs/gateway-events.md).

### Scheduled Events

```ts
import { defineScheduledEvent } from '@/core/sparks';

export const dailyCleanup = defineScheduledEvent({
  id: 'daily-cleanup',
  schedule: '0 0 * * *',       // midnight UTC
  timezone: 'America/New_York', // optional
  action: async (ctx) => {
    ctx.client.logger.info('Running daily cleanup');
  },
});
```

Supports multiple schedules, timezones, and guards. See [Scheduled Events](docs/scheduled-events.md).

## Guards

Guards are composable validators that run before a spark's action. They chain sequentially with type narrowing — if a guard ensures a guild context, every subsequent guard and the action receive guild-typed interactions.

```ts
import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '@/core/sparks';
import { inCachedGuild, hasPermission } from '@/guards/built-in';

export const kick = defineCommand({
  command: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a member'),
  guards: [inCachedGuild, hasPermission(PermissionFlagsBits.KickMembers)],
  action: async (interaction) => {
    // interaction is typed with guild guaranteed
  },
});
```

17 built-in guards ship with Unicorn. You can also [create your own](docs/guards.md#creating-custom-guards). See [Guards](docs/guards.md) for the full reference.

## Configuration

Type-safe configuration with Zod schemas, automatic secret resolution from environment variables, and typed Snowflake IDs:

```ts
import type { UnicornConfig } from '@/core/configuration';

export default {
  apiKey: 'secret://BOT_TOKEN',
  ids: {
    guild: { main: '123456789' },
    role:  { admin: '987654321' },
  },
} satisfies UnicornConfig;
```

See [Configuration](docs/configuration.md) for the full schema, secret handling, environment mapping, and health check setup.

## Documentation

- [Commands](docs/commands.md) — slash commands, autocomplete, subcommand groups, context menus
- [Components](docs/components.md) — interactive components (buttons, select menus, modals) with exact and parameterized matching
- [Guards](docs/guards.md) — built-in guards, custom guards, composition, type narrowing
- [Gateway Events](docs/gateway-events.md) — event listeners, once vs recurring
- [Scheduled Events](docs/scheduled-events.md) — cron tasks, timezones, lifecycle
- [Configuration](docs/configuration.md) — config schema, secrets, environment mapping, health checks
- [Errors](docs/errors.md) — AppError, error handling strategy, best practices
- [Logger](docs/logger.md) — structured logging, redaction, Sentry integration
- [Emoji](docs/emoji.md) — application emoji resolver

## Support

- [Open an issue](https://github.com/uniquepixels/unicorn/issues) for bug reports and feature requests
- [Join the Discord](https://discord.gg/Dk8P8h3e9u) for questions, help, and discussion

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, code style, and pull request guidelines.

## License

[MIT](LICENSE)

---

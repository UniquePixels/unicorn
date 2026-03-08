# Commands

Commands in Unicorn are built using the Spark system. Every slash command is a `CommandSpark` created via a factory function and auto-registered through the loader.

There are three factory functions, each suited to a different level of complexity:

| Factory | Use case |
|---|---|
| `defineCommand` | Simple commands with no subcommands |
| `defineCommandWithAutocomplete` | Simple commands that need autocomplete |
| `defineCommandGroup` | Commands composed of subcommands and/or subcommand groups |

All three return a `CommandSpark` and register identically. The interaction router, loader, and client collections require no changes regardless of which factory you use.

## Simple Commands

Use `defineCommand` for standalone slash commands.

```ts
import { SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '@/core/sparks';

export const ping = defineCommand({
  command: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check bot latency'),
  action: async (interaction) => {
    const start = Date.now();
    const reply = await interaction.reply({ content: 'Pinging...', fetchReply: true });
    const roundtrip = reply.createdTimestamp - start;
    await interaction.editReply(`Pong! Roundtrip: ${roundtrip}ms | WebSocket: ${interaction.client.ws.ping}ms`);
  },
});
```

### With Guards

Guards run before the action and can narrow the interaction type:

```ts
import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '@/core/sparks';
import { attempt } from '@/core/lib/attempt';
import * as g from '@/guards/built-in';

export const kick = defineCommand({
  command: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a member')
    .addUserOption(opt => opt.setName('target').setDescription('Member to kick').setRequired(true)),
  guards: [g.inCachedGuild, g.hasPermission(PermissionFlagsBits.KickMembers)],
  action: async (interaction) => {
    const target = interaction.options.getUser('target', true);
    const result = await attempt(() => interaction.guild.members.kick(target.id));
    if (result.isErr()) {
      await interaction.reply({ content: 'Failed to kick member.', flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.reply(`Kicked ${target.username}`);
  },
});
```

### With Autocomplete

Use `defineCommandWithAutocomplete` when an option needs dynamic suggestions:

```ts
import { SlashCommandBuilder } from 'discord.js';
import { defineCommandWithAutocomplete } from '@/core/sparks';

export const search = defineCommandWithAutocomplete({
  command: new SlashCommandBuilder()
    .setName('search')
    .setDescription('Search for something')
    .addStringOption(opt =>
      opt.setName('query').setDescription('Search query').setAutocomplete(true),
    ),
  autocomplete: async (interaction) => {
    const query = interaction.options.getFocused();
    const results = await searchDatabase(query);
    await interaction.respond(
      results.slice(0, 25).map(r => ({ name: r.title, value: r.id })),
    );
  },
  action: async (interaction) => {
    const query = interaction.options.getString('query', true);
    await interaction.reply(`You searched for: ${query}`);
  },
});
```

## Context Menu Commands

Context menu commands (right-click on a user or message) are registered and routed through the same `client.commands` map as slash commands. Use `defineCommand` with a `ContextMenuCommandBuilder`:

```ts
import {
  ApplicationCommandType,
  ContextMenuCommandBuilder,
  MessageFlags,
  type MessageContextMenuCommandInteraction,
} from 'discord.js';
import { defineCommand } from '@/core/sparks';

export const reportMessage = defineCommand<MessageContextMenuCommandInteraction>({
  command: new ContextMenuCommandBuilder()
    .setName('Report Message')
    .setType(ApplicationCommandType.Message),
  action: async (interaction) => {
    const message = interaction.targetMessage;
    await interaction.reply({ content: `Reported message ${message.id}`, flags: MessageFlags.Ephemeral });
  },
});
```

> [!NOTE]
> Pass the specific context menu interaction type as a generic to `defineCommand` so the `action` receives the correct type with access to `targetMessage` or `targetUser`. The `execute()` method accepts `CommandInteraction` (the common base), so no unsafe casts are needed.

### User Commands

```ts
import {
  ApplicationCommandType,
  ContextMenuCommandBuilder,
  MessageFlags,
  type UserContextMenuCommandInteraction,
} from 'discord.js';
import { defineCommand } from '@/core/sparks';

export const userInfo = defineCommand<UserContextMenuCommandInteraction>({
  command: new ContextMenuCommandBuilder()
    .setName('User Info')
    .setType(ApplicationCommandType.User),
  action: async (interaction) => {
    const user = interaction.targetUser;
    await interaction.reply({ content: `User: ${user.tag}`, flags: MessageFlags.Ephemeral });
  },
});
```

## Command Groups

Use `defineCommandGroup` when a slash command is composed of subcommands, subcommand groups, or both. This is the recommended pattern for any command with nesting.

### Why Not a Switch Statement?

A common approach is to put all subcommands in one `defineCommand` with a switch:

```ts
// Avoid this pattern
export const manage = defineCommand({
  command: builder,
  action: async (interaction) => {
    switch (interaction.options.getSubcommand()) {
      case 'add': return handleAdd(interaction);
      case 'remove': return handleRemove(interaction);
      case 'list': return handleList(interaction);
    }
  },
});
```

This has several drawbacks:
- No per-subcommand guards (all subcommands share one guard set)
- Manual routing that must be updated for every new subcommand
- No per-subcommand autocomplete routing
- The action function grows into a monolith

`defineCommandGroup` solves all of these.

### Direct Subcommands

For commands like `/manage list`, `/manage add`, `/manage remove`:

```ts
import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { defineCommandGroup } from '@/core/sparks';
import * as g from '@/guards/built-in';

export const manage = defineCommandGroup({
  command: new SlashCommandBuilder()
    .setName('manage')
    .setDescription('Manage items')
    .addSubcommand(sub => sub.setName('list').setDescription('List all items'))
    .addSubcommand(sub => sub.setName('add').setDescription('Add an item'))
    .addSubcommand(sub => sub.setName('remove').setDescription('Remove an item')),

  // Top-level guards run before ANY subcommand
  guards: [g.inCachedGuild],

  subcommands: {
    list: {
      // No extra guards needed for viewing
      action: async (interaction) => {
        await interaction.reply('Here are the items...');
      },
    },
    add: {
      // Per-subcommand guard: only staff can add
      guards: [g.hasPermission(PermissionFlagsBits.ManageGuild)],
      action: async (interaction) => {
        await interaction.reply('Item added!');
      },
    },
    remove: {
      guards: [g.hasPermission(PermissionFlagsBits.ManageGuild)],
      action: async (interaction) => {
        await interaction.reply('Item removed!');
      },
    },
  },
});
```

### Subcommand Groups

For deeper nesting like `/settings roles add`, `/settings roles remove`, `/settings channels set`:

```ts
import { SlashCommandBuilder } from 'discord.js';
import { defineCommandGroup } from '@/core/sparks';
import * as g from '@/guards/built-in';

export const settings = defineCommandGroup({
  command: new SlashCommandBuilder()
    .setName('settings')
    .setDescription('Server settings')
    .addSubcommandGroup(group =>
      group
        .setName('roles')
        .setDescription('Role settings')
        .addSubcommand(sub => sub.setName('add').setDescription('Add a role'))
        .addSubcommand(sub => sub.setName('remove').setDescription('Remove a role')),
    )
    .addSubcommandGroup(group =>
      group
        .setName('channels')
        .setDescription('Channel settings')
        .addSubcommand(sub => sub.setName('set').setDescription('Set a channel')),
    ),

  guards: [g.inCachedGuild],

  groups: {
    roles: {
      add:    { action: async (interaction) => { /* ... */ } },
      remove: { action: async (interaction) => { /* ... */ } },
    },
    channels: {
      set:    { action: async (interaction) => { /* ... */ } },
    },
  },
});
```

### Mixing Subcommands and Groups

Discord allows both direct subcommands and subcommand groups on the same command:

```ts
export const config = defineCommandGroup({
  command: new SlashCommandBuilder()
    .setName('config')
    .setDescription('Bot configuration')
    .addSubcommand(sub => sub.setName('view').setDescription('View current config'))
    .addSubcommandGroup(group =>
      group
        .setName('notifications')
        .setDescription('Notification settings')
        .addSubcommand(sub => sub.setName('enable').setDescription('Enable'))
        .addSubcommand(sub => sub.setName('disable').setDescription('Disable')),
    ),

  guards: [g.inCachedGuild],

  // /config view
  subcommands: {
    view: { action: async (interaction) => { /* ... */ } },
  },

  // /config notifications enable, /config notifications disable
  groups: {
    notifications: {
      enable:  { action: async (interaction) => { /* ... */ } },
      disable: { action: async (interaction) => { /* ... */ } },
    },
  },
});
```

### Per-Subcommand Autocomplete

Each subcommand handler can define its own autocomplete:

```ts
export const lookup = defineCommandGroup({
  command: new SlashCommandBuilder()
    .setName('lookup')
    .setDescription('Lookup commands')
    .addSubcommand(sub =>
      sub
        .setName('user')
        .setDescription('Lookup a user')
        .addStringOption(opt =>
          opt.setName('name').setDescription('Username').setAutocomplete(true),
        ),
    )
    .addSubcommand(sub =>
      sub
        .setName('role')
        .setDescription('Lookup a role')
        .addStringOption(opt =>
          opt.setName('name').setDescription('Role name').setAutocomplete(true),
        ),
    ),

  subcommands: {
    user: {
      autocomplete: async (interaction) => {
        const query = interaction.options.getFocused();
        const users = await searchUsers(query);
        await interaction.respond(users.map(u => ({ name: u.tag, value: u.id })));
      },
      action: async (interaction) => {
        const name = interaction.options.getString('name', true);
        await interaction.reply(`User: ${name}`);
      },
    },
    role: {
      autocomplete: async (interaction) => {
        const query = interaction.options.getFocused();
        const roles = await searchRoles(query);
        await interaction.respond(roles.map(r => ({ name: r.name, value: r.id })));
      },
      action: async (interaction) => {
        const name = interaction.options.getString('name', true);
        await interaction.reply(`Role: ${name}`);
      },
    },
  },
});
```

## Command Scoping

Command scoping controls where a command appears — in guilds, DMs, user-installed contexts, or everywhere. Scoping is applied automatically during command registration.

### Scope Presets

| Scope | Integration Types | Contexts | Use Case |
|---|---|---|---|
| `'guild'` | Guild Install | Guild | Server-only commands (default) |
| `'guild+bot-dm'` | Guild Install | Guild, Bot DM | Server commands also usable in bot DMs |
| `'user'` | User Install | Guild, Private Channel | User-installable commands |
| `'everywhere'` | Guild Install, User Install | Guild, Bot DM, Private Channel | Available in all contexts |

`CommandScope` is a string literal union of these four values.

### Config Default

Set a default scope for all commands in your config. Commands without an explicit `scope` use this value:

```ts
{
  discord: {
    // ...
    commands: {
      defaultScope: 'guild', // default if omitted
    },
  },
}
```

### Per-Command Override

Any command can override the default by setting `scope` in its options:

```ts
export const ping = defineCommand({
  command: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check bot latency'),
  scope: 'everywhere', // overrides config default
  action: async (interaction) => {
    await interaction.reply('Pong!');
  },
});
```

### Dev Guild Registration

During development, you can register commands to a specific guild instead of globally. This makes command updates instant (global registration can take up to an hour to propagate).

```ts
{
  discord: {
    commands: {
      defaultScope: 'guild',
      devGuildId: '987654321098765432', // your test server
    },
  },
}
```

When `devGuildId` is set and the app is not in production mode (`config.isProduction === false`), commands are registered to that guild via `Routes.applicationGuildCommands()`. In production, `devGuildId` is ignored and commands are always registered globally via `Routes.applicationCommands()`.

> [!NOTE]
> `devGuildId` only affects the registration route — it does not change the integration types or contexts set by `scope`. Scope and registration route are independent.

## File Organization

For simple commands, a single file is fine:

```text
src/sparks/ping.ts
```

For command groups with substantial logic, split subcommand handlers into separate files:

```text
src/sparks/manage/
  command.ts              # defineCommandGroup + builder
  subcommands/
    list.ts               # { action } handler object
    add.ts                # { guards, action } handler object
    remove.ts             # { guards, action } handler object
```

Each subcommand file exports a plain handler object:

```ts
// src/sparks/manage/subcommands/add.ts
import type { SubcommandHandler } from '@/core/sparks';
import * as g from '@/guards/built-in';
import { PermissionFlagsBits } from 'discord.js';

export const add: SubcommandHandler = {
  guards: [g.hasPermission(PermissionFlagsBits.ManageGuild)],
  action: async (interaction) => {
    await interaction.reply('Item added!');
  },
};
```

Then compose them in the command file:

```ts
// src/sparks/manage/command.ts
import { SlashCommandBuilder } from 'discord.js';
import { defineCommandGroup } from '@/core/sparks';
import * as g from '@/guards/built-in';
import { add } from './subcommands/add';
import { list } from './subcommands/list';
import { remove } from './subcommands/remove';

export const manage = defineCommandGroup({
  command: new SlashCommandBuilder()
    .setName('manage')
    .setDescription('Manage items')
    .addSubcommand(sub => sub.setName('list').setDescription('List items'))
    .addSubcommand(sub => sub.setName('add').setDescription('Add an item'))
    .addSubcommand(sub => sub.setName('remove').setDescription('Remove an item')),
  guards: [g.inCachedGuild],
  subcommands: { list, add, remove },
});
```

## Execution Flow

Understanding how commands execute helps when debugging:

### Simple commands (`defineCommand`)

```text
Interaction arrives
  -> interaction-create routes by commandName
  -> spark.execute(interaction)
    -> runGuards(guards, interaction)
    -> if guards fail: return { ok: false, reason }
    -> action(narrowedInteraction)
    -> if action throws: log error (don't crash)
```

### Command groups (`defineCommandGroup`)

```text
Interaction arrives
  -> interaction-create routes by commandName
  -> spark.execute(interaction)
    -> runGuards(topLevelGuards, interaction)
    -> if top guards fail: return { ok: false, reason }
    -> resolve subcommand from interaction.options
    -> find handler in subcommands{} or groups{}
    -> if no handler: return { ok: false, reason }
    -> runGuards(subcommandGuards, narrowedInteraction)
    -> if sub guards fail: return { ok: false, reason }
    -> handler.action(narrowedInteraction)
    -> if action throws: log error (don't crash)
```

In both cases, if guards fail and the interaction hasn't been replied to, the interaction router sends an ephemeral error message with the guard's failure reason.

## Guard Composition

Guards are the primary mechanism for validation and type narrowing. They compose at two levels in command groups:

**Top-level guards** run for every subcommand. Use these for shared requirements:
- `inCachedGuild` - require the command to be used in a server
- `hasPermission(...)` - require a base permission level

**Per-subcommand guards** run after top-level guards. Use these for subcommand-specific checks:
- Additional permission requirements for destructive actions
- Rate limiting on specific subcommands
- Custom validation logic

```ts
defineCommandGroup({
  guards: [g.inCachedGuild],                    // All subcommands require a guild
  subcommands: {
    view: {
      action: viewHandler,                    // No extra guards needed
    },
    delete: {
      guards: [g.hasPermission(PermissionFlagsBits.ManageGuild)],  // Extra permission
      action: deleteHandler,
    },
  },
});
```

## API Reference

### `defineCommand<TGuarded>(options)`

Creates a simple command spark.

| Option | Type | Required | Description |
|---|---|---|---|
| `command` | `CommandBuilder` | Yes | The slash command builder |
| `guards` | `Guard[]` | No | Guards to run before the action |
| `scope` | `CommandScope` | No | Override the config's `defaultScope` for this command |
| `action` | `CommandAction<TGuarded>` | Yes | Handler function |

### `defineCommandWithAutocomplete<TGuarded>(options)`

Creates a command spark with autocomplete support. Accepts all `defineCommand` options plus:

| Option | Type | Required | Description |
|---|---|---|---|
| `autocomplete` | `(interaction) => void \| Promise<void>` | Yes | Autocomplete handler |

### `defineCommandGroup<TGuarded>(options)`

Creates a command group spark that routes to subcommand handlers.

| Option | Type | Required | Description |
|---|---|---|---|
| `command` | `CommandBuilder` | Yes | The slash command builder (with subcommands) |
| `guards` | `Guard[]` | No | Top-level guards shared by all subcommands |
| `scope` | `CommandScope` | No | Override the config's `defaultScope` for this command |
| `subcommands` | `Record<string, SubcommandHandler>` | No | Direct subcommand handlers |
| `groups` | `Record<string, Record<string, SubcommandHandler>>` | No | Grouped subcommand handlers |

At least one of `subcommands` or `groups` should be provided.

### `SubcommandHandler<TGuarded>`

A handler object for a single subcommand.

| Property | Type | Required | Description |
|---|---|---|---|
| `guards` | `Guard[]` | No | Guards specific to this subcommand |
| `action` | `CommandAction<TGuarded>` | Yes | Handler function |
| `autocomplete` | `(interaction) => void \| Promise<void>` | No | Autocomplete for this subcommand |

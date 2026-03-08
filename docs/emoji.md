# Emoji

The emoji utility (`@/core/lib/emoji`) resolves application-level custom emojis by name, falling back to a Unicode character when the emoji is not cached.

> [!NOTE]
> Application emojis are fetched and cached during the `ready` event. The utility reads from this cache — it never makes API calls.

## Usage

```ts
import { resolveAppEmoji } from '@/core/lib/emoji';

// Inside a spark action where you have access to a client instance:
button.setEmoji(resolveAppEmoji(interaction.client, 'moderator', '🛡️'));
```

The returned value is a string — either the custom emoji's snowflake ID or the Unicode fallback — ready to pass directly to `.setEmoji()`.

## API

### `resolveAppEmoji(client, name, fallback)`

| Parameter  | Type     | Description                                       |
| ---------- | -------- | ------------------------------------------------- |
| `client`   | `Client` | Discord.js client instance                        |
| `name`     | `string` | Name of the application emoji to look up          |
| `fallback` | `string` | Unicode emoji returned when no custom emoji exists |

**Returns:** `string` — Custom emoji ID or the Unicode fallback.

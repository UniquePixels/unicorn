import type { Message } from 'discord.js';
import { createGuard, type Guard, guardFail, guardPass } from '@/core/guards';

/**
 * Guard that ensures a message is not from a bot.
 * For use with message-based gateway event sparks.
 */
export const notBot: Guard<Message, Message> = createGuard<Message, Message>(
	(message) => {
		if (message.author.bot) {
			return guardFail('Bots cannot use this.');
		}
		return guardPass(message);
	},
	{
		name: 'notBot',
		incompatibleWith: ['command', 'component', 'scheduled-event'],
	},
);

import type { Logger } from '../log.js';
import type { EmailMessage, EmailSender } from './types.js';

/**
 * Used when no SMTP credentials are configured (local dev, previews). Logs
 * that a message would have been sent. The body is not logged: it holds the
 * customer's name and address. The logger masks the recipient.
 */
export function createConsoleSender(log: Logger): EmailSender {
  return {
    logsOnly: true,
    async send(message: EmailMessage) {
      log.info('email.console', { to: message.to, subject: message.subject, text_length: message.text.length });
    },
  };
}

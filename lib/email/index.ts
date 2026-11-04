import type { Logger } from '../log.js';
import { createConsoleSender } from './console.js';
import { createGmailSender, type TransportFactory } from './gmail.js';
import type { EmailSender } from './types.js';

export type { EmailMessage, EmailSender } from './types.js';

type Env = Record<string, string | undefined>;

const DEFAULT_TIMEOUT_MS = 8000;

/**
 * Gmail SMTP when GMAIL_USER and GMAIL_APP_PASSWORD are both set, otherwise
 * the console fallback. Half a configuration is a mistake worth a warning,
 * but not worth failing bookings over.
 */
export function emailSenderFromEnv(env: Env, log: Logger, factory?: TransportFactory): EmailSender {
  const user = env.GMAIL_USER?.trim();
  const appPassword = env.GMAIL_APP_PASSWORD?.replace(/\s+/g, '');

  if (user && appPassword) {
    const timeout = Number(env.EMAIL_TIMEOUT_MS);
    log.info('email.sender', { kind: 'gmail_smtp' });
    return createGmailSender(
      {
        user,
        appPassword,
        fromName: env.EMAIL_FROM_NAME?.trim() || 'GharFix',
        timeoutMs: timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS,
      },
      factory,
    );
  }

  if (user || appPassword) {
    log.warn('email.sender_misconfigured', {
      missing: user ? 'GMAIL_APP_PASSWORD' : 'GMAIL_USER',
      kind: 'console',
    });
  } else {
    log.info('email.sender', { kind: 'console' });
  }
  return createConsoleSender(log);
}

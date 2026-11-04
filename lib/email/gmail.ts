import nodemailer from 'nodemailer';
import type { EmailMessage, EmailSender } from './types.js';

// Gmail SMTP with an app password (Google account -> Security -> 2-Step
// Verification -> App passwords). Replaces WF4's n8n Gmail node.

export interface GmailConfig {
  user: string;
  /** The 16-character app password. Google shows it in groups of four; spaces are removed. */
  appPassword: string;
  fromName: string;
  /** Per SMTP phase (connect, greeting, socket idle). The booking handler also caps the whole send. */
  timeoutMs: number;
}

/** The part of a Nodemailer transport this file uses, so tests can supply a fake. */
export interface MailTransport {
  sendMail(mail: { from: string; to: string; subject: string; text: string; html: string }): Promise<unknown>;
}

export type TransportFactory = (options: Record<string, unknown>) => MailTransport;

const nodemailerFactory: TransportFactory = (options) => nodemailer.createTransport(options) as unknown as MailTransport;

export function gmailTransportOptions(config: GmailConfig): Record<string, unknown> {
  return {
    host: 'smtp.gmail.com',
    port: 465,
    secure: true, // implicit TLS; never fall back to plain text
    auth: { user: config.user, pass: config.appPassword },
    connectionTimeout: config.timeoutMs,
    greetingTimeout: config.timeoutMs,
    socketTimeout: config.timeoutMs,
    // Never read attachments or images from disk or URLs, whatever a message contains.
    disableFileAccess: true,
    disableUrlAccess: true,
  };
}

export function createGmailSender(config: GmailConfig, factory: TransportFactory = nodemailerFactory): EmailSender {
  // Built on first send: creating a transport opens no connection, but there
  // is no reason to touch credentials for requests that send nothing.
  let transport: MailTransport | null = null;
  const from = `"${config.fromName.replace(/["\\\r\n]/g, '')}" <${config.user}>`;

  return {
    async send(message: EmailMessage) {
      transport ??= factory(gmailTransportOptions(config));
      await transport.sendMail({
        from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
    },
  };
}

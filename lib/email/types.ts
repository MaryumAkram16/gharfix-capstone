// The email boundary. Booking code builds an EmailMessage and hands it to an
// EmailSender; which sender (Gmail SMTP, console, a future provider) is
// decided once, from env, in lib/email/index.ts.

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailSender {
  /** Resolves when the message is accepted for delivery; rejects otherwise. */
  send(message: EmailMessage): Promise<void>;
}

import nodemailer from 'nodemailer';
import { describe, expect, it, vi } from 'vitest';
import { buildReceipt, confirmationEmail } from '../../lib/booking/receipt';
import { createConsoleSender } from '../../lib/email/console';
import { createGmailSender, gmailTransportOptions, type MailTransport, type TransportFactory } from '../../lib/email/gmail';
import { emailSenderFromEnv } from '../../lib/email/index';
import { memoryLogger } from '../../lib/log';

// Not real credentials.
const FAKE_PASSWORD = 'abcd efgh ijkl mnop';
const config = { user: 'gharfix.sender@example.test', appPassword: 'abcdefghijklmnop', fromName: 'GharFix', timeoutMs: 8000 };

const message = confirmationEmail(
  buildReceipt({
    bookingId: 'BK-TEST-0001', serviceType: 'AC Repair', providerId: 'p1', providerName: 'Ali AC Services',
    bookingDate: '2026-11-10', slot: '16:00', location: 'DHA Phase 5, Lahore', pricePkr: 2500,
    userName: 'Test User', userEmail: 'booking-test@example.test', createdAt: '2026-11-04T09:00:00.000Z',
  }),
)!;

function fakeFactory(sendMail: MailTransport['sendMail'] = async () => ({})) {
  const created: Array<Record<string, unknown>> = [];
  const send = vi.fn(sendMail);
  const factory: TransportFactory = (options) => {
    created.push(options);
    return { sendMail: send };
  };
  return { factory, created, send };
}

describe('gmailTransportOptions', () => {
  it('uses implicit TLS on 465 with timeouts and no file or URL access', () => {
    expect(gmailTransportOptions(config)).toEqual({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: 'gharfix.sender@example.test', pass: 'abcdefghijklmnop' },
      connectionTimeout: 8000,
      greetingTimeout: 8000,
      socketTimeout: 8000,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  });
});

describe('createGmailSender', () => {
  it('creates the transport on first send only, and reuses it', async () => {
    const fake = fakeFactory();
    const sender = createGmailSender(config, fake.factory);
    expect(fake.created).toHaveLength(0);

    await sender.send(message);
    await sender.send(message);

    expect(fake.created).toHaveLength(1);
    expect(fake.send).toHaveBeenCalledTimes(2);
    expect(fake.send.mock.calls[0][0]).toEqual({
      from: '"GharFix" <gharfix.sender@example.test>',
      to: 'booking-test@example.test',
      subject: 'Your GharFix Booking is Confirmed! (Booking ID: BK-TEST-0001)',
      text: message.text,
      html: message.html,
    });
  });

  it('strips quotes and line breaks from the display name', async () => {
    const fake = fakeFactory();
    await createGmailSender({ ...config, fromName: 'Ghar"Fix\r\nBcc: x@example.test' }, fake.factory).send(message);
    expect(fake.send.mock.calls[0][0].from).toBe('"GharFixBcc: x@example.test" <gharfix.sender@example.test>');
  });

  it('rejects when SMTP rejects, so the handler can log it', async () => {
    const fake = fakeFactory(async () => { throw new Error('535-5.7.8 Username and Password not accepted'); });
    await expect(createGmailSender(config, fake.factory).send(message)).rejects.toThrow('535-5.7.8');
  });

  it('produces a real MIME message with Nodemailer (offline stream transport)', async () => {
    let raw = '';
    const streaming: TransportFactory = (options) => {
      expect(options.host).toBe('smtp.gmail.com');
      const t = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
      return {
        sendMail: async (mail) => {
          const info = (await t.sendMail(mail)) as { message: Buffer; envelope: unknown };
          raw = info.message.toString();
          expect(info.envelope).toEqual({ from: 'gharfix.sender@example.test', to: ['booking-test@example.test'] });
          return info;
        },
      };
    };
    await createGmailSender(config, streaming).send(message);
    expect(raw).toContain('From: GharFix <gharfix.sender@example.test>');
    expect(raw).toContain('To: booking-test@example.test');
    expect(raw).toContain('Subject: Your GharFix Booking is Confirmed! (Booking ID: BK-TEST-0001)');
    expect(raw).toMatch(/Content-Type: multipart\/alternative/);
    expect(raw).toContain('Content-Type: text/plain');
    expect(raw).toContain('Content-Type: text/html');
  });
});

describe('createConsoleSender', () => {
  it('logs subject and masked recipient, never the body', async () => {
    const log = memoryLogger();
    await createConsoleSender(log).send(message);
    expect(log.records).toEqual([
      expect.objectContaining({ event: 'email.console', to: 'b***@example.test', subject: message.subject }),
    ]);
    expect(JSON.stringify(log.records)).not.toContain('DHA Phase 5');
  });
});

describe('emailSenderFromEnv', () => {
  it('picks Gmail when both variables are set, removing spaces from the app password', async () => {
    const log = memoryLogger();
    const fake = fakeFactory();
    const sender = emailSenderFromEnv({ GMAIL_USER: ' gharfix.sender@example.test ', GMAIL_APP_PASSWORD: FAKE_PASSWORD }, log, fake.factory);
    await sender.send(message);

    expect(fake.created[0]).toMatchObject({ auth: { user: 'gharfix.sender@example.test', pass: 'abcdefghijklmnop' }, socketTimeout: 8000 });
    expect(log.records.map((r) => [r.event, r.kind])).toEqual([['email.sender', 'gmail_smtp']]);
    expect(JSON.stringify(log.records)).not.toContain('abcd');
  });

  it('honours EMAIL_FROM_NAME and EMAIL_TIMEOUT_MS', async () => {
    const fake = fakeFactory();
    await emailSenderFromEnv(
      { GMAIL_USER: 'gharfix.sender@example.test', GMAIL_APP_PASSWORD: FAKE_PASSWORD, EMAIL_FROM_NAME: 'Khadmat AI', EMAIL_TIMEOUT_MS: '3000' },
      memoryLogger(), fake.factory,
    ).send(message);
    expect(fake.created[0].connectionTimeout).toBe(3000);
    expect(fake.send.mock.calls[0][0].from).toBe('"Khadmat AI" <gharfix.sender@example.test>');
  });

  it('falls back to the console without credentials', async () => {
    const log = memoryLogger();
    const fake = fakeFactory();
    await emailSenderFromEnv({}, log, fake.factory).send(message);
    expect(fake.created).toHaveLength(0);
    expect(log.records.map((r) => r.event)).toEqual(['email.sender', 'email.console']);
  });

  it('warns and falls back when only half is configured', () => {
    for (const [env, missing] of [
      [{ GMAIL_USER: 'gharfix.sender@example.test' }, 'GMAIL_APP_PASSWORD'],
      [{ GMAIL_APP_PASSWORD: FAKE_PASSWORD }, 'GMAIL_USER'],
    ] as const) {
      const log = memoryLogger();
      emailSenderFromEnv(env, log);
      expect(log.records[0]).toMatchObject({ level: 'warn', event: 'email.sender_misconfigured', missing, kind: 'console' });
    }
  });
});

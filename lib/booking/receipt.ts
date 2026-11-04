import { slotLabel } from './slot';

// The confirmation receipt and email, field for field as WF4 "Generate
// Receipt" and the Gmail node built them. The frontend stores this receipt
// in localStorage, so the shape must not change.

export interface ReceiptInput {
  bookingId: string;
  serviceType: string;
  providerId: string;
  providerName: string;
  bookingDate: string;
  /** Normalised "HH:MM". */
  slot: string;
  location: string;
  pricePkr: number;
  userName: string;
  userEmail: string | null;
  /** ISO timestamp of the booking insert. */
  createdAt: string;
}

export interface Receipt {
  booking_id: string;
  status: 'confirmed';
  service: string;
  provider: { id: string; name: string };
  appointment: { date: string; time: string; time_label: string; location: string };
  payment: { estimated_pkr: number; method: string; note: string };
  customer: { name: string; email: string | null };
  confirmation_lines: string[];
  simulated_whatsapp: string;
  next_steps: string[];
  workflow: 'WF4-StepB';
  created_at: string;
}

const NEXT_STEPS = [
  'Provider will call you 1 hour before arrival',
  'Keep your phone available',
  'Pay in cash after service is done',
];

export function buildReceipt(b: ReceiptInput): Receipt {
  const label = slotLabel(b.slot);
  const email = b.userEmail ?? '';
  return {
    booking_id: b.bookingId,
    status: 'confirmed',
    service: b.serviceType,
    provider: { id: b.providerId, name: b.providerName },
    appointment: { date: b.bookingDate, time: b.slot, time_label: label, location: b.location },
    payment: {
      estimated_pkr: b.pricePkr,
      method: 'Cash on service',
      note: 'Final price may vary based on actual work done',
    },
    customer: { name: b.userName, email: b.userEmail },
    confirmation_lines: [
      '✅ Booking confirmed!',
      `🎫 ID: ${b.bookingId}`,
      `📅 ${b.bookingDate} at ${label}`,
      `👷 ${b.providerName}`,
      `📍 ${b.location}`,
      `💰 PKR ${b.pricePkr}`,
      '📱 Provider will call 30 min before arrival',
      `📧 Email: ${email}`,
    ],
    simulated_whatsapp:
      'Assalam o Alaikum! Aapki booking confirm ho gayi.\n' +
      `🎫 ID: ${b.bookingId}\n` +
      `🔧 Service: ${b.serviceType}\n` +
      `👷 Provider: ${b.providerName}\n` +
      `📅 ${b.bookingDate} at ${label}\n` +
      `💰 PKR ${b.pricePkr} (cash on delivery)\n` +
      `📧 Email: ${email}\n` +
      'Shukriya! — Khadmat AI',
    next_steps: [...NEXT_STEPS],
    workflow: 'WF4-StepB',
    created_at: b.createdAt,
  };
}

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** The confirmation email, or null when the customer gave no email address. */
export function confirmationEmail(r: Receipt): EmailMessage | null {
  if (!r.customer.email) return null;
  const rows: Array<[string, string]> = [
    ['Booking ID', r.booking_id],
    ['Service', r.service],
    ['Provider', r.provider.name],
    ['Date', r.appointment.date],
    ['Time', r.appointment.time_label],
    ['Location', r.appointment.location],
    ['Estimated Price', `PKR ${r.payment.estimated_pkr}`],
  ];
  const name = r.customer.name || 'Valued Customer';

  const html =
    '<!DOCTYPE html><html><head><meta charset="UTF-8"></head>' +
    '<body style="font-family: Arial, sans-serif; font-size: 15px; color: #333333; line-height: 1.6; padding: 20px;">' +
    '<div style="max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px;">' +
    '<h2 style="color: #2c5aa0;">Booking Confirmed! 🎉</h2>' +
    `<p>Dear ${escapeHtml(name)},</p>` +
    '<p>Your GharFix booking has been successfully confirmed!</p>' +
    '<h3 style="color: #2c5aa0;">Booking Details:</h3><table style="width: 100%;">' +
    rows
      .map(([k, v]) => `<tr><td style="padding: 4px 12px 4px 0;"><strong>${k}:</strong></td><td style="padding: 4px 0;">${escapeHtml(v)}</td></tr>`)
      .join('') +
    '</table>' +
    `<p><strong>Next Steps:</strong><br>${r.next_steps.map(escapeHtml).join('<br>')}</p>` +
    '<p>Please ensure you are available.</p>' +
    '<p style="margin-top: 30px;">Thank you for choosing GharFix!</p>' +
    '<p style="margin-top: 30px;">Sincerely,<br><strong>The GharFix Team</strong></p>' +
    '</div></body></html>';

  const text = [
    `Dear ${name},`,
    '',
    'Your GharFix booking has been successfully confirmed!',
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    '',
    'Next Steps:',
    ...r.next_steps.map((s) => `- ${s}`),
    '',
    'Thank you for choosing GharFix!',
  ].join('\n');

  return {
    to: r.customer.email,
    // Subject is a header, not HTML: strip line breaks so it cannot inject headers.
    subject: `Your GharFix Booking is Confirmed! (Booking ID: ${r.booking_id})`.replace(/[\r\n]+/g, ' '),
    html,
    text,
  };
}

import { escapeHtml } from '../booking/receipt.js';
import type { EmailMessage } from '../email/types.js';

// WF7's three Gmail nodes: same subjects and wording, values HTML-escaped,
// sent to the booking's own email address.

function render(to: string, subject: string, title: string, name: string, paragraphs: string[], heading: string, rows: Array<[string, string]>, after: string[]): EmailMessage {
  const p = (t: string) => `<p>${escapeHtml(t)}</p>`;
  const html =
    '<!DOCTYPE html><html><head><meta charset="UTF-8"></head>' +
    '<body style="font-family: Arial, sans-serif; font-size: 15px; color: #333333; line-height: 1.6; padding: 20px;">' +
    '<div style="max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px;">' +
    `<h2 style="color: #2c5aa0;">${escapeHtml(title)}</h2><p>Dear ${escapeHtml(name)},</p>` + paragraphs.map(p).join('') +
    `<h3 style="color: #2c5aa0;">${escapeHtml(heading)}</h3><table style="width: 100%;">` +
    rows.map(([k, v]) => `<tr><td style="padding: 4px 12px 4px 0;"><strong>${escapeHtml(k)}:</strong></td><td style="padding: 4px 0;">${escapeHtml(v)}</td></tr>`).join('') +
    '</table>' + after.map(p).join('') + '<p style="margin-top: 30px;">Sincerely,<br><strong>The GharFix Team</strong></p></div></body></html>';
  const text = [`Dear ${name},`, '', ...paragraphs, '', heading, ...rows.map(([k, v]) => `${k}: ${v}`), '', ...after, '', 'Sincerely,', 'The GharFix Team'].join('\n');
  return { to, subject, html, text };
}

export function cancelEmail(to: string, b: { booking_id: string; user_name: string }): EmailMessage {
  return render(to, `Your GharFix Booking Cancelled (${b.booking_id})`, 'Booking Cancelled', b.user_name, ['Your booking has been cancelled as requested.'],
    'Booking Details:', [['Booking ID', b.booking_id]], ['If this was a mistake, please book again through the app.']);
}

export function noSlotEmail(to: string, b: { original_booking_id: string; user_name: string; booking_date: string | null; service_type: string; location: string }): EmailMessage {
  return render(to, "GharFix — We're Finding You a Provider", 'Added to Waitlist', b.user_name,
    [`Your original provider cancelled but unfortunately we could not find an available slot with an alternative provider for ${b.booking_date ?? 'that date'}.`],
    'Booking Details:', [['Booking ID', b.original_booking_id], ['Service', b.service_type], ['Location', b.location]],
    ['You have been added to our waitlist and we will notify you as soon as a slot opens up.']);
}

export function rescheduleEmail(to: string, b: ReturnType<typeof import('./rules.js').rescheduledBody>): EmailMessage {
  const n = b.new_booking;
  return render(to, `Important Update: Your GharFix Booking (${n.booking_id})`, 'Booking Update', b.user_name, [b.customer_message], 'New Booking:', [
    ['Original Booking ID', b.original_booking.booking_id], ['Original Provider', b.original_booking.provider],
    ['New Booking ID', n.booking_id], ['New Provider', n.provider], ['Date & Time', `${n.date} at ${n.slot_label}`], ['Location', n.location],
  ], b.compensation.eligible ? [`Compensation: PKR ${b.compensation.amount_pkr} credit has been added to your account.`] : []);
}

import { escapeHtml } from '../booking/receipt.js';
import type { EmailMessage } from '../email/types.js';
import type { Resolution } from './decide.js';

// WF6 "Send a message" (Gmail node), same layout and wording. Every value is
// HTML-escaped (n8n interpolated them raw). Sent to the booking's own email
// address, never to one taken from the request.

export function disputeEmail(to: string, userName: string | null, providerName: string, r: Resolution): EmailMessage {
  const bookingId = String(r.booking_id);
  const name = userName?.trim() || 'Valued Customer';
  const rows: Array<[string, string]> = [
    ['Booking ID', bookingId],
    ['Dispute Type', String(r.dispute_type)],
    ['Service Provider', providerName],
  ];
  const message = r.customer_message;
  const html =
    '<!DOCTYPE html><html><head><meta charset="UTF-8"></head>' +
    '<body style="font-family: Arial, sans-serif; font-size: 15px; color: #333333; line-height: 1.6; padding: 20px;">' +
    '<div style="max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px;">' +
    '<h2 style="color: #2c5aa0;">Dispute Update</h2>' +
    `<p>Dear ${escapeHtml(name)},</p>` +
    `<p>We hope this finds you well. We are reaching out with an update concerning your dispute regarding Booking ID: <strong>${escapeHtml(bookingId)}</strong>.</p>` +
    '<hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">' +
    '<h3 style="color: #2c5aa0;">Dispute Details:</h3><table style="width: 100%;">' +
    rows.map(([k, v]) => `<tr><td style="padding: 4px 12px 4px 0;"><strong>${k}:</strong></td><td style="padding: 4px 0;">${escapeHtml(v)}</td></tr>`).join('') +
    '</table>' +
    '<hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">' +
    '<h3 style="color: #2c5aa0;">Resolution Provided:</h3>' +
    `<p>${escapeHtml(message).replace(/\n/g, '<br>')}</p>` +
    '<hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">' +
    '<p>For more information, please log in to your GharFix account or respond to this email.</p>' +
    '<p>We appreciate your patience and understanding as we work to resolve this matter for you.</p>' +
    '<p style="margin-top: 30px;">Best regards,<br><strong>The GharFix Team</strong></p>' +
    '</div></body></html>';
  const text = [`Dear ${name},`, '', `Update on your dispute for booking ${bookingId}.`, '', ...rows.map(([k, v]) => `${k}: ${v}`), '', 'Resolution:', message, '', 'The GharFix Team'].join('\n');
  return { to, subject: `Dispute Update - Booking ${bookingId}`, html, text };
}

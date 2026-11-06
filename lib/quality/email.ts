import { escapeHtml } from '../booking/receipt.js';
import type { EmailMessage } from '../email/types.js';
import type { Stage } from './stages.js';

// WF5's four Gmail nodes: same subjects and wording, values HTML-escaped,
// sent to the booking's email address.

const SUBJECT: Record<Stage, string> = {
  en_route: 'Your GharFix Provider is On the Way! 🚗',
  arrived: 'Your GharFix Provider Has Arrived! ✅',
  completed: 'Your GharFix Service is Complete! 🎉',
  feedback: 'Thank You for Your Feedback! 🙏',
};

function layout(title: string, intro: string, heading: string, rows: Array<[string, string]>, outro: string): { html: string; text: string } {
  const html =
    '<!DOCTYPE html><html><head><meta charset="UTF-8"></head>' +
    '<body style="font-family: Arial, sans-serif; font-size: 15px; color: #333333; line-height: 1.6; padding: 20px;">' +
    '<div style="max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px;">' +
    `<h2 style="color: #2c5aa0;">${escapeHtml(title)}</h2><p>Dear Valued Customer,</p><p>${escapeHtml(intro)}</p>` +
    `<h3 style="color: #2c5aa0;">${escapeHtml(heading)}</h3><table style="width: 100%;">` +
    rows.map(([k, v]) => `<tr><td style="padding: 4px 12px 4px 0;"><strong>${escapeHtml(k)}:</strong></td><td style="padding: 4px 0;">${escapeHtml(v)}</td></tr>`).join('') +
    `</table><p>${escapeHtml(outro)}</p><p style="margin-top: 30px;">Sincerely,<br><strong>The GharFix Team</strong></p></div></body></html>`;
  const text = ['Dear Valued Customer,', '', intro, '', `${heading}`, ...rows.map(([k, v]) => `${k}: ${v}`), '', outro, '', 'Sincerely,', 'The GharFix Team'].join('\n');
  return { html, text };
}

export function stageEmail(stage: Stage, to: string, b: Record<string, any>): EmailMessage {
  const id = String(b.booking_id);
  let parts: { html: string; text: string };
  if (stage === 'en_route') {
    const eta = b.eta_minutes === null ? 'The provider will share it' : `${b.estimated_arrival_time} (in approximately ${b.eta_minutes} minutes)`;
    parts = layout('Your Provider is On the Way! 🚗', `Good news! Your GharFix provider, ${b.provider_name}, is now en route to your location.`, 'Service Details:',
      [['Booking ID', id], ['Service', String(b.service_type)], ['Estimated Arrival', eta], ['Location', String(b.customer_location)]], 'Please ensure you are ready for their arrival.');
  } else if (stage === 'arrived') {
    parts = layout('Your Provider Has Arrived! ✅', `Your GharFix provider, ${b.provider_name}, has arrived at your location.`, 'Service Details:',
      [['Booking ID', id], ['Service', String(b.service_type)], ['Arrival Time', String(b.arrival_time)], ['Location', String(b.customer_location)]],
      'Your service is about to begin. If you have any questions, please speak directly with your provider.');
  } else if (stage === 'completed') {
    parts = layout('Service Complete! 🎉', `Your GharFix service for Booking ID: ${id} has been successfully completed by ${b.provider_name}.`, 'Service Summary:',
      [['Service', String(b.service_type)], ['Completion Time', String(b.completion_time)], ['Final Price', `PKR ${b.payment.final_pkr} (Quoted: PKR ${b.payment.quoted_pkr})`]],
      'We hope you are satisfied with the service. Please take a moment to provide your valuable feedback — it helps us maintain high-quality service! Thank you for choosing GharFix!');
  } else {
    parts = layout('Thank You for Your Feedback! 🙏', `Thank you for providing your feedback for Booking ID: ${id}.`, 'Your Feedback:',
      [['Rating', `${b.submitted_rating} stars ⭐`], ['Review', String(b.review_text || '-')]],
      'We appreciate you taking the time to share your experience. Your input is invaluable as we continuously strive to improve our services.');
  }
  return { to, subject: `${SUBJECT[stage]} (Booking ID: ${id})`, ...parts };
}

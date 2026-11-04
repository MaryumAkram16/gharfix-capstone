import { describe, expect, it } from 'vitest';
import { buildReceipt, confirmationEmail, escapeHtml, type ReceiptInput } from '../../lib/booking/receipt';

const input: ReceiptInput = {
  bookingId: 'BK-TEST-0001',
  serviceType: 'AC Repair',
  providerId: 'ChIJ-test-provider',
  providerName: 'Ali AC Services',
  bookingDate: '2026-11-10',
  slot: '16:00',
  location: 'DHA Phase 5, Lahore',
  pricePkr: 2500,
  userName: 'Test User',
  userEmail: 'booking-test@example.test',
  createdAt: '2026-11-04T09:00:00.000Z',
};

describe('buildReceipt', () => {
  it('keeps the WF4 receipt shape', () => {
    const r = buildReceipt(input);
    expect(Object.keys(r)).toEqual([
      'booking_id', 'status', 'service', 'provider', 'appointment', 'payment', 'customer',
      'confirmation_lines', 'simulated_whatsapp', 'next_steps', 'workflow', 'created_at',
    ]);
    expect(r).toMatchObject({
      booking_id: 'BK-TEST-0001',
      status: 'confirmed',
      service: 'AC Repair',
      provider: { id: 'ChIJ-test-provider', name: 'Ali AC Services' },
      appointment: { date: '2026-11-10', time: '16:00', time_label: '4:00 PM', location: 'DHA Phase 5, Lahore' },
      payment: { estimated_pkr: 2500, method: 'Cash on service' },
      customer: { name: 'Test User', email: 'booking-test@example.test' },
      workflow: 'WF4-StepB',
      created_at: '2026-11-04T09:00:00.000Z',
    });
    expect(r.confirmation_lines).toHaveLength(8);
    expect(r.confirmation_lines[2]).toBe('📅 2026-11-10 at 4:00 PM');
    expect(r.simulated_whatsapp).toContain('💰 PKR 2500 (cash on delivery)');
  });

  it('prints an empty email line instead of "null" when there is no email', () => {
    const r = buildReceipt({ ...input, userEmail: null });
    expect(r.customer.email).toBeNull();
    expect(r.confirmation_lines[7]).toBe('📧 Email: ');
    expect(r.simulated_whatsapp).not.toContain('null');
  });
});

describe('confirmationEmail', () => {
  it('returns null when there is no address', () => {
    expect(confirmationEmail(buildReceipt({ ...input, userEmail: null }))).toBeNull();
  });

  it('addresses the customer with subject, html and text', () => {
    const mail = confirmationEmail(buildReceipt(input))!;
    expect(mail.to).toBe('booking-test@example.test');
    expect(mail.subject).toBe('Your GharFix Booking is Confirmed! (Booking ID: BK-TEST-0001)');
    expect(mail.html).toContain('<td style="padding: 4px 0;">4:00 PM</td>');
    expect(mail.html).toContain('Provider will call you 1 hour before arrival<br>Keep your phone available');
    expect(mail.text).toContain('Location: DHA Phase 5, Lahore');
  });

  it('escapes user-supplied text in the html body', () => {
    const mail = confirmationEmail(
      buildReceipt({ ...input, userName: '<script>x</script>', location: 'Block "A" & <b>B</b>' }),
    )!;
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('Dear &lt;script&gt;x&lt;/script&gt;,');
    expect(mail.html).toContain('Block &quot;A&quot; &amp; &lt;b&gt;B&lt;/b&gt;');
  });

  it('escapeHtml covers the five special characters', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });
});

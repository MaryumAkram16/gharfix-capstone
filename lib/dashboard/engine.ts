import { pakistanDate } from '../booking/schedule.js';
import { normaliseSlot } from '../booking/slot.js';

// WF8 "Provider Optimization Agent" (Optimization Engine v3) and WF8b's
// batch engine: one computation used by the live dashboard and by the
// nightly provider_scores refresh. Thresholds, tips and formulas are n8n's
// (tests/dashboard/engine.test.ts runs the original nodes). What changed:
//
// - "Completed" means the job was done: status completed / feedback_done, or
//   tracking position completed / feedback_done. n8n counted only
//   status = 'completed', which nothing ever sets (WF5 writes current_status
//   'completed', then status 'feedback_done'), so every provider showed 0
//   completed jobs, 0 earnings and no ratings.
// - The cancellation rate counts the provider's own failures (no_show,
//   provider_cancelled); n8n also counted customers cancelling.
// - No invented platform average: n8n used PKR 1200 when there were no
//   completed jobs, and called a provider with no earnings "FAIR". Here both
//   are NOT_ENOUGH_DATA.
// - Customer emails are masked and names cut to the first name: the
//   dashboard has no login and provider ids are public (OSM / Google ids).
//   n8n returned every repeat customer's email address.
// - "Today" and slots are Pakistan date and normalised "HH:MM" (n8n: UTC
//   date, raw slot strings, so "4:00 PM" never matched "16:00").
// - The profile comes from what the provider's bookings recorded (rating,
//   address, distance, maps link at booking time) instead of re-running
//   provider matching (a paid Google search) on every dashboard view.

export const ALL_SLOTS = ['09:00', '10:00', '11:00', '12:00', '14:00', '15:00', '16:00', '17:00'];
const DONE = ['completed', 'feedback_done'];
const PROVIDER_FAULT = ['provider_cancelled', 'no_show'];

export interface DashBooking {
  booking_id: string;
  user_name?: string | null;
  user_email?: string | null;
  service_type?: string | null;
  provider_id?: string | null;
  provider_name?: string | null;
  location?: string | null;
  slot?: string | null;
  booking_date?: string | null;
  price_pkr?: number | string | null;
  final_price_pkr?: number | string | null;
  status?: string | null;
  current_status?: string | null;
  customer_rating?: number | string | null;
  flagged_for_review?: boolean | null;
  provider_action_locked?: boolean | null;
  tracking_locked?: boolean | null;
  reassigned_to_provider_id?: string | null;
  [k: string]: unknown;
}

export interface Intake {
  provider_id: string;
  provider_name: string;
  base_rate_pkr: number;
  max_daily_bookings: number;
}

export const isDone = (b: DashBooking) => DONE.includes(String(b.status)) || DONE.includes(String(b.current_status));
const isActive = (b: DashBooking) => b.status === 'confirmed' || b.status === 'in_progress';
const price = (b: DashBooking) => {
  const n = parseInt(String(b.final_price_pkr ?? b.price_pkr ?? ''), 10);
  return Number.isFinite(n) ? n : 0;
};

/** "ayesha.k@gmail.com" -> "a***@gmail.com". */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  return at > 0 ? `${email[0]}***${email.slice(at)}` : '***';
}
const firstName = (b: DashBooking) => {
  const n = typeof b.user_name === 'string' ? b.user_name.trim().split(/\s+/)[0] : '';
  return n || (b.user_email ? maskEmail(b.user_email) : 'Customer');
};

/** Platform-wide average per completed job, or null when there is none. */
export function platformAverage(platform: DashBooking[]): number | null {
  const done = platform.filter(isDone);
  return done.length ? Math.round(done.reduce((s, b) => s + price(b), 0) / done.length) : null;
}

export function slotDemand(platform: DashBooking[]): Record<string, number> {
  const demand: Record<string, number> = Object.fromEntries(ALL_SLOTS.map((s) => [s, 0]));
  for (const b of platform) {
    const s = normaliseSlot(b.slot);
    if (s && demand[s] !== undefined) demand[s]++;
  }
  return demand;
}

function uiActions(b: DashBooking, role: string) {
  const base = { show_track_button: false, show_cancel_button: false, show_report_button: false, show_feedback_button: false };
  if (role === 'lost_to_reschedule') return { ...base, show_feedback_button: true, primary_label: 'Booking Reassigned', secondary_label: 'Leave Feedback', reason: 'booking_rescheduled_to_new_provider' };
  if ((b.status === 'provider_cancelled' || b.status === 'rescheduled') && b.provider_action_locked) {
    return { ...base, show_feedback_button: true, primary_label: b.status === 'rescheduled' ? 'Booking Reassigned' : 'Cancelled', secondary_label: 'Leave Feedback', reason: b.status === 'rescheduled' ? 'booking_rescheduled_to_new_provider' : 'booking_cancelled_by_provider' };
  }
  if (isDone(b)) return { ...base, show_report_button: true, show_feedback_button: true, primary_label: 'Completed', secondary_label: 'Leave Feedback', reason: 'booking_completed' };
  if (isActive(b)) return { ...base, show_track_button: !b.tracking_locked, show_cancel_button: true, primary_label: b.status === 'in_progress' ? 'In Progress' : 'Track', secondary_label: 'Cancel', reason: 'booking_active' };
  return { ...base, primary_label: b.status || 'Unknown', secondary_label: null, reason: 'unknown_status' };
}

export interface Profile {
  provider_name: string;
  google_rating: number | null;
  review_count: number | null;
  address: string | null;
  distance_km: number | null;
  verified: boolean | null;
  reputation_score: number | null;
  google_maps_url: string | null;
  source: 'booking_snapshot' | 'unavailable';
  note?: string;
}

/** The provider details the most recent booking recorded. */
export function profileFrom(bookings: DashBooking[], providerId: string, fallbackName: string): Profile {
  const n = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
  const mine = bookings.filter((b) => b.provider_id === providerId).sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')));
  const b = mine[0];
  if (!b) return { provider_name: fallbackName, google_rating: null, review_count: null, address: null, distance_km: null, verified: null, reputation_score: null, google_maps_url: null, source: 'unavailable', note: 'No bookings for this provider yet.' };
  return {
    provider_name: b.provider_name || fallbackName,
    google_rating: n(b.provider_rating),
    review_count: n(b.provider_review_count),
    address: typeof b.provider_address === 'string' ? b.provider_address : null,
    distance_km: n(b.provider_distance_km),
    verified: typeof b.provider_verified === 'boolean' ? b.provider_verified : null,
    reputation_score: n(b.provider_reputation_score),
    google_maps_url: typeof b.provider_google_maps_url === 'string' && b.provider_google_maps_url ? b.provider_google_maps_url : null,
    source: 'booking_snapshot',
  };
}

export function computeDashboard(intake: Intake, rawBookings: DashBooking[], platformBookings: DashBooking[], now: Date) {
  const me = intake.provider_id;
  const today = pakistanDate(now);
  const max = intake.max_daily_bookings;
  const profile = profileFrom(rawBookings, me, intake.provider_name);

  const myOriginal = rawBookings.filter((b) => b.provider_id === me && b.reassigned_to_provider_id !== me);
  const reassignedToMe = rawBookings.filter((b) => b.reassigned_to_provider_id === me);
  const lost = myOriginal.filter((b) => b.status === 'rescheduled' && b.provider_action_locked);
  const earning = [...myOriginal.filter(isDone), ...reassignedToMe.filter(isDone)];

  // 1. Workload
  const confirmedToday = [
    ...myOriginal.filter((b) => b.booking_date === today && isActive(b) && !b.provider_action_locked),
    ...reassignedToMe.filter((b) => b.booking_date === today && isActive(b)),
  ];
  const utilizationRate = Math.round((confirmedToday.length / max) * 100);
  const workloadStatus = utilizationRate >= 100 ? 'FULL' : utilizationRate >= 75 ? 'BUSY' : utilizationRate >= 50 ? 'MODERATE' : 'AVAILABLE';
  const bookedSlotsToday = confirmedToday.map((b) => normaliseSlot(b.slot) ?? String(b.slot));
  const openSlotsToday = ALL_SLOTS.filter((s) => !bookedSlotsToday.includes(s));

  // 2. Earnings
  const totalEarnings = earning.reduce((s, b) => s + price(b), 0);
  const avgPerJob = earning.length ? Math.round(totalEarnings / earning.length) : 0;
  const platformAvg = platformAverage(platformBookings);
  const earningIndex = avgPerJob > 0 && platformAvg ? Number((avgPerJob / platformAvg).toFixed(2)) : null;
  const earningFairness = earningIndex === null ? 'NOT_ENOUGH_DATA' : earningIndex >= 0.9 ? 'FAIR' : earningIndex >= 0.7 ? 'BELOW_AVERAGE' : 'LOW';

  // 3. Reputation (in-app ratings first, else the rating recorded at booking time)
  const ratings = earning.map((b) => b.customer_rating).filter((r) => r !== null && r !== undefined && r !== '').map((r) => parseFloat(String(r)));
  const inAppAvg = ratings.length ? Number((ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(2)) : null;
  const avgRating = inAppAvg ?? profile.google_rating;
  const ratingSource = inAppAvg !== null ? 'in_app' : profile.google_rating !== null ? 'recorded_at_booking' : null;
  const flaggedCount = rawBookings.filter((b) => b.flagged_for_review === true).length;
  const fiveStar = ratings.filter((r) => r === 5).length;
  const lowRating = ratings.filter((r) => r <= 2).length;
  const reputationHealth = flaggedCount > 3 ? 'AT_RISK' : flaggedCount > 1 ? 'MONITOR' : avgRating === null ? 'NEW' : avgRating >= 4.5 ? 'EXCELLENT' : avgRating >= 3.5 ? 'GOOD' : 'NEEDS_IMPROVEMENT';

  // 4. Cancellations (the provider's own)
  const cancelled = myOriginal.filter((b) => PROVIDER_FAULT.includes(String(b.status)));
  const totalBookings = myOriginal.length;
  const cancellationRate = totalBookings ? Number((cancelled.length / totalBookings).toFixed(2)) : 0;
  const cancellationStatus = cancellationRate > 0.2 ? 'HIGH_RISK' : cancellationRate > 0.1 ? 'WARNING' : 'GOOD';

  // 5. Loyalty
  const counts = new Map<string, number>();
  for (const b of earning) if (b.user_email) counts.set(b.user_email.toLowerCase(), (counts.get(b.user_email.toLowerCase()) ?? 0) + 1);
  const repeat = [...counts.entries()].filter(([, c]) => c >= 2).map(([email, c]) => ({ email: maskEmail(email), bookings: c }));
  const loyaltyInsight = repeat.length ? `${repeat.length} repeat customer(s) detected. Loyalty discounts could boost retention.` : 'No repeat customers yet — focus on getting your first repeat booking.';

  // 6. Demand
  const demand = slotDemand(platformBookings);
  const recommendedSlots = Object.entries(demand).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([slot, count]) => {
    const h = Number(slot.slice(0, 2));
    return {
      slot,
      label: `${h > 12 ? h - 12 : h}:00 ${h >= 12 ? 'PM' : 'AM'}`,
      demand_score: count,
      is_open_today: openSlotsToday.includes(slot),
      recommendation: count >= 3 ? 'HIGH DEMAND — stay available' : count >= 1 ? 'MODERATE DEMAND — good to keep open' : 'LOW DEMAND',
    };
  });

  // 7. Rate
  const baseRate = intake.base_rate_pkr;
  const rateSuggestion = earningFairness === 'LOW'
    ? { current_base_rate: baseRate, suggested_base_rate: Math.round((platformAvg as number) * 0.85), reason: 'Avg earning is significantly below platform average. Rate increase recommended.', loyalty_discount_suggestion: 'Offer 5% off to repeat customers while increasing base rate.' }
    : earningFairness === 'BELOW_AVERAGE'
      ? { current_base_rate: baseRate, suggested_base_rate: Math.round(baseRate * 1.1), reason: 'Slightly below platform average. A 10% rate increase is recommended.', loyalty_discount_suggestion: 'Offer 5% off to repeat customers to balance the increase.' }
      : {
          current_base_rate: baseRate,
          suggested_base_rate: baseRate,
          reason: earningFairness === 'FAIR' ? 'Rate is fair relative to platform average. No change needed.' : 'Not enough completed jobs yet to compare with the platform.',
          loyalty_discount_suggestion: repeat.length ? `Consider a 5% loyalty discount for your ${repeat.length} repeat customer(s).` : null,
        };

  const tips = [
    utilizationRate === 0 ? '🔔 No bookings today — you are visible for urgent same-day requests.' : utilizationRate < 50 ? `📅 Only ${confirmedToday.length}/${max} slots filled today.` : null,
    earningFairness === 'LOW' || earningFairness === 'BELOW_AVERAGE' ? `💰 Your avg earning (PKR ${avgPerJob}) is below platform avg (PKR ${platformAvg}).` : null,
    recommendedSlots[0]?.is_open_today && recommendedSlots[0].demand_score > 0 ? `⏰ Peak slot ${recommendedSlots[0].slot} is still open today!` : null,
    earning.length < 5 ? '⭐ Complete more jobs to build your rating history.' : null,
    lowRating > 0 ? `⚠️ ${lowRating} low rating(s) detected. Review your service checklist.` : null,
    flaggedCount > 0 ? `🚩 ${flaggedCount} booking(s) flagged for review. Address disputes to protect ranking.` : null,
    cancellationStatus !== 'GOOD' ? `❌ Cancellation rate ${(cancellationRate * 100).toFixed(0)}% is ${cancellationStatus}.` : null,
    repeat.length ? `🔁 ${loyaltyInsight}` : null,
    lost.length ? `🔄 ${lost.length} booking(s) were reassigned away — maintain availability to avoid this.` : null,
    `📊 Utilization today: ${utilizationRate}% (${confirmedToday.length}/${max} slots)`,
  ].filter((t): t is string => t !== null);

  const entry = (b: DashBooking, role: string) => ({
    booking_id: b.booking_id,
    service_type: b.service_type,
    booking_date: b.booking_date,
    slot: normaliseSlot(b.slot) ?? b.slot,
    user_name: firstName(b),
    location: b.location,
    status: b.status,
    price_pkr: price(b),
    provider_action_locked: role === 'lost_to_reschedule' ? true : !!b.provider_action_locked,
    tracking_locked: role === 'lost_to_reschedule' ? true : !!b.tracking_locked,
    role,
    ui_actions: uiActions(b, role),
  });
  const bookingsList = [
    ...myOriginal.filter((b) => !lost.includes(b)).map((b) => entry(b, 'original')),
    ...reassignedToMe.map((b) => entry(b, 'reassigned_to_me')),
    ...lost.map((b) => entry(b, 'lost_to_reschedule')),
  ];

  return {
    status: 'provider_dashboard',
    provider_id: me,
    provider_name: profile.provider_name,
    date: today,
    profile,
    workload: {
      bookings_today: confirmedToday.length, max_capacity: max, utilization_rate_pct: utilizationRate, status: workloadStatus,
      slots_booked_today: bookedSlotsToday, slots_open_today: openSlotsToday, slots_remaining: openSlotsToday.length,
    },
    earnings: {
      total_completed_jobs: earning.length, total_earnings_pkr: totalEarnings, avg_per_job_pkr: avgPerJob, platform_avg_pkr: platformAvg,
      earning_index: earningIndex, earning_fairness: earningFairness, note: 'Includes earnings from bookings reassigned to this provider via WF7',
    },
    reputation: {
      avg_rating: avgRating, rating_source: ratingSource, google_rating: profile.google_rating, google_review_count: profile.review_count ?? 0,
      in_app_avg_rating: inAppAvg, total_in_app_ratings: ratings.length, five_star_count: fiveStar, low_rating_count: lowRating,
      flagged_bookings: flaggedCount, reputation_health: reputationHealth,
    },
    cancellations: { total_cancelled: cancelled.length, cancellation_rate_pct: Math.round(cancellationRate * 100), status: cancellationStatus },
    reschedule_impact: {
      bookings_lost_to_reschedule: lost.length, bookings_gained_from_reschedule: reassignedToMe.length, net_reschedule_impact: reassignedToMe.length - lost.length,
      note: lost.length ? `${lost.length} booking(s) were rescheduled away from you. These no longer appear in your active workload.` : 'No bookings rescheduled away from you.',
    },
    loyalty: { repeat_customers: repeat.length, repeat_customer_list: repeat.slice(0, 5), insight: loyaltyInsight, suggested_discount_pct: repeat.length ? 5 : 0 },
    demand_forecast: {
      recommended_slots: recommendedSlots,
      peak_insight: recommendedSlots[0]?.demand_score ? `Peak demand is at ${recommendedSlots[0].slot}. Being available then maximizes bookings.` : 'Not enough bookings yet to show peak times.',
    },
    bookings: bookingsList,
    rate_optimization: rateSuggestion,
    optimization_tips: tips,
    simulated_whatsapp:
      `Provider Dashboard — GharFix\nDate: ${today}\nWorkload: ${confirmedToday.length}/${max} (${workloadStatus})\n` +
      `Earnings avg: PKR ${avgPerJob} (${earningFairness})\nRating: ${avgRating ?? 'No ratings yet'}/5 (${reputationHealth})\n` +
      `Reschedule: -${lost.length} lost / +${reassignedToMe.length} gained\nTop tip: ${tips[0] ?? 'Keep it up!'}`,
    workflow: 'WF8-ProviderOptimization-v3',
    timestamp: now.toISOString(),
  };
}

export type Dashboard = ReturnType<typeof computeDashboard>;

/** WF8b: one provider_scores row per provider, from the same computation. */
export function scoreRow(d: Dashboard) {
  const row = {
    provider_id: d.provider_id,
    provider_name: d.provider_name,
    computed_at: d.timestamp,
    utilization_rate_pct: d.workload.utilization_rate_pct,
    workload_status: d.workload.status,
    slots_open_today: d.workload.slots_open_today,
    total_completed_jobs: d.earnings.total_completed_jobs,
    total_earnings_pkr: d.earnings.total_earnings_pkr,
    avg_per_job_pkr: d.earnings.avg_per_job_pkr,
    platform_avg_pkr: d.earnings.platform_avg_pkr,
    earning_fairness: d.earnings.earning_fairness,
    avg_rating: d.reputation.avg_rating,
    reputation_health: d.reputation.reputation_health,
    flagged_bookings: d.reputation.flagged_bookings,
    cancellation_rate_pct: d.cancellations.cancellation_rate_pct,
    cancellation_status: d.cancellations.status,
    repeat_customers: d.loyalty.repeat_customers,
    recommended_slots: d.demand_forecast.recommended_slots,
    optimization_tips: d.optimization_tips,
    rate_optimization: d.rate_optimization,
  };
  return { ...row, raw: row };
}

/** Every provider that owns or was reassigned a booking. */
export function providerIds(all: DashBooking[]): string[] {
  const ids = new Set<string>();
  for (const b of all) {
    if (b.provider_id) ids.add(b.provider_id);
    if (b.reassigned_to_provider_id) ids.add(b.reassigned_to_provider_id);
  }
  return [...ids];
}

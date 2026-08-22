import { motion, AnimatePresence } from 'motion/react';
import { useState, useEffect, MouseEvent } from 'react';
import {
  CalendarCheck, MapPin, Clock, ShieldCheck, ChevronRight,
  CheckCircle2, AlertCircle, Inbox, Copy, Phone, MessageSquare,
  XCircle, Flag, RefreshCw, Star, Loader2,
  TriangleAlert, CalendarX, Navigation2, Hash, X, Filter, UserX
} from 'lucide-react';
import { AppLanguage } from '../App';
import { getUserProfile } from '../lib/profile';
import { ProviderCancelSheet } from './ProviderCancelSheet';

export interface SavedBooking {
  booking_id: string;
  provider_name: string;
  provider_id?: string;
  service_type: string;
  location: string;
  slot: string;
  booking_date: string;
  price_pkr: number;
  status: 'confirmed' | 'pending' | 'completed' | 'cancelled' | 'rescheduled';
  saved_at: string;
  next_steps?: string[];
  alternatives?: any[];
  user_email?: string;
  rescheduled_to?: {
    booking_id: string;
    provider_name: string;
    provider_id?: string;
    slot: string;
    slot_label?: string;
    date: string;
  };
  dispute_result?: any;
}

const STORAGE_KEY = 'khidmatgaar_bookings';

export function saveBookingToStorage(receipt: any, payload: any) {
  try {
    const existing = getBookingsFromStorage();
    const booking: SavedBooking = {
      booking_id: receipt.booking_id || `BK-${Date.now()}`,
      provider_name: receipt.provider?.name || payload?.provider_name || 'Provider',
      provider_id: payload?.provider_id || receipt.provider?.id || '',
      service_type: receipt.service || payload?.service_type || 'Service',
      location: receipt.appointment?.location || payload?.location || '',
      slot: receipt.appointment?.time_label || receipt.appointment?.time || payload?.slot || '',
      booking_date: receipt.appointment?.date || payload?.booking_date || '',
      price_pkr: receipt.payment?.estimated_pkr || payload?.price_pkr || 0,
      status: 'confirmed',
      saved_at: new Date().toISOString(),
      next_steps: receipt.next_steps || [],
      alternatives: payload?.alternatives || receipt.alternatives || [],
      user_email: payload?.user_email || '',
    };
    const filtered = existing.filter(b => b.booking_id !== booking.booking_id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify([booking, ...filtered]));
  } catch (e) {
    console.error('Failed to save booking:', e);
  }
}

export function getBookingsFromStorage(): SavedBooking[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function updateBookingInStorage(booking_id: string, updates: Partial<SavedBooking>) {
  try {
    const existing = getBookingsFromStorage();
    const updated = existing.map(b => b.booking_id === booking_id ? { ...b, ...updates } : b);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (e) {
    console.error('Failed to update booking:', e);
  }
}

function deleteBookingFromStorage(booking_id: string) {
  try {
    const existing = getBookingsFromStorage();
    const filtered = existing.filter(b => b.booking_id !== booking_id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  } catch (e) {
    console.error('Failed to delete booking:', e);
  }
}

function formatSlotLabel(time: string) {
  if (!time) return '';
  if (time.includes('AM') || time.includes('PM')) return time;
  const [h, m] = time.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${hour}:${String(m).padStart(2, '0')} ${period}`;
}

function StatusBadge({ status }: { status: SavedBooking['status'] }) {
  const map: Record<string, { label: string; cls: string }> = {
    confirmed:   { label: 'Confirmed',   cls: 'bg-secondary/10 text-secondary' },
    pending:     { label: 'Pending',     cls: 'bg-yellow-100 text-yellow-700' },
    completed:   { label: 'Completed',   cls: 'bg-primary/10 text-primary' },
    cancelled:   { label: 'Cancelled',   cls: 'bg-error/10 text-error' },
    rescheduled: { label: 'Rescheduled', cls: 'bg-purple-100 text-purple-700' },
  };
  const { label, cls } = map[status] || map.confirmed;
  return (
    <span className={`text-[9px] font-black px-2.5 py-1 rounded-full uppercase tracking-widest ${cls}`}>{label}</span>
  );
}

// ─── Dispute Types ────────────────────────────────────────────────────────────
const DISPUTE_TYPES = [
  { id: 'no_show',            label: 'Provider Never Arrived',  icon: CalendarX,      desc: 'Provider did not show up' },
  { id: 'quality_complaint',  label: 'Poor Quality of Work',    icon: Star,           desc: 'Work was unsatisfactory' },
  { id: 'price_disagreement', label: 'Overcharged',             icon: TriangleAlert,  desc: 'Charged more than quoted' },
  { id: 'provider_cancelled', label: 'Provider Cancelled',      icon: XCircle,        desc: 'Provider cancelled after confirmation' },
  { id: 'other',              label: 'Other Reason',            icon: Flag,           desc: 'Describe below' },
];

function DisputeSheet({ booking, onClose, onSuccess }: { booking: SavedBooking; onClose: () => void; onSuccess: () => void }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [otherText, setOtherText] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');

  const canSubmit = !!selected && (selected !== 'other' || otherText.trim().length > 5);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setLoading(true); setError('');
    try {
      const payload = {
        dispute_type: selected === 'other' ? 'quality_complaint' : selected,
        custom_reason: selected === 'other' ? otherText.trim() : undefined,
        review: selected === 'other' ? otherText.trim() : undefined,
        booking_id: booking.booking_id,
        provider_id: booking.provider_id || booking.provider_name.toLowerCase().replace(/\s+/g, '_'),
        provider_name: booking.provider_name,
        service_type: booking.service_type,
        location: booking.location,
        booking_date: booking.booking_date,
        price_pkr: booking.price_pkr,
        slot: booking.slot,
        alternatives: booking.alternatives || [],
        user_email: booking.user_email || getUserProfile()?.email || '',
      };
      const res = await fetch('/api/proxy', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: 'khadmat-dispute', ...payload }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      let json: any = {};
      try { if (text) { let p = JSON.parse(text); json = Array.isArray(p) && p.length === 1 ? p[0] : p; } } catch { json = { status: 'dispute_resolved' }; }
      setResult(json);
      updateBookingInStorage(booking.booking_id, { dispute_result: json });
      onSuccess();
    } catch { setError('Network error. Please try again.'); }
    finally { setLoading(false); }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-end justify-center"
      style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className="w-full max-w-md bg-white rounded-t-[2rem] p-6 pb-10 space-y-5 shadow-2xl max-h-[90vh] overflow-y-auto"
      >
        <div className="w-10 h-1 bg-outline-variant/40 rounded-full mx-auto" />
        {!result ? (
          <>
            <div>
              <h2 className="text-lg font-black text-on-surface">Report an Issue</h2>
              <p className="text-xs text-outline mt-1">Booking #{booking.booking_id} · {booking.provider_name}</p>
            </div>
            <div className="space-y-2">
              {DISPUTE_TYPES.map(dt => {
                const Icon = dt.icon;
                const isSel = selected === dt.id;
                return (
                  <button key={dt.id} onClick={() => setSelected(dt.id)}
                    className={`w-full flex items-center gap-3 p-4 rounded-2xl border-2 text-left transition-all active:scale-[0.98] ${isSel ? 'border-error bg-error/5' : 'border-outline-variant/30 hover:border-outline-variant/60'}`}
                  >
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${isSel ? 'bg-error/10' : 'bg-surface-container-low'}`}>
                      <Icon className={`w-5 h-5 ${isSel ? 'text-error' : 'text-outline'}`} />
                    </div>
                    <div>
                      <p className={`text-sm font-bold ${isSel ? 'text-error' : 'text-on-surface'}`}>{dt.label}</p>
                      <p className="text-[10px] text-outline mt-0.5">{dt.desc}</p>
                    </div>
                    {isSel && <CheckCircle2 className="w-4 h-4 text-error ml-auto shrink-0" />}
                  </button>
                );
              })}
            </div>
            {selected === 'other' && (
              <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="space-y-1.5">
                <label className="text-[10px] font-black text-outline uppercase tracking-widest">Describe your issue <span className="text-error">*</span></label>
                <textarea value={otherText} onChange={e => setOtherText(e.target.value)}
                  placeholder="Please describe what happened..."
                  rows={4}
                  className="w-full rounded-2xl border-2 border-outline-variant/30 focus:border-error bg-surface-container-lowest px-4 py-3 text-sm text-on-surface placeholder:text-outline/50 resize-none outline-none transition-colors"
                />
              </motion.div>
            )}
            {error && <p className="text-xs text-error font-bold text-center">{error}</p>}
            <button onClick={handleSubmit} disabled={!canSubmit || loading}
              className="w-full py-4 bg-error text-white rounded-2xl font-black text-sm shadow-lg shadow-error/20 flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 transition-all"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Flag className="w-4 h-4" />}
              {loading ? 'Submitting...' : 'Submit Complaint'}
            </button>
            <button onClick={onClose} className="w-full text-center text-xs text-outline font-medium py-2">Cancel</button>
          </>
        ) : (
          <div className="flex flex-col items-center text-center space-y-4 py-2">
            <div className={`w-16 h-16 rounded-full flex items-center justify-center ${result.status === 'dispute_resolved' ? 'bg-secondary/10' : 'bg-yellow-100'}`}>
              {result.status === 'dispute_resolved' ? <CheckCircle2 className="w-8 h-8 text-secondary" /> : <AlertCircle className="w-8 h-8 text-yellow-600" />}
            </div>
            <div>
              <h3 className="text-lg font-black text-on-surface">{result.status === 'escalated_to_human' ? 'Escalated to Team' : 'Complaint Filed'}</h3>
              <p className="text-xs text-outline mt-1 leading-relaxed max-w-xs mx-auto">{result.customer_message || 'Your complaint has been recorded.'}</p>
            </div>
            <button onClick={onClose} className="w-full py-4 bg-on-surface text-white rounded-2xl font-black text-sm active:scale-95 transition-all">Done</button>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

function CancelSheet({ booking, onClose, onSuccess }: { booking: SavedBooking; onClose: () => void; onSuccess: () => void }) {
  const [loading, setLoading] = useState<'reschedule' | 'cancel' | null>(null);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');

  const currentBookingId = (booking.status === 'rescheduled' && booking.rescheduled_to?.booking_id) || booking.booking_id;
  const currentProviderName = (booking.status === 'rescheduled' && booking.rescheduled_to?.provider_name) || booking.provider_name;
  const currentProviderId = (booking.status === 'rescheduled' && booking.rescheduled_to?.provider_id) || (booking.provider_id || booking.provider_name.toLowerCase().replace(/\s+/g, '_'));
  const currentSlot = (booking.status === 'rescheduled' && booking.rescheduled_to?.slot) || booking.slot;
  const currentDate = (booking.status === 'rescheduled' && booking.rescheduled_to?.date) || booking.booking_date;

  // Option A: Cancel Only — no replacement, just mark cancelled
  const handleCancelOnly = async () => {
    setLoading('cancel'); setError('');
    try {
      await fetch('/api/proxy', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: 'khadmat-reschedule',
          action: 'cancel_only',
          booking_id: currentBookingId,
          provider_id: currentProviderId,
          provider_name: currentProviderName,
          service_type: booking.service_type,
          location: booking.location,
          booking_date: currentDate,
          price_pkr: booking.price_pkr,
          slot: currentSlot,
          user_email: booking.user_email || getUserProfile()?.email || '',
        }),
      });
    } catch { /* still cancel locally */ }
    updateBookingInStorage(booking.booking_id, { status: 'cancelled' });
    setResult({ status: 'cancelled' });
    setLoading(null);
    onSuccess();
  };

    // Option B: Cancel & Auto-Reschedule — find next best provider
    const handleReschedule = async () => {
      setLoading('reschedule'); setError('');
      try {
        const res = await fetch('/api/proxy', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            endpoint: 'khadmat-reschedule',
            action: 'reschedule',
            booking_id: currentBookingId,
            provider_id: currentProviderId,
            provider_name: currentProviderName,
            service_type: booking.service_type,
            location: booking.location,
            booking_date: currentDate,
            price_pkr: booking.price_pkr,
            slot: currentSlot,
            alternatives: booking.alternatives || [],
            user_email: booking.user_email || getUserProfile()?.email || '',
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        let json: any = {};
        try { if (text) { let p = JSON.parse(text); json = Array.isArray(p) && p.length === 1 ? p[0] : p; } } catch { json = { status: 'cancelled' }; }
        setResult(json);
        if (json.status === 'rescheduled' && json.new_booking) {
          updateBookingInStorage(booking.booking_id, {
            status: 'rescheduled',
            rescheduled_to: {
              booking_id: json.new_booking.booking_id,
              provider_name: json.new_booking.provider,
              provider_id: json.new_booking.provider_id,
              slot: json.new_booking.slot,
              slot_label: json.new_booking.slot_label,
              date: json.new_booking.date,
            },
          });
        } else if (json.status === 'cancelled') {
          updateBookingInStorage(booking.booking_id, { status: 'cancelled' });
        }
        onSuccess();
      } catch { setError('Network error. Please try again.'); }
      finally { setLoading(null); }
    };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-end justify-center"
      style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className="w-full max-w-md bg-white rounded-t-[2rem] p-6 pb-10 space-y-5 shadow-2xl max-h-[90vh] overflow-y-auto"
      >
        <div className="w-10 h-1 bg-outline-variant/40 rounded-full mx-auto" />

        {!result ? (
          <>
            {/* Header */}
            <div className="flex flex-col items-center text-center space-y-3 pt-2">
              <div className="w-16 h-16 bg-error/10 rounded-full flex items-center justify-center">
                <CalendarX className="w-8 h-8 text-error" />
              </div>
              <div>
                <h2 className="text-lg font-black text-on-surface">Cancel Booking?</h2>
                <p className="text-xs text-outline mt-1">Choose how you'd like to proceed</p>
              </div>
            </div>

            {/* Booking summary */}
            <div className="bg-surface-container-low rounded-2xl p-4 space-y-2 border border-outline-variant/20">
              <div className="flex justify-between text-xs"><span className="text-outline font-medium">Provider</span><span className="font-bold text-on-surface">{currentProviderName}</span></div>
              <div className="flex justify-between text-xs"><span className="text-outline font-medium">Service</span><span className="font-bold text-on-surface capitalize">{booking.service_type}</span></div>
              <div className="flex justify-between text-xs"><span className="text-outline font-medium">Date & Time</span><span className="font-bold text-on-surface">{currentDate} · {formatSlotLabel(currentSlot)}</span></div>
            </div>

            {error && <p className="text-xs text-error font-bold text-center">{error}</p>}

            {/* Option A — Cancel & Auto-Reschedule */}
            <button
              onClick={handleReschedule}
              disabled={!!loading}
              className="w-full p-4 rounded-2xl border-2 border-primary/20 bg-primary/5 text-left flex items-start gap-4 hover:bg-primary/10 active:scale-[0.98] transition-all disabled:opacity-50"
            >
              <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center shrink-0 mt-0.5">
                {loading === 'reschedule'
                  ? <Loader2 className="w-5 h-5 text-primary animate-spin" />
                  : <RefreshCw className="w-5 h-5 text-primary" />}
              </div>
              <div>
                <p className="text-sm font-black text-primary">Cancel & Auto-Reschedule</p>
                <p className="text-[11px] text-on-surface-variant mt-0.5 leading-snug">
                  We'll instantly find and book the next best available provider for your slot.
                </p>
              </div>
            </button>

            {/* Option B — Cancel Only */}
            <button
              onClick={handleCancelOnly}
              disabled={!!loading}
              className="w-full p-4 rounded-2xl border-2 border-error/20 bg-error/5 text-left flex items-start gap-4 hover:bg-error/10 active:scale-[0.98] transition-all disabled:opacity-50"
            >
              <div className="w-10 h-10 bg-error/10 rounded-xl flex items-center justify-center shrink-0 mt-0.5">
                {loading === 'cancel'
                  ? <Loader2 className="w-5 h-5 text-error animate-spin" />
                  : <XCircle className="w-5 h-5 text-error" />}
              </div>
              <div>
                <p className="text-sm font-black text-error">Cancel Only</p>
                <p className="text-[11px] text-on-surface-variant mt-0.5 leading-snug">
                  Just cancel this booking. No replacement will be made.
                </p>
              </div>
            </button>

            <button
              onClick={onClose}
              disabled={!!loading}
              className="w-full py-3 text-center text-xs text-outline font-medium hover:text-on-surface transition-colors disabled:opacity-40"
            >
              Keep My Booking
            </button>
          </>
        ) : (
          /* Result screen */
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
            <div className="flex flex-col items-center text-center space-y-3 py-2">
              <div className={`w-16 h-16 rounded-full flex items-center justify-center ${
                result.status === 'rescheduled' ? 'bg-secondary/10'
                : result.status === 'cancelled' ? 'bg-error/10'
                : 'bg-yellow-100'
              }`}>
                {result.status === 'rescheduled'
                  ? <CheckCircle2 className="w-8 h-8 text-secondary" />
                  : result.status === 'cancelled'
                  ? <XCircle className="w-8 h-8 text-error" />
                  : <Clock className="w-8 h-8 text-yellow-600" />}
              </div>
              <div>
                <h3 className="text-lg font-black text-on-surface">
                  {result.status === 'rescheduled' ? 'Auto-Rescheduled!'
                    : result.status === 'cancelled' ? 'Booking Cancelled'
                    : 'No Alternative Found'}
                </h3>
                <p className="text-xs text-outline mt-1 leading-relaxed max-w-xs mx-auto">
                  {result.status === 'rescheduled'
                    ? 'We found and booked the next best provider automatically.'
                    : result.status === 'cancelled'
                    ? 'Your booking has been cancelled successfully.'
                    : 'No alternatives available. Full refund has been approved.'}
                </p>
              </div>
            </div>

            {result.status === 'rescheduled' && result.new_booking && (
              <div className="bg-secondary/5 border border-secondary/20 rounded-2xl p-4 space-y-3">
                <p className="text-[10px] font-black text-secondary uppercase tracking-widest">New Booking Details</p>
                <div className="bg-white border border-secondary/20 rounded-xl px-3 py-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Hash className="w-3.5 h-3.5 text-secondary shrink-0" />
                    <span className="text-[9px] font-black text-secondary uppercase tracking-widest">New Booking ID</span>
                  </div>
                  <span className="font-mono text-xs font-black text-on-surface">{result.new_booking.booking_id}</span>
                </div>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-outline">New Provider</span>
                    <span className="font-bold text-on-surface">{result.new_booking.provider}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-outline">Date & Time</span>
                    <span className="font-bold text-on-surface">{result.new_booking.date} · {result.new_booking.slot_label || formatSlotLabel(result.new_booking.slot)}</span>
                  </div>
                  {result.compensation?.eligible && (
                    <div className="flex justify-between">
                      <span className="text-outline">Compensation</span>
                      <span className="font-bold text-secondary">PKR {result.compensation.amount_pkr} credit</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            <button onClick={onClose} className="w-full py-4 bg-on-surface text-white rounded-2xl font-black text-sm active:scale-95 transition-all">Done</button>
          </motion.div>
        )}
      </motion.div>
    </motion.div>
  );
}

// ─── Booking Card ─────────────────────────────────────────────────────────────
function BookingCard({ booking, onExpand, expanded, onRefresh, onTrack }: {
  key?: string | number;
  booking: SavedBooking;
  onExpand: () => void;
  expanded: boolean;
  onRefresh: () => void;
  onTrack?: (payload: any) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [copiedField, setCopiedField] = useState<string>('');
  const [showCancel, setShowCancel] = useState(false);
  const [showProviderCancel, setShowProviderCancel] = useState(false);
  const [showDispute, setShowDispute] = useState(false);

  const handleCopy = (e: MouseEvent, text: string, field: string) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true); setCopiedField(field);
      setTimeout(() => { setCopied(false); setCopiedField(''); }, 2000);
    });
  };

  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleDelete = (e: MouseEvent) => {
    e.stopPropagation();
    if (!confirmDelete) {
      setConfirmDelete(true);
      // Reset confirmation state after 3 seconds if not clicked again
      setTimeout(() => setConfirmDelete(false), 3000);
      return;
    }
    deleteBookingFromStorage(booking.booking_id);
    onRefresh();
    setConfirmDelete(false);
  };

  const userProfile = getUserProfile();
  const isProvider = userProfile?.role === 'provider';
  const isTrackable = booking.status === 'confirmed' || booking.status === 'rescheduled';

  const handleTrackClick = (e: MouseEvent) => {
    e.stopPropagation();
    if (!onTrack) return;
    const b = booking.status === 'rescheduled' && booking.rescheduled_to
      ? { booking_id: booking.rescheduled_to.booking_id, provider_id: booking.rescheduled_to.provider_id || booking.provider_id, provider_name: booking.rescheduled_to.provider_name, service_type: booking.service_type, location: booking.location, price_pkr: booking.price_pkr, user_email: booking.user_email || getUserProfile()?.email || '' }
      : { booking_id: booking.booking_id, provider_id: booking.provider_id, provider_name: booking.provider_name, service_type: booking.service_type, location: booking.location, price_pkr: booking.price_pkr, user_email: booking.user_email || getUserProfile()?.email || '' };
    onTrack(b);
  };

  const borderColor = {
    confirmed: 'border-l-secondary', pending: 'border-l-yellow-400',
    completed: 'border-l-primary', cancelled: 'border-l-error', rescheduled: 'border-l-purple-400',
  }[booking.status] ?? 'border-l-outline-variant';

  return (
    <>
      <motion.div layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
        className={`glass-card rounded-[2rem] border bg-white/90 shadow-sm overflow-hidden border-l-[4px] ${borderColor}`}
      >
        {/* Card Summary Row */}
        <div onClick={onExpand} className="w-full p-5 flex items-center justify-between gap-3 text-left cursor-pointer hover:bg-surface-container-low transition-colors">
          <div className="flex items-center gap-4 flex-1 min-w-0">
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 shadow-inner ${booking.status === 'confirmed' ? 'bg-secondary/10' : 'bg-primary/10'}`}>
              <span className={`text-lg font-black ${booking.status === 'confirmed' ? 'text-secondary' : 'text-primary'}`}>{booking.provider_name.charAt(0)}</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                <h3 className="text-sm font-black text-on-surface truncate">{booking.provider_name}</h3>
                <StatusBadge status={booking.status} />
              </div>
              <p className="text-[10px] text-outline font-medium capitalize truncate">{booking.service_type}</p>
              <div className="flex items-center gap-1 mt-0.5">
                <Clock className="w-3 h-3 text-on-surface-variant/60" />
                <span className="text-[10px] text-on-surface-variant font-medium">{booking.booking_date} · {formatSlotLabel(booking.slot)}</span>
              </div>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2 shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-black text-on-surface">PKR {booking.price_pkr.toLocaleString()}</span>
              <button
                onClick={handleDelete}
                className={`w-7 h-7 flex items-center justify-center rounded-full transition-all duration-200 ${
                  confirmDelete 
                    ? 'bg-error text-white scale-110 shadow-lg' 
                    : 'bg-error/5 text-error hover:bg-error/20'
                }`}
                title={confirmDelete ? 'Click again to confirm delete' : 'Delete from history'}
              >
                {confirmDelete ? <XCircle className="w-4 h-4" /> : <X className="w-3.5 h-3.5" strokeWidth={2.5} />}
              </button>
            </div>
            <ChevronRight className={`w-4 h-4 text-outline transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`} />
          </div>
        </div>

        {/* Reschedule Banner — shows new booking ID clearly */}
        {booking.status === 'rescheduled' && booking.rescheduled_to && (
          <div className="mx-4 mb-3 bg-gradient-to-r from-purple-50 to-purple-100 border-l-4 border-l-purple-600 rounded-xl px-4 py-3.5 space-y-2">
            <div className="flex items-center gap-2">
              <RefreshCw className="w-4 h-4 text-purple-700 shrink-0" />
              <p className="text-xs font-black text-purple-700 uppercase tracking-widest">Auto-Rescheduled</p>
            </div>
            <div className="space-y-1.5 pl-6">
              {/* NEW BOOKING ID — prominently shown */}
              <div className="flex items-center justify-between bg-white/60 rounded-lg px-2.5 py-1.5 border border-purple-200">
                <div className="flex items-center gap-1.5">
                  <Hash className="w-3 h-3 text-purple-600" />
                  <span className="text-[9px] font-black text-purple-600 uppercase tracking-widest">New Booking ID</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-xs font-black text-on-surface">{booking.rescheduled_to.booking_id}</span>
                  <button
                    onClick={e => handleCopy(e, booking.rescheduled_to!.booking_id, 'newbooking')}
                    className="p-1 hover:bg-purple-100 rounded transition-colors"
                  >
                    {copied && copiedField === 'newbooking' ? <CheckCircle2 className="w-3 h-3 text-secondary" /> : <Copy className="w-3 h-3 text-purple-500" />}
                  </button>
                </div>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-purple-600 font-bold">New Provider:</span>
                <div className="text-right">
                  <span className="font-black text-on-surface">{booking.rescheduled_to.provider_name}</span>
                  {booking.rescheduled_to.provider_id && (
                    <p className="font-mono text-[10px] text-outline">{booking.rescheduled_to.provider_id}</p>
                  )}
                </div>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-purple-600 font-bold">New Time:</span>
                <span className="font-bold text-on-surface">{booking.rescheduled_to.date} · {booking.rescheduled_to.slot_label || formatSlotLabel(booking.rescheduled_to.slot)}</span>
              </div>
            </div>
          </div>
        )}

        {/* Expanded Details */}
        <AnimatePresence>
          {expanded && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
              <div className="px-5 pb-5 space-y-4 border-t border-outline-variant/20 pt-4">
                
                {/* Booking ID row */}
                <div className="flex items-center justify-between bg-surface-container-low px-4 py-2.5 rounded-2xl">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-3.5 h-3.5 text-primary" />
                    <span className="text-[10px] font-black text-outline uppercase tracking-widest">Booking ID</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-black text-on-surface">{booking.booking_id}</span>
                    <button onClick={e => handleCopy(e, booking.booking_id, 'main')} className="p-1.5 hover:bg-surface-variant rounded-lg transition-colors">
                      {copied && copiedField === 'main' ? <CheckCircle2 className="w-3.5 h-3.5 text-secondary" /> : <Copy className="w-3.5 h-3.5 text-outline" />}
                    </button>
                  </div>
                </div>

                {/* Provider ID row */}
                {booking.provider_id && (
                  <div className="flex items-center justify-between bg-surface-container-low px-4 py-2.5 rounded-2xl">
                    <div className="flex items-center gap-2">
                      <Hash className="w-3.5 h-3.5 text-outline" />
                      <span className="text-[10px] font-black text-outline uppercase tracking-widest">Provider ID</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono text-on-surface truncate max-w-[140px]">{booking.provider_id}</span>
                      <button onClick={e => handleCopy(e, booking.provider_id!, 'providerid')} className="p-1.5 hover:bg-surface-variant rounded-lg transition-colors">
                        {copied && copiedField === 'providerid' ? <CheckCircle2 className="w-3.5 h-3.5 text-secondary" /> : <Copy className="w-3.5 h-3.5 text-outline" />}
                      </button>
                    </div>
                  </div>
                )}

                {/* Location + Date grid */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-surface-container-low p-3 rounded-2xl space-y-1">
                    <div className="flex items-center gap-1.5"><MapPin className="w-3 h-3 text-outline" /><span className="text-[9px] font-black text-outline uppercase tracking-widest">Location</span></div>
                    <p className="text-[11px] font-bold text-on-surface leading-tight">{booking.location}</p>
                  </div>
                  <div className="bg-surface-container-low p-3 rounded-2xl space-y-1">
                    <div className="flex items-center gap-1.5"><CalendarCheck className="w-3 h-3 text-outline" /><span className="text-[9px] font-black text-outline uppercase tracking-widest">Booked On</span></div>
                    <p className="text-[11px] font-bold text-on-surface leading-tight">{new Date(booking.saved_at).toLocaleDateString()}</p>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-2 pt-2">
                  {isTrackable && onTrack && (
                    <button onClick={handleTrackClick} className="flex-1 py-3 bg-primary text-white rounded-2xl font-black text-[10px] shadow-lg shadow-primary/20 flex items-center justify-center gap-1.5 active:scale-95 transition-all">
                      <Navigation2 className="w-3.5 h-3.5" />Track
                    </button>
                  )}
                  <button onClick={() => setShowDispute(true)} className="flex-1 py-3 border-2 border-outline-variant/30 text-on-surface-variant rounded-2xl font-black text-[10px] hover:bg-surface-variant active:scale-95 transition-all flex items-center justify-center gap-1.5 leading-tight">
                    <Flag className="w-3.5 h-3.5" />Report
                  </button>
                  {(booking.status !== 'cancelled' && booking.status !== 'completed') && (
                    isProvider ? (
                      <button onClick={() => setShowProviderCancel(true)} className="flex-1 py-3 border-2 border-error/20 text-error rounded-2xl font-black text-[10px] hover:bg-error/5 active:scale-95 transition-all flex items-center justify-center gap-1.5">
                        <UserX className="w-3.5 h-3.5" />Unable to Attend
                      </button>
                    ) : (
                      <button onClick={() => setShowCancel(true)} className="flex-1 py-3 border-2 border-error/20 text-error rounded-2xl font-black text-[10px] hover:bg-error/5 active:scale-95 transition-all flex items-center justify-center gap-1.5">
                        <XCircle className="w-3.5 h-3.5" />Cancel
                      </button>
                    )
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      <AnimatePresence>{showCancel && <CancelSheet booking={booking} onClose={() => setShowCancel(false)} onSuccess={() => { setShowCancel(false); onRefresh(); }} />}</AnimatePresence>
      <AnimatePresence>{showProviderCancel && <ProviderCancelSheet booking={booking} onClose={() => setShowProviderCancel(false)} onSuccess={() => { setShowProviderCancel(false); onRefresh(); }} />}</AnimatePresence>
      <AnimatePresence>{showDispute && <DisputeSheet booking={booking} onClose={() => setShowDispute(false)} onSuccess={() => { setShowDispute(false); onRefresh(); }} />}</AnimatePresence>
    </>
  );
}

export function BookingsListView({ appLanguage, onTrack }: { appLanguage: AppLanguage; onTrack: (payload: any) => void }) {
  const [bookings, setBookings] = useState<SavedBooking[]>([]);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [showFilters, setShowFilters] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const userProfile = getUserProfile();
  const isProvider = userProfile?.role === 'provider';
  const providerId = userProfile?.provider_id;

  const refresh = () => {
    const all = getBookingsFromStorage();
    setBookings(isProvider && providerId ? all.filter(b => b.provider_id === providerId) : all);
  };

  useEffect(() => { refresh(); }, [isProvider, providerId]);

  const filteredBookings = bookings.filter(b => {
    if (filterStatus === 'all') return true;
    return b.status === filterStatus;
  });

  const filterOptions = [
    { id: 'all', label: 'All' },
    { id: 'confirmed', label: 'Confirmed' },
    { id: 'rescheduled', label: 'Rescheduled' },
    { id: 'cancelled', label: 'Cancelled' },
    { id: 'completed', label: 'Completed' },
  ];

  if (bookings.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
        <div className="w-20 h-20 bg-surface-container rounded-full flex items-center justify-center"><Inbox className="w-10 h-10 text-outline/30" /></div>
        <div>
          <h3 className="text-lg font-bold text-on-surface">No Bookings Found</h3>
          <p className="text-sm text-on-surface-variant max-w-[200px] mx-auto">
            {isProvider ? "No bookings assigned to you yet." : "You haven't made any bookings yet."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-10">
      <div className="flex flex-col gap-4 mb-2">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-black text-primary tracking-tight">{isProvider ? 'Your Assignments' : 'My Bookings'}</h2>
          <span className="text-[10px] font-black text-outline uppercase tracking-widest bg-surface-container px-3 py-1 rounded-full">{filteredBookings.length} Result{filteredBookings.length !== 1 ? 's' : ''}</span>
        </div>

        {/* Filter Dropdown/Menu */}
        <div className="relative">
          <div className="flex items-center gap-2 mb-2">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-outline-variant/30 rounded-xl shadow-sm hover:surface-container-low transition-all active:scale-95 group"
            >
              <Filter className={`w-4 h-4 transition-colors ${showFilters ? 'text-primary' : 'text-outline group-hover:text-primary'}`} />
              <span className="text-xs font-black text-on-surface uppercase tracking-widest">
                {filterStatus === 'all' ? 'All Bookings' : filterOptions.find(o => o.id === filterStatus)?.label}
              </span>
              <ChevronRight className={`w-4 h-4 text-outline transition-transform duration-300 ${showFilters ? 'rotate-90' : ''}`} />
            </button>

            {filterStatus !== 'all' && (
              <button
                onClick={() => setFilterStatus('all')}
                className="px-3 py-2 text-[10px] font-black text-primary uppercase tracking-widest hover:bg-primary/5 rounded-lg transition-colors"
              >
                Reset Filter
              </button>
            )}
          </div>

          <AnimatePresence>
            {showFilters && (
              <>
                {/* Backdrop to close */}
                <div 
                  className="fixed inset-0 z-40" 
                  onClick={() => setShowFilters(false)} 
                />
                
                <motion.div 
                  initial={{ opacity: 0, scale: 0.95, y: -10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: -10 }}
                  className="absolute left-0 top-full mt-2 w-48 bg-white border border-outline-variant/20 rounded-2xl shadow-xl z-50 overflow-hidden"
                >
                  <div className="p-1.5">
                    {filterOptions.map(opt => (
                      <button
                        key={opt.id}
                        onClick={() => {
                          setFilterStatus(opt.id);
                          setShowFilters(false);
                        }}
                        className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-left transition-colors ${
                          filterStatus === opt.id 
                            ? 'bg-primary/5 text-primary' 
                            : 'text-on-surface-variant hover:bg-surface-container-low'
                        }`}
                      >
                        <span className={`text-xs font-bold ${filterStatus === opt.id ? 'font-black' : ''}`}>{opt.label}</span>
                        {filterStatus === opt.id && <CheckCircle2 className="w-3.5 h-3.5" />}
                      </button>
                    ))}
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>
      </div>

      {filteredBookings.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredBookings.map(b => (
            <BookingCard
              key={b.booking_id}
              booking={b}
              expanded={expandedId === b.booking_id}
              onExpand={() => setExpandedId(expandedId === b.booking_id ? null : b.booking_id)}
              onRefresh={refresh}
              onTrack={onTrack}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-10 text-center space-y-3">
          <div className="w-16 h-16 bg-surface-container rounded-full flex items-center justify-center opacity-50"><Inbox className="w-8 h-8 text-outline" /></div>
          <p className="text-sm text-outline font-medium">No {filterStatus} bookings found</p>
        </div>
      )}
    </div>
  );
}
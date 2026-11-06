import { motion } from 'motion/react';
import { useState, useEffect, useRef } from 'react';
import {
  CalendarCheck, MapPin, Clock, ShieldCheck,
  Phone, MessageSquare, Star, CheckCircle2, Copy, Loader2,
  AlertCircle, ArrowLeft, Navigation2, RotateCcw
} from 'lucide-react';
import { saveBookingToStorage } from './BookingsListView';
import { AppLanguage } from '../App';
import { getUserProfile } from '../lib/profile';
import { interpretBookingResponse, networkFailure, newIdempotencyKey, type BookingOutcome } from '../lib/bookingResponse';

export interface BookingPayload {
  action: 'confirm';
  provider_id: string;
  provider_name: string;
  service_type: string;
  location: string;
  price_pkr: number;
  slot: string;
  booking_date: string;
  user_name?: string;
  user_email?: string;
  alternatives?: any[];
}

interface BookingViewProps {
  payload: BookingPayload | null;
  onBack: () => void;
  onTrack?: (payload: any) => void;
  appLanguage: AppLanguage;
}

interface Receipt {
  booking_id: string;
  status: string;
  service: string;
  provider: { id: string; name: string };
  appointment: { date: string; time: string; time_label: string; location: string };
  payment: { estimated_pkr: number; method: string; note: string };
  customer: string;
  confirmation_lines: string[];
  next_steps: string[];
  simulated_whatsapp?: string;
}

function formatSlotLabel(time: string) {
  const [h, m] = time.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${hour}:${String(m).padStart(2, '0')} ${period}`;
}

export function BookingView({ payload, onBack, onTrack, appLanguage }: BookingViewProps) {
  const [phase, setPhase] = useState<'loading' | 'success' | 'slot_taken' | 'error'>('loading');
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [retryable, setRetryable] = useState(false);
  const [copied, setCopied] = useState(false);
  const hasFired = useRef(false);
  // One request per booking attempt: built once, then resent unchanged by "Try again",
  // so the server sees the same idempotency key and body and replays instead of double-booking.
  const requestRef = useRef<{ forPayload: BookingPayload; body: string; stored: Record<string, unknown> } | null>(null);

  const t = {
    english: {
      confirming: "Confirming Your Booking",
      securing: "Securing your slot...",
      confirmed: "Booking Confirmed!",
      desc: "Your booking was successful.",
      track: "Track Live Service",
      copy: "Copy Booking Details",
      back: "Back to Providers"
    },
    urdu: {
      confirming: "آپ کی بکنگ کی تصدیق ہو رہی ہے",
      securing: "آپ کا وقت محفوظ کیا جا رہا ہے...",
      confirmed: "بکنگ کی تصدیق ہو گئی!",
      desc: "آپ کی بکنگ کامیابی سے ہو گئی ہے۔",
      track: "لائیو ٹریک کریں",
      copy: "بکنگ کی تفصیلات کاپی کریں",
      back: "فراہم کنندگان پر واپس جائیں"
    },
    roman_urdu: {
      confirming: "Confirming Your Booking",
      securing: "Securing your slot...",
      confirmed: "Booking Confirmed!",
      desc: "Aapki booking successfully ho gayi.",
      track: "Track Live Service",
      copy: "Copy Booking Details",
      back: "Back to Providers"
    }
  }[appLanguage];

  useEffect(() => {
    if (!payload || hasFired.current) return;
    hasFired.current = true;
    callBookingWebhook(payload);
  }, []);

  /** Builds the request for this payload once; later calls (retries) get the identical request. */
  const requestFor = (data: BookingPayload) => {
    if (requestRef.current?.forPayload === data) return requestRef.current;
    const { alternatives: alternativesForStorage, ...webhookPayload } = data;
    const profile = getUserProfile();
    const enrichedPayload = {
      ...webhookPayload,
      user_name: webhookPayload.user_name || profile?.name || 'Guest User',
      user_email: webhookPayload.user_email || profile?.email || '',
      idempotency_key: newIdempotencyKey(),
    };
    requestRef.current = {
      forPayload: data,
      body: JSON.stringify({ endpoint: 'khadmat-booking', ...enrichedPayload }),
      stored: { ...enrichedPayload, alternatives: alternativesForStorage ?? [] },
    };
    return requestRef.current;
  };

  const callBookingWebhook = async (data: BookingPayload) => {
    setPhase('loading');
    const request = requestFor(data);

    let outcome: BookingOutcome;
    try {
      const response = await fetch('/api/proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: request.body,
      });
      // Body first: 409 slot_taken and 400 validation_error carry the message to show.
      const responseText = await response.text();
      outcome = interpretBookingResponse(response.status, responseText);
    } catch (err) {
      console.error('Booking request failed:', err);
      outcome = networkFailure();
    }

    if (outcome.kind === 'confirmed') {
      setReceipt(outcome.receipt as unknown as Receipt);
      saveBookingToStorage(outcome.receipt, request.stored);
      setPhase('success');
    } else if (outcome.kind === 'slot_taken') {
      setErrorMsg(outcome.message);
      setPhase('slot_taken');
    } else {
      setErrorMsg(outcome.message);
      setRetryable(outcome.retryable);
      setPhase('error');
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // ─── Loading ────────────────────────────────────────────────────────────────
  if (phase === 'loading') {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex flex-col items-center justify-center min-h-[65vh] text-center space-y-6 px-6"
      >
        <div className="relative w-20 h-20">
          <div className="w-20 h-20 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
          <CalendarCheck className="w-8 h-8 text-primary absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
        </div>
        <div className="space-y-1.5">
          <p className="text-on-surface font-black text-lg">{t.confirming}</p>
          <p className="text-on-surface-variant text-sm">{t.securing} {payload?.provider_name}...</p>
        </div>

        {/* Skeleton receipt preview */}
        <div className="w-full max-w-sm glass-card rounded-2xl p-5 space-y-3 border border-outline-variant/30">
          {[80, 60, 70, 50].map((w, i) => (
            <div key={i} className="flex justify-between items-center">
              <div className="h-3 bg-surface-variant rounded-full animate-pulse" style={{ width: `${w * 0.5}%` }} />
              <div className="h-3 bg-surface-variant rounded-full animate-pulse" style={{ width: `${w * 0.35}%` }} />
            </div>
          ))}
        </div>
      </motion.div>
    );
  }

  // ─── Slot Taken ─────────────────────────────────────────────────────────────
  if (phase === 'slot_taken') {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex flex-col items-center justify-center min-h-[65vh] text-center space-y-6 px-6"
      >
        <div className="w-20 h-20 bg-secondary/10 rounded-full flex items-center justify-center">
          <Clock className="w-10 h-10 text-secondary" />
        </div>
        <div className="space-y-2">
          <p className="text-on-surface font-black text-xl">Slot Just Got Booked!</p>
          <p className="text-on-surface-variant text-sm leading-relaxed max-w-xs mx-auto">{errorMsg}</p>
        </div>
        <button
          onClick={onBack}
          className="w-full max-w-xs py-4 bg-primary text-white rounded-2xl font-black text-sm shadow-lg shadow-primary/20 flex items-center justify-center gap-2 active:scale-95 transition-all"
        >
          <ArrowLeft className="w-4 h-4" />
          Pick Another Slot
        </button>
      </motion.div>
    );
  }

  // ─── Error ───────────────────────────────────────────────────────────────────
  if (phase === 'error') {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex flex-col items-center justify-center min-h-[65vh] text-center space-y-6 px-6"
      >
        <div className="w-20 h-20 bg-error/10 rounded-full flex items-center justify-center">
          <AlertCircle className="w-10 h-10 text-error" />
        </div>
        <div className="space-y-2">
          <p className="text-on-surface font-black text-xl">Booking Failed</p>
          <p className="text-on-surface-variant text-sm leading-relaxed">{errorMsg}</p>
        </div>
        {retryable && payload && (
          <button
            onClick={() => callBookingWebhook(payload)}
            className="w-full max-w-xs py-4 bg-primary text-white rounded-2xl font-black text-sm shadow-lg shadow-primary/20 flex items-center justify-center gap-2 active:scale-95 transition-all"
          >
            <RotateCcw className="w-4 h-4" />
            Try Again
          </button>
        )}
        <button
          onClick={onBack}
          className={`w-full max-w-xs py-4 rounded-2xl font-black text-sm active:scale-95 transition-all ${retryable ? 'border border-outline-variant/40 text-on-surface-variant' : 'bg-on-surface text-white'}`}
        >
          Go Back
        </button>
      </motion.div>
    );
  }

  // ─── Success ─────────────────────────────────────────────────────────────────
  if (!receipt) return null;

  const timeLabel = receipt.appointment?.time_label || formatSlotLabel(receipt.appointment?.time || payload?.slot || '');
  const providerInitial = (receipt.provider?.name || payload?.provider_name || '?').charAt(0);

  const handleTrack = () => {
    if (!onTrack) return;
    onTrack({
      booking_id: receipt.booking_id,
      provider_id: receipt.provider?.id || payload?.provider_id || '',
      provider_name: receipt.provider?.name || payload?.provider_name || '',
      service_type: receipt.service || payload?.service_type || '',
      location: receipt.appointment?.location || payload?.location || '',
      price_pkr: receipt.payment?.estimated_pkr || payload?.price_pkr || 0,
      user_email: payload?.user_email || getUserProfile()?.email || '',
    });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-5 pb-20"
    >
      {/* ── Success Hero ── */}
      <div className="flex flex-col items-center text-center pt-2 pb-2 space-y-3">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 18, delay: 0.1 }}
          className="w-20 h-20 bg-secondary/10 rounded-full flex items-center justify-center"
        >
          <CheckCircle2 className="w-10 h-10 text-secondary" />
        </motion.div>
        <div>
          <h1 className="text-2xl font-black text-on-surface">{t.confirmed}</h1>
          <p className="text-sm text-on-surface-variant mt-1">
            {t.desc}
          </p>
        </div>

        {/* Booking ID Pill */}
        <button
          onClick={() => handleCopy(receipt.booking_id)}
          className="flex items-center gap-2 bg-primary/5 border border-primary/15 px-4 py-2 rounded-full hover:bg-primary/10 transition-colors active:scale-95"
        >
          <span className="text-xs font-black text-primary tracking-widest uppercase">
            {receipt.booking_id}
          </span>
          {copied
            ? <CheckCircle2 className="w-3.5 h-3.5 text-secondary" />
            : <Copy className="w-3.5 h-3.5 text-primary/60" />
          }
        </button>
      </div>

      {/* ── Provider Card ── */}
      <div className="glass-card rounded-[2rem] p-5 border border-outline-variant/30 bg-white/90 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center relative shadow-inner">
            <span className="text-xl font-black text-primary">{providerInitial}</span>
            <div className="absolute -bottom-1 -right-1 bg-white p-0.5 rounded-full shadow-md">
              <ShieldCheck className="w-4 h-4 text-secondary" />
            </div>
          </div>
          <div className="flex-1">
            <h2 className="text-base font-black text-on-surface">{receipt.provider?.name || payload?.provider_name}</h2>
            <div className="flex items-center gap-1 mt-0.5">
              <Star className="w-3 h-3 text-secondary fill-secondary" />
              <span className="text-[10px] font-bold text-secondary">Verified Pro</span>
            </div>
            <p className="text-[10px] text-outline mt-0.5 capitalize">{receipt.service || payload?.service_type}</p>
          </div>
          <div className="flex flex-col gap-2">
            <button className="w-9 h-9 rounded-full bg-secondary/10 text-secondary flex items-center justify-center hover:bg-secondary/20 active:scale-90 transition-all">
              <Phone className="w-4 h-4 fill-current" />
            </button>
            <button className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center hover:bg-primary/20 active:scale-90 transition-all">
              <MessageSquare className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* ── Appointment Details ── */}
      <div className="glass-card rounded-[2rem] p-5 border border-outline-variant/30 bg-white/90 shadow-sm space-y-4">
        <h3 className="text-[10px] font-black text-outline uppercase tracking-widest">Appointment Details</h3>

        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-secondary/10 text-secondary flex items-center justify-center shrink-0">
            <Clock className="w-4 h-4" />
          </div>
          <div>
            <p className="text-[10px] font-bold text-outline uppercase">Date & Time</p>
            <p className="text-sm font-black text-on-surface mt-0.5">
              {receipt.appointment?.date || payload?.booking_date}
            </p>
            <p className="text-xs font-bold text-secondary">{timeLabel}</p>
          </div>
        </div>

        <div className="h-px bg-outline-variant/20" />

        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <MapPin className="w-4 h-4" />
          </div>
          <div>
            <p className="text-[10px] font-bold text-outline uppercase">Location</p>
            <p className="text-sm font-black text-on-surface mt-0.5">
              {receipt.appointment?.location || payload?.location}
            </p>
          </div>
        </div>
      </div>

      {/* ── Payment Summary ── */}
      <div className="glass-card rounded-[2rem] p-5 border border-outline-variant/30 bg-white/90 shadow-sm space-y-4">
        <h3 className="text-[10px] font-black text-outline uppercase tracking-widest">Payment Summary</h3>

        <div className="flex justify-between items-center">
          <span className="text-sm text-on-surface-variant font-medium">Estimated Cost</span>
          <span className="text-2xl font-black text-on-surface">
            PKR {(receipt.payment?.estimated_pkr || payload?.price_pkr || 0).toLocaleString()}
          </span>
        </div>

        <div className="flex items-center gap-2 bg-secondary/5 border border-secondary/15 px-4 py-3 rounded-2xl">
          <CalendarCheck className="w-4 h-4 text-secondary shrink-0" />
          <p className="text-[11px] text-secondary font-bold">
            {receipt.payment?.method || 'Cash on service'}
          </p>
        </div>

        <p className="text-[10px] text-outline leading-relaxed">
          {receipt.payment?.note || 'Final price may vary based on actual work required.'}
        </p>
      </div>

      {/* ── Next Steps ── */}
      {receipt.next_steps && receipt.next_steps.length > 0 && (
        <div className="glass-card rounded-[2rem] p-5 border border-outline-variant/30 bg-white/90 shadow-sm space-y-3">
          <h3 className="text-[10px] font-black text-outline uppercase tracking-widest">What Happens Next</h3>
          <ul className="space-y-3">
            {receipt.next_steps.map((step, i) => (
              <li key={i} className="flex items-center gap-3">
                <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 text-[10px] font-black">
                  {i + 1}
                </div>
                <p className="text-xs text-on-surface-variant font-medium leading-snug">{step}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Actions ── */}
      <div className="space-y-3 pt-2">

        {/* Track Live Service — shown only if onTrack is provided */}
        {onTrack && (
          <button
            onClick={handleTrack}
            className="w-full py-4 bg-primary text-white rounded-2xl font-black text-sm shadow-lg shadow-primary/20 flex items-center justify-center gap-2 hover:opacity-90 active:scale-95 transition-all"
          >
            <Navigation2 className="w-4 h-4" />
            {t.track}
          </button>
        )}

        <button
          onClick={() => handleCopy(receipt.simulated_whatsapp || receipt.confirmation_lines?.join('\n') || '')}
          className="w-full py-4 bg-secondary text-white rounded-2xl font-black text-sm shadow-lg shadow-secondary/20 flex items-center justify-center gap-2 hover:opacity-90 active:scale-95 transition-all"
        >
          {copied ? <CheckCircle2 className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          {copied ? 'Copied!' : 'Copy Booking Details'}
        </button>

        <button
          onClick={onBack}
          className="w-full py-3.5 border border-outline-variant/40 text-on-surface-variant rounded-2xl font-bold text-sm flex items-center justify-center gap-2 hover:bg-surface-variant/30 active:scale-95 transition-all"
        >
          <ArrowLeft className="w-4 h-4" />
          {t.back}
        </button>
      </div>

      {/* Footer */}
      <div className="flex justify-center pt-2 pb-4">
        <p className="text-[9px] text-outline font-bold uppercase tracking-[0.2em] flex items-center gap-2">
          <ShieldCheck className="w-3 h-3" />
          Secure Booking · GharFix
        </p>
      </div>
    </motion.div>
  );
}
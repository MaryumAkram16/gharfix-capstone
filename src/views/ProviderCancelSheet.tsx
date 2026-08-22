import { motion } from 'motion/react';
import { useState } from 'react';
import { 
  XCircle, CheckCircle2, Loader2, AlertCircle, 
  CalendarX, Clock, User, ShieldAlert 
} from 'lucide-react';
import { SavedBooking, updateBookingInStorage } from './BookingsListView';
import { getUserProfile } from '../lib/profile';

interface ProviderCancelSheetProps {
  booking: SavedBooking;
  onClose: () => void;
  onSuccess: () => void;
}

const PROVIDER_CANCEL_REASONS = [
  { id: 'emergency', label: 'Emergency', desc: 'Unforeseen personal emergency', icon: ShieldAlert },
  { id: 'scheduling_conflict', label: 'Scheduling Conflict', desc: 'Double-booked or timing issue', icon: Clock },
  { id: 'illness', label: 'Illness', desc: 'Unable to perform service due to illness', icon: User },
  { id: 'tool_breakage', label: 'Tool/Equipment Breakage', desc: 'Essential tools are unavailable', icon: CalendarX },
  { id: 'other', label: 'Other Reason', desc: 'Please specify below', icon: AlertCircle },
];

export function ProviderCancelSheet({ booking, onClose, onSuccess }: ProviderCancelSheetProps) {
  const [selectedReason, setSelectedReason] = useState<string | null>(null);
  const [otherReasonText, setOtherReasonText] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');

  const canSubmit = !!selectedReason && (selectedReason !== 'other' || otherReasonText.trim().length > 5);

  const handleProviderCancel = async () => {
    if (!canSubmit) return;
    setLoading(true);
    setError('');

    const currentBookingId = booking.booking_id;
    const currentProviderId = booking.provider_id || booking.provider_name.toLowerCase().replace(/\s+/g, '_');

    try {
      // Include alternatives from the booking object for auto-rescheduling
      const payload = {
        endpoint: 'khadmat-reschedule',
        action: 'provider_cancel', // New action type
        initiator: 'provider', // New initiator type
        booking_id: currentBookingId,
        provider_id: currentProviderId,
        provider_name: booking.provider_name,
        service_type: booking.service_type,
        location: booking.location,
        booking_date: booking.booking_date,
        price_pkr: booking.price_pkr,
        slot: booking.slot,
        user_email: booking.user_email || getUserProfile()?.email || '',
        cancellation_reason_by_provider: selectedReason === 'other' ? otherReasonText : selectedReason,
        // Include alternatives for automatic rescheduling (same as user reschedule)
        alternatives: booking.alternatives || [],
      };

      console.log('[ProviderCancelSheet] Sending payload:', payload);

      const res = await fetch('/api/proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      
      const text = await res.text();
      let json: any = {};
      try {
        if (text) {
          let p = JSON.parse(text);
          json = Array.isArray(p) && p.length === 1 ? p[0] : p;
        }
      } catch {
        json = { status: 'provider_cancelled_success' };
      }

      console.log('[ProviderCancelSheet] Response:', json);
      setResult(json);
      
      // Update local storage to reflect cancellation
      updateBookingInStorage(booking.booking_id, { status: 'cancelled' });
      onSuccess();
    } catch (e: any) {
      console.error('[ProviderCancelSheet] Error:', e);
      setError(`Failed to submit cancellation: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }} 
      animate={{ opacity: 1 }} 
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-end justify-center"
      style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div 
        initial={{ y: '100%' }} 
        animate={{ y: 0 }} 
        exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className="w-full max-w-md bg-white rounded-t-[2rem] p-6 pb-10 space-y-5 shadow-2xl max-h-[90vh] overflow-y-auto"
      >
        <div className="w-10 h-1 bg-outline-variant/40 rounded-full mx-auto" />
        
        {!result ? (
          <>
            <div>
              <h2 className="text-lg font-black text-on-surface">Cancel Booking</h2>
              <p className="text-xs text-outline mt-1">Booking #{booking.booking_id} · {booking.service_type}</p>
              {booking.alternatives && booking.alternatives.length > 0 && (
                <p className="text-[10px] text-secondary font-bold mt-2">
                  ✓ {booking.alternatives.length} alternative provider(s) available for auto-rescheduling
                </p>
              )}
            </div>

            <div className="space-y-2">
              {PROVIDER_CANCEL_REASONS.map(reason => {
                const Icon = reason.icon;
                const isSel = selectedReason === reason.id;
                return (
                  <button 
                    key={reason.id} 
                    onClick={() => setSelectedReason(reason.id)}
                    className={`w-full flex items-center gap-3 p-4 rounded-2xl border-2 text-left transition-all active:scale-[0.98] ${
                      isSel ? 'border-error bg-error/5' : 'border-outline-variant/30 hover:border-outline-variant/60'
                    }`}
                  >
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                      isSel ? 'bg-error/10' : 'bg-surface-container-low'
                    }`}>
                      <Icon className={`w-5 h-5 ${isSel ? 'text-error' : 'text-outline'}`} />
                    </div>
                    <div>
                      <p className={`text-sm font-bold ${isSel ? 'text-error' : 'text-on-surface'}`}>{reason.label}</p>
                      <p className="text-[10px] text-outline mt-0.5">{reason.desc}</p>
                    </div>
                    {isSel && <CheckCircle2 className="w-4 h-4 text-error ml-auto shrink-0" />}
                  </button>
                );
              })}
            </div>

            {selectedReason === 'other' && (
              <motion.div 
                initial={{ opacity: 0, y: -8 }} 
                animate={{ opacity: 1, y: 0 }}
                className="space-y-1.5"
              >
                <label className="text-[10px] font-black text-outline uppercase tracking-widest">
                  Reason Details <span className="text-error">*</span>
                </label>
                <textarea 
                  value={otherReasonText} 
                  onChange={e => setOtherReasonText(e.target.value)}
                  placeholder="Please describe why you need to cancel..."
                  rows={4}
                  className="w-full rounded-2xl border-2 border-outline-variant/30 focus:border-error bg-surface-container-lowest px-4 py-3 text-sm text-on-surface placeholder:text-outline/50 resize-none outline-none transition-colors"
                />
              </motion.div>
            )}

            {error && <p className="text-xs text-error font-bold text-center">{error}</p>}

            <div className="pt-2 space-y-3">
              <button 
                onClick={handleProviderCancel} 
                disabled={!canSubmit || loading}
                className="w-full py-4 bg-error text-white rounded-2xl font-black text-sm shadow-lg shadow-error/20 flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 transition-all"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
                {loading ? 'Submitting...' : 'Confirm Cancellation'}
              </button>
              
              <button 
                onClick={onClose} 
                className="w-full text-center text-xs text-outline font-medium py-2"
              >
                Go Back
              </button>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center text-center space-y-4 py-2">
            <div className="w-16 h-16 rounded-full bg-secondary/10 flex items-center justify-center">
              <CheckCircle2 className="w-8 h-8 text-secondary" />
            </div>
            <div>
              <h3 className="text-lg font-black text-on-surface">Cancellation Submitted</h3>
              <p className="text-xs text-outline mt-1 leading-relaxed max-w-xs mx-auto">
                {result.status === 'rescheduled' 
                  ? `Successfully rescheduled with ${result.new_provider_name || 'an alternative provider'}. Customer has been notified.`
                  : 'We\'ve received your cancellation. We are finding a replacement for the customer to ensure they are still served.'}
              </p>
            </div>
            <button 
              onClick={onClose} 
              className="w-full py-4 bg-on-surface text-white rounded-2xl font-black text-sm active:scale-95 transition-all"
            >
              Done
            </button>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
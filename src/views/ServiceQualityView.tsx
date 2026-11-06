import { motion, AnimatePresence } from 'motion/react';
import { useState, useEffect, useRef } from 'react';
import {
  Navigation2, MapPin, Clock, CheckSquare, Square,
  Star, CheckCircle2, AlertCircle, Loader2, ChevronRight,
  Phone, MessageSquare, ArrowRight, Package, Activity, Shield,
  ThumbsUp, Send, RefreshCw, Upload, Mic, Trash2, Image as ImageIcon
} from 'lucide-react';
import { AppLanguage } from '../App';
import { getUserProfile } from '../lib/profile';

// ─── Types ────────────────────────────────────────────────────────────────────
type Stage = 'en_route' | 'arrived' | 'completed' | 'feedback';

export interface WF5Payload {
  booking_id: string;
  provider_id?: string;
  provider_name: string;
  service_type: string;
  location: string;
  price_pkr: number;
  distance_km?: number;
  arrival_time?: string;
  final_price_pkr?: number;
  user_email?: string;
}

interface WF5ViewProps {
  key?: string | number;
  payload: WF5Payload;
  initialStage?: Stage;
  onComplete?: () => void;
  appLanguage: AppLanguage;
}

// ─── WF5 API Caller ───────────────────────────────────────────────────────────
async function callWF5(action: Stage, data: WF5Payload & Record<string, any>) {
  const url = '/api/proxy';
  console.log(`[WF5] Calling proxy for stage: ${action}`, data);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: 'khadmat-quality', action, ...data }),
    });
    
    console.log(`[WF5] Response status: ${res.status}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    
    const text = await res.text();
    console.log(`[WF5] Response text:`, text);
    if (!text) return {};
    
    let parsed = JSON.parse(text);
    return Array.isArray(parsed) && parsed.length === 1 ? parsed[0] : parsed;
  } catch (err: any) {
    console.error(`[WF5] proxy error:`, err.message);
    throw err;
  }
}

// ─── Stage Stepper ────────────────────────────────────────────────────────────
function StageStepper({ current, appLanguage }: { current: Stage; appLanguage: AppLanguage }) {
  const STAGES: { id: Stage; label: string }[] = {
    english: [
      { id: 'en_route', label: 'On Way' },
      { id: 'arrived', label: 'Arrived' },
      { id: 'completed', label: 'Done' },
      { id: 'feedback', label: 'Rate' },
    ],
    urdu: [
      { id: 'en_route', label: 'راستے میں' },
      { id: 'arrived', label: 'پہنچ گئے' },
      { id: 'completed', label: 'مکمل' },
      { id: 'feedback', label: 'رائے' },
    ],
    roman_urdu: [
      { id: 'en_route', label: 'On Way' },
      { id: 'arrived', label: 'Arrived' },
      { id: 'completed', label: 'Done' },
      { id: 'feedback', label: 'Rate' },
    ]
  }[appLanguage] as { id: Stage; label: string }[];

  const idx = STAGES.findIndex(s => s.id === current);
  return (
    <div className="flex items-center justify-between px-2 py-3">
      {STAGES.map((s, i) => (
        <div key={s.id} className="flex items-center">
          <div className="flex flex-col items-center gap-1">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-black transition-all ${
              i < idx ? 'bg-secondary text-white' :
              i === idx ? 'bg-primary text-white scale-110 ring-2 ring-primary/20' :
              'bg-surface-container-low text-outline border border-outline-variant/30'
            }`}>
              {i < idx ? <CheckCircle2 className="w-3.5 h-3.5" /> : i + 1}
            </div>
            <span className={`text-[9px] font-bold uppercase tracking-wider ${
              i === idx ? 'text-primary' : i < idx ? 'text-secondary' : 'text-outline'
            }`}>{s.label}</span>
          </div>
          {i < STAGES.length - 1 && (
            <div className={`h-px w-8 mx-1 mb-4 transition-colors ${i < idx ? 'bg-secondary' : 'bg-outline-variant/30'}`} />
          )}
        </div>
      ))}
    </div>
  );
}

// ─── ERROR STATE COMPONENT ───────────────────────────────────────────────────
function ErrorState({ message, onRetry, appLanguage }: { message: string; onRetry: () => void; appLanguage: AppLanguage }) {
  const t = {
    english: { retry: "Try Again", error: "Connection Error" },
    urdu: { retry: "دوبارہ کوشش کریں", error: "کنکشن کی خرابی" },
    roman_urdu: { retry: "Try Again", error: "Connection Error" }
  }[appLanguage];

  return (
    <div className="flex flex-col items-center justify-center min-h-[30vh] gap-4 p-6 text-center">
      <div className="w-16 h-16 rounded-full bg-error/10 flex items-center justify-center text-error border border-error/20">
        <AlertCircle className="w-8 h-8" />
      </div>
      <div>
        <h3 className="text-base font-black text-on-surface">{t.error}</h3>
        <p className="text-xs text-outline mt-1 leading-relaxed max-w-[240px]">{message}</p>
      </div>
      <button
        onClick={onRetry}
        className="mt-2 px-6 py-3 bg-primary text-white rounded-2xl font-black text-sm flex items-center gap-2 active:scale-95 transition-all shadow-lg shadow-primary/20"
      >
        <RefreshCw className="w-4 h-4" />
        {t.retry}
      </button>
    </div>
  );
}

// ─── EN ROUTE VIEW ────────────────────────────────────────────────────────────
function EnRouteView({
  payload,
  onNext,
  appLanguage
}: { payload: WF5Payload; onNext: (data: any) => void; appLanguage: AppLanguage }) {
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  const hasFired = useRef(false);

  const t = {
    english: {
      locating: "Locating provider...",
      eta: "Estimated Arrival",
      min: "min",
      arrived: "Mark as Arrived"
    },
    urdu: {
      locating: "فراہم کنندہ کو تلاش کیا جا رہا ہے...",
      eta: "متوقع آمد",
      min: "منٹ",
      arrived: "آمد کی تصدیق کریں"
    },
    roman_urdu: {
      locating: "Locating provider...",
      eta: "Estimated Arrival",
      min: "min",
      arrived: "Mark as Arrived"
    }
  }[appLanguage];

  const fetchStatus = () => {
    setLoading(true);
    setError('');
    callWF5('en_route', { ...payload, distance_km: payload.distance_km || 7 })
      .then(r => { setResult(r); setError(''); })
      .catch((err) => { 
        setError(err.message === 'Failed to fetch' || err.message.includes('HTTP') 
          ? 'We are having trouble connecting to the tracking server. Please check your internet or try again.' 
          : 'Could not reach server. Showing estimated data.');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (hasFired.current) return;
    hasFired.current = true;
    fetchStatus();
  }, []);

  // Countdown simulation
  useEffect(() => {
    if (!result) return;
    const t = setInterval(() => setTick(p => p + 1), 30000);
    return () => clearInterval(t);
  }, [result]);

  const eta = result?.eta_minutes ? Math.max(1, result.eta_minutes - tick) : '…';

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4">
        <div className="relative w-16 h-16">
          <div className="w-16 h-16 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
          <Navigation2 className="w-6 h-6 text-primary absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
        </div>
        <p className="text-sm font-bold text-on-surface-variant">{t.locating}</p>
      </div>
    );
  }

  if (error && !result) {
    return <ErrorState message={error} onRetry={fetchStatus} appLanguage={appLanguage} />;
  }

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      {error && (
        <div className="flex items-center gap-2 bg-error/5 text-error px-4 py-2.5 rounded-2xl border border-error/20 mb-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <p className="text-[10px] font-bold leading-tight">{error}</p>
        </div>
      )}

      {/* ETA Hero */}
      <div className="glass-card rounded-[2rem] p-6 border border-secondary/20 bg-secondary/5 relative overflow-hidden">
        <div className="absolute -right-8 -top-8 w-32 h-32 bg-secondary/10 rounded-full blur-2xl" />
        <div className="relative z-10">
          <p className="text-[10px] font-black text-secondary uppercase tracking-widest mb-2">{t.eta}</p>
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-5xl font-black text-primary leading-none">{eta}</span>
            <span className="text-lg font-bold text-on-surface-variant">{t.min}</span>
          </div>
          <p className="text-xs text-outline font-medium">
            {result?.estimated_arrival_time ? `Around ${result.estimated_arrival_time}` : 'Calculating route…'}
          </p>
        </div>
      </div>

      {/* Provider + Service Info */}
      <div className="glass-card rounded-[2rem] p-5 border border-outline-variant/20 space-y-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
            <span className="text-xl font-black text-primary">{payload.provider_name.charAt(0)}</span>
          </div>
          <div className="flex-1">
            <h3 className="text-base font-black text-on-surface">{payload.provider_name}</h3>
            <p className="text-[10px] text-outline capitalize font-medium">{payload.service_type}</p>
          </div>
          <div className="flex gap-2">
            <button className="w-10 h-10 rounded-full bg-secondary/10 text-secondary flex items-center justify-center hover:bg-secondary/20 active:scale-90 transition-all">
              <Phone className="w-4 h-4 fill-current" />
            </button>
            <button className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center hover:bg-primary/20 active:scale-90 transition-all">
              <MessageSquare className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="h-px bg-outline-variant/20" />

        <div className="flex items-center gap-3">
          <MapPin className="w-4 h-4 text-secondary shrink-0" />
          <p className="text-xs font-bold text-on-surface">{payload.location}</p>
        </div>

        {result?.checklist_reminder && (
          <div className="space-y-2 pt-1">
            <p className="text-[9px] font-black text-outline uppercase tracking-widest">Before They Arrive</p>
            {result.checklist_reminder.map((item: string, i: number) => (
              <div key={i} className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-secondary shrink-0" />
                <p className="text-[11px] text-on-surface-variant">{item}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Mark as Arrived Button */}
      <button
        onClick={() => onNext(result)}
        className="w-full py-4 bg-primary text-white rounded-2xl font-black text-sm shadow-lg shadow-primary/20 flex items-center justify-center gap-2 hover:opacity-90 active:scale-95 transition-all"
      >
        <CheckCircle2 className="w-4 h-4" />
        {t.arrived}
        <ArrowRight className="w-4 h-4" />
      </button>
    </motion.div>
  );
}

// ─── ARRIVED VIEW ─────────────────────────────────────────────────────────────
function ArrivedView({
  payload,
  onNext,
}: { payload: WF5Payload; onNext: (data: any) => void }) {
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<any>(null);
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const [error, setError] = useState('');
  const hasFired = useRef(false);

  const fetchChecklist = () => {
    setLoading(true);
    setError('');
    callWF5('arrived', { ...payload })
      .then(r => { setResult(r); setError(''); })
      .catch((err) => { 
        setError(err.message.includes('HTTP') || err.message === 'Failed to fetch'
          ? 'Unable to sync with server. Using offline checklist mode.'
          : 'Using offline checklist.');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (hasFired.current) return;
    hasFired.current = true;
    fetchChecklist();
  }, []);

  const checklist = result?.service_checklist || [
    { step: 1, task: 'Inspect the problem area', completed: false },
    { step: 2, task: 'Prepare tools and materials', completed: false },
    { step: 3, task: 'Carry out the repair', completed: false },
    { step: 4, task: 'Test the result', completed: false },
    { step: 5, task: 'Clean up and hand over', completed: false, photo_required: true },
  ];

  const doneCount = Object.values(checked).filter(Boolean).length;
  const progress = checklist.length > 0 ? (doneCount / checklist.length) * 100 : 0;
  const allDone = doneCount === checklist.length;

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
        <p className="text-sm text-on-surface-variant font-medium">Loading service checklist…</p>
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      {error && (
        <div className="flex items-center gap-2 bg-secondary/5 text-secondary px-4 py-2.5 rounded-2xl border border-secondary/20 mb-2">
          <Activity className="w-3.5 h-3.5 shrink-0" />
          <div className="flex-1">
            <p className="text-[10px] font-bold leading-tight">{error}</p>
          </div>
          <button onClick={fetchChecklist} className="text-[9px] font-black underline uppercase">Retry Sync</button>
        </div>
      )}

      {/* Arrival Banner */}
      <div className="glass-card rounded-[2rem] p-5 border-l-[4px] border-l-secondary bg-secondary/5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-secondary/15 flex items-center justify-center">
            <CheckCircle2 className="w-5 h-5 text-secondary" />
          </div>
          <div>
            <p className="text-sm font-black text-on-surface">{payload.provider_name} Arrived!</p>
            <p className="text-[10px] text-outline">
              {result?.arrival_time ? `Arrived at ${result.arrival_time}` : 'Service in progress'}
            </p>
          </div>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <p className="text-[10px] font-black text-outline uppercase tracking-widest">Service Checklist</p>
          <span className="text-[10px] font-bold text-primary">{doneCount}/{checklist.length} done</span>
        </div>
        <div className="h-2 bg-surface-container rounded-full overflow-hidden">
          <motion.div
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.5 }}
            className="h-full bg-secondary rounded-full"
          />
        </div>
      </div>

      {/* Checklist */}
      <div className="glass-card rounded-[2rem] p-4 border border-outline-variant/20 space-y-2">
        {checklist.map((item: any, i: number) => (
          <motion.button
            key={i}
            onClick={() => setChecked(prev => ({ ...prev, [i]: !prev[i] }))}
            whileTap={{ scale: 0.98 }}
            className={`w-full flex items-center gap-3 p-3.5 rounded-2xl text-left transition-all ${
              checked[i] ? 'bg-secondary/8 border border-secondary/20' : 'hover:bg-surface-container-low border border-transparent'
            }`}
          >
            <div className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 transition-colors ${
              checked[i] ? 'bg-secondary text-white' : 'border-2 border-outline-variant/50'
            }`}>
              {checked[i] && <CheckCircle2 className="w-3.5 h-3.5" />}
            </div>
            <div className="flex-1">
              <p className={`text-xs font-bold transition-colors ${checked[i] ? 'text-secondary line-through opacity-70' : 'text-on-surface'}`}>
                {item.task}
              </p>
              {item.photo_required && (
                <p className="text-[9px] text-outline mt-0.5 font-medium">📷 Photo evidence required</p>
              )}
            </div>
            <span className="text-[9px] text-outline font-bold shrink-0">Step {item.step}</span>
          </motion.button>
        ))}
      </div>

      {/* Mark Complete Button */}
      <button
        onClick={() => onNext(result)}
        disabled={!allDone}
        className="w-full py-4 bg-secondary text-white rounded-2xl font-black text-sm shadow-lg shadow-secondary/20 flex items-center justify-center gap-2 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Package className="w-4 h-4" />
        {allDone ? 'Mark Service Complete' : `Complete all ${checklist.length - doneCount} remaining steps`}
      </button>
    </motion.div>
  );
}

// ─── COMPLETED VIEW ───────────────────────────────────────────────────────────
function CompletedView({
  payload,
  onNext,
}: { payload: WF5Payload; onNext: (data: any) => void }) {
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<any>(null);
  const [finalPrice, setFinalPrice] = useState(String(payload.price_pkr));
  const [error, setError] = useState('');
  const hasFired = useRef(false);

  const logCompletion = () => {
    setLoading(true);
    setError('');
    callWF5('completed', { ...payload, final_price_pkr: payload.price_pkr })
      .then(r => {
        setResult(r);
        setFinalPrice(String(r?.payment?.final_pkr || payload.price_pkr));
        setError('');
      })
      .catch((err) => { 
        setError(err.message.includes('HTTP') || err.message === 'Failed to fetch'
          ? 'Network error while logging completion. Your payment details might not sync immediately.'
          : 'Using local data.');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (hasFired.current) return;
    hasFired.current = true;
    logCompletion();
  }, []);

  const quotedPrice = payload.price_pkr;
  const parsedFinal = parseInt(finalPrice) || quotedPrice;
  const variance = parsedFinal - quotedPrice;
  const variantColor = variance > 0 ? 'text-error' : variance < 0 ? 'text-secondary' : 'text-primary';
  const variantLabel = variance > 0 ? `+PKR ${variance} overrun` : variance < 0 ? `-PKR ${Math.abs(variance)} saving` : 'Exact match ✓';

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4">
        <Loader2 className="w-8 h-8 text-secondary animate-spin" />
        <p className="text-sm text-on-surface-variant font-medium">Logging completion…</p>
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      {error && (
        <div className="bg-error/5 text-error px-4 py-3 rounded-2xl border border-error/20 mb-2 flex items-center justify-between">
          <p className="text-[10px] font-bold leading-tight flex-1 mr-4">{error}</p>
          <button onClick={logCompletion} className="text-[9px] font-black underline uppercase shrink-0">Retry Log</button>
        </div>
      )}

      {/* Success Banner */}
      <div className="flex flex-col items-center text-center py-4 space-y-2">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 18 }}
          className="w-16 h-16 bg-secondary/10 rounded-full flex items-center justify-center"
        >
          <ThumbsUp className="w-8 h-8 text-secondary" />
        </motion.div>
        <h2 className="text-xl font-black text-on-surface">Service Complete!</h2>
        <p className="text-xs text-outline">{result?.completion_time ? `Completed at ${result.completion_time}` : 'Job done successfully'}</p>
      </div>

      {/* Payment Summary */}
      <div className="glass-card rounded-[2rem] p-5 border border-outline-variant/20 space-y-4">
        <p className="text-[9px] font-black text-outline uppercase tracking-widest">Payment Summary</p>

        <div className="flex justify-between items-center">
          <span className="text-sm text-on-surface-variant">Quoted Price</span>
          <span className="text-sm font-bold text-on-surface">PKR {quotedPrice.toLocaleString()}</span>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm text-on-surface-variant flex-1">Final Amount</span>
          <input
            type="number"
            value={finalPrice}
            onChange={e => setFinalPrice(e.target.value)}
            className="w-28 text-right text-sm font-black text-on-surface bg-surface-container-low border border-outline-variant/30 rounded-xl px-3 py-1.5 outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>

        <div className="h-px bg-outline-variant/20" />

        <div className="flex justify-between items-center">
          <span className="text-sm font-bold text-on-surface">Status</span>
          <span className={`text-xs font-black ${variantColor}`}>{variantLabel}</span>
        </div>

        {variance > 0 && (
          <div className="bg-error/5 border border-error/20 rounded-2xl px-4 py-3">
            <p className="text-[11px] text-error font-bold">
              Extra charge detected — you can raise a price dispute via Report Issue in your booking.
            </p>
          </div>
        )}
      </div>

      {/* Duration */}
      {result?.duration && (
        <div className="flex items-center gap-3 bg-primary/5 border border-primary/10 rounded-2xl px-4 py-3">
          <Clock className="w-4 h-4 text-primary shrink-0" />
          <p className="text-[11px] text-primary font-bold">Service duration: {result.duration}</p>
        </div>
      )}

      <button
        onClick={() => onNext({ ...result, final_price_pkr: parsedFinal })}
        className="w-full py-4 bg-primary text-white rounded-2xl font-black text-sm shadow-lg shadow-primary/20 flex items-center justify-center gap-2 active:scale-95 transition-all"
      >
        <Star className="w-4 h-4" />
        Rate Your Experience
        <ArrowRight className="w-4 h-4" />
      </button>
    </motion.div>
  );
}

// ─── FEEDBACK VIEW (UPDATED WITH IMAGE & TRANSCRIPT) ──────────────────────────
function FeedbackView({
  payload,
  onComplete,
}: { payload: WF5Payload; onComplete?: () => void }) {
  const [rating, setRating] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [review, setReview] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [attachedImages, setAttachedImages] = useState<File[]>([]);
  const [imagePreviewUrls, setImagePreviewUrls] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);

  const TAGS = ['On time', 'Professional', 'Clean work', 'Good value', 'Friendly'];
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  // Initialize Speech Recognition
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = false;
      recognitionRef.current.onresult = (event: any) => {
        const speechTranscript = Array.from(event.results)
          .map((result: any) => result[0].transcript)
          .join('');
        setTranscript(prev => prev + (prev ? ' ' : '') + speechTranscript);
      };
      recognitionRef.current.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
        setError('Could not recognize speech. Please try again.');
        setIsRecording(false);
      };
      recognitionRef.current.onend = () => {
        setIsRecording(false);
      };
    }
  }, []);

  // Start/Stop Recording
  const toggleRecording = () => {
    if (!recognitionRef.current) {
      setError('Speech recognition not supported in your browser.');
      return;
    }
    if (isRecording) {
      recognitionRef.current.stop();
      setIsRecording(false);
    } else {
      setIsRecording(true);
      recognitionRef.current.start();
    }
  };

  // Handle Image Upload
  const handleImageUpload = (e: any) => {
    const files = Array.from((e.target as HTMLInputElement).files || []);
    if (files.length + attachedImages.length > 3) {
      setError('Maximum 3 images allowed.');
      return;
    }

    const newFiles = [...attachedImages, ...files];
    setAttachedImages(newFiles);

    // Create preview URLs
    const newUrls = files.map(file => URL.createObjectURL(file as any));
    setImagePreviewUrls(prev => [...prev, ...newUrls]);
  };

  // Remove Image
  const removeImage = (index: number) => {
    setAttachedImages(prev => prev.filter((_, i) => i !== index));
    URL.revokeObjectURL(imagePreviewUrls[index]);
    setImagePreviewUrls(prev => prev.filter((_, i) => i !== index));
  };

  const resizeImage = (file: File): Promise<string> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;
          const maxDim = 800;
          if (width > height) {
            if (width > maxDim) {
              height *= maxDim / width;
              width = maxDim;
            }
          } else {
            if (height > maxDim) {
              width *= maxDim / height;
              height = maxDim;
            }
          }
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.7));
        };
        img.src = e.target?.result as string;
      };
      reader.readAsDataURL(file);
    });
  };

  // Handle Submit
  const handleSubmit = async () => {
    if (rating === 0) return;
    setLoading(true);
    setError('');

    // Combine review text with transcript
    const fullReview = [review, transcript, ...selectedTags].filter(Boolean).join('. ');

    // Convert and resize images
    const imageBase64Array: string[] = [];
    for (const file of attachedImages) {
      const base64 = await resizeImage(file);
      imageBase64Array.push(base64);
    }

    try {
      const res = await callWF5('feedback', {
        ...payload,
        rating,
        review: fullReview,
        transcript_included: transcript.length > 0,
        transcript_text: transcript,
        images_attached: attachedImages.length,
        image_base64_array: imageBase64Array,
        image_count: attachedImages.length,
      });
      setResult(res);
      setError('');
    } catch (err: any) {
      setError(err.message === 'Failed to fetch' || err.message.includes('HTTP')
        ? 'Network error. We could not sync your feedback with the server. Please check your connection and try again.'
        : 'Could not submit feedback. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (result) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex flex-col items-center text-center space-y-5 py-6"
      >
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 260, damping: 16, delay: 0.1 }}
          className="w-20 h-20 bg-secondary/10 rounded-full flex items-center justify-center"
        >
          <CheckCircle2 className="w-10 h-10 text-secondary" />
        </motion.div>
        <div>
          <h3 className="text-xl font-black text-on-surface">Shukriya!</h3>
          <p className="text-xs text-outline mt-1 max-w-xs mx-auto leading-relaxed">
            {result.customer_message || 'Your feedback has been saved.'}
          </p>
        </div>

        {result.escalate_to_wf6 && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-2xl px-4 py-3 flex items-center gap-2 w-full">
            <AlertCircle className="w-4 h-4 text-yellow-600 shrink-0" />
            <p className="text-[11px] text-yellow-700 font-bold">Your complaint has been escalated to our dispute team.</p>
          </div>
        )}

        {result.reputation_update && (
          <div className="bg-primary/5 border border-primary/15 rounded-2xl px-4 py-3 w-full text-left">
            <p className="text-[9px] font-black text-outline uppercase tracking-widest mb-2">Provider Rating Impact</p>
            <div className="flex justify-between text-xs">
              <span className="text-outline">New Rating</span>
              <span className="font-black text-primary">{result.reputation_update.new_rating} / 5</span>
            </div>
            <div className="flex justify-between text-xs mt-1">
              <span className="text-outline">Trend</span>
              <span className={`font-bold ${result.reputation_update.delta >= 0 ? 'text-secondary' : 'text-error'}`}>
                {result.reputation_update.direction} ({result.reputation_update.delta > 0 ? '+' : ''}{result.reputation_update.delta})
              </span>
            </div>
          </div>
        )}

        {onComplete && (
          <button
            onClick={onComplete}
            className="w-full py-4 bg-on-surface text-white rounded-2xl font-black text-sm active:scale-95 transition-all"
          >
            Back to Home
          </button>
        )}
      </motion.div>
    );
  }

  const ratingLabels = ['', 'Very Bad', 'Bad', 'Okay', 'Good', 'Excellent'];

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
      {/* Stars */}
      <div className="glass-card rounded-[2rem] p-6 border border-outline-variant/20 space-y-4">
        <div className="text-center">
          <p className="text-sm font-black text-on-surface">How was the service?</p>
          <p className="text-[10px] text-outline mt-0.5 capitalize">{payload.service_type} by {payload.provider_name}</p>
        </div>
        <div className="flex justify-center gap-3">
          {[1, 2, 3, 4, 5].map(s => (
            <button
              key={s}
              onClick={() => setRating(s)}
              onMouseEnter={() => setHovered(s)}
              onMouseLeave={() => setHovered(0)}
              className="transition-all active:scale-90"
            >
              <Star
                className={`w-9 h-9 transition-all ${
                  s <= (hovered || rating)
                    ? 'text-amber-400 fill-amber-400 scale-110'
                    : 'text-outline-variant/60'
                }`}
              />
            </button>
          ))}
        </div>
        {(hovered || rating) > 0 && (
          <p className="text-center text-xs font-black text-secondary">{ratingLabels[hovered || rating]}</p>
        )}
      </div>

      {/* Quick Tags */}
      <div className="space-y-2">
        <p className="text-[9px] font-black text-outline uppercase tracking-widest px-1">Quick Tags</p>
        <div className="flex flex-wrap gap-2">
          {TAGS.map(tag => (
            <button
              key={tag}
              onClick={() => setSelectedTags(prev =>
                prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
              )}
              className={`text-[11px] font-bold px-3 py-1.5 rounded-full border transition-all active:scale-95 ${
                selectedTags.includes(tag)
                  ? 'bg-primary text-white border-primary shadow-sm'
                  : 'bg-surface-container-low text-on-surface-variant border-outline-variant/30 hover:border-primary/30'
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
      </div>

      {/* Written Review */}
      <div className="space-y-1.5">
        <p className="text-[9px] font-black text-outline uppercase tracking-widest">Write a Review</p>
        <textarea
          value={review}
          onChange={e => setReview(e.target.value)}
          placeholder="Tell us more about your experience…"
          rows={3}
          className="w-full rounded-2xl border-2 border-outline-variant/30 focus:border-primary bg-surface-container-lowest px-4 py-3 text-sm text-on-surface placeholder:text-outline/50 resize-none outline-none transition-colors leading-relaxed"
        />
      </div>

      {/* Voice Transcript Section */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-[9px] font-black text-outline uppercase tracking-widest">Add Voice Feedback</p>
          <span className="text-[9px] text-outline font-medium">
            {transcript.length > 0 ? `${transcript.length} chars` : 'Optional'}
          </span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={toggleRecording}
            className={`flex-1 py-3 rounded-2xl font-black text-sm flex items-center justify-center gap-2 transition-all active:scale-95 ${
              isRecording
                ? 'bg-error text-white shadow-lg shadow-error/20 animate-pulse'
                : 'bg-secondary/10 text-secondary border border-secondary/20 hover:bg-secondary/15'
            }`}
          >
            <Mic className={`w-4 h-4 ${isRecording ? 'animate-pulse' : ''}`} />
            {isRecording ? 'Recording...' : 'Record Voice'}
          </button>
        </div>
        {transcript && (
          <div className="bg-secondary/5 border border-secondary/20 rounded-2xl p-3">
            <p className="text-[11px] text-on-surface leading-relaxed">{transcript}</p>
            <button
              onClick={() => setTranscript('')}
              className="text-[9px] text-secondary font-bold mt-2 hover:underline"
            >
              Clear transcript
            </button>
          </div>
        )}
      </div>

      {/* Image Upload Section */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-[9px] font-black text-outline uppercase tracking-widest">Attach Photos</p>
          <span className="text-[9px] text-outline font-medium">
            {attachedImages.length}/3 images
          </span>
        </div>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={attachedImages.length >= 3}
          className="w-full py-3 rounded-2xl font-black text-sm flex items-center justify-center gap-2 transition-all active:scale-95 border-2 border-dashed border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Upload className="w-4 h-4" />
          {attachedImages.length >= 3 ? 'Max images reached' : 'Upload Image'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleImageUpload}
          className="hidden"
        />

        {/* Image Previews */}
        {imagePreviewUrls.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {imagePreviewUrls.map((url, i) => (
              <div key={i} className="relative group">
                <img
                  src={url}
                  alt={`Preview ${i + 1}`}
                  className="w-full h-20 object-cover rounded-xl border border-outline-variant/20"
                />
                <button
                  onClick={() => removeImage(i)}
                  className="absolute top-1 right-1 w-6 h-6 bg-error text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className="bg-error/5 border border-error/20 rounded-2xl p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-error shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-xs font-bold text-error leading-relaxed">{error}</p>
            <button 
              onClick={handleSubmit} 
              className="mt-2 text-[10px] font-black uppercase text-error underline underline-offset-4 hover:opacity-80"
            >
              Retry Submission
            </button>
          </div>
        </div>
      )}

      <button
        onClick={handleSubmit}
        disabled={rating === 0 || loading}
        className="w-full py-4 bg-primary text-white rounded-2xl font-black text-sm shadow-lg shadow-primary/20 flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 transition-all"
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        {loading ? 'Submitting…' : 'Submit Feedback'}
      </button>
    </motion.div>
  );
}

// ─── MAIN ServiceQualityView ──────────────────────────────────────────────────
export function ServiceQualityView({ payload, initialStage = 'en_route', onComplete, appLanguage }: WF5ViewProps) {
  const [stage, setStage] = useState<Stage>(initialStage);
  const [stageData, setStageData] = useState<Record<string, any>>({});
  
  // Enrich payload with user email from profile
  const profile = getUserProfile();
  const enrichedInitialPayload = {
    ...payload,
    user_email: payload.user_email || profile?.email || '',
  };

  const advance = (from: Stage, data: any) => {
    setStageData(prev => ({ ...prev, [from]: data }));
    const order: Stage[] = ['en_route', 'arrived', 'completed', 'feedback'];
    const next = order[order.indexOf(from) + 1];
    if (next) setStage(next);
  };

  const mergedPayload = { ...enrichedInitialPayload, ...(stageData[stage] || {}) };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4 pb-8">
      {/* Header */}
      <div className="glass-card rounded-[2rem] p-4 border border-outline-variant/20">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Activity className="w-5 h-5 text-primary fill-primary/20" />
          </div>
          <div>
            <h2 className="text-sm font-black text-on-surface">{appLanguage === 'urdu' ? 'لائیو سروس ٹریکنگ' : 'Live Service Tracking'}</h2>
            <p className="text-[10px] text-outline font-medium">{payload.booking_id}</p>
          </div>
          <div className="ml-auto flex items-center gap-1 bg-secondary/10 px-2.5 py-1 rounded-full">
            <div className="w-1.5 h-1.5 bg-secondary rounded-full animate-pulse" />
            <span className="text-[9px] font-black text-secondary uppercase tracking-wider">Live</span>
          </div>
        </div>
        <StageStepper current={stage} appLanguage={appLanguage} />
      </div>

      {/* Stage Content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={stage}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.2 }}
        >
          {stage === 'en_route' && (
            <EnRouteView payload={mergedPayload} onNext={d => advance('en_route', d)} appLanguage={appLanguage} />
          )}
          {stage === 'arrived' && (
            <ArrivedView payload={mergedPayload} onNext={d => advance('arrived', d)} />
          )}
          {stage === 'completed' && (
            <CompletedView payload={mergedPayload} onNext={d => advance('completed', d)} />
          )}
          {stage === 'feedback' && (
            <FeedbackView payload={mergedPayload} onComplete={onComplete} />
          )}
        </motion.div>
      </AnimatePresence>

      {/* Security Footer */}
      <div className="flex justify-center">
        <p className="text-[9px] text-outline font-bold uppercase tracking-[0.2em] flex items-center gap-2">
          <Shield className="w-3 h-3" />
          Protected by GharFix WF5
        </p>
      </div>
    </motion.div>
  );
}
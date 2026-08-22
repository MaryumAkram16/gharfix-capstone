import { motion } from 'motion/react';
import { Star, MapPin, CheckCircle2, Clock, Info, ArrowRight, ShieldCheck, TrendingUp, Sparkles, Hash, BadgeCheck, Award } from 'lucide-react';
import { useState } from 'react';
import { transformMatchData, MatchViewData, ProviderCardData } from '../lib/transformer';
import { BookingPayload } from './BookingView';
import { AppLanguage } from '../App';
import { getUserProfile } from '../lib/profile';

interface MatchViewProps {
  data?: any;
  onBook?: (payload: BookingPayload) => void;
  appLanguage: AppLanguage;
  onSearchAgain: () => void;
}

interface ProviderCardProps {
  key?: string | number;
  provider: ProviderCardData;
  isSelectedSlot: (slot: string) => boolean;
  onSelectSlot: (slot: string) => void;
  onBook: (provider: ProviderCardData) => void;
  isTopMatch?: boolean;
  appLanguage: AppLanguage;
  baselineRank?: number;
  agenticRank?: number;
}

function ProviderCard({ provider, isSelectedSlot, onSelectSlot, onBook, isTopMatch, appLanguage, baselineRank, agenticRank }: ProviderCardProps) {
  const translations = {
    english: {
      reviews: "reviews", score: "Score", startsFrom: "Starts From",
      earliestSlot: "Earliest Slot", trust: "Trust & Quality Scores",
      pickTime: "Pick a Time Slot", book: "Book This Provider",
      providerIdLabel: "Provider ID",
    },
    urdu: {
      reviews: "تبصرے", score: "اسکور", startsFrom: "شروع سے",
      earliestSlot: "سب سے پہلے وقت", trust: "بھروسہ اور معیار",
      pickTime: "وقت کا انتخاب کریں", book: "یہ فراہم کنندہ بک کریں",
      providerIdLabel: "پرووائیڈر آئی ڈی",
    },
    roman_urdu: {
      reviews: "reviews", score: "Score", startsFrom: "Starts From",
      earliestSlot: "Earliest Slot", trust: "Trust & Quality Scores",
      pickTime: "Pick a Time Slot", book: "Book This Provider",
      providerIdLabel: "Provider ID",
    },
  }[appLanguage];

  const selectedSlot = provider.availability_slots.find(s => isSelectedSlot(s));
  const canBook = provider.availability_slots.length === 0 || !!selectedSlot;

  return (
    <div className={`glass-card rounded-[2.5rem] p-6 border-2 bg-white shadow-xl relative overflow-hidden transition-all ${isTopMatch ? 'border-primary/20 hover:border-primary/40' : 'border-outline-variant/10 hover:border-outline-variant/30'}`}>
      {isTopMatch && <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-primary to-secondary" />}

      {/* Provider Header */}
      <div className="flex justify-between items-start mb-4">
        <div className="flex gap-4 flex-1 min-w-0">
          <div className={`w-16 h-16 rounded-2xl flex items-center justify-center relative shadow-inner shrink-0 ${isTopMatch ? 'bg-primary/10' : 'bg-surface-container-high'}`}>
            <span className={`text-2xl font-black ${isTopMatch ? 'text-primary' : 'text-on-surface-variant'}`}>
              {provider.name.charAt(0)}
            </span>
            {provider.verified && (
              <div className="absolute -bottom-1 -right-1 bg-white p-0.5 rounded-full shadow-md">
                <ShieldCheck className={`w-5 h-5 ${isTopMatch ? 'text-secondary' : 'text-primary'}`} />
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <h3 className="text-base font-black text-on-surface leading-tight truncate">{provider.name}</h3>
              {provider.verified && (
                <div className="flex items-center gap-1 bg-secondary/10 text-secondary px-2 py-0.5 rounded-full border border-secondary/20 shadow-sm">
                  <BadgeCheck className="w-3 h-3" />
                  <span className="text-[9px] font-black uppercase tracking-widest">Verified Pro</span>
                </div>
              )}
              {provider.rating >= 4.8 && (
                <div className="flex items-center gap-1 bg-primary/10 text-primary px-2 py-0.5 rounded-full border border-primary/20 shadow-sm">
                  <Award className="w-3 h-3" />
                  <span className="text-[9px] font-black uppercase tracking-widest">Highly Rated</span>
                </div>
              )}
            </div>
            {/* Provider ID — prominent and copyable */}
            <div className="flex items-center gap-1 mt-1 mb-1">
              <Hash className="w-3 h-3 text-outline shrink-0" />
              <span className="text-[10px] font-mono text-outline truncate max-w-[180px]" title={provider.id}>
                {provider.id}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1">
                <Star className="w-3.5 h-3.5 text-secondary fill-secondary" />
                <span className="text-xs font-black text-secondary">{provider.rating}</span>
              </div>
              <span className="text-[10px] text-on-surface-variant/60 font-medium">({provider.reviews} {translations.reviews})</span>
            </div>
            <p className="text-[10px] text-outline mt-0.5 font-medium">
              {provider.distance_km} km away
              {provider.location?.address ? ` · ${provider.location.address}` : ''}
            </p>
          </div>
        </div>
        <div className="text-right shrink-0 ml-2">
          <div className={`text-2xl font-black leading-none ${isTopMatch ? 'text-primary' : 'text-on-surface-variant'}`}>
            {provider.computed_score}
          </div>
          <div className="text-[8px] font-bold text-outline uppercase tracking-widest mt-1">{translations.score}</div>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-surface-container-lowest p-3 rounded-2xl border border-outline-variant/10 text-center">
          <span className="block text-[8px] font-bold text-outline uppercase mb-1">{translations.startsFrom}</span>
          <span className="text-sm font-black text-on-surface">₨ {provider.price_from.toLocaleString()}</span>
        </div>
        <div className="bg-surface-container-lowest p-3 rounded-2xl border border-outline-variant/10 text-center">
          <span className="block text-[8px] font-bold text-outline uppercase mb-1">{translations.earliestSlot}</span>
          <span className="text-sm font-black text-on-surface">{provider.arrival_time !== 'N/A' ? provider.arrival_time : provider.availability_slots[0] || '—'}</span>
        </div>
      </div>

      {/* Match Reason */}
      {provider.match_reason && (
        <div className={`${isTopMatch ? 'bg-primary/5 border-primary/10' : 'bg-surface-container-low border-outline-variant/10'} rounded-2xl p-3 mb-4 border`}>
          <p className="text-[11px] text-on-surface-variant leading-relaxed italic">"{provider.match_reason}"</p>
        </div>
      )}

      {/* Score Breakdown */}
      {provider.score_breakdown && (
        <div className="mb-4 space-y-3 bg-surface-container-lowest/50 p-4 rounded-3xl border border-outline-variant/10">
          <div className="flex justify-between items-center px-1">
            <span className="text-[10px] font-black text-outline uppercase tracking-widest">{translations.trust}</span>
            <div className="flex items-center gap-1">
              <TrendingUp className={`w-3 h-3 ${isTopMatch ? 'text-primary' : 'text-on-surface-variant'}`} />
              <span className={`text-[10px] font-black ${isTopMatch ? 'text-primary' : 'text-on-surface-variant'}`}>{provider.computed_score}%</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-3">
            {Object.entries(provider.score_breakdown)
              .filter(([k, v]) => k !== 'total' && typeof v === 'number')
              .map(([key, val]) => (
                <div key={key} className="space-y-1.5">
                  <div className="flex justify-between text-[9px] px-0.5">
                    <span className="capitalize text-on-surface-variant font-bold">{key}</span>
                    <span className="text-on-surface font-black">{val}%</span>
                  </div>
                  <div className="h-1 w-full bg-outline-variant/20 rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${val}%` }}
                      transition={{ duration: 1, delay: 0.2, ease: 'easeOut' }}
                      className={`h-full rounded-full ${Number(val) > 80 ? 'bg-secondary' : 'bg-primary/60'}`}
                    />
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Baseline vs Agentic Rank Comparison — always shown */}
      {baselineRank !== undefined && agenticRank !== undefined && (
        <div className="mb-4 rounded-2xl border border-outline-variant/20 overflow-hidden">
          {/* Header */}
          <div className="bg-surface-container-low px-4 py-2 flex items-center gap-2 border-b border-outline-variant/10">
            <TrendingUp className="w-3 h-3 text-primary" />
            <span className="text-[9px] font-black text-outline uppercase tracking-widest">Why AI ranked this provider here</span>
          </div>
          {/* Rank row */}
          <div className="flex items-stretch divide-x divide-outline-variant/15 bg-white">
            {/* Baseline side */}
            <div className="flex-1 px-4 py-3 flex flex-col gap-0.5">
              <span className="text-[9px] font-bold text-outline uppercase tracking-widest">Distance only</span>
              <div className="flex items-baseline gap-1.5">
                <span className="text-xl font-black text-on-surface-variant">#{baselineRank}</span>
                <span className="text-[9px] text-outline">naive rank</span>
              </div>
            </div>
            {/* Arrow */}
            <div className="flex items-center px-3 bg-surface-container-lowest">
              <ArrowRight className="w-4 h-4 text-outline-variant" />
            </div>
            {/* Agentic side */}
            <div className={`flex-1 px-4 py-3 flex flex-col gap-0.5 ${isTopMatch ? 'bg-secondary/5' : 'bg-primary/5'}`}>
              <span className="text-[9px] font-bold text-outline uppercase tracking-widest">7-factor AI</span>
              <div className="flex items-baseline gap-1.5">
                <span className={`text-xl font-black ${isTopMatch ? 'text-secondary' : 'text-primary'}`}>#{agenticRank}</span>
                <span className="text-[9px] text-outline">agentic rank</span>
              </div>
            </div>
          </div>
          {/* Delta pill */}
          {baselineRank !== agenticRank && (
            <div className={`px-4 py-2 text-center text-[10px] font-black ${
              baselineRank > agenticRank
                ? 'bg-secondary/8 text-secondary'
                : 'bg-surface-container text-outline'
            }`}>
              {baselineRank > agenticRank
                ? `↑ Moved up ${baselineRank - agenticRank} place${baselineRank - agenticRank > 1 ? 's' : ''} — better rating, availability & reliability than closer providers`
                : `↓ Moved down ${agenticRank - baselineRank} place${agenticRank - baselineRank > 1 ? 's' : ''} — closer but scored lower on quality factors`
              }
            </div>
          )}
          {baselineRank === agenticRank && (
            <div className="px-4 py-2 text-center text-[10px] font-bold text-outline bg-surface-container-low">
              Same rank — nearest provider also has the best overall score
            </div>
          )}
        </div>
      )}

      {/* Badges */}
      {provider.badges.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {provider.badges.map((badge, i) => (
            <span key={i} className={`text-[9px] font-bold px-3 py-1 rounded-full uppercase ${isTopMatch ? 'bg-primary/10 text-primary' : 'bg-outline-variant/10 text-on-surface-variant'}`}>
              {badge}
            </span>
          ))}
        </div>
      )}

      {/* Slot Selection */}
      {provider.availability_slots.length > 0 && (
        <div className="mb-5">
          <div className="flex items-center gap-2 mb-3">
            <Clock className="w-3.5 h-3.5 text-secondary" />
            <span className="text-[10px] font-black text-outline uppercase tracking-widest">{translations.pickTime}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {provider.availability_slots.map(slot => {
              const active = isSelectedSlot(slot);
              return (
                <button
                  key={slot}
                  onClick={() => onSelectSlot(slot)}
                  className={`px-4 py-2 rounded-xl text-xs font-bold border transition-all active:scale-95 ${
                    active
                      ? 'bg-secondary text-white border-secondary shadow-md shadow-secondary/20 scale-105'
                      : 'bg-surface-container-lowest text-on-surface-variant border-outline-variant/30 hover:border-secondary/40 hover:text-secondary'
                  }`}
                >
                  {slot}
                  {active && <CheckCircle2 className="w-3 h-3 inline ml-1.5 -mt-0.5" />}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* CTA */}
      <button
        onClick={() => onBook(provider)}
        disabled={!canBook}
        className={`w-full py-4 rounded-2xl font-black text-sm shadow-lg transition-all flex items-center justify-center gap-2 group disabled:opacity-40 disabled:cursor-not-allowed hover:scale-[1.02] active:scale-95 ${isTopMatch ? 'bg-primary text-white shadow-primary/20' : 'bg-on-surface text-white'}`}
      >
        {translations.book}
        <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
      </button>
    </div>
  );
}

export function MatchView({ data, onBook, appLanguage, onSearchAgain }: MatchViewProps) {
  const [selectedBooking, setSelectedBooking] = useState<{ provider: string; slot: string } | null>(null);
  const [showAllAlternatives, setShowAllAlternatives] = useState(false);

  const t = {
    english: {
      finding: "Finding Your Best Match",
      scanning: "We're scanning 20+ verified providers in your area...",
      noMatches: "No Providers Available",
      noMatchesText: "We couldn't find available providers for your request right now.",
      nearbyAreas: "Try searching in nearby areas:",
      tryAgain: "Try Again",
      found: "Found", estimate: "Estimated Cost", total: "approx. total",
      disclaimer: "Final price may vary slightly based on actual work required.",
      topRated: "Top Rated Match", alternative: "Alternative Providers",
      secure: "Secure Booking · Protected by KhidmatGaar",
      showMore: "Show More Providers", showLess: "Show Less Providers",
      changeSearch: "Search Again",
    },
    urdu: {
      finding: "ہم آپ کے لیے بہترین میاچ تلاش کر رہے ہیں",
      scanning: "ہم آپ کے علاقے میں 20 سے زیادہ تصدیق شدہ فراہم کنندگان کی جانچ کر رہے ہیں...",
      noMatches: "کوئی فراہم کنندہ دستیاب نہیں",
      noMatchesText: "ہمیں ابھی آپ کی درخواست کے لیے کوئی دستیاب فراہم کنندہ نہیں ملا۔",
      nearbyAreas: "قریبی علاقوں میں تلاش کریں:",
      tryAgain: "دوبارہ کوشش کریں",
      found: "مل گئے", estimate: "متوقع قیمت", total: "تقریباً",
      disclaimer: "کام کی نوعیت کے مطابق حتمی قیمت تھوڑی تبدیل ہو سکتی ہے۔",
      topRated: "بہترین انتخاب", alternative: "دیگر فراہم کنندگان",
      secure: "محفوظ بکنگ بذریعہ خدمت گار",
      showMore: "مزید فراہم کنندگان", showLess: "کم فراہم کنندگان",
      changeSearch: "دوبارہ تلاش کریں",
    },
    roman_urdu: {
      finding: "Finding Your Best Match",
      scanning: "We're scanning 20+ verified providers in your area...",
      noMatches: "No Providers Available",
      noMatchesText: "We couldn't find available providers for your request right now.",
      nearbyAreas: "Try searching in nearby areas:",
      tryAgain: "Try Again",
      found: "Found", estimate: "Estimated Cost", total: "approx. total",
      disclaimer: "Final price may vary slightly based on actual work required.",
      topRated: "Top Rated Match", alternative: "Alternative Providers",
      secure: "Secure Booking · Protected by KhidmatGaar",
      showMore: "Show More Providers", showLess: "Show Less Providers",
      changeSearch: "Search Again",
    },
  }[appLanguage];

  const uiData: MatchViewData = data
    ? transformMatchData(data)
    : {
        status: 'loading', stage: 'searching', location: 'Detecting...', service_type: 'Service',
        header: { service: 'Searching...', location: '...', providers_found: 0 },
        pricing_card: { title: t.estimate, total: 0, currency: 'PKR', breakdown: [], badges: [] },
        top_provider_card: null, alternative_cards: [],
      };

  const handleSelectSlot = (providerName: string, slot: string) => {
    setSelectedBooking(prev =>
      prev?.provider === providerName && prev?.slot === slot ? null : { provider: providerName, slot }
    );
  };

  const handleBooking = (provider: ProviderCardData) => {
    // Use the selected slot, or the first available, or a default
    const slot = (selectedBooking?.provider === provider.name ? selectedBooking.slot : null)
      || provider.availability_slots[0]
      || '09:00';

    const today = new Date().toISOString().split('T')[0];

    const allProviders = [
      ...(uiData.top_provider_card ? [uiData.top_provider_card] : []),
      ...uiData.alternative_cards,
    ];
    const alternatives = allProviders
      .filter(p => p.id !== provider.id)
      .map(p => ({
        id: p.id,
        place_id: p.id,
        name: p.name,
        rating: p.rating,
        computed_score: p.computed_score,
        distance_km: p.distance_km,
        estimated_arrival: p.arrival_time,
        availability_slots: p.availability_slots,
        address: p.location?.address || '',
        coordinates: p.location ? { lat: p.location.lat, lng: p.location.lng } : undefined,
      }));

    const profile = getUserProfile();
    const payload: BookingPayload = {
      action: 'confirm',
      provider_id: provider.id,          // place_id from Google Maps / provider schema
      provider_name: provider.name,
      service_type: uiData.header.service,
      location: uiData.header.location,
      price_pkr: provider.price_from,
      slot,
      booking_date: today,
      user_name: profile?.name || 'Guest User',
      user_email: profile?.email || '',
      alternatives,
    };

    onBook?.(payload);
  };

  if (!data || uiData.status === 'loading') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center space-y-6 px-4">
        <div className="relative">
          <div className="w-16 h-16 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
          <Sparkles className="w-6 h-6 text-primary absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium text-on-surface-variant">{t.finding}</p>
          <p className="text-xs text-outline">{t.scanning}</p>
        </div>
      </div>
    );
  }

  if (uiData.status === 'error' || uiData.status === 'no_matches' || (!uiData.top_provider_card && uiData.alternative_cards.length === 0)) {
    const hasNearbyAreas = uiData.nearby_areas && uiData.nearby_areas.length > 0;
    
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center space-y-6 px-4">
        <div className="relative">
          <div className="w-16 h-16 rounded-full bg-surface-container-low flex items-center justify-center">
            <Info className="w-8 h-8 text-outline" />
          </div>
        </div>
        <div className="space-y-2 max-w-sm">
          <p className="text-sm font-bold text-on-surface">{t.noMatches}</p>
          <p className="text-xs text-outline">{uiData.no_match_reason || t.noMatchesText}</p>
        </div>

        {/* Nearby Areas Suggestions */}
        {hasNearbyAreas && (
          <div className="w-full max-w-sm bg-surface-container-low rounded-2xl p-4 border border-outline-variant/20">
            <p className="text-xs font-bold text-outline uppercase tracking-wider mb-3">{t.nearbyAreas}</p>
            <div className="space-y-2">
              {uiData.nearby_areas!.map((area, idx) => (
                <button
                  key={idx}
                  onClick={() => {
                    // Store the selected area and trigger search again
                    // This will be handled by the parent component
                    onSearchAgain();
                  }}
                  className="w-full px-4 py-2.5 bg-white border border-primary/20 text-primary rounded-xl font-semibold text-sm hover:bg-primary/5 hover:border-primary/40 active:scale-95 transition-all flex items-center justify-between group"
                >
                  <span>{area}</span>
                  <span className="text-xs opacity-0 group-hover:opacity-100 transition-opacity">→</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <button onClick={onSearchAgain} className="px-6 py-3 bg-primary text-white rounded-2xl font-bold text-sm shadow-md shadow-primary/20 active:scale-95 transition-all hover:shadow-lg">
          {t.tryAgain}
        </button>
      </div>
    );
  }

  const initialAlternatives = uiData.alternative_cards.slice(0, 2);
  const remainingAlternatives = uiData.alternative_cards.slice(2);

  // Compute baseline (distance-only) rankings for all providers
  const allProvidersList = [
    ...(uiData.top_provider_card ? [uiData.top_provider_card] : []),
    ...uiData.alternative_cards,
  ];
  const baselineRanked = [...allProvidersList].sort((a, b) => a.distance_km - b.distance_km);
  const getBaselineRank = (id: string) => baselineRanked.findIndex(p => p.id === id) + 1;
  const getAgenticRank = (id: string) => allProvidersList.findIndex(p => p.id === id) + 1;


  const renderPricingBreakdown = () => {
    const breakdown = uiData.pricing_card.breakdown;
    if (!breakdown) return null;
    const entries = Array.isArray(breakdown)
      ? breakdown.map((item: any) => [item.label || 'Item', typeof item.value === 'number' ? item.value : 0])
      : Object.entries(breakdown);

    return entries.map(([label, value]: any[]) => (
      <div key={label} className="flex justify-between">
        <span className="text-on-surface-variant capitalize">{String(label).replace(/_/g, ' ')}</span>
        <span className="font-medium text-on-surface">₨ {Number(value).toLocaleString()}</span>
      </div>
    ));
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="max-w-4xl mx-auto space-y-6"
    >
      {/* Summary header */}
      <div className="text-center pt-2">
        <p className="text-sm text-on-surface-variant">
          <span className="font-black text-primary">{uiData.header.providers_found}</span> providers found for{' '}
          <span className="font-bold">{uiData.header.service}</span> near{' '}
          <span className="font-bold">{uiData.header.location}</span>
        </p>
        <p className="text-[10px] text-outline mt-1 flex items-center justify-center gap-1">
          <ShieldCheck className="w-3 h-3" /> {t.secure}
        </p>
      </div>

      {/* Pricing Card */}
      {uiData.pricing_card.total > 0 && (
        <div className="bg-surface-container-low rounded-3xl p-5 shadow-lg border border-outline-variant/10">
          <div className="flex justify-between items-center mb-2">
            <h2 className="text-base font-black text-on-surface">{uiData.pricing_card.title}</h2>
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-black text-primary leading-none">₨ {uiData.pricing_card.total.toLocaleString()}</span>
              <span className="text-xs font-bold text-outline uppercase">{t.total}</span>
            </div>
          </div>
          <p className="text-xs text-outline-variant mb-3">{t.disclaimer}</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">{renderPricingBreakdown()}</div>
        </div>
      )}

      {/* Top Provider */}
      {uiData.top_provider_card && (
        <div>
          <h2 className="text-lg font-black text-on-surface mb-3">{t.topRated}</h2>
          <ProviderCard
            provider={uiData.top_provider_card}
            isSelectedSlot={slot => selectedBooking?.provider === uiData.top_provider_card!.name && selectedBooking?.slot === slot}
            onSelectSlot={slot => handleSelectSlot(uiData.top_provider_card!.name, slot)}
            onBook={handleBooking}
            isTopMatch
            appLanguage={appLanguage}
            baselineRank={getBaselineRank(uiData.top_provider_card.id)}
            agenticRank={getAgenticRank(uiData.top_provider_card.id)}
          />
        </div>
      )}

      {/* Initial Alternatives */}
      {initialAlternatives.length > 0 && (
        <div>
          <h2 className="text-lg font-black text-on-surface mb-3">{t.alternative}</h2>
          <div className="space-y-6">
            {initialAlternatives.map(p => (
              <ProviderCard
                key={p.id}
                provider={p}
                isSelectedSlot={slot => selectedBooking?.provider === p.name && selectedBooking?.slot === slot}
                onSelectSlot={slot => handleSelectSlot(p.name, slot)}
                onBook={handleBooking}
                appLanguage={appLanguage}
                baselineRank={getBaselineRank(p.id)}
                agenticRank={getAgenticRank(p.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* More Alternatives */}
      {showAllAlternatives && remainingAlternatives.length > 0 && (
        <div className="space-y-6">
          {remainingAlternatives.map(p => (
            <ProviderCard
              key={p.id}
              provider={p}
              isSelectedSlot={slot => selectedBooking?.provider === p.name && selectedBooking?.slot === slot}
              onSelectSlot={slot => handleSelectSlot(p.name, slot)}
              onBook={handleBooking}
              appLanguage={appLanguage}
              baselineRank={getBaselineRank(p.id)}
              agenticRank={getAgenticRank(p.id)}
            />
          ))}
        </div>
      )}

      {remainingAlternatives.length > 0 && (
        <div className="text-center">
          <button
            onClick={() => setShowAllAlternatives(v => !v)}
            className="px-6 py-3 rounded-full bg-secondary text-white font-bold text-sm shadow-md hover:bg-secondary/90 active:scale-95 transition-all"
          >
            {showAllAlternatives ? t.showLess : `${t.showMore} (${remainingAlternatives.length})`}
          </button>
        </div>
      )}

      {/* Search again */}
      <div className="text-center pt-4 border-t border-outline-variant/20">
        <button
          onClick={onSearchAgain}
          className="px-6 py-3 rounded-full bg-surface-container-high text-on-surface-variant font-bold text-sm shadow-md hover:bg-surface-container-high/90 active:scale-95 transition-all"
        >
          {t.changeSearch}
        </button>
      </div>
    </motion.div>
  );
}
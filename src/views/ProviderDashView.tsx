import { motion } from 'motion/react';
import { TrendingUp, Wallet, Star, Activity, Sparkles } from 'lucide-react';
import { useState, useEffect } from 'react';
import { AppLanguage } from '../App';
import { getProviderData, saveProviderData } from '../lib/profile';

interface ProviderDashViewProps {
  appLanguage: AppLanguage;
  providerId: string;
}

interface WF8Data {
  provider_id: string;
  provider_name: string;
  workload: {
    bookings_today: number;
    max_capacity: number;
    utilization_rate_pct: number;
    status: string;
    slots_booked_today: string[];
    slots_open_today: string[];
    slots_remaining: number;
  };
  earnings: {
    total_completed_jobs: number;
    total_earnings_pkr: number;
    avg_per_job_pkr: number;
    platform_avg_pkr: number;
    earning_index: number;
    earning_fairness: string;
  };
  reputation: {
    avg_rating: number | null;
    total_ratings: number;
    reputation_health: string;
  };
  cancellations: {
    total_cancelled: number;
    cancellation_rate_pct: number;
    status: string;
  };
  optimization_tips: string[];
}

export function ProviderDashView({ appLanguage, providerId }: ProviderDashViewProps) {
  const [providerData, setProviderData] = useState<WF8Data | null>(getProviderData());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchProviderData = async () => {
      if (!providerId) {
        setError('Provider ID is missing.');
        return;
      }
      setLoading(true);
      try {
        // Replace with your actual WF8 webhook URL
        const response = await fetch('/api/proxy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: 'khadmat-provider-dashboard', provider_id: providerId }),
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const resText = await response.text();
        if (!resText) {
          throw new Error('Empty response from server.');
        }

        const rawData = JSON.parse(resText);
        // Unpack single-item array if necessary
        const data = Array.isArray(rawData) && rawData.length > 0 ? rawData[0] : rawData;
        
        if (data.status === 'validation_error') {
          setError(data.message);
        } else {
          setProviderData(data);
          saveProviderData(data);
        }
      } catch (e: any) {
        setError(`Failed to fetch provider data: ${e.message}`);
      } finally {
        setLoading(false);
      }
    };

    if (!providerData || providerData.provider_id !== providerId) {
      fetchProviderData();
    }
  }, [providerId]);

  if (loading && !providerData) {
    return (
      <div className="flex flex-col items-center justify-center py-20 space-y-4">
        <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
        <p className="text-on-surface-variant font-medium">Fetching provider insights...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-error/10 border border-error/30 rounded-2xl p-6 text-center space-y-3">
        <p className="text-error font-bold">Data Fetch Error</p>
        <p className="text-sm text-on-surface-variant">{error}</p>
        <button 
          onClick={() => window.location.reload()}
          className="px-4 py-2 bg-error text-white rounded-lg text-xs font-bold"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!providerData) {
    return <div className="text-center py-8">No provider data available.</div>;
  }

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }} 
      animate={{ opacity: 1, y: 0 }} 
      className="space-y-6 pb-10"
    >
      {/* Header Section */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-black text-primary tracking-tight">Provider Dashboard</h2>
          <p className="text-xs text-on-surface-variant font-medium uppercase tracking-widest">ID: {providerId}</p>
        </div>
        <div className="w-12 h-12 bg-secondary/10 rounded-2xl flex items-center justify-center">
          <TrendingUp className="w-6 h-6 text-secondary" />
        </div>
      </div>

      {/* Workload Card */}
      <div className="glass-card rounded-[2rem] p-6 shadow-sm bg-white/80 border border-white/50 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center">
            <Activity className="w-5 h-5 text-primary" />
          </div>
          <h3 className="text-lg font-bold text-on-surface">Workload Today</h3>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-surface-container-low p-4 rounded-2xl">
            <p className="text-[10px] font-black text-outline uppercase tracking-widest mb-1">Status</p>
            <p className="text-sm font-bold text-primary">{providerData.workload.status}</p>
          </div>
          <div className="bg-surface-container-low p-4 rounded-2xl">
            <p className="text-[10px] font-black text-outline uppercase tracking-widest mb-1">Utilization</p>
            <p className="text-sm font-bold text-primary">{providerData.workload.utilization_rate_pct}%</p>
          </div>
        </div>
        <div className="bg-primary/5 p-4 rounded-2xl border border-primary/10">
          <p className="text-xs font-medium text-on-surface-variant">
            You have <span className="font-bold text-primary">{providerData.workload.bookings_today}</span> confirmed bookings out of <span className="font-bold text-primary">{providerData.workload.max_capacity}</span> max capacity.
          </p>
        </div>
      </div>

      {/* Earnings Card */}
      <div className="glass-card rounded-[2rem] p-6 shadow-sm bg-white/80 border border-white/50 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-secondary/10 rounded-xl flex items-center justify-center">
            <Wallet className="w-5 h-5 text-secondary" />
          </div>
          <h3 className="text-lg font-bold text-on-surface">Earnings Overview</h3>
        </div>
        <div className="space-y-3">
          <div className="flex justify-between items-end">
            <p className="text-sm font-medium text-on-surface-variant">Total Earnings</p>
            <p className="text-2xl font-black text-secondary">₨ {providerData.earnings.total_earnings_pkr.toLocaleString()}</p>
          </div>
          <div className="h-2 bg-surface-container-high rounded-full overflow-hidden">
            <div className="h-full bg-secondary w-3/4 rounded-full"></div>
          </div>
          <div className="flex justify-between text-[10px] font-black text-outline uppercase tracking-widest">
            <span>Avg/Job: ₨ {providerData.earnings.avg_per_job_pkr.toLocaleString()}</span>
            <span>Fairness: {providerData.earnings.earning_fairness}</span>
          </div>
        </div>
      </div>

      {/* Reputation Card */}
      <div className="grid grid-cols-2 gap-4">
        <div className="glass-card rounded-[2rem] p-5 shadow-sm bg-white/80 border border-white/50 flex flex-col items-center text-center space-y-2">
          <div className="w-10 h-10 bg-yellow-400/10 rounded-full flex items-center justify-center">
            <Star className="w-5 h-5 text-yellow-500 fill-current" />
          </div>
          <p className="text-[10px] font-black text-outline uppercase tracking-widest">Avg Rating</p>
          <p className="text-xl font-black text-on-surface">{providerData.reputation.avg_rating ? providerData.reputation.avg_rating.toFixed(1) : 'N/A'}</p>
          <p className="text-[10px] font-bold text-yellow-600 bg-yellow-400/10 px-2 py-0.5 rounded-full">{providerData.reputation.reputation_health}</p>
        </div>
        <div className="glass-card rounded-[2rem] p-5 shadow-sm bg-white/80 border border-white/50 flex flex-col items-center text-center space-y-2">
          <div className="w-10 h-10 bg-error/10 rounded-full flex items-center justify-center">
            <div className="w-5 h-5 border-2 border-error rounded-full flex items-center justify-center text-[10px] font-black text-error">!</div>
          </div>
          <p className="text-[10px] font-black text-outline uppercase tracking-widest">Cancellations</p>
          <p className="text-xl font-black text-on-surface">{providerData.cancellations.cancellation_rate_pct.toFixed(0)}%</p>
          <p className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${providerData.cancellations.status === 'GOOD' ? 'text-green-600 bg-green-400/10' : 'text-error bg-error/10'}`}>
            {providerData.cancellations.status}
          </p>
        </div>
      </div>

      {/* Optimization Tips */}
      <div className="ai-gradient-border glass-card rounded-[2rem] p-6 shadow-md bg-white/95 space-y-4">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-primary" />
          <h3 className="text-sm font-black text-primary uppercase tracking-widest">AI Optimization Tips</h3>
        </div>
        <div className="space-y-3">
          {providerData.optimization_tips.map((tip, index) => (
            <div key={index} className="flex gap-3">
              <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-primary shrink-0"></div>
              <p className="text-xs font-medium text-on-surface-variant leading-relaxed">{tip}</p>
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
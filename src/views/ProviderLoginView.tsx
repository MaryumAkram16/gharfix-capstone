import { motion } from 'motion/react';
import { LogIn, Briefcase, User as UserIcon, Mail, ChevronDown } from 'lucide-react';
import { useState, FormEvent } from 'react';
import { loginAsProvider, loginAsUser } from '../lib/profile';

interface ProviderLoginViewProps {
  onLoginSuccess: () => void;
}

function getKnownProviders(): Array<{ id: string; name: string }> {
  try {
    const raw = localStorage.getItem('khidmatgaar_bookings');
    const bookings: any[] = raw ? JSON.parse(raw) : [];
    const seen = new Map<string, string>();
    for (const b of bookings) {
      if (b.provider_id && b.provider_name && !seen.has(b.provider_id)) {
        seen.set(b.provider_id, b.provider_name);
      }
    }
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  } catch {
    return [];
  }
}

export function ProviderLoginView({ onLoginSuccess }: ProviderLoginViewProps) {
  const [activeTab, setActiveTab] = useState<'user' | 'provider'>('user');
  const [userName, setUserName] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [providerIdInput, setProviderIdInput] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const knownProviders = getKnownProviders();
  const [error, setError] = useState('');

  const handleUserLogin = (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!userName.trim() || !userEmail.trim()) {
      setError('Please enter both your name and email.');
      return;
    }
    loginAsUser(userName.trim(), userEmail.trim());
    onLoginSuccess();
  };

  const handleProviderLogin = (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!providerIdInput.trim()) {
      setError('Please select or enter a Provider ID.');
      return;
    }
    loginAsProvider(providerIdInput.trim());
    onLoginSuccess();
  };

  return (
    <div className="flex-grow flex flex-col items-center justify-center min-h-screen pt-20 pb-8 relative overflow-hidden bg-gradient-to-br from-background via-primary-fixed/30 to-background">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-10 flex flex-col items-center z-10">
        <div className="relative mb-4">
          <div className="absolute inset-0 bg-primary/20 rounded-full blur-3xl scale-125"></div>
          <div className="w-20 h-20 bg-primary rounded-2xl flex items-center justify-center shadow-2xl relative z-10">
            <LogIn className="w-10 h-10 text-on-primary fill-current" />
          </div>
        </div>
        <h1 className="text-3xl font-extrabold text-primary tracking-tight">Welcome Back</h1>
        <p className="mt-3 text-sm text-on-surface-variant font-medium text-center">Choose your role to continue to KhidmatGaar.</p>
      </motion.div>

      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.1 }} className="w-full max-w-sm z-10 px-4">
        <div className="flex p-1 bg-surface-container-high rounded-2xl mb-6 shadow-inner">
          <button onClick={() => { setActiveTab('user'); setError(''); }} className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all ${activeTab === 'user' ? 'bg-white text-primary shadow-sm' : 'text-on-surface-variant hover:text-on-surface'}`}>User</button>
          <button onClick={() => { setActiveTab('provider'); setError(''); }} className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all ${activeTab === 'provider' ? 'bg-white text-primary shadow-sm' : 'text-on-surface-variant hover:text-on-surface'}`}>Provider</button>
        </div>

        <div className="glass-card rounded-[2rem] p-6 shadow-xl border-t border-l border-white/60">
          {activeTab === 'user' ? (
            <form onSubmit={handleUserLogin} className="space-y-5">
              <div className="space-y-2">
                <label className="block text-xs font-black text-outline uppercase tracking-widest">Full Name <span className="text-error">*</span></label>
                <div className="relative">
                  <UserIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-outline pointer-events-none" />
                  <input type="text" value={userName} onChange={(e) => setUserName(e.target.value)} placeholder="Enter your name" className="w-full pl-10 pr-4 py-3 rounded-xl border-2 border-outline-variant/30 focus:border-primary bg-surface-container-lowest text-on-surface placeholder:text-outline/50 outline-none transition-colors" />
                </div>
              </div>
              <div className="space-y-2">
                <label className="block text-xs font-black text-outline uppercase tracking-widest">Email Address <span className="text-error">*</span></label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-outline pointer-events-none" />
                  <input type="email" value={userEmail} onChange={(e) => setUserEmail(e.target.value)} placeholder="Enter your email" className="w-full pl-10 pr-4 py-3 rounded-xl border-2 border-outline-variant/30 focus:border-primary bg-surface-container-lowest text-on-surface placeholder:text-outline/50 outline-none transition-colors" />
                </div>
              </div>
              {error && <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="bg-error/10 border border-error/30 rounded-xl p-3"><p className="text-xs text-error font-medium">{error}</p></motion.div>}
              <button type="submit" className="w-full py-4 bg-primary text-on-primary rounded-xl font-bold text-lg shadow-xl shadow-primary/20 flex items-center justify-center gap-2 hover:opacity-90 active:scale-95 transition-all">
                <LogIn className="w-5 h-5" />Login as User
              </button>
            </form>
          ) : (
            <form onSubmit={handleProviderLogin} className="space-y-5">
              <div className="space-y-2">
                <label className="block text-xs font-black text-outline uppercase tracking-widest">Provider <span className="text-error">*</span></label>

                {knownProviders.length > 0 ? (
                  <div className="relative">
                    <button type="button" onClick={() => setShowDropdown(v => !v)}
                      className="w-full flex items-center justify-between px-4 py-3 rounded-xl border-2 border-outline-variant/30 bg-surface-container-lowest hover:border-primary transition-colors">
                      <div className="flex items-center gap-3 min-w-0">
                        <Briefcase className="w-4 h-4 text-outline shrink-0" />
                        <span className={`text-sm truncate ${providerIdInput ? 'font-bold text-primary' : 'text-outline/60'}`}>
                          {providerIdInput ? (knownProviders.find(p => p.id === providerIdInput)?.name || providerIdInput) : 'Select a provider…'}
                        </span>
                      </div>
                      <ChevronDown className={`w-4 h-4 text-outline shrink-0 transition-transform duration-200 ${showDropdown ? 'rotate-180' : ''}`} />
                    </button>

                    {showDropdown && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setShowDropdown(false)} />
                        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-outline-variant/30 rounded-xl shadow-xl z-50 overflow-hidden max-h-64 flex flex-col">
                          <div className="overflow-y-auto flex-1 scrollbar-thin scrollbar-thumb-primary/30 scrollbar-track-surface-container-low">
                            {knownProviders.map(p => (
                              <button key={p.id} type="button" onClick={() => { setProviderIdInput(p.id); setShowDropdown(false); }}
                                className={`w-full flex flex-col items-start px-4 py-3 hover:bg-primary/5 transition-colors border-b border-outline-variant/10 last:border-0 text-left ${providerIdInput === p.id ? 'bg-primary/5' : ''}`}>
                                <span className="text-sm font-bold text-on-surface">{p.name}</span>
                                <span className="text-[10px] font-mono text-outline truncate w-full mt-0.5">{p.id}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="relative">
                    <Briefcase className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-outline pointer-events-none" />
                    <input type="text" value={providerIdInput} onChange={(e) => setProviderIdInput(e.target.value)}
                      placeholder="Enter Provider ID (Google Place ID)"
                      className="w-full pl-10 pr-4 py-3 rounded-xl border-2 border-outline-variant/30 focus:border-primary bg-surface-container-lowest text-on-surface placeholder:text-outline/50 outline-none transition-colors font-mono text-xs" />
                  </div>
                )}

                {knownProviders.length === 0 && (
                  <p className="text-[10px] text-outline leading-relaxed">No providers yet — complete a booking as a user first. Booked providers will appear here automatically.</p>
                )}
              </div>

              {error && <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="bg-error/10 border border-error/30 rounded-xl p-3"><p className="text-xs text-error font-medium">{error}</p></motion.div>}

              <button type="submit" className="w-full py-4 bg-primary text-on-primary rounded-xl font-bold text-lg shadow-xl shadow-primary/20 flex items-center justify-center gap-2 hover:opacity-90 active:scale-95 transition-all">
                <LogIn className="w-5 h-5" />Login as Provider
              </button>
            </form>
          )}
        </div>
      </motion.div>
    </div>
  );
}
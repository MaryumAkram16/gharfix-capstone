import { motion } from 'motion/react';
import { Users, CreditCard, Bot, ArrowRight, Shield, Mail, User as UserIcon } from 'lucide-react';
import { useState, FormEvent } from 'react';
import { loginAsUser, saveUserProfile, hasUserProfile } from '../lib/profile';

export function OnboardingView({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState<'intro' | 'profile'>('intro');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleProfileSetup = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    // Validation
    if (!name.trim()) {
      setError('Please enter your name');
      return;
    }
    if (!email.trim() || !email.includes('@')) {
      setError('Please enter a valid email address');
      return;
    }

    setLoading(true);
    try {
      loginAsUser(name.trim(), email.trim());
      setLoading(false);
      onComplete();
    } catch (err) {
      setError('Failed to save profile. Please try again.');
      setLoading(false);
    }
  };

  const handleSkipProfile = () => {
    onComplete();
  };

  if (step === 'profile') {
    return (
      <div className="flex-grow flex flex-col items-center justify-center min-h-screen pt-20 pb-8 relative overflow-hidden bg-gradient-to-br from-background via-primary-fixed/30 to-background">
        {/* Background Decorative */}
        <div className="absolute top-1/4 -right-20 w-64 h-64 bg-secondary-container/40 rounded-full blur-[80px] pointer-events-none"></div>
        <div className="absolute bottom-1/4 -left-20 w-80 h-80 bg-primary-fixed/50 rounded-full blur-[80px] pointer-events-none"></div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-10 flex flex-col items-center z-10"
        >
          <div className="relative mb-4">
            <div className="absolute inset-0 bg-primary/20 rounded-full blur-3xl scale-125"></div>
            <div className="w-20 h-20 bg-primary rounded-2xl flex items-center justify-center shadow-2xl relative z-10">
              <UserIcon className="w-10 h-10 text-on-primary fill-current" />
            </div>
          </div>
          <h1 className="text-3xl font-extrabold text-primary tracking-tight">Let's Get Started</h1>
          <p className="mt-3 text-sm text-on-surface-variant font-medium text-center">
            Tell us a bit about yourself so we can personalize your experience
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.1 }}
          className="w-full max-w-sm z-10 px-4"
        >
          <form onSubmit={handleProfileSetup} className="glass-card rounded-[2rem] p-6 shadow-xl space-y-5 border-t border-l border-white/60">
            {/* Name Input */}
            <div className="space-y-2">
              <label className="block text-xs font-black text-outline uppercase tracking-widest">
                Your Name <span className="text-error">*</span>
              </label>
              <div className="relative">
                <UserIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-outline pointer-events-none" />
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., Asad Khan"
                  className="w-full pl-10 pr-4 py-3 rounded-xl border-2 border-outline-variant/30 focus:border-primary bg-surface-container-lowest text-on-surface placeholder:text-outline/50 outline-none transition-colors"
                />
              </div>
            </div>

            {/* Email Input */}
            <div className="space-y-2">
              <label className="block text-xs font-black text-outline uppercase tracking-widest">
                Email Address <span className="text-error">*</span>
              </label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-outline pointer-events-none" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your.email@example.com"
                  className="w-full pl-10 pr-4 py-3 rounded-xl border-2 border-outline-variant/30 focus:border-primary bg-surface-container-lowest text-on-surface placeholder:text-outline/50 outline-none transition-colors"
                />
              </div>
              <p className="text-[10px] text-outline">
                We'll use this to send booking confirmations and updates
              </p>
            </div>

            {/* Error Message */}
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-error/10 border border-error/30 rounded-xl p-3"
              >
                <p className="text-xs text-error font-medium">{error}</p>
              </motion.div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-4 bg-primary text-on-primary rounded-xl font-bold text-lg shadow-xl shadow-primary/20 flex items-center justify-center gap-2 hover:opacity-90 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-on-primary border-t-transparent rounded-full animate-spin"></div>
                  Saving...
                </>
              ) : (
                <>
                  Continue
                  <ArrowRight className="w-5 h-5" />
                </>
              )}
            </button>

            {/* Skip Button */}
            <button
              type="button"
              onClick={handleSkipProfile}
              disabled={loading}
              className="w-full text-center text-xs text-outline font-medium py-2 hover:text-on-surface transition-colors disabled:opacity-50"
            >
              Skip for now
            </button>
          </form>
        </motion.div>
      </div>
    );
  }

  // Intro step
  return (
    <div className="flex-grow flex flex-col items-center justify-center min-h-screen pt-20 pb-8 relative overflow-hidden bg-gradient-to-br from-background via-primary-fixed/30 to-background">
      {/* Background Decorative */}
      <div className="absolute top-1/4 -right-20 w-64 h-64 bg-secondary-container/40 rounded-full blur-[80px] pointer-events-none"></div>
      <div className="absolute bottom-1/4 -left-20 w-80 h-80 bg-primary-fixed/50 rounded-full blur-[80px] pointer-events-none"></div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-10 flex flex-col items-center z-10"
      >
        <div className="relative mb-4">
          <div className="absolute inset-0 bg-primary/20 rounded-full blur-3xl scale-125"></div>
          <div className="w-20 h-20 bg-primary rounded-2xl flex items-center justify-center shadow-2xl relative z-10">
            <Shield className="w-10 h-10 text-on-primary fill-current" />
          </div>
        </div>
        <h1 className="text-4xl font-extrabold text-primary tracking-tight">GharFix</h1>
        <p className="mt-3 text-base text-on-surface-variant font-medium text-center">
          Aapki Zaroorat, Hamare Maahir
        </p>
      </motion.div>

      {/* Carousel Container Mock */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.1 }}
        className="w-full max-w-sm z-10"
      >
        <div className="glass-card rounded-[2rem] p-6 shadow-xl flex flex-col items-center text-center h-[340px] border-t border-l border-white/60">
          <div className="w-full h-40 rounded-2xl overflow-hidden mb-6 relative bg-primary-fixed">
            <img
              src="https://lh3.googleusercontent.com/aida-public/AB6AXuDgkVYKhfTvOKwFNPFOXNyuDhojv7dSuVKhj3JDBZUDfVVmtDAgf9vX9kh9vAy_SvA9cpVnmM_JF9DVEYuWadqos6svwUPTC5YkPF3Uahs-9g3nw_xKe2ub7t1G-GoOJiGoFR5CtdjDrqR3LGvpIEv5p3POQY9eDS4AjNu772qBwtY24xaIBP3rlyehPo_RQnE6oSvhgSDkMKXDyHJK6DhY8vvATCEfS-n2cn8XpkIzStJZlbVhAmasRszN_8hi4QAaJ5dwExwY6Kg"
              alt="Services"
              className="w-full h-full object-cover"
            />
          </div>
          <div className="flex flex-col flex-grow justify-center">
            <h2 className="text-2xl font-bold text-primary mb-2">Find trusted experts near you</h2>
            <p className="text-sm text-on-surface-variant leading-relaxed">Access a network of verified professionals for all your home maintenance needs.</p>
          </div>
        </div>
      </motion.div>

      {/* Pagination */}
      <div className="flex gap-2 mt-8 z-10">
        <div className="w-6 h-1.5 bg-primary rounded-full"></div>
        <div className="w-1.5 h-1.5 bg-outline-variant rounded-full"></div>
        <div className="w-1.5 h-1.5 bg-outline-variant rounded-full"></div>
      </div>

      <div className="mt-auto w-full max-w-sm px-4 z-10 pb-8">
        <button
          onClick={() => setStep('profile')}
          className="w-full py-4 bg-primary text-on-primary rounded-xl font-bold text-lg shadow-xl shadow-primary/20 flex items-center justify-center gap-2 hover:opacity-90 active:scale-95 transition-all"
        >
          Get Started
          <ArrowRight className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}

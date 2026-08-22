import { useState, useEffect } from 'react';
import { Home as HomeIcon, Search, Calendar, MessageSquare, User, LayoutDashboard, Menu, Bell, Shield, Languages, ChevronDown, ArrowLeft } from 'lucide-react';
import { HomeView } from './views/HomeView';
import { MatchView } from './views/MatchView';
import { DashView } from './views/DashView';
import { OnboardingView } from './views/OnboardingView';
import { WelcomeView } from './views/WelcomeView';
import { BookingView } from './views/BookingView';
import { BookingsListView } from './views/BookingsListView';
import { ServiceQualityView } from './views/ServiceQualityView';
import { ProviderLoginView } from './views/ProviderLoginView';
import { ProviderDashView } from './views/ProviderDashView';
import { getUserProfile, hasUserProfile, clearUserProfile } from './lib/profile';
import type { BookingPayload } from './views/BookingView';

export type ViewState = 'welcome' | 'login' | 'onboarding' | 'home' | 'search' | 'booking' | 'bookings' | 'profile' | 'tracking' | 'provider_dash';
export type AppLanguage = 'english' | 'urdu' | 'roman_urdu';

// Navigation history stack for proper back navigation
type NavEntry = { view: ViewState; label: string };

export default function App() {
  const [currentView, setCurrentView] = useState<ViewState>('welcome');
  const [navHistory, setNavHistory] = useState<NavEntry[]>([]);
  const [matchData, setMatchData] = useState<any>(null);
  const [bookingPayload, setBookingPayload] = useState<BookingPayload | null>(null);
  const [trackingPayload, setTrackingPayload] = useState<any>(null);
  const [appLanguage, setAppLanguage] = useState<AppLanguage>(() => {
    const saved = localStorage.getItem('app_language');
    return (saved as AppLanguage) || 'english';
  });
  const [showLangMenu, setShowLangMenu] = useState(false);

  const userProfile = getUserProfile();
  const isProvider = userProfile?.role === 'provider';

  // Navigate with history tracking
  const navigateTo = (view: ViewState, label?: string) => {
    // Bottom-nav tabs reset history; deep views push onto stack
    const isTabView = ['home', 'search', 'bookings', 'profile', 'provider_dash'].includes(view);
    if (isTabView) {
      setNavHistory([]);
    } else {
      setNavHistory(prev => [...prev, { view: currentView, label: label || currentView }]);
    }
    setCurrentView(view);
  };

  const navigateBack = () => {
    if (navHistory.length > 0) {
      const prev = navHistory[navHistory.length - 1];
      setNavHistory(h => h.slice(0, -1));
      setCurrentView(prev.view);
    } else {
      setCurrentView(isProvider ? 'provider_dash' : 'home');
    }
  };

  useEffect(() => {
    localStorage.setItem('app_language', appLanguage);
    // Update document direction and language based on app language
    if (appLanguage === 'urdu') {
      document.documentElement.dir = 'rtl';
      document.documentElement.lang = 'ur';
    } else {
      document.documentElement.dir = 'ltr';
      document.documentElement.lang = 'en';
    }
    if (isProvider && currentView === 'home') {
      setCurrentView('provider_dash');
    }
  }, [appLanguage, isProvider, currentView]);

  const handleLoginSuccess = () => {
    const profile = getUserProfile();
    if (profile?.role === 'provider') {
      setCurrentView('provider_dash');
    } else {
      setCurrentView('home');
    }
  };

  const handleLogout = () => {
    clearUserProfile();
    setNavHistory([]);
    setCurrentView('login');
    setMatchData(null);
    setBookingPayload(null);
    setTrackingPayload(null);
  };

  const handleWelcomeGetStarted = () => {
    if (hasUserProfile()) {
      setCurrentView('home');
    } else {
      setCurrentView('login');
    }
  };

  const handleWelcomeSkip = () => {
    if (hasUserProfile()) {
      setCurrentView('home');
    } else {
      setCurrentView('login');
    }
  };

  const handleServiceTriggered = (data: any) => {
    setMatchData(data);
    navigateTo('search', 'Home');
  };

  const handleBooking = (payload: BookingPayload) => {
    setBookingPayload(payload);
    navigateTo('booking', 'Providers');
  };

  const handleTrack = (payload: any) => {
    setTrackingPayload(payload);
    navigateTo('tracking', 'Bookings');
  };

  const languages = [
    { id: 'english', label: 'English', sub: 'Default' },
    { id: 'urdu', label: 'اردو', sub: 'Native' },
    { id: 'roman_urdu', label: 'Roman Urdu', sub: 'Transact' },
  ];

  // Views that need a back button (not a tab)
  const deepViews: ViewState[] = ['booking', 'tracking', 'search'];
  const isDeepView = deepViews.includes(currentView);

  // View title map
  const viewTitles: Record<ViewState, string> = {
    welcome: 'KhidmatGaar',
    login: 'KhidmatGaar',
    onboarding: 'KhidmatGaar',
    home: userProfile?.name ? `Asalam-o-Alaikum, ${userProfile.name.split(' ')[0]}` : 'Asalam-o-Alaikum',
    search: 'Provider Matches',
    booking: 'Confirm Booking',
    bookings: 'My Bookings',
    profile: 'My Profile',
    tracking: 'Live Tracking',
    provider_dash: 'Dashboard',
  };

  const viewSubtitles: Partial<Record<ViewState, string>> = {
    booking: bookingPayload ? `${bookingPayload.service_type} · ${bookingPayload.location}` : '',
    tracking: trackingPayload ? `${trackingPayload.service_type} · ${trackingPayload.location}` : '',
    search: matchData ? 'Tap a provider to book' : '',
  };

  const TopBar = () => (
    <div className="w-full flex justify-between items-center h-full" dir={appLanguage === 'urdu' ? 'rtl' : 'ltr'}>
      {/* Left: back button or avatar */}
      <div className={`flex items-center gap-3 ${appLanguage === 'urdu' ? 'flex-row-reverse' : ''}`}>
        {isDeepView ? (
          <button
            onClick={navigateBack}
            className="p-2 -ml-1 text-primary hover:bg-primary/10 rounded-xl transition-colors active:scale-95"
            aria-label="Go back"
          >
            <ArrowLeft className="w-5 h-5" strokeWidth={2.5} />
          </button>
        ) : currentView !== 'onboarding' && currentView !== 'login' && currentView !== 'welcome' ? (
          <div className="relative">
            <div className="w-10 h-10 rounded-full border-2 border-primary-container bg-primary flex items-center justify-center">
              <span className="text-sm font-bold text-on-primary">
                {userProfile?.name
                  ?.split(' ')
                  .slice(0, 2)
                  .map(n => n[0])
                  .join('')
                  .toUpperCase() || 'U'}
              </span>
            </div>
            <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-secondary rounded-full border-2 border-white flex items-center justify-center">
              <div className="w-1.5 h-1.5 bg-white rounded-full" />
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center shadow-lg">
              <Shield className="w-5 h-5 text-on-primary fill-current" />
            </div>
            <span className="text-xl font-extrabold text-primary tracking-tight">KhidmatGaar</span>
          </div>
        )}

        {/* Title block */}
        {currentView !== 'onboarding' && currentView !== 'login' && currentView !== 'welcome' && (
          <div>
            <h1 className="text-base font-bold text-primary leading-tight">
              {viewTitles[currentView]}
            </h1>
            {viewSubtitles[currentView] && (
              <p className="text-[10px] text-on-surface-variant font-medium leading-tight">
                {viewSubtitles[currentView]}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Right controls */}
      <div className={`flex items-center gap-2 ${appLanguage === 'urdu' ? 'flex-row-reverse' : ''}`}>
        {currentView !== 'login' && currentView !== 'welcome' && (
          <div className="relative">
            <button
              onClick={() => setShowLangMenu(v => !v)}
              className="flex items-center gap-1.5 bg-surface-container-low px-2 py-1.5 rounded-lg border border-outline-variant/30 hover:bg-surface-variant/50 transition-colors"
            >
              <Languages className="w-4 h-4 text-primary" />
              <span className="text-[10px] font-black uppercase text-on-surface-variant hidden xs:block">
                {appLanguage.replace('_', ' ')}
              </span>
              <ChevronDown className={`w-3 h-3 text-outline transition-transform duration-200 ${showLangMenu ? 'rotate-180' : ''}`} />
            </button>
            {showLangMenu && (
              <div className="absolute top-full right-0 mt-2 w-36 bg-white rounded-xl shadow-xl border border-outline-variant/30 overflow-hidden z-50">
                <div className="p-1.5 space-y-1">
                  {languages.map(lang => (
                    <button
                      key={lang.id}
                      onClick={() => { setAppLanguage(lang.id as AppLanguage); setShowLangMenu(false); }}
                      className={`w-full flex flex-col items-start px-3 py-2 rounded-lg transition-colors ${appLanguage === lang.id ? 'bg-primary/10 border border-primary/20' : 'hover:bg-surface-container'}`}
                    >
                      <span className={`text-xs ${appLanguage === lang.id ? 'font-bold text-primary' : 'font-medium text-on-surface'}`}>{lang.label}</span>
                      <span className="text-[8px] text-on-surface-variant uppercase tracking-tighter">{lang.sub}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {(currentView === 'home' || currentView === 'bookings' || currentView === 'provider_dash') && currentView !== 'welcome' && (
          <button className="relative p-2 text-on-surface-variant hover:bg-surface-variant rounded-full transition-colors">
            <Bell className="w-5 h-5" />
            <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-error rounded-full border border-white" />
          </button>
        )}

        {currentView === 'onboarding' && (
          <button onClick={() => setCurrentView('home')} className="text-xs font-semibold text-primary glass-card px-4 py-2 rounded-full drop-shadow-sm">
            Skip
          </button>
        )}
      </div>
    </div>
  );

  const BottomNav = () => {
    const navTabs = isProvider ? [
      { id: 'provider_dash', icon: LayoutDashboard, label: appLanguage === 'urdu' ? 'ڈیش بورڈ' : 'Dashboard' },
      { id: 'bookings', icon: Calendar, label: appLanguage === 'urdu' ? 'بکنگز' : 'Bookings' },
      { id: 'profile', icon: User, label: appLanguage === 'urdu' ? 'پروفائل' : 'Profile' },
    ] : [
      { id: 'home', icon: HomeIcon, label: appLanguage === 'urdu' ? 'ہوم' : 'Home' },
      { id: 'search', icon: Search, label: appLanguage === 'urdu' ? 'تلاش' : 'Match' },
      { id: 'bookings', icon: Calendar, label: appLanguage === 'urdu' ? 'بکنگز' : 'Bookings' },
      { id: 'profile', icon: User, label: appLanguage === 'urdu' ? 'پروفائل' : 'Profile' },
    ];

    // Active state: treat deep-flow views as belonging to their parent tab
    const activeTab = currentView === 'booking' ? 'search'
      : currentView === 'tracking' ? 'bookings'
      : currentView;

    return (
      <nav className={`w-full flex justify-around items-center px-2 py-3 pb-safe glass-surface rounded-t-2xl ${appLanguage === 'urdu' ? 'flex-row-reverse' : ''}`}>
        {navTabs.map(tab => {
          const isActive = activeTab === tab.id;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => {
                // If clicking Search tab when no match data, go to home
                if (tab.id === 'search' && !matchData) {
                  navigateTo('home');
                  return;
                }
                navigateTo(tab.id as ViewState);
              }}
              className={`flex flex-col items-center justify-center w-16 h-12 rounded-full transition-all duration-200 ${
                isActive
                  ? 'text-primary bg-secondary-container/40 scale-105'
                  : 'text-on-surface-variant hover:bg-surface-variant/50 hover:text-on-surface'
              }`}
            >
              <Icon className={`w-5 h-5 mb-0.5 ${isActive ? 'fill-current opacity-20' : ''}`} strokeWidth={isActive ? 2.5 : 2} />
              <span className={`text-[10px] ${isActive ? 'font-bold' : 'font-medium'}`}>{tab.label}</span>
            </button>
          );
        })}
      </nav>
    );
  };

  const showBottomNav = !['onboarding', 'booking', 'tracking', 'login', 'welcome'].includes(currentView);
  
  // RTL support: apply direction to main container
  const mainDir = appLanguage === 'urdu' ? 'rtl' : 'ltr';

  return (
    <div
      className="min-h-screen bg-background relative selection:bg-primary-container selection:text-on-primary-container max-w-3xl mx-auto lg:max-w-5xl md:shadow-2xl md:border-x border-outline-variant/20 overflow-x-hidden"
      onClick={() => showLangMenu && setShowLangMenu(false)}
      dir={mainDir}
    >
      <header className="fixed top-0 left-1/2 -translate-x-1/2 w-full max-w-3xl lg:max-w-5xl z-50 flex justify-between items-center px-4 h-16 glass-surface shadow-sm">
        <TopBar />
      </header>

      <main className={`w-full h-full min-h-screen overflow-y-auto ${currentView === 'onboarding' || currentView === 'login' || currentView === 'welcome' ? '' : 'pt-20 pb-28 md:pb-24'} px-4`}>
        {currentView === 'welcome' && <WelcomeView onGetStarted={handleWelcomeGetStarted} />}
        {currentView === 'login' && <ProviderLoginView onLoginSuccess={handleLoginSuccess} />}
        {currentView === 'onboarding' && <OnboardingView onComplete={handleLoginSuccess} />}

        {currentView === 'home' && (
          <HomeView appLanguage={appLanguage} onServiceTriggered={handleServiceTriggered} />
        )}

        {currentView === 'search' && (
          <MatchView
            data={matchData}
            appLanguage={appLanguage}
            onBook={handleBooking}
            onSearchAgain={() => navigateTo('home')}
          />
        )}

        {currentView === 'booking' && bookingPayload && (
          <BookingView
            payload={bookingPayload}
            appLanguage={appLanguage}
            onBack={navigateBack}
            onTrack={handleTrack}
          />
        )}

        {currentView === 'tracking' && trackingPayload && (
          <ServiceQualityView
            key={trackingPayload.booking_id}
            payload={trackingPayload}
            appLanguage={appLanguage}
          />
        )}

        {currentView === 'bookings' && (
          <BookingsListView
            appLanguage={appLanguage}
            onTrack={handleTrack}
          />
        )}

        {currentView === 'profile' && (
          <DashView
            appLanguage={appLanguage}
            onLogout={handleLogout}
          />
        )}

        {currentView === 'provider_dash' && userProfile?.provider_id && (
          <ProviderDashView
            appLanguage={appLanguage}
            providerId={userProfile.provider_id}
          />
        )}
      </main>

      {showBottomNav && (
        <footer className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-3xl lg:max-w-5xl z-50">
          <BottomNav />
        </footer>
      )}
    </div>
  );
}
import { motion } from 'motion/react';
import { Check, Mail, User as UserIcon, Edit2, Save, LogOut } from 'lucide-react';
import { AppLanguage } from '../App';
import { useState } from 'react';
import { getUserProfile, updateUserProfile, clearUserProfile } from '../lib/profile';

interface DashViewProps {
  appLanguage: AppLanguage;
  onLogout: () => void;
}

export function DashView({ appLanguage, onLogout }: DashViewProps) {
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const profile = getUserProfile();
  const [editName, setEditName] = useState(profile?.name || '');
  const [editEmail, setEditEmail] = useState(profile?.email || '');
  const [editPhone, setEditPhone] = useState(profile?.phone || '');
  const [saveMessage, setSaveMessage] = useState('');

  const isProvider = profile?.role === 'provider';

  const t = {
    english: {
      profile: "Your Profile",
      name: "Full Name",
      email: "Email Address",
      phone: "Phone Number",
      edit: "Edit Profile",
      save: "Save Changes",
      cancel_btn: "Cancel",
      logout: "Logout",
      profileUpdated: "Profile updated successfully!",
      noProfile: "No profile set up yet. Please complete onboarding.",
      providerId: "Provider ID",
    },
    urdu: {
      profile: "آپ کا پروفائل",
      name: "مکمل نام",
      email: "ای میل ایڈریس",
      phone: "فون نمبر",
      edit: "پروفائل میں ترمیم",
      save: "تبدیلیاں محفوظ کریں",
      cancel_btn: "منسوخ کریں",
      logout: "لاگ آؤٹ",
      profileUpdated: "پروفائل کامیابی سے اپ ڈیٹ ہو گیا!",
      noProfile: "ابھی پروفائل سیٹ اپ نہیں ہوا۔ براہ کرم آن بورڈنگ مکمل کریں۔",
      providerId: "پرووائیڈر آئی ڈی",
    },
    roman_urdu: {
      profile: "Your Profile",
      name: "Full Name",
      email: "Email Address",
      phone: "Phone Number",
      edit: "Edit Profile",
      save: "Save Changes",
      cancel_btn: "Cancel",
      logout: "Logout",
      profileUpdated: "Profile updated successfully!",
      noProfile: "No profile set up yet. Please complete onboarding.",
      providerId: "Provider ID",
    }
  }[appLanguage];

  const handleSaveProfile = () => {
    if (!editName.trim() || !editEmail.trim()) {
      alert('Name and email are required');
      return;
    }
    updateUserProfile({
      name: editName.trim(),
      email: editEmail.trim(),
      phone: editPhone.trim() || undefined,
    });
    setSaveMessage(t.profileUpdated);
    setIsEditingProfile(false);
    setTimeout(() => setSaveMessage(''), 3000);
  };

  const handleLogout = () => {
    console.log('[DashView] handleLogout called');
    onLogout();
  };

  if (!profile) {
    return (
      <div className="text-center py-20">
        <p className="text-sm text-on-surface-variant">{t.noProfile}</p>
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      
      {/* Profile Section */}
      <div className="glass-card rounded-[2rem] p-6 shadow-sm bg-white/80 border border-white/50">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
              <UserIcon className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-on-surface">{t.profile}</h3>
              <p className="text-xs text-on-surface-variant">
                {isProvider ? 'Manage your provider account' : 'Manage your personal information'}
              </p>
            </div>
          </div>
          {!isEditingProfile && (
            <button
              onClick={() => setIsEditingProfile(true)}
              className="p-2 hover:bg-surface-variant rounded-lg transition-colors"
            >
              <Edit2 className="w-4 h-4 text-primary" />
            </button>
          )}
        </div>

        {isEditingProfile ? (
          <div className="space-y-4">
            {/* Name Input */}
            <div>
              <label className="block text-xs font-bold text-outline uppercase tracking-widest mb-2">
                {t.name}
              </label>
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border-2 border-outline-variant/30 focus:border-primary bg-surface-container-lowest text-on-surface outline-none transition-colors"
              />
            </div>

            {/* Email Input */}
            <div>
              <label className="block text-xs font-bold text-outline uppercase tracking-widest mb-2">
                {t.email}
              </label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-outline pointer-events-none" />
                <input
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 rounded-xl border-2 border-outline-variant/30 focus:border-primary bg-surface-container-lowest text-on-surface outline-none transition-colors"
                />
              </div>
            </div>

            {/* Phone Input */}
            <div>
              <label className="block text-xs font-bold text-outline uppercase tracking-widest mb-2">
                {t.phone}
              </label>
              <input
                type="tel"
                value={editPhone}
                onChange={(e) => setEditPhone(e.target.value)}
                placeholder="Optional"
                className="w-full px-4 py-3 rounded-xl border-2 border-outline-variant/30 focus:border-primary bg-surface-container-lowest text-on-surface placeholder:text-outline/50 outline-none transition-colors"
              />
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 pt-2">
              <button
                onClick={handleSaveProfile}
                className="flex-1 py-3 bg-primary text-white rounded-xl font-bold text-sm shadow-md hover:opacity-90 flex items-center justify-center gap-2 active:scale-95 transition-all"
              >
                <Save className="w-4 h-4" />
                {t.save}
              </button>
              <button
                onClick={() => {
                  setIsEditingProfile(false);
                  setEditName(profile?.name || '');
                  setEditEmail(profile?.email || '');
                  setEditPhone(profile?.phone || '');
                }}
                className="flex-1 py-3 border-2 border-outline-variant/30 text-on-surface rounded-xl font-bold text-sm hover:bg-surface-variant active:scale-95 transition-all"
              >
                {t.cancel_btn}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {isProvider && (
              <div>
                <p className="text-xs font-bold text-outline uppercase tracking-widest mb-1">{t.providerId}</p>
                <p className="text-sm font-black text-primary">{profile.provider_id}</p>
              </div>
            )}
            <div>
              <p className="text-xs font-bold text-outline uppercase tracking-widest mb-1">{t.name}</p>
              <p className="text-sm font-medium text-on-surface">{profile.name}</p>
            </div>
            <div>
              <p className="text-xs font-bold text-outline uppercase tracking-widest mb-1">{t.email}</p>
              <p className="text-sm font-medium text-on-surface flex items-center gap-2">
                <Mail className="w-3.5 h-3.5 text-primary" />
                {profile.email}
              </p>
            </div>
            {profile.phone && (
              <div>
                <p className="text-xs font-bold text-outline uppercase tracking-widest mb-1">{t.phone}</p>
                <p className="text-sm font-medium text-on-surface">{profile.phone}</p>
              </div>
            )}
          </div>
        )}

        {saveMessage && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-4 bg-secondary/10 border border-secondary/30 rounded-xl p-3"
          >
            <p className="text-xs text-secondary font-bold flex items-center gap-2">
              <Check className="w-3.5 h-3.5" />
              {saveMessage}
            </p>
          </motion.div>
        )}

        <button
          onClick={(e) => {
            console.log('[DashView] Logout button clicked');
            e.preventDefault();
            handleLogout();
          }}
          className="w-full mt-8 py-4 text-error text-sm font-black hover:bg-error/5 border-2 border-error/20 rounded-2xl transition-all flex items-center justify-center gap-2 active:scale-95"
          id="logout-button"
        >
          <LogOut className="w-4 h-4" />
          {t.logout}
        </button>
      </div>
    </motion.div>
  );
}
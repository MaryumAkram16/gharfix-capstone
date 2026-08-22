/**
 * Profile Management Utility
 * Handles storing, retrieving, and updating user profile data in localStorage
 */

export interface UserProfile {
  name: string;
  email: string;
  phone?: string;
  address?: string;
  joined_at: string;
  role: 'user' | 'provider';
  provider_id?: string;
}

const PROFILE_STORAGE_KEY = 'khidmatgaar_user_profile';
const PROVIDER_DATA_STORAGE_KEY = 'khidmatgaar_provider_data';

/**
 * Get the current user profile from localStorage
 * Returns null if no profile exists
 */
export function getUserProfile(): UserProfile | null {
  try {
    const stored = localStorage.getItem(PROFILE_STORAGE_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch (error) {
    console.error('Failed to retrieve user profile:', error);
    return null;
  }
}

/**
 * Save or update the user profile in localStorage
 */
export function saveUserProfile(profile: UserProfile): boolean {
  try {
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
    return true;
  } catch (error) {
    console.error('Failed to save user profile:', error);
    return false;
  }
}

/**
 * Update specific fields of the user profile
 */
export function updateUserProfile(updates: Partial<UserProfile>): boolean {
  try {
    const existing = getUserProfile();
    if (!existing) {
      console.warn('No existing profile to update');
      return false;
    }
    const updated: UserProfile = {
      ...existing,
      ...updates,
    };
    return saveUserProfile(updated);
  } catch (error) {
    console.error('Failed to update user profile:', error);
    return false;
  }
}

/**
 * Create and save a new user profile (for User login)
 */
export function loginAsUser(name: string, email: string): UserProfile {
  const profile: UserProfile = {
    name,
    email,
    joined_at: new Date().toISOString(),
    role: 'user',
  };
  saveUserProfile(profile);
  return profile;
}

/**
 * Create and save a new provider profile (for Provider login)
 */
export function loginAsProvider(providerId: string): UserProfile {
  const profile: UserProfile = {
    name: `Provider ${providerId}`,
    email: `${providerId}@example.com`,
    joined_at: new Date().toISOString(),
    role: 'provider',
    provider_id: providerId,
  };
  saveUserProfile(profile);
  return profile;
}

/**
 * Clear the user profile (logout) and any associated provider data
 */
export function clearUserProfile(): boolean {
  try {
    localStorage.removeItem(PROFILE_STORAGE_KEY);
    localStorage.removeItem(PROVIDER_DATA_STORAGE_KEY);
    return true;
  } catch (error) {
    console.error('Failed to clear user profile:', error);
    return false;
  }
}

/**
 * Check if a user profile exists
 */
export function hasUserProfile(): boolean {
  return getUserProfile() !== null;
}

/**
 * Get user name or return default
 */
export function getUserName(): string {
  const profile = getUserProfile();
  return profile?.name || 'Guest User';
}

/**
 * Get user email or return empty string
 */
export function getUserEmail(): string {
  const profile = getUserProfile();
  return profile?.email || '';
}

/**
 * Get stored provider dashboard data from localStorage
 */
export function getProviderData(): any | null {
  try {
    const stored = localStorage.getItem(PROVIDER_DATA_STORAGE_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch (error) {
    console.error('Failed to retrieve provider data:', error);
    return null;
  }
}

/**
 * Save provider dashboard data to localStorage
 */
export function saveProviderData(data: any): boolean {
  try {
    localStorage.setItem(PROVIDER_DATA_STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch (error) {
    console.error('Failed to save provider data:', error);
    return false;
  }
}
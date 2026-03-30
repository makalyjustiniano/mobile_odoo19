import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface AuthUser {
  url: string;
  apiKey: string;
  database: string;
  username: string;
  name?: string;
  uid?: number;
  company_id?: number;
  company_ids?: number[];
  company_name?: string;
  company_latitude?: number;
  company_longitude?: number;
  permissions?: any;
}

interface AuthState {
  isLoggedIn: boolean;
  user: AuthUser | null;
  
  // Actions
  login: (userData: AuthUser) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      isLoggedIn: false,
      user: null,

      login: (userData) => set({ 
        isLoggedIn: true, 
        user: userData 
      }),

      logout: () => set({ 
        isLoggedIn: false, 
        user: null 
      }),
    }),
    {
      name: 'auth-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);

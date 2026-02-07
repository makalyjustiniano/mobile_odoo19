import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface AuthState {
  isLoggedIn: boolean;
  user: {
    url: string;
    apiKey: string;
    database: string;
    username: string;
  } | null;
  
  // Actions
  login: (userData: { url: string; apiKey: string; database: string; username: string }) => void;
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

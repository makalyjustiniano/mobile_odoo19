import { create } from 'zustand';

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

export const useAuthStore = create<AuthState>((set) => ({
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
}));

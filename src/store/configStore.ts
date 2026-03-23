import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface ConnectionProfile {
  id: string;
  name: string;
  url: string;
  database: string;
  apiKey: string;
}

interface ConfigState {
  profiles: ConnectionProfile[];
  activeProfileId: string;
  isOffline: boolean;
  setProfileField: (id: string, field: keyof ConnectionProfile, value: string) => void;
  setActiveProfile: (id: string) => void;
  getActiveProfile: () => ConnectionProfile | undefined;
  toggleOffline: () => void;
}

export const useConfigStore = create<ConfigState>()(
  persist(
    (set, get) => ({
      profiles: [
        { id: '1', name: 'Conexión 1', url: 'https://brixy-staging-28261857.dev.odoo.com', database: 'brixy-staging-28261857', apiKey: '' },
        { id: '2', name: 'Conexión 2', url: '', database: '', apiKey: '' },
        { id: '3', name: 'Conexión 3', url: '', database: '', apiKey: '' },
      ],
      activeProfileId: '1',
      isOffline: true,

      setProfileField: (id, field, value) => set((state) => ({
        profiles: state.profiles.map((p) => p.id === id ? { ...p, [field]: value } : p)
      })),

      setActiveProfile: (id) => set({ activeProfileId: id }),

      toggleOffline: () => set((state) => ({ isOffline: !state.isOffline })),

      getActiveProfile: () => {
        const state = get();
        return state.profiles.find((p) => p.id === state.activeProfileId);
      }
    }),
    {
      name: 'config-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);

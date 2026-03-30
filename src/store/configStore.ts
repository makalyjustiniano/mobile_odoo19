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
  autoSyncEnabled: boolean;
  syncIntervalMinutes: number;
  setProfileField: (id: string, field: keyof ConnectionProfile, value: string) => void;
  setActiveProfile: (id: string) => void;
  getActiveProfile: () => ConnectionProfile | undefined;
  toggleOffline: () => void;
  setSyncSettings: (enabled: boolean, interval: number) => void;
}

export const useConfigStore = create<ConfigState>()(
  persist(
    (set, get) => ({
      profiles: [
        { id: '1', name: 'Conexión 1', url: '', database: '', apiKey: '' },
        { id: '2', name: 'Conexión 2', url: '', database: '', apiKey: '' },
        { id: '3', name: 'Conexión 3', url: '', database: '', apiKey: '' },
      ],
      activeProfileId: '1',
      isOffline: false,
      autoSyncEnabled: true,
      syncIntervalMinutes: 3,

      setProfileField: (id, field, value) => set((state) => ({
        profiles: state.profiles.map((p) => p.id === id ? { ...p, [field]: value } : p)
      })),

      setActiveProfile: (id) => set({ activeProfileId: id }),

      toggleOffline: () => set((state) => ({ isOffline: !state.isOffline })),

      setSyncSettings: (enabled, interval) => set({ 
        autoSyncEnabled: enabled, 
        syncIntervalMinutes: interval 
      }),

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

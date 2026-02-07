import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface ConnectionProfile {
  id: string;
  name: string;
  url: string;
}

interface ConfigState {
  profiles: ConnectionProfile[];
  activeProfileId: string;
  setProfileUrl: (id: string, url: string) => void;
  setActiveProfile: (id: string) => void;
  getActiveProfile: () => ConnectionProfile | undefined;
}

export const useConfigStore = create<ConfigState>()(
  persist(
    (set, get) => ({
      profiles: [
        { id: '1', name: 'Conexión 1', url: 'https://brixy-staging-28261857.dev.odoo.com' },
        { id: '2', name: 'Conexión 2', url: '' },
        { id: '3', name: 'Conexión 3', url: '' },
      ],
      activeProfileId: '1',

      setProfileUrl: (id, url) => set((state) => ({
        profiles: state.profiles.map((p) => p.id === id ? { ...p, url } : p)
      })),

      setActiveProfile: (id) => set({ activeProfileId: id }),

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

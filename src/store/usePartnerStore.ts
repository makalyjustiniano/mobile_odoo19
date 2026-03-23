import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { callOdoo } from '../api/odooClient';

interface Partner {
  id: number;
  name: string;
  email: string | false;
  phone: string | false;
  city: string | false;
}

interface PartnerState {
  partners: Partner[];
  loading: boolean;
  error: string | null;
  fetchPartners: () => Promise<void>;
  searchPartnersLocal: (query: string) => Partner[];
  clearError: () => void;
}

export const usePartnerStore = create<PartnerState>()(
  persist(
    (set, get) => ({
      partners: [],
      loading: false,
      error: null,

      fetchPartners: async () => {
        set({ loading: true, error: null });
        try {
          const data = await callOdoo('res.partner', 'search_read', {
            fields: ['name', 'email', 'phone', 'city'],
            limit: 100,
          });
          const partnerArray = Array.isArray(data) ? data : (data?.result || []);
          set({ partners: partnerArray, loading: false });
        } catch (err: any) {
          set({ error: err.message, loading: false });
        }
      },

      searchPartnersLocal: (query: string) => {
        const { partners } = get();
        if (!query) return [];
        const lowerQuery = query.toLowerCase();
        return partners.filter(p => 
          (p.name || '').toLowerCase().includes(lowerQuery)
        );
      },

      clearError: () => set({ error: null }),
    }),
    {
      name: 'partner-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);

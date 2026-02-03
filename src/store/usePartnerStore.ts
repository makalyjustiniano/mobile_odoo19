import { create } from 'zustand';
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
  
  // Actions
  fetchPartners: () => Promise<void>;
  clearError: () => void;
}

export const usePartnerStore = create<PartnerState>((set) => ({
  partners: [],
  loading: false,
  error: null,

  fetchPartners: async () => {
    set({ loading: true, error: null });
    try {
      const data = await callOdoo('res.partner', 'search_read', [], {
        fields: ['name', 'email', 'phone', 'city'],
        limit: 100,
      });
      set({ partners: data, loading: false });
    } catch (err: any) {
      set({ error: err.message, loading: false });
    }
  },

  clearError: () => set({ error: null }),
}));

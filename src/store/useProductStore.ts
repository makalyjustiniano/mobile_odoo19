import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { callOdoo } from '../api/odooClient';

interface Product {
  id: number;
  display_name: string;
  list_price: number;
}

interface ProductState {
  products: Product[];
  loading: boolean;
  fetchProducts: () => Promise<void>;
  searchProductsLocal: (query: string) => Product[];
}

export const useProductStore = create<ProductState>()(
  persist(
    (set, get) => ({
      products: [],
      loading: false,

      fetchProducts: async () => {
        set({ loading: true });
        try {
          const data = await callOdoo('product.product', 'search_read', {
            domain: [['sale_ok', '=', true]],
            fields: ['display_name', 'list_price'],
          });
          
          const productArray = Array.isArray(data) ? data : (data?.result || []);
          console.log('Products fetched:', productArray.length);
          set({ products: productArray, loading: false });
        } catch (error) {
          console.error('Error fetching products:', error);
          set({ loading: false });
        }
      },

      searchProductsLocal: (query: string) => {
        const { products } = get();
        if (!query) return [];
        const lowerQuery = query.toLowerCase();
        return products.filter(p => 
          p.display_name.toLowerCase().includes(lowerQuery)
        );
      },
    }),
    {
      name: 'product-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);

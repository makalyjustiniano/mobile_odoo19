import axios from 'axios';

const ODOO_URL = 'http://190.104.16.140:8069';
const API_KEY = '6b6850dc3f6eb6789f552fde0eb02ed881bb0d35';
const DB_NAME = 'db_production';

/**
 * Custom Axios instance for Odoo 19 Native JSON/2 API
 */
const odooClient = axios.create({
  baseURL: ODOO_URL,
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${API_KEY}`,
  },
});

/**
 * Simple helper to call Odoo methods via JSON/2 API
 * @param model The Odoo model (e.g., 'res.partner')
 * @param method The method to call (e.g., 'search_read')
 * @param ids Optional list of IDs
 * @param kwargs Arguments for the method
 */
export const callOdoo = async (
  model: string,
  method: string,
  ids: number[] = [],
  kwargs: any = {}
) => {
  try {
    const response = await odooClient.post(`/json/2/${model}/${method}`, {
      ids,
      ...kwargs,
    });
    return response.data;
  } catch (error: any) {
    console.error(`Odoo API Error [${model}.${method}]:`, error.response?.data || error.message);
    throw error;
  }
};

/**
 * Initial Test function to verify connection
 */
export const testConnection = async () => {
  try {
    // Calling 'search_read' on 'res.partner' to get the first 5 contacts
    const contacts = await callOdoo('res.partner', 'search_read', [], {
      fields: ['name', 'email', 'phone'],
      limit: 5,
    });
    console.log('Connection Successful! First 5 contacts:', contacts);
    return contacts;
  } catch (error) {
    console.error('Connection Failed:', error);
    throw error;
  }
};

export default odooClient;

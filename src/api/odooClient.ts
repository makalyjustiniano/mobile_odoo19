const ODOO_URL = 'https://brixy-staging-28261857.dev.odoo.com/json/2/res.partner/search_read';
const API_KEY = 'bd5951a4824169366b71711e9f28f0be31a6d2bf';
const DB_NAME = 'brixy-staging-28261857';


export const callOdoo = async (
  model: string,
  method: string,
  ids: number[] = [],
  domain: any[] = [],
  fields: any[] = [],
  limit: number = 20,
) => {
  const url = `${ODOO_URL}`;
  
  const requestBody = {
    ids,
    domain,
    fields,
    limit,
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
        "X-Odoo-Database": DB_NAME,


      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `Odoo Error: ${response.status}`);
    }

    return await response.json();
  } catch (error: any) {
    console.error(`Odoo API Error [${model}.${method}]:`, error.message);
    throw error;
  }
};

/**
 * Initial Test function to verify connection using Fetch
 */
export const testConnection = async () => {
  try {
    const contacts = await callOdoo('res.partner', 'search_read', [], {
      fields: ['display_name', 'email'],
      limit: 5,
    });
    console.log('Connection Successful! Data:', contacts);
    return contacts;
  } catch (error) {
    console.error('Connection Failed:', error);
    throw error;
  }
};

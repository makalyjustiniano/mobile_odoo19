const ODOO_URL = 'https://brixy-staging-28261857.dev.odoo.com';
const API_KEY = 'e6c0484bddd4f9354010c515c433d97503c87757';
const DB_NAME = 'brixy-staging-28261857';

export interface OdooKwargs {
  ids?: number[];
  domain?: any[];
  fields?: string[];
  limit?: number;
  context?: any;
}

export const callOdoo = async (
  model: string,
  method: string,
  kwargs: OdooKwargs = {}
) => {
  // Construcción dinámica de la URL (sin repetir path si ya viene en ODOO_URL)
  const baseUrl = ODOO_URL.endsWith('/') ? ODOO_URL.slice(0, -1) : ODOO_URL;
  const url = `${baseUrl}/json/2/${model}/${method}`;
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
        "X-Odoo-Database": DB_NAME,
      },
      body: JSON.stringify(kwargs),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Odoo Error ${response.status}: ${errorText}`);
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
export const testConnection = async (url: string, apiKey: string, database: string, username: string, password: string) => {
  try {
    // Usamos el objeto de argumentos (kwargs)
    const contacts = await callOdoo('res.users', 'search_read', {
      domain: [["login", "=", username]],
      fields: ['display_name', 'email'],
      limit: 1,
    });
    console.log('¡Conexión Exitosa!', contacts);
    return contacts;
  } catch (error) {
    console.error('Error en la prueba de conexión:', error);
    throw error;
  }
};

/**
 * Autenticación real por sesión (Valida password)
 * Nota: Usa el endpoint /web/session/authenticate (JSON-RPC)
 */
export const testConnection2 = async (url: string, database: string, username: string, password: string) => {
  const baseUrl = url.endsWith('/') ? url.slice(0, -1) : url;
  const authUrl = `${baseUrl}/web/session/authenticate`;

  const requestBody = {
    jsonrpc: "2.0",
    method: "call",
    params: {
      db: database,
      login: username,
      password: password,
      context: {}
    }
  };

  try {
    const response = await fetch(authUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    const data = await response.json();

    if (data.result && data.result.uid) {
      console.log('¡Autenticación de sesión exitosa! UID:', data.result.uid);
      return data.result;
    } else if (data.error) {
      throw new Error(data.error.data.message || 'Error de autenticación');
    } else {
      throw new Error('Credenciales incorrectas');
    }
  } catch (error: any) {
    console.error('Error en testConnection2 (Sesión):', error.message);
    throw error;
  }
};

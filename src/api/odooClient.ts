import { Alert } from 'react-native';
import { useAuthStore } from '../store/authStore';

const FALLBACK_ODOO_URL = 'https://brixy-staging-28261857.dev.odoo.com';
const FALLBACK_API_KEY = 'e6c0484bddd4f9354010c515c433d97503c87757';
const FALLBACK_DB_NAME = 'brixy-staging-28261857';

export interface OdooKwargs {
  ids?: number[];
  domain?: any[];
  fields?: string[];
  limit?: number;
  context?: any;
  [key: string]: any;
}

interface OdooConnection {
  url: string;
  apiKey: string;
  database: string;
}

const resolveConnection = (): OdooConnection => {
  const { user } = useAuthStore.getState();
  return {
    url: user?.url || FALLBACK_ODOO_URL,
    apiKey: user?.apiKey || FALLBACK_API_KEY,
    database: user?.database || FALLBACK_DB_NAME,
  };
};

const buildJson2Url = (baseUrl: string, model: string, method: string) => {
  const cleanBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  return `${cleanBase}/json/2/${model}/${method}`;
};

export const callOdoo = async (
  model: string,
  method: string,
  kwargs: OdooKwargs = {}
) => {
  const connection = resolveConnection();
  const url = buildJson2Url(connection.url, model, method);
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${connection.apiKey}`,
        "X-Odoo-Database": connection.database,
      },
      body: JSON.stringify(kwargs),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Odoo Error ${response.status}: ${errorText}`);
    }

    return await response.json();
  } catch (error: any) {
    console.error(`Odoo API Error [${model}.${method}] ${url}:`, error.message);
    if (!error.message.includes('aborted')) {
        Alert.alert('Error de Conexión', `No se pudo conectar con Odoo: ${error.message}`);
    }
    throw error;
  }
};

/**
 * Initial Test function to verify connection using Fetch
 */
export const testConnection = async (url: string, apiKey: string, database: string, username: string, password: string) => {
  const endpoint = buildJson2Url(url, 'res.users', 'search_read');
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        "X-Odoo-Database": database,
      },
      body: JSON.stringify({
      domain: [["login", "=", username]],
      fields: ['display_name', 'email'],
      limit: 1,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Odoo Error ${response.status}: ${errorText}`);
    }

    const contacts = await response.json();
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

import { Alert } from 'react-native';
import { useAuthStore } from '../store/authStore';
import { useConfigStore } from '../store/configStore';
import { getPortalPermissions } from '../utils/permissionUtils';

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
  sessionId?: string;
}

const resolveConnection = (): OdooConnection => {
  const { user } = useAuthStore.getState();
  const { getActiveProfile } = useConfigStore.getState();
  const activeProfile = getActiveProfile();

  // Priorizamos el perfil activo para URL/DB/APIKey si el usuario solo tiene identidad
  return {
    url: activeProfile?.url || user?.url || '',
    apiKey: activeProfile?.apiKey || user?.apiKey || '',
    database: activeProfile?.database || user?.database || '',
  };
};

const buildJson2Url = (baseUrl: string, model: string, method: string) => {
  const cleanBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  return `${cleanBase}/json/2/${model}/${method}`;
};

export const callOdoo = async (
  model: string,
  method: string,
  kwargs: OdooKwargs = {},
  silent: boolean = false,
  connectionOverride?: OdooConnection
) => {
  const connection = connectionOverride || resolveConnection();
  const url = buildJson2Url(connection.url, model, method);
  
  if (!connection.url) {
    throw new Error('No se ha definido la URL de Odoo en el perfil activo.');
  }

  const headers: any = {
    'Content-Type': 'application/json',
    "X-Odoo-Database": connection.database,
  };

  if (connection.apiKey) {
    headers['Authorization'] = `Bearer ${connection.apiKey}`;
  } else if (connection.sessionId) {
    headers['X-Odoo-Session'] = connection.sessionId;
    headers['Cookie'] = `session_id=${connection.sessionId}`;
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(kwargs),
    });

    if (!response.ok) {
      const errorText = await response.text();
      // Si recibimos 401, es probable que la API Key sea inválida o el endpoint solo acepte tokens
      if (response.status === 401) {
        throw new Error(`Auth Error (401): Este endpoint (/json/2/) requiere una API Key válida. Verifica "Ajustes".`);
      }
      throw new Error(`Odoo Error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    if (data.error) {
      throw new Error(data.error.message || 'Error desconocido en Odoo');
    }
    return data;
  } catch (error: any) {
    if (!silent) {
      console.error(`Error en callOdoo [${model}.${method}]:`, error.message);
    }
    throw error;
  }
};

/**
 * Nueva función para llamadas RPC estándar (/web/dataset/call_kw)
 * Estas llamadas SÍ aceptan sesiones sin necesidad de API Key.
 */
export const callOdooRpc = async (
    url: string,
    model: string,
    method: string,
    args: any[] = [],
    kwargs: any = {},
    sessionId?: string,
    database?: string
) => {
    const rpcUrl = `${url.endsWith('/') ? url.slice(0, -1) : url}/web/dataset/call_kw`;
    const body = {
        jsonrpc: "2.0",
        method: "call",
        params: {
            model,
            method,
            args,
            kwargs,
        },
        id: Math.floor(Math.random() * 1000)
    };

    const headers: any = {
        'Content-Type': 'application/json',
    };
    if (database) headers['X-Odoo-Database'] = database;
    if (sessionId) {
        headers['X-Odoo-Session'] = sessionId;
        headers['Cookie'] = `session_id=${sessionId}`;
    }

    const response = await fetch(rpcUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        throw new Error(`RPC Error ${response.status}`);
    }

    const data = await response.json();
    if (data.error) {
        throw new Error(data.error.data?.message || data.error.message || 'RPC Fail');
    }
    return data.result;
};

/**
 * Función especial para extraer la API Key y Metadatos desde el HTML del Dashboard
 * Útil para usuarios portal que no tienen permisos RPC pero sí ven el dashboard web.
 */
export const fetchSiatMetadataFromHtml = async (url: string, sessionId: string): Promise<{apiKey?: string, companyName?: string}> => {
    try {
        const dashboardUrl = `${url.endsWith('/') ? url.slice(0, -1) : url}/siat/dashboard`;
        const response = await fetch(dashboardUrl, {
            headers: {
                'X-Odoo-Session': sessionId,
                'Cookie': `session_id=${sessionId}`
            }
        });
        const html = await response.text();
        
        const apiKeyMatch = html.match(/data-api-key="([^"]+)"/);
        const companyNameMatch = html.match(/data-company-name="([^"]+)"/);
        
        return {
            apiKey: apiKeyMatch ? apiKeyMatch[1] : undefined,
            companyName: companyNameMatch ? companyNameMatch[1] : undefined,
        };
    } catch (e) {
        console.warn('HTML Discovery failed:', e);
        return {};
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
 * Autenticación SIAT Portal (Adaptada al flujo estándar de Odoo)
 * No requiere cambios en el servidor.
 */
export const loginSiat = async (url: string, database: string, username: string, password: string) => {
  const baseUrl = url.endsWith('/') ? url.slice(0, -1) : url;
  
  // 1. Autenticación Estándar (Session)
  const authUrl = `${baseUrl}/web/session/authenticate`;
  const authBody = {
    jsonrpc: "2.0",
    method: "call",
    params: {
      db: database,
      login: username,
      password: password,
      context: {}
    }
  };

  const response = await fetch(authUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(authBody),
  });

  const authData = await response.json();
  console.log('--- RPC AUTH RAW RESPONSE ---', JSON.stringify(authData, null, 2));

  if (authData.error) {
    throw new Error(authData.error.data?.message || 'Credenciales incorrectas');
  }

  const session = authData.result || {};
  const uid = session.uid;

  // 1. Extraer Session ID con búsqueda exhaustiva
  let sessionId = session.session_id || session.sid || session.id || "";
  
  // Intento de extraer desde las cabeceras si no está en el body (Set-Cookie)
  if (!sessionId && response.headers.get('Set-Cookie')) {
    const cookies = response.headers.get('Set-Cookie') || "";
    const match = cookies.match(/session_id=([^; ]+)/);
    if (match) sessionId = match[1];
  }
  
  // Si sigue vacío, probamos a buscar cualquier cadena de ~40 caracteres en el result
  if (!sessionId) {
    for (const key in session) {
      if (typeof session[key] === 'string' && session[key].length >= 30 && /^[a-f0-9]+$/.test(session[key])) {
        sessionId = session[key];
        break;
      }
    }
  }

  // 2. Capturar la API Key si el servidor la devuelve directamente
  const apiKey = session.api_key || session.apiKey || session.siat_api_key || session.siat_api_key_connection || "";

  // 3. Capturar Company ID con fallbacks robustos
  const companyId = session.company_id || 
                    session.user_companies?.current_company || 
                    session.user_context?.allowed_company_ids?.[0] || 
                    1; // Fallback a 1 si el portal devuelve 0

  return {
    uid: uid,
    name: session.name || username,
    company_id: companyId,
    company_name: session.user_companies?.current_company_name || session.company_name || "Compañía Principal",
    database: database,
    sessionId: sessionId, 
    apiKey: apiKey,
    permissions: null
  };
};

/**
 * Paso 2: Recuperar Metadatos y Permisos de SIAT usando la API Key de Superusuario
 */
export const fetchPortalMetadata = async (
    uid: number, 
    companyId: number,
    connection?: OdooConnection
): Promise<any> => {
    const { url, database, sessionId } = connection || {};
    if (!url || !sessionId) {
        throw new Error("No se puede sincronizar metadatos sin una sesión activa.");
    }

    try {
        let roleCodes: string[] = [];
        let isPortalAdmin = false;
        let siatApiKey = "";
        let userData: any = null;

        // 1. Obtener datos mínimos del usuario (solo campos permitidos para portal)
        try {
            const userInfo = await callOdooRpc(url, 'res.users', 'search_read', [], {
                domain: [['id', '=', uid]],
                fields: ["display_name", "company_id", "siat_portal_role_ids"],
                limit: 1
            }, sessionId, database);
            userData = userInfo?.[0];
        } catch (e) {
            console.warn('RPC: Falló lectura mínima de usuario (esperado para portal):', e);
        }
        
        if (userData) {
            // 2. Intentar obtener códigos de rol (silencioso)
            try {
                const roleIds = userData.siat_portal_role_ids || [];
                if (roleIds.length > 0) {
                    const roles = await callOdooRpc(url, 'siat.portal.role', 'search_read', [], {
                        domain: [['id', 'in', roleIds]],
                        fields: ["code"]
                    }, sessionId, database);
                    roleCodes = roles?.map((r: any) => r.code) || [];
                }
            } catch (e) { console.warn('RPC: No se pudieron leer roles del portal.'); }

            // 3. Intentar obtener API Key de la Empresa vía RPC (silencioso)
            try {
                const companies = await callOdooRpc(url, 'res.company', 'search_read', [], {
                    domain: [['id', '=', companyId]],
                    fields: ["siat_api_key_connection"],
                    limit: 1
                }, sessionId, database);
                siatApiKey = companies?.[0]?.siat_api_key_connection || "";
            } catch (e) { console.warn('RPC: No se pudo leer API Key de empresa.'); }
        }

        // 4. FALLBACK CRÍTICO: Si no tenemos API Key vía RPC, la intentamos descubrir en el HTML
        if (!siatApiKey) {
            console.log('--- Iniciando Discovery vía HTML (Portal Fallback) ---');
            const discovery = await fetchSiatMetadataFromHtml(url, sessionId);
            if (discovery.apiKey) {
                console.log('--- API Key descubierta vía HTML! ---');
                siatApiKey = discovery.apiKey;
            }
        }

        const permissions = getPortalPermissions(roleCodes, isPortalAdmin);
        
        return {
            permissions,
            siatApiKey: siatApiKey || (connection?.apiKey || "") 
        };
    } catch (error: any) {
        console.error('Error al recuperar metadatos (ignorado):', error.message);
        // Retornamos metadatos vacíos en lugar de fallar el login
        return {
            permissions: getPortalPermissions([], false),
            siatApiKey: connection?.apiKey || ""
        };
    }
};

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
  connectionOverride?: OdooConnection,
  timeoutMs: number = 30000 // Default 30s
) => {
  const connection = connectionOverride || resolveConnection();
  const url = buildJson2Url(connection.url, model, method);
  
  if (!connection.url) {
    throw new Error('No se ha definido la URL de Odoo en el perfil activo.');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

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
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);

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
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      const msg = `Timeout: La respuesta de Odoo tardó más de ${timeoutMs/1000}s. El servidor podría estar procesando, pero la app liberará el control.`;
      if (!silent) console.error(msg);
      throw new Error(msg);
    }
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
    return contacts;
  } catch (error) {
    console.error('Error en la prueba de conexión:', error);
    throw error;
  }
};

/**
 * Autenticación SIAT Portal (Adaptada al flujo estándar de Odoo)
 */
export const loginSiat = async (url: string, database: string, username: string, password: string) => {
  const baseUrl = url.endsWith('/') ? url.slice(0, -1) : url;
  
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
  if (authData.error) {
    throw new Error(authData.error.data?.message || 'Credenciales incorrectas');
  }

  const session = authData.result || {};
  const uid = session.uid;
  let sessionId = session.session_id || session.sid || session.id || "";
  
  if (!sessionId && response.headers.get('Set-Cookie')) {
    const cookies = response.headers.get('Set-Cookie') || "";
    const match = cookies.match(/session_id=([^; ]+)/);
    if (match) sessionId = match[1];
  }
  
  const apiKey = session.api_key || session.apiKey || "";
  const companyId = session.company_id || session.user_context?.allowed_company_ids?.[0] || 1;

  return {
    uid,
    name: session.name || username,
    company_id: companyId,
    company_name: session.user_companies?.current_company_name || session.company_name || "Compañía Principal",
    database,
    sessionId, 
    apiKey,
    permissions: null
  };
};

/**
 * Paso 2: Recuperar Metadatos y Permisos de SIAT (RPC Nativo)
 * Usa la Master API Key (autoridad de sistema) para consultar los privilegios del Portal.
 */
export const fetchPortalMetadata = async (
    uid: number, 
    connection: OdooConnection
): Promise<any> => {
    const { url, database, apiKey } = connection;
    
    // Necesitamos la Master API Key para consultar res.users (niveles de acceso de sistema)
    if (!url || !apiKey) {
        throw new Error("API Key Maestra no disponible para consulta de privilegios.");
    }

    try {
        console.log(`[OdooClient] Fetching metadata for UID ${uid} via Admin Dispatch...`);
        
        // 2.1 Obtener datos del usuario (roles y grupos) con autoridad de Admin
        // En Odoo 19, el campo es 'group_ids' en lugar de 'groups_id'
        const userRes = await callOdoo('res.users', 'search_read', {
            domain: [["id", "=", uid]],
            fields: ["siat_portal_role_ids", "group_ids", "company_id", "company_ids"],
            limit: 1
        }, true, connection);

        const userData = userRes?.[0];
        if (!userData) throw new Error("No se pudo encontrar el usuario portal vía RPC Administrador.");

        const roleIds = userData.siat_portal_role_ids || [];
        const groupIds = userData.group_ids || [];
        const mainCompanyId = Array.isArray(userData.company_id) ? userData.company_id[0] : userData.company_id || 1;
        const allCompanyIds = userData.company_ids || [mainCompanyId];

        // 2.2 Verificar si es Admin del Portal (siat_portal_web.group_siat_portal_admin)
        // Buscamos el ID del grupo por su XML ID
        const adminGroup = await callOdoo('ir.model.data', 'search_read', {
            domain: [['module', '=', 'siat_portal_web'], ['name', '=', 'group_siat_portal_admin']],
            fields: ['res_id'],
            limit: 1
        }, true, connection);
        
        const adminGroupId = adminGroup?.[0]?.res_id;
        const isPortalAdmin = adminGroupId ? groupIds.includes(adminGroupId) : false;

        // 2.3 Obtener códigos de rol de la tabla siat.portal.role
        let roleCodes: string[] = [];
        if (roleIds.length > 0) {
            const roles = await callOdoo('siat.portal.role', 'search_read', {
                domain: [['id', 'in', roleIds]],
                fields: ["code"]
            }, true, connection);
            roleCodes = roles?.map((r: any) => r.code) || [];
        }

        console.log(`[OdooClient] Roles detectados: [${roleCodes.join(', ')}]. Admin: ${isPortalAdmin}`);

        const permissions = getPortalPermissions(roleCodes, isPortalAdmin);
        
        return {
            permissions,
            roleCodes,
            isAdmin: isPortalAdmin,
            companyIds: allCompanyIds,
            companyId: mainCompanyId,
            apiKey: connection.apiKey
        };
    } catch (error: any) {
        console.error("[OdooClient] RPC Metadata Discovery failed:", error.message);
        throw error;
    }
};

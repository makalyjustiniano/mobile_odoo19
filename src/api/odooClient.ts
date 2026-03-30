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
  silent: boolean = false
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
    if (!silent && !error.message.includes('aborted')) {
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

  if (authData.error) {
    throw new Error(authData.error.data?.message || 'Credenciales incorrectas');
  }

  const session = authData.result;
  const uid = session.uid;

  // 2. Retorno Minimalista (Solo identidad del usuario portal)
  // El resto de metadatos se recuperarán con la API Key en el paso siguiente (Dashboard)
  return {
    uid: uid,
    name: session.name || username,
    company_id: session.user_companies?.current_company || 0,
    company_name: session.user_companies?.current_company_name || "",
    database: database,
    permissions: null
  };
};

/**
 * Paso 2: Recuperar Metadatos y Permisos de SIAT usando la API Key de Superusuario
 */
export const fetchPortalMetadata = async (uid: number, companyId: number): Promise<any> => {
    try {
        const superUserInfo = await callOdoo('res.users', 'search_read', {
            domain: [['id', '=', uid]],
            fields: ["display_name", "company_id", "group_ids", "siat_portal_role_ids"],
            limit: 1
        }, true);
        
        const userData = superUserInfo?.[0];
        let roleCodes: string[] = [];
        let isPortalAdmin = false;
        let siatApiKey = "";

        if (userData) {
            try {
                const groupInfo = await callOdoo('ir.model.data', 'search_read', {
                    domain: [['module', '=', 'siat_portal_web'], ['name', '=', 'group_siat_portal_admin']],
                    fields: ["res_id"],
                    limit: 1
                }, true);
                const adminGroupId = groupInfo?.[0]?.res_id;
                isPortalAdmin = adminGroupId ? userData.group_ids.includes(adminGroupId) : false;
            } catch (e) { console.warn('Error Admin Check:', e); }

            try {
                const roleIds = userData.siat_portal_role_ids || [];
                if (roleIds.length > 0) {
                    const roles = await callOdoo('siat.portal.role', 'search_read', {
                        domain: [['id', 'in', roleIds]],
                        fields: ["code"]
                    }, true);
                    roleCodes = roles?.map((r: any) => r.code) || [];
                }
            } catch (e) { console.warn('Error Roles Check:', e); }

            try {
                const companies = await callOdoo('res.company', 'search_read', {
                    domain: [['id', '=', companyId]],
                    fields: ["siat_portal_active", "siat_api_key_connection"],
                    limit: 1
                }, true);
                siatApiKey = companies?.[0]?.siat_api_key_connection || "";
            } catch (e) { console.warn('Error Company Check:', e); }
        }

        const permissions = getPortalPermissions(roleCodes, isPortalAdmin);
        
        return {
            permissions,
            siatApiKey
        };
    } catch (error) {
        console.error('Error al recuperar metadatos via API Key:', error);
        return null;
    }
};

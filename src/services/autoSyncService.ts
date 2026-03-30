import { useConfigStore } from '../store/configStore';
import { uploadOfflineChanges } from './syncService';

let syncInterval: any = null;
let isSyncing = false;

export const startAutoSync = () => {
  stopAutoSync(); // Prevenir múltiples intervalos

  const { autoSyncEnabled, syncIntervalMinutes } = useConfigStore.getState();

  if (!autoSyncEnabled) {
    console.log('[AutoSync] Deshabilitado en configuración.');
    return;
  }

  const intervalMs = syncIntervalMinutes * 60 * 1000;
  console.log(`[AutoSync] Iniciado cada ${syncIntervalMinutes} minutos.`);

  syncInterval = setInterval(async () => {
    if (isSyncing) return;
    
    const state = useConfigStore.getState();
    if (!state.autoSyncEnabled || state.isOffline) return;

    try {
      isSyncing = true;
      console.log('[AutoSync] Ejecutando sincronización automática...');
      await uploadOfflineChanges((msg) => console.log(`[AutoSync] ${msg}`));
      console.log('[AutoSync] Sincronización automática completada.');
    } catch (error) {
      console.error('[AutoSync] Error en sincronización:', error);
    } finally {
      isSyncing = false;
    }
  }, intervalMs);
};

export const stopAutoSync = () => {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
    console.log('[AutoSync] Detenido.');
  }
};

/**
 * Trigger an immediate sync (e.g. when app starts or connection returns)
 */
export const triggerImmediateSync = async () => {
    if (isSyncing) return;
    const state = useConfigStore.getState();
    if (!state.autoSyncEnabled || state.isOffline) return;

    try {
        isSyncing = true;
        await uploadOfflineChanges();
    } catch (error) {
        console.error('[AutoSync] Error en trigger inmediato:', error);
    } finally {
        isSyncing = false;
    }
};

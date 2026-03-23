import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  Switch,
  ActivityIndicator,
} from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { Picker } from '@react-native-picker/picker';
import { useConfigStore } from '../../src/store/configStore';
import { useAuthStore } from '../../src/store/authStore';
import { uploadOfflineChanges, backupAndPurgeDatabase } from '../../src/services/syncService';
import { printerService, PrinterDevice } from '../../src/services/printerService';

export default function ConfiguracionScreen() {
  const { profiles, activeProfileId, setActiveProfile, setProfileField, toggleOffline, isOffline } = useConfigStore();
  
  const handleFieldChange = (id: string, field: any, value: string) => {
    setProfileField(id, field, value);
  };
  const logout = useAuthStore((state) => state.logout);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');

  // Printer states
  const [isScanning, setIsScanning] = useState(false);
  const [devices, setDevices] = useState<PrinterDevice[]>([]);
  const [connectedDevice, setConnectedDevice] = useState<PrinterDevice | null>(null);

  useEffect(() => {
    const checkConnected = () => {
        const dev = printerService.getConnectedDevice();
        if (dev) setConnectedDevice(dev);
    };
    checkConnected();
  }, []);

  const handleScan = async () => {
    // 1. Check if we are in Expo Go or if native modules are missing
    const env = printerService.checkEnvironment();
    if (!env.ok) {
        Alert.alert('Acción Requerida', env.msg);
        return;
    }

    // 2. Request Permissions
    const hasPermission = await printerService.requestPermissions();
    if (!hasPermission) {
        Alert.alert('Permisos Denegados', 'Se requieren permisos de Ubicación y Bluetooth para buscar dispositivos.');
        return;
    }

    // 3. Confirm Bluetooth is actually on
    const isBtEnabled = await printerService.isBluetoothEnabled();
    if (!isBtEnabled) {
        const enabled = await printerService.enableBluetooth();
        if (!enabled) {
            Alert.alert('Bluetooth Desactivado', 'No pudimos encender el Bluetooth automáticamente. Por favor enciéndelo manualmente.');
            return;
        }
    }

    setIsScanning(true);
    setDevices([]);
    try {
        const found = await printerService.scanDevices();
        setDevices(found);
        if (found.length === 0) {
            Alert.alert('Sin impresoras', 'Asegúrate de que la impresora Zebra esté encendida y sea visible.');
        }
    } catch (e) {
        Alert.alert('Error', 'Fallo al buscar dispositivos.');
    } finally {
        setIsScanning(false);
    }
  };

  const handleConnect = async (device: PrinterDevice) => {
    setSyncMessage(`Vinculando ${device.name}...`);
    setSyncing(true);
    try {
        const success = await printerService.connect(device.address, device.name);
        if (success) {
            setConnectedDevice(device);
            // Automatic first print
            await printerService.printTest();
            Alert.alert('Éxito', `Conectado a ${device.name}. Se imprimió el ticket de bienvenida.`);
        } else {
            Alert.alert('Fallo de Conexión', 'No se pudo conectar. Verifica que la impresora esté lista y no esté conectada a otro móvil.');
        }
    } catch (e) {
        Alert.alert('Error Fatal', 'Se produjo un error durante la conexión.');
    } finally {
        setSyncing(false);
        setSyncMessage('');
    }
  };

  const handleSyncAndLogout = async () => {
    Alert.alert(
      'Confirmar Sincronización',
      'Se subirán tus cambios locales a Odoo, se creará un respaldo de seguridad y se cerrará la sesión actual para limpiar el dispositivo.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { 
          text: 'Continuar', 
          onPress: async () => {
            setSyncing(true);
            try {
              await uploadOfflineChanges((msg) => setSyncMessage(msg));
              await backupAndPurgeDatabase((msg) => setSyncMessage(msg));
              Alert.alert('Éxito', 'Sincronización y backup completados.');
              logout();
            } catch (error: any) {
              Alert.alert('Error', 'Problema al sincronizar: ' + error.message);
            } finally {
              setSyncing(false);
            }
          }
        }
      ]
    );
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <FontAwesome name="cog" size={50} color="#714B67" />
        <Text style={styles.title}>Parámetros de Conexión</Text>
        <Text style={styles.subtitle}>Configura perfiles e impresoras Zebra</Text>
      </View>

      {/* SECCIÓN IMPRESORA */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Impresora Zebra (ZQ320)</Text>
        
        {connectedDevice ? (
            <View style={styles.connectedBox}>
                <View style={{ flex: 1 }}>
                    <Text style={styles.deviceConnectedName}>{connectedDevice.name}</Text>
                    <Text style={styles.deviceAddress}>{connectedDevice.address}</Text>
                    <View style={styles.statusRow}>
                        <View style={styles.statusDot} />
                        <Text style={styles.statusText}>Conectado</Text>
                    </View>
                </View>
                <TouchableOpacity style={styles.testBtn} onPress={() => printerService.printTest()}>
                    <FontAwesome name="print" size={22} color="#00A09D" />
                </TouchableOpacity>
            </View>
        ) : (
            <View style={styles.notConnectedBox}>
                <FontAwesome name="exclamation-circle" size={16} color="#6B7280" />
                <Text style={styles.info}>No hay una impresora Zebra vinculada.</Text>
            </View>
        )}

        <TouchableOpacity 
            style={[styles.scanBtn, isScanning && { opacity: 0.7 }]} 
            onPress={handleScan}
            disabled={isScanning}
        >
            {isScanning ? (
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <ActivityIndicator color="#fff" size="small" style={{ marginRight: 10 }} />
                    <Text style={styles.btnText}>BUSCANDO...</Text>
                </View>
            ) : (
                <>
                    <FontAwesome name="search" size={16} color="#fff" style={{ marginRight: 10 }} />
                    <Text style={styles.btnText}>BUSCAR IMPRESORA</Text>
                </>
            )}
        </TouchableOpacity>

        {devices.length > 0 && !connectedDevice && (
            <View style={styles.deviceList}>
                <Text style={styles.listSubtitle}>Dispositivos Encontrados:</Text>
                {devices.map((item) => (
                    <TouchableOpacity 
                        key={item.address} 
                        style={styles.deviceItem}
                        onPress={() => handleConnect(item)}
                    >
                        <View style={styles.btIconCircle}>
                            <FontAwesome name="bluetooth-b" size={16} color="#fff" />
                        </View>
                        <View style={{ flex: 1, marginLeft: 12 }}>
                            <Text style={styles.deviceName}>{item.name}</Text>
                            <Text style={styles.deviceAddress}>{item.address}</Text>
                        </View>
                        <FontAwesome name="plus" size={14} color="#00A09D" />
                    </TouchableOpacity>
                ))}
            </View>
        )}
      </View>

      <View style={styles.section}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={styles.sectionTitle}>Configuración avanzada</Text>
          <Switch
            value={showAdvanced}
            onValueChange={setShowAdvanced}
            trackColor={{ false: '#d1d5db', true: '#00A09D' }}
            thumbColor={showAdvanced ? '#fff' : '#f4f3f4'}
          />
        </View>
      </View>

      <View style={styles.section}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View>
            <Text style={styles.sectionTitle}>Modo Offline</Text>
            <Text style={[styles.info, { marginTop: 0 }]}>
              {isOffline ? 'Usando datos locales (SQLite)' : 'Usando conexión directa a Odoo'}
            </Text>
          </View>
          <Switch
            value={isOffline}
            onValueChange={toggleOffline}
            trackColor={{ false: '#d1d5db', true: '#00A09D' }}
            thumbColor={isOffline ? '#fff' : '#f4f3f4'}
          />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Conexión Activa</Text>
        <View style={styles.pickerContainer}>
          <Picker
            selectedValue={activeProfileId}
            onValueChange={(itemValue) => setActiveProfile(itemValue)}
            style={styles.picker}
          >
            {profiles.map((profile) => (
              <Picker.Item
                key={profile.id}
                label={profile.url ? `${profile.name} (${profile.url.substring(0, 20)}...)` : profile.name}
                value={profile.id}
              />
            ))}
          </Picker>
        </View>
      </View>

      <TouchableOpacity
        style={[styles.saveButton, { marginTop: 30 }]}
        onPress={() => Alert.alert('Éxito', 'Configuración guardada correctamente')}
      >
        <Text style={styles.saveButtonText}>GUARDAR CONFIGURACIÓN</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.syncLogoutButton}
        onPress={handleSyncAndLogout}
      >
        <FontAwesome name="cloud-upload" size={20} color="#fff" style={{ marginRight: 10 }} />
        <Text style={styles.saveButtonText}>SINCRONIZAR Y SALIR</Text>
      </TouchableOpacity>

      {syncing && (
        <View style={styles.syncOverlay}>
          <ActivityIndicator size="large" color="#00A09D" />
          <Text style={styles.syncText}>{syncMessage}</Text>
        </View>
      )}

      {showAdvanced && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Perfiles de URL</Text>
          {profiles.map((profile) => (
            <View key={profile.id} style={[styles.inputGroup, { borderBottomWidth: 1, borderBottomColor: '#eee', paddingBottom: 15 }]}>
              <Text style={[styles.label, { fontWeight: 'bold', color: '#714B67' }]}>{profile.name}</Text>
              
              <Text style={styles.label}>URL Odoo</Text>
              <View style={styles.inputContainer}>
                <FontAwesome name="globe" size={20} color="#9CA3AF" style={styles.icon} />
                <TextInput
                  style={styles.input}
                  placeholder="https://tu-servidor.odoo.com"
                  value={profile.url}
                  onChangeText={(text) => handleFieldChange(profile.id, 'url', text)}
                  autoCapitalize="none"
                  keyboardType="url"
                />
              </View>

              <Text style={[styles.label, { marginTop: 10 }]}>Base de Datos</Text>
              <View style={styles.inputContainer}>
                <FontAwesome name="database" size={20} color="#9CA3AF" style={styles.icon} />
                <TextInput
                  style={styles.input}
                  placeholder="nombre_db"
                  value={profile.database}
                  onChangeText={(text) => handleFieldChange(profile.id, 'database', text)}
                  autoCapitalize="none"
                />
              </View>

              <Text style={[styles.label, { marginTop: 10 }]}>Odoo API Key</Text>
              <View style={styles.inputContainer}>
                <FontAwesome name="key" size={20} color="#9CA3AF" style={styles.icon} />
                <TextInput
                  style={styles.input}
                  placeholder="api_key_..."
                  value={profile.apiKey}
                  onChangeText={(text) => handleFieldChange(profile.id, 'apiKey', text)}
                  autoCapitalize="none"
                  secureTextEntry={false}
                />
              </View>
            </View>
          ))}
        </View>
      )}

      <View style={{ height: 60 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: { alignItems: 'center', padding: 30, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#eee' },
  title: { fontSize: 22, fontWeight: 'bold', color: '#333', marginTop: 10 },
  subtitle: { fontSize: 14, color: '#666', marginTop: 5 },
  section: { padding: 20, backgroundColor: '#fff', marginTop: 15 },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', color: '#714B67', marginBottom: 15, textTransform: 'uppercase' },
  info: { fontSize: 13, color: '#6B7280', fontStyle: 'italic', marginLeft: 8 },
  btnText: { color: '#fff', fontWeight: 'bold', fontSize: 15 },
  
  // Printer Specific Styles
  notConnectedBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F9FAFB', padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#F3F4F6' },
  scanBtn: {
    backgroundColor: '#00A09D',
    flexDirection: 'row',
    height: 55,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 15,
    elevation: 3,
  },
  connectedBox: {
    flexDirection: 'row',
    backgroundColor: '#ECFDF5',
    padding: 18,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#A7F3D0',
    alignItems: 'center',
    elevation: 1,
  },
  deviceConnectedName: { fontSize: 17, fontWeight: 'bold', color: '#064E3B' },
  deviceAddress: { fontSize: 12, color: '#6B7280' },
  statusRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  statusDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#10B981', marginRight: 8 },
  statusText: { fontSize: 13, color: '#10B981', fontWeight: 'bold' },
  testBtn: { width: 50, height: 50, backgroundColor: '#fff', borderRadius: 25, justifyContent: 'center', alignItems: 'center', elevation: 2, borderWidth: 1, borderColor: '#00A09D' },
  
  deviceList: { marginTop: 25, borderTopWidth: 1, borderTopColor: '#eee', paddingTop: 15 },
  listSubtitle: { fontSize: 14, fontWeight: 'bold', color: '#4B5563', marginBottom: 15 },
  deviceItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  btIconCircle: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#00A09D', justifyContent: 'center', alignItems: 'center' },
  deviceName: { fontSize: 16, color: '#1F2937', fontWeight: '500' },

  inputGroup: { marginBottom: 15 },
  label: { fontSize: 14, marginBottom: 5, color: '#4B5563', fontWeight: '500' },
  inputContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f9fafb', borderRadius: 8, borderWidth: 1, borderColor: '#d1d5db', paddingHorizontal: 12, height: 50 },
  icon: { marginRight: 10 },
  input: { flex: 1, color: '#374151', fontSize: 16 },
  pickerContainer: { backgroundColor: '#f9fafb', borderRadius: 8, borderWidth: 1, borderColor: '#d1d5db', overflow: 'hidden' },
  picker: { height: 50 },
  saveButton: { backgroundColor: '#00A09D', margin: 20, height: 55, borderRadius: 10, justifyContent: 'center', alignItems: 'center', elevation: 3 },
  saveButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  syncLogoutButton: { backgroundColor: '#714B67', margin: 20, marginTop: 0, height: 55, borderRadius: 10, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', elevation: 3 },
  syncOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(255, 255, 255, 0.9)', justifyContent: 'center', alignItems: 'center', zIndex: 1000 },
  syncText: { marginTop: 15, color: '#714B67', fontWeight: 'bold', fontSize: 16, textAlign: 'center', paddingHorizontal: 20 }
});

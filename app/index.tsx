import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
  ActivityIndicator,
  Switch,
  Modal,
  FlatList
} from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { loginSiat, fetchPortalMetadata } from '../src/api/odooClient';
import { useAuthStore } from '../src/store/authStore';
import { useConfigStore } from '../src/store/configStore';
import { runSync } from '../src/services/syncService';
import { listBackups, loadBackupDatabase } from '../src/services/dbService';

export default function LoginScreen() {
  const router = useRouter();
  const login = useAuthStore((state) => state.login);
  const setAuditMode = useAuthStore((state) => state.setAuditMode);
  
  const getActiveProfile = useConfigStore((state) => state.getActiveProfile);
  const activeProfileId = useConfigStore((state) => state.activeProfileId);
  const setProfileField = useConfigStore((state) => state.setProfileField);
  const activeProfile = getActiveProfile();

  const [url, setUrl] = useState(activeProfile?.url || '');
  const [apiKey, setApiKey] = useState(activeProfile?.apiKey || '');
  const [database, setDatabase] = useState(activeProfile?.database || '');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');
  const [isAdvanced, setIsAdvanced] = useState(false);
  
  // Backup Modal State
  const [showBackupModal, setShowBackupModal] = useState(false);
  const [backups, setBackups] = useState<string[]>([]);
  const [loadingBackups, setLoadingBackups] = useState(false);

  // Sync state if active profile changes
  useEffect(() => {
    if (activeProfile) {
      setUrl(activeProfile.url || '');
      setApiKey(activeProfile.apiKey || '');
      setDatabase(activeProfile.database || '');
    }
  }, [activeProfileId]);

  const handleLogin = async () => {
    setLoading(true);
    setAuditMode(false); // Ensure standard flow
    try {
      console.log('Iniciando autenticación SIAT para:', username);

      // Paso 1: Autenticación SIAT (Sesión)
      const authData = await loginSiat(url, database, username, password);
      console.log('AuthData Success:', JSON.stringify(authData, null, 2));

      // Paso 2: Recuperar Metadatos y API Key de Sucursal usando la autoridad del Perfil
      const activeProfile = getActiveProfile();
      const portalInfo = await fetchPortalMetadata(authData.uid, {
        url,
        database,
        apiKey: (authData as any).apiKey || activeProfile?.apiKey || '',
        sessionId: (authData as any).sessionId || ''
      });
      console.log('PortalInfo Result:', JSON.stringify(portalInfo, null, 2));
      
      const finalApiKey = portalInfo?.siatApiKey || activeProfile?.apiKey || '';
      const finalPermissions = portalInfo?.permissions || null;
      const finalCompanyIds = portalInfo?.companyIds || [authData.company_id];
      const finalCompanyId = portalInfo?.companyId || authData.company_id;

      // Si tiene éxito, guardamos en Auth y actualizamos el Perfil activo
      login({ 
        url, 
        apiKey: finalApiKey, 
        database, 
        username,
        name: authData.name,
        uid: authData.uid,
        company_id: finalCompanyId,
        company_ids: finalCompanyIds,
        company_name: authData.company_name,
        permissions: finalPermissions
      });
      
      if (activeProfileId) {
        setProfileField(activeProfileId, 'url', url);
        setProfileField(activeProfileId, 'database', database);
        setProfileField(activeProfileId, 'apiKey', finalApiKey); 
      }

      // Sincronización Inicial CRÍTICA
      setSyncing(true);
      setSyncMessage('Iniciando descarga maestra...');
      try {
        console.log('--- EMPEZANDO SYNC MAESTRO ---');
        await runSync((msg) => {
            console.log('Sync progress:', msg);
            setSyncMessage(msg);
        });
        console.log('--- SYNC MAESTRO COMPLETADO ---');
        setSyncMessage('¡Sincronización Exitosa!');
      } catch (syncError: any) {
        console.error('Error FATAL en sync inicial:', syncError);
        Alert.alert(
            'Sesión Iniciada con Advertencia', 
            'Tus credenciales son correctas, pero no pudimos descargar todos los datos offline por problemas de conexión. Algunas funciones podrían estar vacías hasta que sincronices manualmente.'
        );
      } finally {
        setSyncing(false);
      }

      console.log('Autenticación y sincronización finalizadas. Redirigiendo...');
      router.replace('/(tabs)/home');
    } catch (error: any) {
      console.error('Error de Login:', error.message);
      Alert.alert('Error de Acceso', error.message || 'Credenciales incorrectas o problema de conexión.');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenAudit = async () => {
    setLoadingBackups(true);
    setShowBackupModal(true);
    const files = await listBackups();
    setBackups(files);
    setLoadingBackups(false);
  };

  const handleLoadBackup = async (fileName: string) => {
    Alert.alert(
      "Modo Auditoría",
      `¿Deseas cargar "${fileName.replace('odoo_mobile_backup_', '').replace('.db', '')}" para auditar? La aplicación no sincronizará cambios.`,
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Cargar", onPress: async () => {
            setShowBackupModal(false);
            setLoading(true);
            const success = await loadBackupDatabase(fileName);
            if (success) {
               // Pseudo-Login for Audit
               setAuditMode(true);
               login({
                  url: 'offline',
                  apiKey: 'audit',
                  database: 'audit',
                  username: 'Auditor',
                  name: 'Auditor Offline',
                  uid: 1,
                  permissions: null
               });
               router.replace('/(tabs)/home');
            } else {
               Alert.alert('Error', 'No se pudo cargar la base de datos seleccionada.');
            }
            setLoading(false);
        }}
      ]
    );
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scrollContainer}>
        {/* Header con Logos */}
        <View style={styles.header}>
          <Text style={styles.companyName}>Industrias Kral</Text>
          <Text style={styles.kralLogo}>odoo</Text>
        </View>

        {/* Formulario */}
        <View style={styles.form}>
          {/* Toggle Advanced */}
          <View style={styles.advancedToggleContainer}>
            <Text style={styles.advancedLabel}>Configuraciones Avanzadas</Text>
            <Switch
              value={isAdvanced}
              onValueChange={setIsAdvanced}
              trackColor={{ false: '#9CA3AF', true: '#00A09D' }}
              thumbColor={isAdvanced ? '#fff' : '#f4f3f4'}
            />
          </View>

          {isAdvanced && (
            <>
              {/* URL Input */}
              <View style={styles.inputContainer}>
                <FontAwesome name="globe" size={20} color="#9CA3AF" style={styles.icon} />
                <TextInput
                  style={styles.input}
                  placeholder="URL del Servidor"
                  placeholderTextColor="#9CA3AF"
                  value={url}
                  onChangeText={setUrl}
                  autoCapitalize="none"
                  keyboardType="url"
                />
              </View>

              {/* Database Input */}
              <View style={styles.inputContainer}>
                <FontAwesome name="database" size={20} color="#9CA3AF" style={styles.icon} />
                <TextInput
                  style={styles.input}
                  placeholder="Base de Datos"
                  placeholderTextColor="#9CA3AF"
                  value={database}
                  onChangeText={setDatabase}
                  autoCapitalize="none"
                />
              </View>
            </>
          )}

          {/* Username Input */}
          <View style={styles.inputContainer}>
            <FontAwesome name="user" size={20} color="#9CA3AF" style={styles.icon} />
            <TextInput
              style={styles.input}
              placeholder="Email/Username"
              placeholderTextColor="#9CA3AF"
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              keyboardType="email-address"
            />
          </View>

          {/* Password Input */}
          <View style={styles.inputContainer}>
            <FontAwesome name="lock" size={20} color="#9CA3AF" style={styles.icon} />
            <TextInput
              style={styles.input}
              placeholder="Password"
              placeholderTextColor="#9CA3AF"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
            />
            <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
              <FontAwesome name={showPassword ? "eye" : "eye-slash"} size={20} color="#9CA3AF" />
            </TouchableOpacity>
          </View>

          {/* Login Button */}
          <TouchableOpacity
            style={[styles.loginButton, loading && { opacity: 0.7 }]}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.loginButtonText}>LOGIN</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.auditButton}
            onPress={handleOpenAudit}
            disabled={loading}
          >
            <FontAwesome name="database" size={16} color="#D1D5DB" style={{marginRight: 8}} />
            <Text style={styles.auditButtonText}>Modo Auditoría (Respaldos)</Text>
          </TouchableOpacity>

          {syncing && (
            <View style={styles.syncOverlay}>
              <ActivityIndicator size="large" color="#fff" />
              <Text style={styles.syncText}>{syncMessage}</Text>
            </View>
          )}

        </View>
      </ScrollView>

      {/* MODAL DE BACKUPS */}
      <Modal visible={showBackupModal} animationType="slide" transparent={true}>
         <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
               <View style={styles.modalHeader}>
                 <Text style={styles.modalTitle}>Cargar Base de Datos Alterna</Text>
                 <TouchableOpacity onPress={() => setShowBackupModal(false)}>
                    <FontAwesome name="close" size={24} color="#374151" />
                 </TouchableOpacity>
               </View>
               
               {loadingBackups ? (
                 <ActivityIndicator size="large" color="#00A09D" style={{marginTop: 50}}/>
               ) : (
                 <FlatList 
                    data={backups}
                    keyExtractor={item => item}
                    contentContainerStyle={{paddingBottom: 20}}
                    ListEmptyComponent={<Text style={{textAlign: 'center', marginTop: 30, color: '#6B7280'}}>No se encontraron respaldos locaux.</Text>}
                    renderItem={({item}) => (
                        <TouchableOpacity style={styles.backupItem} onPress={() => handleLoadBackup(item)}>
                            <FontAwesome name="file-text-o" size={20} color="#00A09D" style={{marginRight: 10}}/>
                            <View style={{flex: 1}}>
                               <Text style={styles.backupItemName}>{item.replace('odoo_mobile_backup_', '').replace('.db', '')}</Text>
                               <Text style={{fontSize: 12, color: '#9CA3AF'}}>Modo Solo Lectura</Text>
                            </View>
                            <FontAwesome name="chevron-right" size={14} color="#9CA3AF"/>
                        </TouchableOpacity>
                    )}
                 />
               )}
            </View>
         </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#714B67', // Odoo Purple
  },
  scrollContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 20,
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
  },
  companyName: {
    fontSize: 24,
    color: '#fff',
    fontWeight: '300',
    letterSpacing: 2,
    marginBottom: -10,
  },
  kralLogo: {
    fontSize: 60,
    fontWeight: 'bold',
    color: '#fff',
    letterSpacing: 1.5,
  },
  form: {
    width: '100%',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 4,
    marginBottom: 12,
    paddingHorizontal: 12,
    height: 50,
  },
  icon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    color: '#374151',
    fontSize: 16,
  },
  loginButton: {
    backgroundColor: '#00A09D', // Odoo Teal
    height: 55,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 4,
  },
  loginButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  auditButton: {
    marginTop: 20,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 10,
  },
  auditButtonText: {
    color: '#D1D5DB',
    fontSize: 14,
    textDecorationLine: 'underline',
  },
  syncOverlay: {
    marginTop: 20,
    padding: 15,
    backgroundColor: 'rgba(0,160,157, 0.2)',
    borderRadius: 8,
    alignItems: 'center',
  },
  syncText: {
    color: '#fff',
    marginTop: 10,
    fontWeight: 'bold',
  },
  advancedToggleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
    paddingHorizontal: 2,
  },
  advancedLabel: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    height: '60%',
    padding: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1F2937',
  },
  backupItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    marginBottom: 10,
    backgroundColor: '#F3F4F6',
    borderRadius: 8,
  },
  backupItemName: {
    fontSize: 16,
    color: '#1F2937',
    fontWeight: '500',
  }
});

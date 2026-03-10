import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
  ActivityIndicator,
  Switch,
} from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { testConnection2, testConnection } from '../src/api/odooClient';
import { useAuthStore } from '../src/store/authStore';
import { useConfigStore } from '../src/store/configStore';
import { runSync } from '../src/services/syncService';

export default function LoginScreen() {
  const router = useRouter();
  const login = useAuthStore((state) => state.login);
  const getActiveProfile = useConfigStore((state) => state.getActiveProfile);
  const activeProfile = getActiveProfile();

  const [url, setUrl] = useState(activeProfile?.url || 'https://brixy-staging240226-28986359.dev.odoo.com');
  const [apiKey, setApiKey] = useState('f5a38c3e56a878d1228745041c0bd105374134a6');
  const [database, setDatabase] = useState('brixy-staging240226-28986359');
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('Odo0Kr@l');
  const [loading, setLoading] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');
  const [isAdvanced, setIsAdvanced] = useState(false);

  const handleLogin = async () => {
    setLoading(true);
    try {
      console.log('Iniciando autenticación para:', username);

      // Intentamos la autenticación real
      await testConnection2(url, database, username, password);

      // Si tiene éxito, guardamos y navegamos
      login({ url, apiKey, database, username });

      // Sincronización Inicial
      setSyncing(true);
      try {
        await runSync((msg) => setSyncMessage(msg));
      } catch (syncError) {
        console.error('Error en sync inicial:', syncError);
        Alert.alert('Advertencia', 'El login fue exitoso pero hubo un problema al descargar los datos para el modo offline.');
      } finally {
        setSyncing(false);
      }

      console.log('Login exitoso, redirigiendo...');
      router.replace('/(tabs)/home');
    } catch (error: any) {
      console.error('Error de Login:', error.message);
      Alert.alert('Error de Acceso', 'Credenciales incorrectas o problema de conexión. Verifique su email y password.');
    } finally {
      setLoading(false);
    }
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

              {/* API Key Input */}
              <View style={styles.inputContainer}>
                <FontAwesome name="key" size={20} color="#9CA3AF" style={styles.icon} />
                <TextInput
                  style={styles.input}
                  placeholder="Odoo API Key"
                  placeholderTextColor="#9CA3AF"
                  value={apiKey}
                  onChangeText={setApiKey}
                  autoCapitalize="none"
                  secureTextEntry={!showApiKey}
                />
                <TouchableOpacity onPress={() => setShowApiKey(!showApiKey)}>
                  <FontAwesome name={showApiKey ? "eye" : "eye-slash"} size={20} color="#9CA3AF" />
                </TouchableOpacity>
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


          {syncing && (
            <View style={styles.syncOverlay}>
              <ActivityIndicator size="large" color="#fff" />
              <Text style={styles.syncText}>{syncMessage}</Text>
            </View>
          )}

        </View>
      </ScrollView>
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
  createAccountLink: {
    marginTop: 30,
    alignItems: 'center',
  },
  createAccountText: {
    color: '#D1D5DB',
    fontSize: 14,
    textDecorationLine: 'none',
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
  }
});

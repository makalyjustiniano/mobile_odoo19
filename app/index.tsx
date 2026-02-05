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
} from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { testConnection2, testConnection } from '../src/api/odooClient';
import { useAuthStore } from '../src/store/authStore';

export default function LoginScreen() {
  const router = useRouter();
  const login = useAuthStore((state) => state.login);

  const [url, setUrl] = useState('https://brixy-staging-28261857.dev.odoo.com');
  const [apiKey, setApiKey] = useState('e6c0484bddd4f9354010c515c433d97503c87757');
  const [database, setDatabase] = useState('brixy-staging-28261857');
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('Odo0Kr@l');
  const [loading, setLoading] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleLogin = async () => {
    setLoading(true);
    try {
      console.log('Iniciando autenticación para:', username);

      // Intentamos la autenticación real
      await testConnection2(url, database, username, password);

      // Si tiene éxito, guardamos y navegamos
      login({ url, apiKey, database, username });
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
          <View style={styles.odooLogoContainer}>
            {/* <Image
              source={{ uri: 'https://drive.google.com/uc?export=download&id=1wDUrE7TVsuY_WL6hZucwrpFhePECRlw1' }}
              style={styles.odooLogo}
              resizeMode="contain"
            /> */}
          </View>
          <Text style={styles.kralLogo}>odoo</Text>
        </View>

        {/* Formulario */}
        <View style={styles.form}>
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
  odooLogoContainer: {
    padding: 10,
    //borderWidth: 1,
    borderColor: '#fff',
    marginBottom: 20,
  },
  odooLogo: {
    width: 60,
    height: 30,
    tintColor: '#fff',
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
});

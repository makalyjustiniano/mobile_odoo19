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
} from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { Picker } from '@react-native-picker/picker';
import { useConfigStore } from '../../src/store/configStore';

export default function ConfiguracionScreen() {
  const { profiles, activeProfileId, setProfileUrl, setActiveProfile } = useConfigStore();
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Estado local para los inputs antes de guardar (opcional, pero aquí lo haremos directo)
  const handleUrlChange = (id: string, url: string) => {
    setProfileUrl(id, url);
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <FontAwesome name="cog" size={50} color="#714B67" />
        <Text style={styles.title}>Parámetros de Conexión</Text>
        <Text style={styles.subtitle}>Configura hasta 3 perfiles de servidor Odoo</Text>
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
        {!showAdvanced && (
          <Text style={styles.info}>Habilita esta opción para editar las URLs de los servidores.</Text>
        )}
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
        <Text style={styles.info}>
          * El perfil seleccionado será el que se use para el inicio de sesión.
        </Text>
      </View>

      <TouchableOpacity
        style={styles.saveButton}
        onPress={() => Alert.alert('Éxito', 'Configuración guardada correctamente')}
      >
        <Text style={styles.saveButtonText}>GUARDAR CAMBIOS</Text>
      </TouchableOpacity>


      {showAdvanced && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Perfiles de URL</Text>

          {profiles.map((profile) => (
            <View key={profile.id} style={styles.inputGroup}>
              <Text style={styles.label}>{profile.name}</Text>
              <View style={styles.inputContainer}>
                <FontAwesome name="globe" size={20} color="#9CA3AF" style={styles.icon} />
                <TextInput
                  style={styles.input}
                  placeholder="https://tu-servidor.odoo.com"
                  value={profile.url}
                  onChangeText={(text) => handleUrlChange(profile.id, text)}
                  autoCapitalize="none"
                  keyboardType="url"
                />
              </View>
            </View>
          ))}
        </View>
      )}



      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    alignItems: 'center',
    padding: 30,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 10,
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    marginTop: 5,
  },
  section: {
    padding: 20,
    backgroundColor: '#fff',
    marginTop: 15,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#714B67',
    marginBottom: 15,
    textTransform: 'uppercase',
  },
  inputGroup: {
    marginBottom: 15,
  },
  label: {
    fontSize: 14,
    marginBottom: 5,
    color: '#4B5563',
    fontWeight: '500',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f9fafb',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d1d5db',
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
  pickerContainer: {
    backgroundColor: '#f9fafb',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d1d5db',
    overflow: 'hidden',
  },
  picker: {
    height: 50,
  },
  info: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 10,
    fontStyle: 'italic',
  },
  saveButton: {
    backgroundColor: '#00A09D',
    margin: 20,
    height: 55,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 2,
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});

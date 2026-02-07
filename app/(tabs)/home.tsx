import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView, Dimensions } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

const { width } = Dimensions.get('window');
const COLUMN_WIDTH = (width - 40) / 2; // Subtracting padding

export default function DashboardScreen() {
  const router = useRouter();

  const menuItems = [
    {
      title: 'Clientes',
      icon: 'users',
      color: '#714B67',
      route: '/(tabs)/clientes',
    },
    {
      title: 'Auto-Ventas',
      icon: 'shopping-cart',
      color: '#00A09D',
      route: '/(tabs)/ventas',
    },
    {
      title: 'Distribución',
      icon: 'truck',
      color: '#3B82F6',
      route: '/(tabs)/distribucion',
    },
    {
      title: 'Cobranzas',
      icon: 'money',
      color: '#10B981',
      route: '/(tabs)/cobranzas',
    },
    {
      title: 'Configuración',
      icon: 'cog',
      color: '#10B9ff',
      route: '/(tabs)/configuracion',
    },
  ];

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.greeting}>Panel de Control</Text>
      </View>

      <View style={styles.grid}>
        {menuItems.map((item, index) => (
          <TouchableOpacity
            key={index}
            style={[styles.card, { backgroundColor: item.color }]}
            onPress={() => router.push(item.route as any)}
          >
            <View style={styles.iconContainer}>
              <FontAwesome name={item.icon as any} size={40} color="#fff" />
            </View>
            <Text style={styles.cardTitle}>{item.title}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    padding: 20,
    paddingTop: 20,
    backgroundColor: '#714B67',
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
    marginBottom: 20,
  },
  greeting: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
  },
  subtitle: {
    fontSize: 16,
    color: '#e2e2e2',
    marginTop: 5,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    padding: 20,
  },
  card: {
    width: COLUMN_WIDTH - 5,
    height: COLUMN_WIDTH,
    borderRadius: 20,
    padding: 10,
    marginBottom: 15,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  iconContainer: {
    marginBottom: 15,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
    textAlign: 'center',
  },
});

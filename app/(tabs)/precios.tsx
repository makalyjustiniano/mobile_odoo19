import { Text, View, StyleSheet } from 'react-native';

export default function PreciosScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Lista de Precios</Text>
      <Text>Consulta los precios de Odoo sincronizados.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 10,
  },
});

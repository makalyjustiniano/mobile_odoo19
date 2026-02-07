import { ScrollView, Text, View, Image } from 'react-native';
import { callOdoo, testConnection } from '../../src/api/odooClient';
import { useEffect, useState } from 'react';
import { Link } from 'expo-router';
import { StyleSheet } from 'react-native';

export default function Index() {

  useEffect(() => {
    testConnection();
  }, []);

  const [result, setResult] = useState([]);

  const testConnection = async () => {
    try {
      const result = await callOdoo('res.partner', 'search_read', {
        fields: [
          "display_name", "email", "phone", "lang",
          "property_account_receivable_id", "property_account_payable_id"
        ]
      });
      setResult(result);
    } catch (error) {
      console.log(error);
    }
  };

  return (
    <ScrollView
      contentContainerStyle={{
        gap: 16,
        padding: 5,
        backgroundColor: "#fff",
      }}
    >
      {result.map((partner) => (
        <View
          // que mis items name inicien en la izquierda
          key={partner.display_name}
          style={{
            backgroundColor: "#fff",
            padding: 10,
            borderRadius: 5,
            borderColor: "#ccc",
            borderWidth: 1,
          }}
        >
          <View style={{ display: "flex", flexDirection: "row", justifyContent: "space-between" }} >
            <Text style={styles.name}>{partner.display_name}</Text>
            <Text style={styles.type}>{partner.email}</Text>
            <Text style={styles.type}>{partner.phone}</Text>

          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  name: {
    fontSize: 18,
    fontWeight: "bold",
    textAlign: "left",

  },
  type: {
    fontSize: 16,
    fontWeight: "bold",
    color: "gray",
    textAlign: "left",
  },
});

import { ScrollView, Text, View, Image } from 'react-native';
import { callOdoo, testConnection } from '../src/api/odooClient';
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
      const result = await callOdoo('res.partner', 'search_read', [], [
        ["display_name", "ilike", "a%"]
      ], [
        "display_name", "email", "phone", "lang", "property_account_receivable_id", "property_account_payable_id"
      ], 20);
      setResult(result);
    } catch (error) {
      console.log(error);
    }
  };  

return (
    <ScrollView
      contentContainerStyle={{
        gap: 16,
        padding: 16,
        backgroundColor: "#fff",
      }}
    >
      {result.map((partner) => (
        <View
          key={partner.display_name}
          style={{
            backgroundColor: "#fff",
            padding: 20,
            borderRadius: 20,
            borderColor: "#ccc",
            borderWidth: 1,
          }}
        >
          <View>
            <Text style={styles.name}>{partner.display_name}</Text>
            <Text style={styles.type}>{partner.email}</Text>
            <Text style={styles.type}>{partner.phone}</Text>
            <Text style={styles.type}>{partner.lang}</Text>
            <Text style={styles.type}>{partner.property_account_receivable_id}</Text>
            <Text style={styles.type}>{partner.property_account_payable_id}</Text>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  name: {
    fontSize: 20,
    fontWeight: "bold",
    textAlign: "center",
  },
  type: {
    fontSize: 16,
    fontWeight: "bold",
    color: "gray",
    textAlign: "center",
  },
});

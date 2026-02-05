import { Text, View, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useEffect, useState } from 'react';
import { callOdoo } from '../../src/api/odooClient';

interface Product {
    id: number;
    display_name: string;
    list_price: number;
    qty_available: number;
    default_code: string | boolean;
    uom_id: [number, string];
}

export default function InventarioScreen() {
    const [products, setProducts] = useState<Product[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchProducts();
    }, []);

    const fetchProducts = async () => {
        try {
            setLoading(true);
            const data: Product[] = await callOdoo('product.product', 'search_read', {
                domain: [['sale_ok', '=', true]],
                fields: ["display_name", "list_price", "qty_available", "default_code", "uom_id"]
            });
            setProducts(data);
        } catch (error) {
            console.error("Error al cargar inventario:", error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <ScrollView style={styles.container}>
            <Text style={styles.title}>Inventario de Productos</Text>

            {loading ? (
                <ActivityIndicator size="large" color="#714B67" style={{ marginTop: 50 }} />
            ) : products.length > 0 ? (
                products.map((item) => (
                    <View key={item.id} style={styles.card}>
                        <View style={styles.row}>
                            <View style={{ flex: 1 }}>
                                <Text style={styles.code}>{item.default_code || 'Sin código'}</Text>
                                <Text style={styles.name}>{item.display_name}</Text>
                                <Text style={styles.uom}>{item.uom_id[1]}</Text>
                            </View>
                            <View style={styles.priceContainer}>
                                <Text style={styles.priceLabel}>Precio</Text>
                                <Text style={styles.priceValue}>{item.list_price} Bs.</Text>
                            </View>
                        </View>
                        <View style={styles.stockRow}>
                            <Text style={styles.stockLabel}>Stock Disponible:</Text>
                            <Text style={[styles.stockValue, { color: item.qty_available > 0 ? '#22c55e' : '#ef4444' }]}>
                                {item.qty_available}
                            </Text>
                        </View>
                    </View>
                ))
            ) : (
                <Text style={styles.emptyText}>No se encontraron productos.</Text>
            )}
            <View style={{ height: 40 }} />
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        padding: 10,
        backgroundColor: '#f5f5f5',
    },
    title: {
        fontSize: 24,
        fontWeight: 'bold',
        marginBottom: 20,
        textAlign: 'center',
        marginTop: 20,
    },
    card: {
        backgroundColor: "#fff",
        padding: 15,
        borderRadius: 12,
        borderColor: "#eee",
        borderWidth: 1,
        marginBottom: 10,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    row: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
    },
    code: {
        fontSize: 12,
        color: '#9CA3AF',
        fontWeight: 'bold',
    },
    name: {
        fontSize: 16,
        fontWeight: "bold",
        color: '#333',
        marginVertical: 2,
    },
    uom: {
        fontSize: 12,
        color: '#6B7280',
    },
    priceContainer: {
        alignItems: 'flex-end',
    },
    priceLabel: {
        fontSize: 10,
        color: '#9CA3AF',
        textTransform: 'uppercase',
    },
    priceValue: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#714B67',
    },
    stockRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginTop: 10,
        borderTopWidth: 1,
        borderTopColor: '#f3f4f6',
        paddingTop: 8,
    },
    stockLabel: {
        fontSize: 14,
        color: '#4B5563',
    },
    stockValue: {
        fontSize: 14,
        fontWeight: 'bold',
    },
    emptyText: {
        textAlign: 'center',
        marginTop: 30,
        color: '#6B7280',
    }
});

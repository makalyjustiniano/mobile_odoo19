import { Text, View, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useEffect, useState } from 'react';
import { callOdoo } from '../../src/api/odooClient';

interface SaleOrderLine {
    id: number;
    product_id: [number, string];
    product_uom_qty: number;
    price_unit: number;
    price_subtotal: number;
}

interface SaleOrder {
    id: number;
    display_name: string;
    partner_id: [number, string] | number;
    date_order: string;
    state: string;
    amount_total: number;
    order_line: number[];
    lines_data?: SaleOrderLine[];
}

export default function VentasScreen() {
    const [result, setResult] = useState<SaleOrder[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        try {
            setLoading(true);
            // 1. Fetch Orders
            const orders: SaleOrder[] = await callOdoo('sale.order', 'search_read', {
                fields: ["display_name", "partner_id", "date_order", "state", "amount_total", "order_line"]
            });

            // 2. Extract IDs
            const allLineIds = orders.flatMap(order => order.order_line);

            if (allLineIds.length > 0) {
                // 3. Fetch Line details
                const lines: SaleOrderLine[] = await callOdoo('sale.order.line', 'search_read', {
                    domain: [['id', 'in', allLineIds]],
                    fields: ["product_id", "product_uom_qty", "price_unit", "price_subtotal"]
                });

                // 4. Merge data
                const ordersWithLines = orders.map(order => ({
                    ...order,
                    lines_data: lines.filter(line => order.order_line.includes(line.id))
                }));
                setResult(ordersWithLines);
            } else {
                setResult(orders);
            }
        } catch (error) {
            console.error("Error al cargar ventas:", error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <ScrollView style={styles.container}>
            <Text style={styles.title}>Cotizaciones</Text>

            {loading ? (
                <ActivityIndicator size="large" color="#714B67" style={{ marginTop: 50 }} />
            ) : result.length > 0 ? (
                result.map((order) => (
                    <View key={order.id} style={styles.card}>
                        <View>
                            <Text style={[styles.type, { textAlign: 'right', fontWeight: 'bold' }]}>Order: {order.state}</Text>
                            <Text style={styles.name}>{order.display_name}</Text>
                            <Text style={styles.type}>Cliente: {Array.isArray(order.partner_id) ? order.partner_id[1] : order.partner_id}</Text>
                            <Text style={styles.type}>Fecha: {order.date_order}</Text>
                            <Text style={[styles.type, { color: order.state === 'sale' ? '#22c55e' : '#f59e0b' }]}>
                                Estado: {order.state}
                            </Text>
                            <Text style={styles.name}>Total: {order.amount_total} Bs.</Text>

                            <View style={styles.lineItem}>
                                <Text style={styles.lineTitle}>Productos:</Text>
                                {order.lines_data?.map((line) => (
                                    <View key={line.id} style={{ marginVertical: 5, paddingLeft: 10 }}>
                                        <Text style={{ fontWeight: 'bold' }}>• {line.product_id[1]}</Text>
                                        <Text style={styles.type}>Cant: {line.product_uom_qty} | Precio: {line.price_unit} Bs.</Text>
                                        <Text style={[styles.type, { textAlign: 'right', fontWeight: 'bold' }]}>
                                            Subtotal: {line.price_subtotal} Bs.
                                        </Text>

                                    </View>
                                ))}
                            </View>
                        </View>
                    </View>
                ))
            ) : (
                <Text style={{ textAlign: 'center', marginTop: 30 }}>No se encontraron ventas.</Text>
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
        position: 'relative',
    },
    card: {
        backgroundColor: "#fff",
        padding: 15,
        borderRadius: 12,
        borderColor: "#eee",
        borderWidth: 1,
        marginBottom: 15,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    name: {
        fontSize: 18,
        fontWeight: "bold",
        color: '#333',
        marginBottom: 5,
    },
    type: {
        fontSize: 14,
        color: "#666",
        marginBottom: 2,
    },
    lineItem: {
        marginTop: 10,
        paddingTop: 10,
        borderTopWidth: 1,
        borderTopColor: '#eee',
    },
    lineTitle: {
        fontSize: 14,
        fontWeight: 'bold',
        color: '#444',
    }
});

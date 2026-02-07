import React, { useEffect, useState } from 'react';
import {
    StyleSheet,
    View,
    Text,
    FlatList,
    ActivityIndicator,
    TextInput,
    TouchableOpacity,
    RefreshControl
} from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
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
    const [filteredProducts, setFilteredProducts] = useState<Product[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    const fetchProducts = async () => {
        try {
            if (!refreshing) setLoading(true);
            const data: Product[] = await callOdoo('product.product', 'search_read', {
                domain: [['sale_ok', '=', true]],
                fields: ["display_name", "list_price", "qty_available", "default_code", "uom_id"]
            });
            setProducts(data);
            applyFilter(searchQuery, data);
        } catch (error) {
            console.error("Error al cargar inventario:", error);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    useEffect(() => {
        fetchProducts();
    }, []);

    const onRefresh = () => {
        setRefreshing(true);
        fetchProducts();
    };

    const handleSearch = (text: string) => {
        setSearchQuery(text);
        applyFilter(text, products);
    };

    const applyFilter = (query: string, allProducts: Product[]) => {
        if (!query) {
            setFilteredProducts(allProducts);
            return;
        }
        const filtered = allProducts.filter(p =>
            p.display_name.toLowerCase().includes(query.toLowerCase()) ||
            (typeof p.default_code === 'string' && p.default_code.toLowerCase().includes(query.toLowerCase()))
        );
        setFilteredProducts(filtered);
    };

    const renderItem = ({ item }: { item: Product }) => (
        <View style={styles.card}>
            <View style={styles.cardHeader}>
                <View style={{ flex: 1 }}>
                    <Text style={styles.code}>{item.default_code || 'Sin Código'}</Text>
                    <Text style={styles.name}>{item.display_name}</Text>
                    <Text style={styles.uom}>{item.uom_id[1]}</Text>
                </View>
                <View style={styles.priceContainer}>
                    <Text style={styles.priceValue}>{item.list_price.toFixed(2)}</Text>
                    <Text style={styles.currency}>Bs.</Text>
                </View>
            </View>

            <View style={styles.stockFooter}>
                <View style={styles.stockLabelContainer}>
                    <FontAwesome name="archive" size={14} color="#666" />
                    <Text style={styles.stockLabel}> Cantidad a mano</Text>
                </View>
                <View style={[
                    styles.stockBadge,
                    { backgroundColor: item.qty_available > 0 ? '#ECFDF5' : '#FEF2F2' }
                ]}>
                    <Text style={[
                        styles.stockValue,
                        { color: item.qty_available > 0 ? '#10B981' : '#EF4444' }
                    ]}>
                        {item.qty_available}
                    </Text>
                </View>
            </View>
        </View>
    );

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.headerTitle}>Stock de Inventario</Text>
                <View style={styles.searchContainer}>
                    <FontAwesome name="search" size={16} color="#9CA3AF" style={styles.searchIcon} />
                    <TextInput
                        style={styles.searchInput}
                        placeholder="Buscar por nombre o código..."
                        value={searchQuery}
                        onChangeText={handleSearch}
                        placeholderTextColor="#9CA3AF"
                    />
                    {searchQuery.length > 0 && (
                        <TouchableOpacity onPress={() => handleSearch('')}>
                            <FontAwesome name="times-circle" size={18} color="#9CA3AF" />
                        </TouchableOpacity>
                    )}
                </View>
            </View>

            {loading && !refreshing ? (
                <View style={styles.centerContainer}>
                    <ActivityIndicator size="large" color="#714B67" />
                    <Text style={styles.loadingText}>Cargando productos...</Text>
                </View>
            ) : (
                <FlatList
                    data={filteredProducts}
                    keyExtractor={(item) => item.id.toString()}
                    renderItem={renderItem}
                    contentContainerStyle={styles.listContent}
                    refreshControl={
                        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#714B67']} />
                    }
                    ListEmptyComponent={
                        <View style={styles.emptyContainer}>
                            <FontAwesome name="dropbox" size={80} color="#E5E7EB" />
                            <Text style={styles.emptyText}>
                                {searchQuery ? 'No se encontraron resultados' : 'No hay productos en inventario'}
                            </Text>
                        </View>
                    }
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F9FAFB',
    },
    header: {
        backgroundColor: '#fff',
        padding: 20,
        paddingBottom: 15,
        borderBottomWidth: 1,
        borderBottomColor: '#F3F4F6',
    },
    headerTitle: {
        fontSize: 22,
        fontWeight: 'bold',
        color: '#111827',
        marginBottom: 15,
    },
    searchContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#F3F4F6',
        borderRadius: 10,
        paddingHorizontal: 12,
        height: 45,
    },
    searchIcon: {
        marginRight: 10,
    },
    searchInput: {
        flex: 1,
        fontSize: 15,
        color: '#111827',
    },
    listContent: {
        padding: 15,
        paddingBottom: 30,
    },
    card: {
        backgroundColor: '#fff',
        borderRadius: 15,
        marginBottom: 15,
        padding: 15,
        elevation: 2,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 10,
        borderWidth: 1,
        borderColor: '#F3F4F6',
    },
    cardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 12,
    },
    code: {
        fontSize: 11,
        fontWeight: 'bold',
        color: '#00A09D',
        textTransform: 'uppercase',
        marginBottom: 4,
    },
    name: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#1F2937',
        marginVertical: 2,
    },
    uom: {
        fontSize: 12,
        color: '#6B7280',
    },
    priceContainer: {
        alignItems: 'flex-end',
    },
    priceValue: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#714B67',
    },
    currency: {
        fontSize: 10,
        color: '#9CA3AF',
        fontWeight: 'bold',
    },
    stockFooter: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderTopWidth: 1,
        borderTopColor: '#F3F4F6',
        paddingTop: 12,
    },
    stockLabelContainer: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    stockLabel: {
        fontSize: 14,
        color: '#4B5563',
    },
    stockBadge: {
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 20,
    },
    stockValue: {
        fontSize: 15,
        fontWeight: '800',
    },
    centerContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    loadingText: {
        marginTop: 10,
        color: '#6B7280',
    },
    emptyContainer: {
        alignItems: 'center',
        marginTop: 100,
    },
    emptyText: {
        marginTop: 20,
        fontSize: 16,
        color: '#9CA3AF',
        textAlign: 'center',
    },
});

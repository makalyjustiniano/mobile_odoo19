import React, { useEffect, useState } from 'react';
import {
    StyleSheet,
    View,
    Text,
    FlatList,
    ActivityIndicator,
    TouchableOpacity,
    RefreshControl,
    Modal,
    TextInput,
    Alert,
    KeyboardAvoidingView,
    Platform,
    ScrollView
} from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
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
    name: string;
    display_name: string;
    partner_id: [number, string];
    date_order: string;
    state: string;
    amount_total: number;
    order_line: number[];
    lines_data?: SaleOrderLine[];
}

interface Partner {
    id: number;
    display_name: string;
}

interface Product {
    id: number;
    display_name: string;
    list_price: number;
}

interface NewLine {
    product_id: number;
    product_name: string;
    quantity: number;
    price: number;
}

export default function VentasScreen() {
    const [result, setResult] = useState<SaleOrder[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [modalVisible, setModalVisible] = useState(false);

    // Form state
    const [selectedPartner, setSelectedPartner] = useState<Partner | null>(null);
    const [partnerSearch, setPartnerSearch] = useState('');
    const [partners, setPartners] = useState<Partner[]>([]);
    const [showPartnerResults, setShowPartnerResults] = useState(false);

    const [productSearch, setProductSearch] = useState('');
    const [products, setProducts] = useState<Product[]>([]);
    const [showProductResults, setShowProductResults] = useState(false);

    const [quoteLines, setQuoteLines] = useState<NewLine[]>([]);
    const [shouldConfirm, setShouldConfirm] = useState(false);

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        try {
            if (!refreshing) setLoading(true);
            const orders: SaleOrder[] = await callOdoo('sale.order', 'search_read', {
                fields: ["name", "display_name", "partner_id", "date_order", "state", "amount_total", "order_line"],
                limit: 20
            });

            const allLineIds = orders.flatMap(order => order.order_line);

            if (allLineIds.length > 0) {
                const lines: SaleOrderLine[] = await callOdoo('sale.order.line', 'search_read', {
                    domain: [['id', 'in', allLineIds]],
                    fields: ["product_id", "product_uom_qty", "price_unit", "price_subtotal"]
                });

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
            setRefreshing(false);
        }
    };

    const onRefresh = () => {
        setRefreshing(true);
        fetchData();
    };

    // Partner search logic
    const searchPartners = async (query: string) => {
        setPartnerSearch(query);
        if (query.length < 2) {
            setPartners([]);
            setShowPartnerResults(false);
            return;
        }
        try {
            const results = await callOdoo('res.partner', 'search_read', {
                domain: [['name', 'ilike', query], ['customer_rank', '>', 0]],
                fields: ['display_name'],
                limit: 5
            });
            setPartners(results);
            setShowPartnerResults(true);
        } catch (error) {
            console.error('Error searching partners:', error);
        }
    };

    // Product search logic
    const searchProducts = async (query: string) => {
        setProductSearch(query);
        if (query.length < 2) {
            setProducts([]);
            setShowProductResults(false);
            return;
        }
        try {
            const results = await callOdoo('product.product', 'search_read', {
                domain: [['name', 'ilike', query], ['sale_ok', '=', true]],
                fields: ['display_name', 'list_price'],
                limit: 5
            });
            setProducts(results);
            setShowProductResults(true);
        } catch (error) {
            console.error('Error searching products:', error);
        }
    };

    const addProductToQuote = (product: Product) => {
        const existing = quoteLines.find(l => l.product_id === product.id);
        if (existing) {
            setQuoteLines(quoteLines.map(l =>
                l.product_id === product.id ? { ...l, quantity: l.quantity + 1 } : l
            ));
        } else {
            setQuoteLines([...quoteLines, {
                product_id: product.id,
                product_name: product.display_name,
                quantity: 1,
                price: product.list_price
            }]);
        }
        setProductSearch('');
        setShowProductResults(false);
    };

    const removeLine = (productId: number) => {
        setQuoteLines(quoteLines.filter(l => l.product_id !== productId));
    };

    const updateQuantity = (productId: number, delta: number) => {
        setQuoteLines(quoteLines.map(l => {
            if (l.product_id === productId) {
                const newQty = Math.max(1, l.quantity + delta);
                return { ...l, quantity: newQty };
            }
            return l;
        }));
    };

    const saveQuotation = async () => {
        if (!selectedPartner) {
            Alert.alert('Error', 'Seleccione un cliente');
            return;
        }
        if (quoteLines.length === 0) {
            Alert.alert('Error', 'Agregue al menos un producto');
            return;
        }

        try {
            setLoading(true);

            // Format lines for Odoo (Command 0, 0, values)
            const lines = quoteLines.map(line => [0, 0, {
                product_id: line.product_id,
                product_uom_qty: line.quantity,
                price_unit: line.price
            }]);

            // Prepare data following Odoo 19 REST API pattern
            const vals = {
                partner_id: selectedPartner.id,
                order_line: lines,
                date_order: new Date().toISOString().split('T')[0] + " " + new Date().toLocaleTimeString('en-GB'),
                state: 'draft',
            };

            const response = await callOdoo('sale.order', 'create', {
                vals_list: [vals]
            });

            // Extraction logic for ID
            let newOrderId = null;
            if (Array.isArray(response) && response.length > 0) {
                newOrderId = response[0].id || response[0];
            } else if (response && typeof response === 'object') {
                newOrderId = response.id || response;
            } else {
                newOrderId = response;
            }

            setModalVisible(false);
            Alert.alert('Éxito', `Cotización creada correctamente. ID: ${JSON.stringify(newOrderId)}`);

            // Reset form
            setSelectedPartner(null);
            setPartnerSearch('');
            setQuoteLines([]);
            fetchData();
        } catch (error: any) {
            console.error('Error creating quotation:', error);
            Alert.alert(
                'Error al registrar',
                `Odoo respondió: ${error.message || 'Error desconocido'}`
            );
        } finally {
            setLoading(false);
        }
    };

    const confirmExistingOrder = async (orderId: number) => {
        try {
            setLoading(true);
            await callOdoo('sale.order', 'action_confirm', {
                ids: [orderId]
            });
            Alert.alert('Éxito', 'Venta confirmada correctamente');
            fetchData();
        } catch (error: any) {
            console.error('Error confirming order:', error);
            Alert.alert('Error', `No se pudo confirmar: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    const renderCard = ({ item }: { item: SaleOrder }) => (
        <View style={styles.card}>
            <View style={styles.cardHeader}>
                <Text style={styles.orderName}>{item.name || item.display_name}</Text>
                <View style={[styles.statusBadge, { backgroundColor: item.state === 'sale' ? '#D1FAE5' : '#FEF3C7' }]}>
                    <Text style={[styles.statusText, { color: item.state === 'sale' ? '#065F46' : '#92400E' }]}>
                        {item.state === 'sale' ? 'Pedido' : 'Cotización'}
                    </Text>
                </View>
            </View>

            <View style={styles.cardBody}>
                <View style={styles.infoRow}>
                    <FontAwesome name="user" size={14} color="#6B7280" />
                    <Text style={styles.partnerName}>
                        {Array.isArray(item.partner_id) ? item.partner_id[1] : 'Individual'}
                    </Text>
                </View>
                <View style={styles.infoRow}>
                    <FontAwesome name="calendar" size={14} color="#6B7280" />
                    <Text style={styles.dateText}>{new Date(item.date_order).toLocaleDateString()}</Text>
                </View>

                <View style={styles.divider} />

                {item.lines_data?.map((line, idx) => (
                    <View key={idx} style={styles.linePreview}>
                        <Text style={styles.lineText} numberOfLines={1}>
                            • {line.product_id[1]} (x{line.product_uom_qty})
                        </Text>
                    </View>
                ))}

                <View style={styles.totalRow}>
                    <View>
                        <Text style={styles.totalLabel}>TOTAL</Text>
                        <Text style={styles.totalValue}>Bs. {item.amount_total.toFixed(2)}</Text>
                    </View>
                    {(item.state === 'draft' || item.state === 'sent') && (
                        <TouchableOpacity
                            style={styles.confirmInlineButton}
                            onPress={() => confirmExistingOrder(item.id)}
                        >
                            <FontAwesome name="check-circle" size={14} color="#fff" />
                            <Text style={styles.confirmInlineText}>CONFIRMAR</Text>
                        </TouchableOpacity>
                    )}
                </View>
            </View>
        </View>
    );

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.headerTitle}>Ventas & Cotizaciones</Text>
                <TouchableOpacity
                    style={styles.newButton}
                    onPress={() => setModalVisible(true)}
                >
                    <FontAwesome name="plus" size={16} color="#fff" />
                    <Text style={styles.newButtonText}>NUEVA</Text>
                </TouchableOpacity>
            </View>

            <FlatList
                data={result}
                keyExtractor={(item) => item.id.toString()}
                renderItem={renderCard}
                contentContainerStyle={styles.listContent}
                refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#714B67']} />
                }
                ListEmptyComponent={
                    <View style={styles.emptyContainer}>
                        <FontAwesome name="shopping-basket" size={80} color="#E5E7EB" />
                        <Text style={styles.emptyText}>No hay movimientos registrados</Text>
                    </View>
                }
            />

            <Modal
                animationType="slide"
                transparent={true}
                visible={modalVisible}
                onRequestClose={() => setModalVisible(false)}
            >
                <KeyboardAvoidingView
                    behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                    style={styles.modalOverlay}
                >
                    <View style={styles.modalContent}>
                        <View style={styles.modalHeader}>
                            <Text style={styles.modalTitle}>Crear Cotización</Text>
                            <TouchableOpacity onPress={() => setModalVisible(false)}>
                                <FontAwesome name="times" size={24} color="#6B7280" />
                            </TouchableOpacity>
                        </View>

                        <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
                            {/* Partner Selection */}
                            <Text style={styles.inputLabel}>Cliente</Text>
                            {selectedPartner ? (
                                <View style={styles.selectedItem}>
                                    <Text style={styles.selectedText}>{selectedPartner.display_name}</Text>
                                    <TouchableOpacity onPress={() => setSelectedPartner(null)}>
                                        <FontAwesome name="times-circle" size={20} color="#EF4444" />
                                    </TouchableOpacity>
                                </View>
                            ) : (
                                <View style={styles.searchWrapper}>
                                    <TextInput
                                        style={styles.searchInput}
                                        placeholder="Buscar cliente..."
                                        value={partnerSearch}
                                        onChangeText={searchPartners}
                                    />
                                    {showPartnerResults && (
                                        <View style={styles.searchResults}>
                                            {partners.map(p => (
                                                <TouchableOpacity
                                                    key={p.id}
                                                    style={styles.resultItem}
                                                    onPress={() => {
                                                        setSelectedPartner(p);
                                                        setShowPartnerResults(false);
                                                    }}
                                                >
                                                    <Text>{p.display_name}</Text>
                                                </TouchableOpacity>
                                            ))}
                                        </View>
                                    )}
                                </View>
                            )}

                            {/* Product Selection */}
                            <Text style={[styles.inputLabel, { marginTop: 20 }]}>Agregar Productos</Text>
                            <View style={styles.searchWrapper}>
                                <TextInput
                                    style={styles.searchInput}
                                    placeholder="Nombre del producto..."
                                    value={productSearch}
                                    onChangeText={searchProducts}
                                />
                                {showProductResults && (
                                    <View style={styles.searchResults}>
                                        {products.map(p => (
                                            <TouchableOpacity
                                                key={p.id}
                                                style={styles.resultItem}
                                                onPress={() => addProductToQuote(p)}
                                            >
                                                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                                                    <Text style={{ flex: 1 }}>{p.display_name}</Text>
                                                    <Text style={{ fontWeight: 'bold' }}>Bs. {p.list_price}</Text>
                                                </View>
                                            </TouchableOpacity>
                                        ))}
                                    </View>
                                )}
                            </View>

                            {/* Quote Lines */}
                            <Text style={[styles.inputLabel, { marginTop: 20 }]}>Productos Seleccionados</Text>
                            {quoteLines.length === 0 ? (
                                <Text style={styles.placeholderText}>No se han agregado productos aún.</Text>
                            ) : (
                                quoteLines.map(line => (
                                    <View key={line.product_id} style={styles.quoteLine}>
                                        <View style={{ flex: 1 }}>
                                            <Text style={styles.lineName} numberOfLines={1}>{line.product_name}</Text>
                                            <Text style={styles.linePrice}>Bs. {line.price.toFixed(2)} c/u</Text>
                                        </View>
                                        <View style={styles.qtyControls}>
                                            <TouchableOpacity onPress={() => updateQuantity(line.product_id, -1)}>
                                                <FontAwesome name="minus-square-o" size={28} color="#714B67" />
                                            </TouchableOpacity>
                                            <Text style={styles.qtyText}>{line.quantity}</Text>
                                            <TouchableOpacity onPress={() => updateQuantity(line.product_id, 1)}>
                                                <FontAwesome name="plus-square-o" size={28} color="#714B67" />
                                            </TouchableOpacity>
                                        </View>
                                        <TouchableOpacity onPress={() => removeLine(line.product_id)} style={{ marginLeft: 15 }}>
                                            <FontAwesome name="trash-o" size={24} color="#EF4444" />
                                        </TouchableOpacity>
                                    </View>
                                ))
                            )}

                            {/* Confirmation Toggle */}
                            <View style={styles.toggleRow}>
                                <Text style={styles.inputLabel}>¿Confirmar Orden Automáticamente?</Text>
                                <TouchableOpacity
                                    onPress={() => setShouldConfirm(!shouldConfirm)}
                                    style={[styles.toggleSwitch, shouldConfirm && styles.toggleSwitchActive]}
                                >
                                    <View style={[styles.toggleCircle, shouldConfirm && styles.toggleCircleActive]} />
                                </TouchableOpacity>
                            </View>

                            <View style={{ height: 100 }} />
                        </ScrollView>

                        <View style={styles.modalFooter}>
                            <Text style={styles.modalTotal}>
                                Total: Bs. {quoteLines.reduce((acc, l) => acc + (l.price * l.quantity), 0).toFixed(2)}
                            </Text>
                            <TouchableOpacity
                                style={[styles.saveButton, { backgroundColor: shouldConfirm ? '#22C55E' : '#00A09D', opacity: (selectedPartner && quoteLines.length > 0) ? 1 : 0.5 }]}
                                onPress={saveQuotation}
                                disabled={!selectedPartner || quoteLines.length === 0}
                            >
                                <Text style={styles.saveButtonText}>
                                    {shouldConfirm ? 'CONFIRMAR Y CREAR ORDEN' : 'GUARDAR COMO COTIZACION'}
                                </Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </KeyboardAvoidingView>
            </Modal>
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
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottomWidth: 1,
        borderBottomColor: '#F3F4F6',
    },
    headerTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#111827',
    },
    newButton: {
        backgroundColor: '#00A09D',
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 15,
        paddingVertical: 10,
        borderRadius: 8,
    },
    newButtonText: {
        color: '#fff',
        fontWeight: 'bold',
        marginLeft: 8,
        fontSize: 12,
    },
    listContent: {
        padding: 15,
    },
    card: {
        backgroundColor: '#fff',
        borderRadius: 12,
        marginBottom: 15,
        borderWidth: 1,
        borderColor: '#E5E7EB',
        elevation: 2,
    },
    cardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 12,
        backgroundColor: '#F9FAFB',
        borderBottomWidth: 1,
        borderBottomColor: '#F3F4F6',
    },
    orderName: {
        fontSize: 14,
        fontWeight: 'bold',
        color: '#374151',
    },
    statusBadge: {
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 4,
    },
    statusText: {
        fontSize: 10,
        fontWeight: 'bold',
        textTransform: 'uppercase',
    },
    cardBody: {
        padding: 15,
    },
    infoRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 6,
    },
    partnerName: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#111827',
        marginLeft: 10,
    },
    dateText: {
        fontSize: 13,
        color: '#6B7280',
        marginLeft: 10,
    },
    divider: {
        height: 1,
        backgroundColor: '#F3F4F6',
        marginVertical: 10,
    },
    linePreview: {
        marginBottom: 4,
    },
    lineText: {
        fontSize: 13,
        color: '#4B5563',
    },
    totalRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: 15,
        paddingTop: 10,
        borderTopWidth: 1,
        borderTopColor: '#F3F4F6',
    },
    totalLabel: {
        fontSize: 12,
        fontWeight: 'bold',
        color: '#9CA3AF',
    },
    totalValue: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#714B67',
    },
    confirmInlineButton: {
        backgroundColor: '#22C55E',
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 6,
    },
    confirmInlineText: {
        color: '#fff',
        fontSize: 11,
        fontWeight: 'bold',
        marginLeft: 5,
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'flex-end',
    },
    modalContent: {
        backgroundColor: '#fff',
        height: '92%',
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        overflow: 'hidden',
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 20,
        borderBottomWidth: 1,
        borderBottomColor: '#F3F4F6',
    },
    modalTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#111827',
    },
    modalBody: {
        padding: 20,
    },
    inputLabel: {
        fontSize: 14,
        fontWeight: 'bold',
        color: '#374151',
        marginBottom: 8,
    },
    searchWrapper: {
        zIndex: 10,
    },
    searchInput: {
        backgroundColor: '#F3F4F6',
        borderRadius: 8,
        padding: 12,
        fontSize: 16,
        borderWidth: 1,
        borderColor: '#E5E7EB',
    },
    searchResults: {
        backgroundColor: '#fff',
        borderWidth: 1,
        borderColor: '#E5E7EB',
        borderRadius: 8,
        marginTop: 4,
        maxHeight: 200,
        elevation: 4,
        zIndex: 100,
    },
    resultItem: {
        padding: 15,
        borderBottomWidth: 1,
        borderBottomColor: '#F3F4F6',
    },
    toggleRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: 25,
        paddingBottom: 20,
    },
    toggleSwitch: {
        width: 50,
        height: 28,
        borderRadius: 14,
        backgroundColor: '#D1D5DB',
        padding: 2,
    },
    toggleSwitchActive: {
        backgroundColor: '#22C55E',
    },
    toggleCircle: {
        width: 24,
        height: 24,
        borderRadius: 12,
        backgroundColor: '#fff',
    },
    toggleCircleActive: {
        transform: [{ translateX: 22 }],
    },
    selectedItem: {
        flexDirection: 'row',
        backgroundColor: '#E6F6F5',
        padding: 12,
        borderRadius: 8,
        justifyContent: 'space-between',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#00A09D',
    },
    selectedText: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#00A09D',
    },
    placeholderText: {
        color: '#9CA3AF',
        fontStyle: 'italic',
        marginTop: 10,
    },
    quoteLine: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#fff',
        borderBottomWidth: 1,
        borderBottomColor: '#F3F4F6',
        paddingVertical: 12,
    },
    lineName: {
        fontSize: 15,
        fontWeight: 'bold',
        color: '#111827',
    },
    linePrice: {
        fontSize: 12,
        color: '#6B7280',
    },
    qtyControls: {
        flexDirection: 'row',
        alignItems: 'center',
        marginLeft: 10,
    },
    qtyText: {
        fontSize: 18,
        fontWeight: 'bold',
        marginHorizontal: 12,
        minWidth: 20,
        textAlign: 'center',
    },
    modalFooter: {
        padding: 20,
        borderTopWidth: 1,
        borderTopColor: '#F3F4F6',
        backgroundColor: '#F9FAFB',
    },
    modalTotal: {
        fontSize: 22,
        fontWeight: 'bold',
        textAlign: 'right',
        color: '#714B67',
        marginBottom: 15,
    },
    saveButton: {
        backgroundColor: '#00A09D',
        height: 55,
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
    },
    saveButtonText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: 'bold',
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
        marginTop: 15,
        fontSize: 16,
        color: '#6B7280',
    },
});

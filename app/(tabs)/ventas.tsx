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
import { useConfigStore } from '../../src/store/configStore';
import { usePartnerStore } from '../../src/store/usePartnerStore';
import { useProductStore } from '../../src/store/useProductStore';
import * as db from '../../src/services/dbService';

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
    invoice_id?: number | null;
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

interface Invoice {
    id: number;
    name: string;
    partner_name: string;
    invoice_date: string;
    amount_total: number;
    amount_residual: number;
    lines?: any[];
}

export default function VentasScreen() {
    const [result, setResult] = useState<SaleOrder[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [modalVisible, setModalVisible] = useState(false);
    
    // Invoice Modal State
    const [invoiceModalVisible, setInvoiceModalVisible] = useState(false);
    const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
    const [loadingInvoice, setLoadingInvoice] = useState(false);

    const isOffline = useConfigStore((state) => state.isOffline);

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
    }, [isOffline]);

    const fetchData = async () => {
        try {
            await db.initDB();
            if (!refreshing) setLoading(true);

            if (isOffline) {
                console.log('Fetching sales from SQLite...');
                const localOrders = await db.getSaleOrders();
                setResult(localOrders as any);
                return;
            }

            console.log('Fetching sales from Odoo...');
            const orders: SaleOrder[] = await callOdoo('sale.order', 'search_read', {
                fields: ["name", "display_name", "partner_id", "date_order", "state", "amount_total", "order_line", "invoice_ids"],
                limit: 20
            });

            const allLineIds = orders.flatMap(order => order.order_line);

            if (allLineIds.length > 0) {
                const lines: SaleOrderLine[] = await callOdoo('sale.order.line', 'search_read', {
                    domain: [['id', 'in', allLineIds]],
                    fields: ["product_id", "product_uom_qty", "price_unit", "price_subtotal"]
                });

                const ordersWithLines = orders.map(order => {
                    const o: any = order;
                    return {
                        ...order,
                        invoice_id: Array.isArray(o.invoice_ids) && o.invoice_ids.length > 0 ? o.invoice_ids[0] : null,
                        lines_data: lines.filter(line => order.order_line.includes(line.id))
                    };
                });
                setResult(ordersWithLines);
            } else {
                setResult(orders.map(o => ({ ...o, invoice_id: (o as any).invoice_ids?.[0] || null })));
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
        if (query.length < 1) {
            setPartners([]);
            setShowPartnerResults(false);
            return;
        }

        // 1. Busqueda local (Instantanea)
        const localResults = usePartnerStore.getState().searchPartnersLocal(query);
        setPartners(localResults as any);
        setShowPartnerResults(true);

        // 2. Busqueda online de respaldo (si no es offline)
        if (!isOffline) {
            try {
                const results = await callOdoo('res.partner', 'search_read', {
                    domain: [['name', 'ilike', query]],
                    fields: ['name'],
                    limit: 10
                });
                
                const partnerArray = Array.isArray(results) ? results : (results?.result || []);
                if (partnerArray.length > 0) {
                    setPartners(partnerArray.map((p: any) => ({
                        id: p.id,
                        display_name: p.name || p.display_name
                    })));
                }
            } catch (error) {
                console.log('Online partner search failed, using local results.');
            }
        }
    };

    // Product search logic
    const searchProducts = async (query: string) => {
        setProductSearch(query);
        if (query.length < 1) {
            setProducts([]);
            setShowProductResults(false);
            return;
        }

        // 1. Busqueda local
        const localResults = useProductStore.getState().searchProductsLocal(query);
        setProducts(localResults as any);
        setShowProductResults(true);

        if (!isOffline) {
            try {
                const results = await callOdoo('product.product', 'search_read', {
                    domain: [['name', 'ilike', query], ['sale_ok', '=', true]],
                    fields: ['display_name', 'list_price'],
                    limit: 10
                });
                
                const productArray = Array.isArray(results) ? results : (results?.result || []);
                if (productArray.length > 0) {
                    setProducts(productArray);
                }
            } catch (error) {
                console.log('Online product search failed, using local.');
            }
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

            if (isOffline) {
                const localOrder = {
                    partner_name: selectedPartner.display_name,
                    date_order: new Date().toISOString().replace('T', ' ').substring(0, 19),
                    amount_total: quoteLines.reduce((acc, l) => acc + (l.price * l.quantity), 0)
                };
                
                await db.createSaleOrderLocal(localOrder, quoteLines);
                
                setModalVisible(false);
                Alert.alert('Modo Offline', 'Cotización guardada localmente.');
                
                setSelectedPartner(null);
                setPartnerSearch('');
                setQuoteLines([]);
                fetchData();
                return;
            }

            const lines = quoteLines.map(line => [0, 0, {
                product_id: line.product_id,
                product_uom_qty: line.quantity,
                price_unit: line.price
            }]);

            const vals = {
                partner_id: selectedPartner.id,
                order_line: lines,
                date_order: new Date().toISOString().split('T')[0] + " " + new Date().toLocaleTimeString('en-GB'),
                state: 'draft',
            };

            await callOdoo('sale.order', 'create', {
                vals_list: [vals]
            });

            setModalVisible(false);
            Alert.alert('Éxito', `Cotización creada correctamente en Odoo.`);

            setSelectedPartner(null);
            setPartnerSearch('');
            setQuoteLines([]);
            fetchData();
        } catch (error: any) {
            console.error('Error creating quotation:', error);
            Alert.alert('Error', `Odoo respondió: ${error.message}`);
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

    const handleCreateInvoice = async (orderId: number) => {
        try {
            setLoading(true);
            if (isOffline) {
                await db.createInvoiceLocal(orderId);
                Alert.alert('Éxito', 'Factura generada localmente. Podrá visualizarla abajo.');
                fetchData();
                return;
            }

            // Online invoicing: Manual creation with linking
            const orderOdoo = await callOdoo('sale.order', 'search_read', {
                domain: [['id', '=', orderId]],
                fields: ['state', 'name', 'partner_id', 'order_line']
            });
            
            if (orderOdoo.length > 0) {
                const order = orderOdoo[0];
                if (['draft', 'sent'].includes(order.state)) {
                    await callOdoo('sale.order', 'action_confirm', { ids: [orderId] }); 
                }

                // Fetch SO lines for linking
                const soLines = await callOdoo('sale.order.line', 'search_read', {
                    domain: [['order_id', '=', orderId]],
                    fields: ['id', 'product_id', 'name', 'product_uom_qty', 'price_unit']
                });

                const invoiceLinesOdoo = soLines.map((sol: any) => [0, 0, {
                    name: sol.name,
                    quantity: sol.product_uom_qty,
                    price_unit: sol.price_unit,
                    sale_line_ids: [[4, sol.id]]
                }]);

                const invoiceVals = {
                    move_type: 'out_invoice',
                    partner_id: order.partner_id[0],
                    invoice_date: new Date().toISOString().split('T')[0],
                    invoice_line_ids: invoiceLinesOdoo,
                    invoice_origin: order.name,
                };

                const invResponse = await callOdoo('account.move', 'create', { vals_list: [invoiceVals] });
                const newInvId = Array.isArray(invResponse) ? (invResponse[0].id || invResponse[0]) : (invResponse.id || invResponse);

                if (newInvId) {
                    await callOdoo('account.move', 'action_post', { ids: [newInvId] });
                    Alert.alert('Éxito', 'Factura generada y publicada en Odoo.');
                }
            }
            fetchData();
        } catch (error: any) {
            console.error('Error creating invoice:', error);
            Alert.alert('Error', `No se pudo facturar: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    const viewInvoiceDetail = async (invoiceId: number) => {
        try {
            setLoadingInvoice(true);
            setInvoiceModalVisible(true);
            
            if (isOffline) {
                const dbInst = await db.getDb();
                const inv: any = await dbInst.getFirstAsync('SELECT * FROM account_moves WHERE id = ?', [invoiceId]);
                if (inv) {
                    const lines = await dbInst.getAllAsync('SELECT * FROM account_move_lines WHERE move_id = ?', [invoiceId]);
                    setSelectedInvoice({ ...inv, lines });
                }
                return;
            }

            const invData = await callOdoo('account.move', 'search_read', {
                domain: [['id', '=', invoiceId]],
                fields: ['name', 'partner_id', 'invoice_date', 'amount_total', 'amount_residual', 'invoice_line_ids']
            });

            if (invData.length > 0) {
                const inv = invData[0];
                const lines = await callOdoo('account.move.line', 'search_read', {
                    domain: [['move_id', '=', invoiceId], ['display_type', 'not in', ['line_section', 'line_note']]],
                    fields: ['name', 'quantity', 'price_unit', 'price_subtotal']
                });
                setSelectedInvoice({
                    ...inv,
                    partner_name: inv.partner_id[1],
                    lines
                });
            }
        } catch (error) {
            console.error('Error fetching invoice details:', error);
        } finally {
            setLoadingInvoice(false);
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
                        {Array.isArray(item.partner_id) ? item.partner_id[1] : (item as any).partner_name || 'Individual'}
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
                            • {Array.isArray(line.product_id) ? line.product_id[1] : (line as any).product_name} (x{line.product_uom_qty})
                        </Text>
                    </View>
                ))}

                <View style={styles.totalRow}>
                    <View>
                        <Text style={styles.totalLabel}>TOTAL</Text>
                        <Text style={styles.totalValue}>Bs. {item.amount_total.toFixed(2)}</Text>
                    </View>
                    
                    <View style={styles.actionRow}>
                        {(item.state === 'draft' || item.state === 'sent') && (
                            <TouchableOpacity
                                style={styles.confirmInlineButton}
                                onPress={() => confirmExistingOrder(item.id)}
                            >
                                <FontAwesome name="check-circle" size={14} color="#fff" />
                                <Text style={styles.confirmInlineText}>CONFIRMAR</Text>
                            </TouchableOpacity>
                        )}

                        {item.state === 'sale' && !item.invoice_id && (
                            <TouchableOpacity
                                style={styles.invoiceButton}
                                onPress={() => handleCreateInvoice(item.id)}
                            >
                                <FontAwesome name="file-text" size={14} color="#fff" />
                                <Text style={styles.actionText}>FACTURAR</Text>
                            </TouchableOpacity>
                        )}

                        {item.invoice_id && (
                            <TouchableOpacity
                                style={styles.viewInvoiceButton}
                                onPress={() => viewInvoiceDetail(item.invoice_id!)}
                            >
                                <FontAwesome name="eye" size={14} color="#714B67" />
                                <Text style={[styles.actionText, { color: '#714B67' }]}>VER FACTURA</Text>
                            </TouchableOpacity>
                        )}
                    </View>
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

            {/* Create Quote Modal */}
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
                            
                            {/* Product Selection (AHORA ARRIBA POR PEDIDO DEL USUARIO) */}
                            <Text style={[styles.inputLabel, { color: '#00A09D' }]}>1. Agregar Productos</Text>
                            <View style={styles.searchWrapper}>
                                <TextInput
                                    style={styles.searchInput}
                                    placeholder="Nombre del producto..."
                                    value={productSearch}
                                    onChangeText={searchProducts}
                                />
                                {showProductResults && (
                                    <View style={[styles.searchResults, { zIndex: 100, elevation: 5 }]}>
                                        {products.length > 0 ? (
                                            products.map(p => (
                                                <TouchableOpacity
                                                    key={p.id}
                                                    style={styles.resultItem}
                                                    onPress={() => addProductToQuote(p)}
                                                >
                                                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                                                        <Text style={{ flex: 1, color: '#374151' }}>{p.display_name}</Text>
                                                        <Text style={{ fontWeight: 'bold' }}>Bs. {p.list_price}</Text>
                                                    </View>
                                                </TouchableOpacity>
                                            ))
                                        ) : (
                                            <View style={{ padding: 12 }}>
                                                <Text style={{ color: '#9CA3AF', fontStyle: 'italic', fontSize: 13 }}>No se encontraron productos</Text>
                                            </View>
                                        )}
                                    </View>
                                )}
                            </View>

                            {/* Partner Selection (AHORA ABAJO POR PEDIDO DEL USUARIO) */}
                            <Text style={[styles.inputLabel, { marginTop: 25, color: '#00A09D' }]}>2. Seleccionar Cliente</Text>
                            {selectedPartner ? (
                                <View style={styles.selectedItem}>
                                    <Text style={styles.selectedText}>{selectedPartner.display_name || (selectedPartner as any).name}</Text>
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
                                        <View style={[styles.searchResults, { zIndex: 100, elevation: 5 }]}>
                                            {partners.length > 0 ? (
                                                partners.map(p => (
                                                    <TouchableOpacity
                                                        key={p.id}
                                                        style={styles.resultItem}
                                                        onPress={() => {
                                                            setSelectedPartner(p);
                                                            setShowPartnerResults(false);
                                                            setPartnerSearch(p.display_name || (p as any).name);
                                                        }}
                                                    >
                                                        <Text style={{ color: '#374151' }}>{p.display_name || (p as any).name}</Text>
                                                    </TouchableOpacity>
                                                ))
                                            ) : (
                                                <View style={{ padding: 12 }}>
                                                    <Text style={{ color: '#9CA3AF', fontStyle: 'italic', fontSize: 13 }}>No se encontraron clientes</Text>
                                                </View>
                                            )}
                                        </View>
                                    )}
                                </View>
                            )}

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

            {/* Invoice Detail Modal */}
            <Modal
                animationType="fade"
                transparent={true}
                visible={invoiceModalVisible}
                onRequestClose={() => setInvoiceModalVisible(false)}
            >
                <View style={styles.invoiceModalOverlay}>
                    <View style={styles.invoiceModalContent}>
                        <View style={styles.modalHeader}>
                            <Text style={styles.modalTitle}>Detalle de Factura</Text>
                            <TouchableOpacity onPress={() => setInvoiceModalVisible(false)}>
                                <FontAwesome name="times" size={24} color="#6B7280" />
                            </TouchableOpacity>
                        </View>

                        {loadingInvoice ? (
                            <ActivityIndicator size="large" color="#714B67" style={{ padding: 40 }} />
                        ) : selectedInvoice ? (
                            <ScrollView style={styles.modalBody}>
                                <View style={styles.invoiceHeaderInfo}>
                                    <Text style={styles.invNumber}>{selectedInvoice.name}</Text>
                                    <Text style={styles.invPartner}>{selectedInvoice.partner_name}</Text>
                                    <Text style={styles.invDate}>Fecha: {selectedInvoice.invoice_date}</Text>
                                </View>

                                <View style={styles.divider} />

                                {selectedInvoice.lines?.map((line: any, idx: number) => (
                                    <View key={idx} style={styles.invLine}>
                                        <View style={{ flex: 2 }}>
                                            <Text style={styles.invLineName}>{line.name || line.product_name}</Text>
                                            <Text style={styles.invLineQty}>Cant: {line.quantity}</Text>
                                        </View>
                                        <Text style={styles.invLineSubtotal}>Bs. {line.price_subtotal?.toFixed(2) || (line.quantity * line.price_unit).toFixed(2)}</Text>
                                    </View>
                                ))}

                                <View style={styles.invFooter}>
                                    <View style={styles.invTotalRow}>
                                        <Text style={styles.invTotalLabel}>TOTAL</Text>
                                        <Text style={styles.invTotalValue}>Bs. {selectedInvoice.amount_total.toFixed(2)}</Text>
                                    </View>
                                    <View style={styles.invTotalRow}>
                                        <Text style={styles.invResidualLabel}>PENDIENTE</Text>
                                        <Text style={styles.invResidualValue}>Bs. {selectedInvoice.amount_residual.toFixed(2)}</Text>
                                    </View>
                                </View>
                                <View style={{ height: 40 }} />
                            </ScrollView>
                        ) : (
                            <Text style={{ padding: 20 }}>No se pudo cargar la información.</Text>
                        )}
                        
                        <View style={styles.modalFooter}>
                             <TouchableOpacity
                                style={styles.printButton}
                                onPress={() => Alert.alert('Imprimir', 'Funcionalidad de impresión en desarrollo')}
                            >
                                <FontAwesome name="print" size={16} color="#fff" />
                                <Text style={styles.saveButtonText}>IMPRIMIR FACTURA</Text>
                             </TouchableOpacity>
                        </View>
                    </View>
                </View>
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
    actionRow: {
        flexDirection: 'row',
    },
    confirmInlineButton: {
        backgroundColor: '#22C55E',
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 6,
        marginLeft: 8,
    },
    confirmInlineText: {
        color: '#fff',
        fontSize: 11,
        fontWeight: 'bold',
        marginLeft: 5,
    },
    invoiceButton: {
        backgroundColor: '#3B82F6',
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 6,
        marginLeft: 8,
    },
    viewInvoiceButton: {
        backgroundColor: '#F3E8FF',
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 6,
        marginLeft: 8,
        borderWidth: 1,
        borderColor: '#C084FC',
    },
    actionText: {
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
    invoiceModalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.7)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    invoiceModalContent: {
        backgroundColor: '#fff',
        width: '100%',
        maxHeight: '80%',
        borderRadius: 15,
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
        fontSize: 16,
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
        fontSize: 14,
        color: '#6B7280',
        marginBottom: 10,
        textAlign: 'right',
    },
    saveButton: {
        paddingVertical: 15,
        borderRadius: 10,
        alignItems: 'center',
    },
    printButton: {
        backgroundColor: '#714B67',
        paddingVertical: 15,
        borderRadius: 10,
        alignItems: 'center',
        flexDirection: 'row',
        justifyContent: 'center',
    },
    saveButtonText: {
        color: '#fff',
        fontWeight: 'bold',
        fontSize: 14,
        marginLeft: 10,
    },
    emptyContainer: {
        padding: 40,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 50,
    },
    emptyText: {
        marginTop: 20,
        fontSize: 16,
        color: '#9CA3AF',
        textAlign: 'center',
    },
    invoiceHeaderInfo: {
        marginBottom: 15,
    },
    invNumber: {
        fontSize: 22,
        fontWeight: 'bold',
        color: '#111827',
    },
    invPartner: {
        fontSize: 16,
        color: '#374151',
        marginTop: 5,
    },
    invDate: {
        fontSize: 14,
        color: '#6B7280',
        marginTop: 5,
    },
    invLine: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: '#F3F4F6',
    },
    invLineName: {
        fontSize: 14,
        color: '#111827',
        fontWeight: '500',
    },
    invLineQty: {
        fontSize: 12,
        color: '#6B7280',
    },
    invLineSubtotal: {
        fontSize: 14,
        fontWeight: 'bold',
        color: '#374151',
    },
    invFooter: {
        marginTop: 20,
        backgroundColor: '#F9FAFB',
        padding: 15,
        borderRadius: 8,
    },
    invTotalRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 8,
    },
    invTotalLabel: {
        fontSize: 14,
        fontWeight: 'bold',
        color: '#111827',
    },
    invTotalValue: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#714B67',
    },
    invResidualLabel: {
        fontSize: 12,
        color: '#EF4444',
    },
    invResidualValue: {
        fontSize: 14,
        fontWeight: 'bold',
        color: '#EF4444',
    }
});

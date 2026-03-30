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
    ScrollView,
    Image,
    Linking
} from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { callOdoo } from '../../src/api/odooClient';
import { useConfigStore } from '../../src/store/configStore';
import { usePartnerStore } from '../../src/store/usePartnerStore';
import { useProductStore } from '../../src/store/useProductStore';
import * as db from '../../src/services/dbService';
import { uploadOfflineChanges } from '../../src/services/syncService';
import { getSiatDomain } from '../../src/utils/permissionUtils';
import { useAuthStore } from '../../src/store/authStore';

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
    user_name?: string;
    is_local?: number;
    sync_status?: string;
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
    partner_id: [number, string];
    partner_name: string;
    partner_mobile?: string;
    partner_email?: string;
    invoice_date: string;
    amount_total: number;
    amount_residual: number;
    state: string;
    invoice_user_id?: [number, string];
    invoice_user_name?: string;
    access_token?: string;
    siat_status?: string;
    siat_url?: string;
    siat_qr_content?: string;
    siat_cuf?: string;
    siat_leyenda?: string;
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

            // 1. CARGA INSTANTÁNEA (Siempre de SQLite primero)
            console.log('Cargando ventas desde SQLite...');
            const localOrders = await db.getSaleOrders();
            setResult(localOrders as any);
            if (localOrders && localOrders.length > 0) setLoading(false);

            // 2. ACTUALIZACIÓN EN SEGUNDO PLANO (Si online)
            if (!isOffline) {
                console.log('Sincronizando historial de ventas con Odoo...');
                try {
                    const user = useAuthStore.getState().user;
                    const saleDomain = getSiatDomain('sale.order', user);
                    
                    const orders: SaleOrder[] = await callOdoo('sale.order', 'search_read', {
                        domain: saleDomain,
                        fields: ["name", "display_name", "partner_id", "date_order", "state", "amount_total", "order_line", "invoice_ids", "company_id", "user_id"],
                        limit: 50
                    }, true);

                    if (orders && Array.isArray(orders)) {
                        // Guardar en SQLite
                        await db.saveSaleOrders(orders);
                        // Recargar de SQLite para consistencia
                        const updatedLocal = await db.getSaleOrders();
                        setResult(updatedLocal as any);
                    }
                } catch (e) {
                    console.warn('Fallo actualización online de ventas.');
                }
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

        // 1. Busqueda local (Instantanea desde SQLite)
        const localResults = await db.searchPartners(query);
        setPartners(localResults as any);
        setShowPartnerResults(true);

        // 2. Busqueda online de respaldo (si no es offline, SILENCIOSA)
        if (!isOffline) {
            try {
                const results = await callOdoo('res.partner', 'search_read', {
                    domain: [['name', 'ilike', query]],
                    fields: ['name'],
                    limit: 10
                }, true); // Silent = true
                
                const partnerArray = Array.isArray(results) ? results : (results?.result || []);
                if (partnerArray.length > 0) {
                    setPartners(partnerArray.map((p: any) => ({
                        id: p.id,
                        display_name: p.name || p.display_name
                    })));
                }
            } catch (error) {
                console.log('Online partner search failed, using local SQLite results.');
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

        // 1. Busqueda local (SQLite)
        const localResults = await db.searchProducts(query);
        setProducts(localResults as any);
        setShowProductResults(true);

        if (!isOffline) {
            try {
                const results = await callOdoo('product.product', 'search_read', {
                    domain: [['name', 'ilike', query], ['sale_ok', '=', true]],
                    fields: ['display_name', 'list_price'],
                    limit: 10
                }, true); // Silent = true
                
                const productArray = Array.isArray(results) ? results : (results?.result || []);
                if (productArray.length > 0) {
                    setProducts(productArray);
                }
            } catch (error) {
                console.log('Online product search failed, using local SQLite.');
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

    const updatePrice = (productId: number, newPrice: string) => {
        const val = parseFloat(newPrice) || 0;
        setQuoteLines(quoteLines.map(l => 
            l.product_id === productId ? { ...l, price: val } : l
        ));
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

            const user = useAuthStore.getState().user;
            const localOrder = {
                partner_name: selectedPartner.display_name,
                partner_id: selectedPartner.id, // Para sincronización posterior
                date_order: new Date().toISOString().replace('T', ' ').substring(0, 19),
                amount_total: quoteLines.reduce((acc, l) => acc + (l.price * l.quantity), 0),
                user_id: user?.uid || null,
                user_name: user?.name || ''
            };
            
            console.log('[HybridSync] Guardando borrador localmente...');
            await db.createSaleOrderLocal(localOrder, quoteLines);
            
            // 2. Limpiar UI y cerrar modal para dar feedback instantáneo de que se guardó
            setModalVisible(false);
            const partnerDisplayName = selectedPartner.display_name;
            setSelectedPartner(null);
            setPartnerSearch('');
            setQuoteLines([]);

            // 3. INTENTO DE SINCRONIZACIÓN AUTOMÁTICA (Híbrido - Prioridad Online)
            if (!isOffline) {
                console.log('[HybridSync] Detectado modo Online. Sincronizando inmediatamente...');
                try {
                    // Subir cambios pendientes (incluyendo este nuevo)
                    await uploadOfflineChanges();
                    Alert.alert('Éxito (Online)', `Venta de ${partnerDisplayName} sincronizada correctamente con Odoo.`);
                } catch (syncErr: any) {
                    console.log('[HybridSync] Error al subir, queda para después:', syncErr.message);
                    Alert.alert('Guardado Offline', `Venta de ${partnerDisplayName} guardada localmente. Se sincronizará automáticamente al mejorar la conexión.`);
                }
            } else {
                Alert.alert('Modo Offline', `Venta de ${partnerDisplayName} guardada localmente en el dispositivo.`);
            }
            
            fetchData();
        } catch (error: any) {
            console.error('Error in saveQuotation:', error);
            Alert.alert('Error Fatal', `No se pudo guardar la venta localmente: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    const confirmExistingOrder = async (orderId: number) => {
        try {
            setLoading(true);
            
            // SI ESTAMOS OFFLINE: Confirmar localmente de inmediato y salir
            if (isOffline) {
                console.log('[DB] Modo offline activo, confirmando localmente...');
                await db.confirmSaleOrderLocal(orderId);
                Alert.alert('Modo Offline', 'Pedido confirmado localmente. Se sincronizará al recuperar conexión.');
                fetchData();
                return;
            }

            let realOdooId = orderId;
            
            // Si el ID es negativo, el pedido es local y Odoo no lo conoce
            if (orderId < 0) {
                if (isOffline) {
                    Alert.alert('Acción requerida', 'Debes estar online para confirmar este pedido en el servidor.');
                    return;
                }
                
                console.log('[HybridSync] Sincronizando pedido local antes de confirmar...');
                await uploadOfflineChanges();
                
                // Buscar el nuevo ID real en SQLite
                const dbInst = await db.getDb();
                const syncedOrder: any = await dbInst.getFirstAsync(
                    'SELECT id FROM sale_orders WHERE sync_status = "synced" AND amount_total = (SELECT amount_total FROM sale_orders WHERE id = ?)', 
                    [orderId]
                );
                
                if (syncedOrder && syncedOrder.id > 0) {
                    realOdooId = syncedOrder.id;
                    console.log('[HybridSync] Pedido sincronizado correctamente con ID:', realOdooId);
                } else {
                    // Si no lo encontramos por algun motivo, refrescamos toda la lista
                    await fetchData();
                    Alert.alert('Sincronizado', 'El pedido se ha subido a Odoo. Por favor, selecciona el pedido sincronizado e intenta confirmar de nuevo.');
                    return;
                }
            }

            console.log('[RPC] Confirmando pedido en Odoo:', realOdooId);
            await callOdoo('sale.order', 'action_confirm', {
                ids: [realOdooId]
            });
            Alert.alert('Éxito', 'Venta confirmada correctamente');
            fetchData();
        } catch (error: any) {
            console.error('Error confirming order:', error);
            // Si falla por falta de internet o error de Odoo (ej: reglas de stock), confirmamos localmente
            try {
                console.log('[DB] Falló confirmación online, aplicando confirmación local provisoria...');
                await db.confirmSaleOrderLocal(orderId);
                Alert.alert('Guardado Local', 'El pedido se ha marcado como Pedido localmente. Se validará con Odoo en la próxima sincronización.');
                fetchData();
            } catch (dbErr) {
                Alert.alert('Error', `No se pudo confirmar: ${error.message}`);
            }
        } finally {
            setLoading(false);
        }
    };

    const handleCreateInvoice = async (orderId: number) => {
        try {
            setLoading(true);
            
            // 1. SIEMPRE GENERAR LOCAL PRIMERO
            console.log('[HybridSync] Generando factura local...');
            const user = useAuthStore.getState().user;
            await db.createInvoiceLocal(orderId, user?.uid || null, user?.name || null);
            
            // 2. INTENTO DE SINCRONIZACIÓN AUTOMÁTICA
            if (!isOffline) {
                console.log('[HybridSync] Intentando subir facturas a Odoo...');
                try {
                    await uploadOfflineChanges();
                    Alert.alert('Éxito', 'Factura generada y sincronizada correctamente.');
                } catch (syncErr: any) {
                    console.log('[HybridSync] Error al subir factura, queda para después:', syncErr.message);
                    Alert.alert('Factura Guardada', 'Factura generada localmente. Se subirá a Odoo automáticamente al recuperar señal.');
                }
            } else {
                Alert.alert('Modo Offline', 'Factura generada localmente.');
            }
            
            fetchData();
        } catch (error: any) {
            console.error('Error in handleCreateInvoice:', error);
            Alert.alert('Error', `No se pudo generar la factura: ${error.message}`);
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

            const invData: any = await callOdoo('account.move', 'search_read', {
                domain: [['id', '=', invoiceId]],
                fields: [
                    'name', 'partner_id', 'invoice_date', 'amount_total', 'amount_residual', 
                    'invoice_line_ids', 'invoice_user_id', 'access_token',
                    'siat_estado', 'siat_cuf', 'siat_qr_string', 'siat_qr_image', 'siat_leyenda'
                ]
            });

            if (invData.length > 0) {
                const inv = invData[0];
                const lines = await callOdoo('account.move.line', 'search_read', {
                    domain: [['move_id', '=', invoiceId], ['display_type', 'not in', ['line_section', 'line_note']]],
                    fields: ['name', 'quantity', 'price_unit', 'price_subtotal']
                });

                // Optimization: Fetch partner data from LOCAL table first 
                const dbInst = await db.getDb();
                const partnerLoc: any = await dbInst.getFirstAsync(
                    'SELECT mobile, phone, email FROM partners WHERE id = ?', 
                    [inv.partner_id[0]]
                );
                
                const partner = partnerLoc || {};

                setSelectedInvoice({
                    ...inv,
                    partner_name: inv.partner_id ? inv.partner_id[1] : (inv as any).partner_name,
                    partner_mobile: partner.mobile || partner.phone || '',
                    partner_email: partner.email || '',
                    invoice_user_name: inv.invoice_user_id ? inv.invoice_user_id[1] : '',
                    siat_status: inv.siat_estado,
                    siat_url: inv.siat_qr_string,
                    siat_qr_content: inv.siat_qr_image,
                    siat_cuf: inv.siat_cuf,
                    siat_leyenda: inv.siat_leyenda,
                    lines
                });
            }
        } catch (error) {
            console.error('Error fetching invoice details:', error);
        } finally {
            setLoadingInvoice(false);
        }
    };

    const handleSendSiat = async (invoiceId: number) => {
        try {
            setLoading(true);
            if (isOffline) {
                console.log('[SIAT] Modo offline, marcando factura para envío local...');
                await db.setInvoiceSiatStatusLocal(invoiceId, 'to_send');
                Alert.alert('SIAT Offline', 'Factura marcada para envío SIAT. Se transmitirá automáticamente al recuperar internet.');
                
                // Actualizar estado local en UI
                if (selectedInvoice) {
                    setSelectedInvoice({ ...selectedInvoice, siat_status: 'to_send' });
                }
                return;
            }

            console.log('[SIAT] Enviando factura a SIAT Odoo...');
            // El método correcto según el modelo es action_send_siat
            await callOdoo('account.move', 'action_send_siat', { ids: [invoiceId] });
            Alert.alert('Éxito', 'Factura enviada al SIAT correctamente');
            viewInvoiceDetail(invoiceId);
        } catch (error: any) {
            console.error('Error sending SIAT:', error);
            // Si falla online, ofrecemos guardar localmente
            try {
                await db.setInvoiceSiatStatusLocal(invoiceId, 'to_send');
                Alert.alert('Guardado Local', 'No se pudo contactar al SIAT (Odoo), pero se guardó la intención de envío localmente.');
                if (selectedInvoice) setSelectedInvoice({ ...selectedInvoice, siat_status: 'to_send' });
            } catch (e) {
                Alert.alert('Error', `No se pudo enviar al SIAT: ${error.message}`);
            }
        } finally {
            setLoading(false);
        }
    };

    const renderCard = ({ item }: { item: SaleOrder }) => (
        <View style={styles.card}>
            <View style={styles.cardHeader}>
                <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                    <Text style={styles.orderName} numberOfLines={1}>{item.name || item.display_name}</Text>
                    {item.is_local === 1 && (
                        <FontAwesome name="cloud-upload" size={16} color="#F59E0B" style={{ marginLeft: 8 }} />
                    )}
                </View>
                <View style={[styles.statusBadge, { backgroundColor: item.state === 'sale' ? '#D1FAE5' : '#FEF3C7' }]}>
                    <Text style={[styles.statusText, { color: item.state === 'sale' ? '#065F46' : '#92400E' }]}>
                        {item.state === 'sale' ? (item.is_local === 1 ? 'Pedido (Local)' : 'Pedido') : 'Cotización'}
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
                {item.user_name && (
                    <View style={styles.infoRow}>
                        <FontAwesome name="id-badge" size={14} color="#00A09D" />
                        <Text style={[styles.dateText, { color: '#00A09D', fontWeight: '500' }]}>
                            Responsable: {item.user_name}
                        </Text>
                    </View>
                )}

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
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                <TouchableOpacity
                                    style={styles.viewInvoiceButton}
                                    onPress={() => viewInvoiceDetail(item.invoice_id!)}
                                >
                                    <FontAwesome name="eye" size={14} color="#714B67" />
                                    <Text style={[styles.actionText, { color: '#714B67' }]}>VER FACTURA</Text>
                                </TouchableOpacity>
                                <View style={[styles.badge, styles.badgePosted, { marginLeft: 8 }]}>
                                    <Text style={styles.badgeTextSmall}>FACTURADA</Text>
                                </View>
                            </View>
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
                                            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 5 }}>
                                                <Text style={{ fontSize: 13, color: '#6B7280', marginRight: 5 }}>Bs.</Text>
                                                <TextInput
                                                    style={styles.priceInput}
                                                    keyboardType="numeric"
                                                    value={line.price.toString()}
                                                    onChangeText={(txt) => updatePrice(line.product_id, txt)}
                                                />
                                            </View>
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
                                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                        <View style={{ flex: 1 }}>
                                            <Text style={styles.invNumber}>{selectedInvoice.name}</Text>
                                            <Text style={styles.invPartner}>{selectedInvoice.partner_name}</Text>
                                            <Text style={styles.invDate}>Fecha: {selectedInvoice.invoice_date}</Text>
                                        </View>
                                        <View style={[styles.badge, 
                                            selectedInvoice.state === 'draft' ? styles.badgeDraft : 
                                            selectedInvoice.state === 'posted' ? styles.badgePosted : styles.badgeCancel
                                        ]}>
                                            <Text style={styles.badgeText}>
                                                {selectedInvoice.state === 'draft' ? 'BORRADOR' : 
                                                 selectedInvoice.state === 'posted' ? 'PUBLICADO' : 
                                                 selectedInvoice.state === 'cancel' ? 'CANCELADO' : selectedInvoice.state?.toUpperCase()}
                                            </Text>
                                        </View>
                                    </View>
                                    {selectedInvoice.siat_cuf && (
                                        <Text style={[styles.invDate, { fontSize: 10, color: '#9CA3AF' }]}>
                                            CUF: {selectedInvoice.siat_cuf}
                                        </Text>
                                    )}
                                    {selectedInvoice.invoice_user_name && (
                                        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 5 }}>
                                            <FontAwesome name="id-badge" size={14} color="#714B67" />
                                            <Text style={[styles.invDate, { marginLeft: 8, color: '#714B67', fontWeight: 'bold' }]}>
                                                Responsable: {selectedInvoice.invoice_user_name}
                                            </Text>
                                        </View>
                                    )}
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

                                {selectedInvoice.siat_status && (
                                    <View style={[styles.siatBadge, { 
                                        backgroundColor: selectedInvoice.siat_status === 'validada' ? '#D1FAE5' : 
                                                        selectedInvoice.siat_status === 'rechazada' ? '#FEE2E2' : '#FFEDD5' 
                                    }]}>
                                        <FontAwesome 
                                            name={selectedInvoice.siat_status === 'validada' ? 'check-circle' : 
                                                  selectedInvoice.siat_status === 'rechazada' ? 'times-circle' : 'clock-o'} 
                                            size={14} 
                                            color={selectedInvoice.siat_status === 'validada' ? '#065F46' : 
                                                   selectedInvoice.siat_status === 'rechazada' ? '#991B1B' : '#9A3412'} 
                                        />
                                        <Text style={[styles.siatText, { 
                                            color: selectedInvoice.siat_status === 'validada' ? '#065F46' : 
                                                   selectedInvoice.siat_status === 'rechazada' ? '#991B1B' : '#9A3412' 
                                        }]}>
                                            SIAT: {(selectedInvoice.siat_status || '').toUpperCase()}
                                        </Text>
                                    </View>
                                )}

                                {(selectedInvoice.siat_url || selectedInvoice.siat_qr_content) && (
                                    <View style={styles.qrSection}>
                                        <Text style={styles.qrLabel}>Verificación Legal SIAT</Text>
                                        <View style={styles.qrContainer}>
                                            {/* Odoo Image field is base64 */}
                                            {selectedInvoice.siat_qr_content ? (
                                                <Image 
                                                    source={{ uri: selectedInvoice.siat_qr_content.startsWith('http') 
                                                        ? selectedInvoice.siat_qr_content 
                                                        : `data:image/png;base64,${selectedInvoice.siat_qr_content}` }} 
                                                    style={styles.qrImage}
                                                />
                                            ) : (
                                                <Image 
                                                    source={{ uri: `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(selectedInvoice.siat_url || '')}` }}
                                                    style={styles.qrImage}
                                                />
                                            )}
                                        </View>
                                        {selectedInvoice.siat_leyenda && (
                                            <Text style={[styles.qrLabel, { marginTop: 15, fontSize: 9, textAlign: 'center', fontWeight: 'normal' }]}>
                                                {selectedInvoice.siat_leyenda}
                                            </Text>
                                        )}
                                        {selectedInvoice.siat_url && (
                                            <TouchableOpacity onPress={() => Alert.alert('SIAT URL', selectedInvoice.siat_url || '')}>
                                                <Text style={styles.qrUrl} numberOfLines={1}>{selectedInvoice.siat_url}</Text>
                                            </TouchableOpacity>
                                        )}
                                    </View>
                                )}

                                <View style={{ height: 40 }} />
                                
                                <View style={styles.modalFooter}>
                                     <TouchableOpacity
                                        style={[styles.printButton, { flex: 1, marginRight: 8 }]}
                                        onPress={() => Alert.alert('Imprimir', 'Funcionalidad de impresión en desarrollo')}
                                    >
                                        <FontAwesome name="print" size={16} color="#fff" />
                                        <Text style={styles.saveButtonText}>IMPRIMIR</Text>
                                     </TouchableOpacity>

                                     {(selectedInvoice.siat_status === 'validada') ? (
                                         <View style={{ flex: 1.5, flexDirection: 'row' }}>
                                             <TouchableOpacity
                                               style={[styles.whatsappButton, { flex: 1, marginRight: 5 }]}
                                               onPress={() => {
                                                   const user = useAuthStore.getState().user;
                                                   const baseUrl = user?.url || '';
                                                   const portalUrl = `${baseUrl}/my/invoices/${selectedInvoice.id}${selectedInvoice.access_token ? `?access_token=${selectedInvoice.access_token}` : ''}`;
                                                   const message = `Hola, te envío tu factura ${selectedInvoice.name}. Puedes verla aquí: ${portalUrl}`;
                                                   
                                                   // Clean phone number (remove non-numeric)
                                                   const cleanPhone = (selectedInvoice.partner_mobile || '').replace(/\D/g, '');
                                                   const waUrl = `whatsapp://send?phone=${cleanPhone}&text=${encodeURIComponent(message)}`;
                                                   Linking.openURL(waUrl).catch(() => Alert.alert('Error', 'No se pudo abrir WhatsApp'));
                                               }}
                                           >
                                               <FontAwesome name="whatsapp" size={18} color="#fff" />
                                               <Text style={styles.saveButtonText}> WHATSAPP</Text>
                                             </TouchableOpacity>

                                             <TouchableOpacity
                                               style={[styles.emailButton, { flex: 1 }]}
                                               onPress={() => {
                                                   const user = useAuthStore.getState().user;
                                                   const baseUrl = user?.url || '';
                                                   const portalUrl = `${baseUrl}/my/invoices/${selectedInvoice.id}${selectedInvoice.access_token ? `?access_token=${selectedInvoice.access_token}` : ''}`;
                                                   const message = `Hola, te envío tu factura ${selectedInvoice.name}. Puedes verla aquí: ${portalUrl}`;
                                                   const mailUrl = `mailto:${selectedInvoice.partner_email || ''}?subject=Factura ${selectedInvoice.name}&body=${encodeURIComponent(message)}`;
                                                   Linking.openURL(mailUrl).catch(() => Alert.alert('Error', 'No hay aplicación de correo configurada.'));
                                               }}
                                           >
                                               <FontAwesome name="envelope" size={16} color="#fff" />
                                               <Text style={styles.saveButtonText}> CORREO</Text>
                                             </TouchableOpacity>
                                         </View>
                                     ) : (
                                         <TouchableOpacity
                                           style={[styles.siatButton, { flex: 1.5 }]}
                                           onPress={() => handleSendSiat(selectedInvoice.id)}
                                       >
                                           <FontAwesome name="shield" size={16} color="#fff" />
                                           <Text style={styles.saveButtonText}> ENVIAR SIAT</Text>
                                         </TouchableOpacity>
                                     )}
                                </View>
                            </ScrollView>
                        ) : (
                            <View style={{ padding: 20 }}>
                                <Text>No se pudo cargar la información.</Text>
                            </View>
                        )}
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
    },
    priceInput: {
        borderWidth: 1,
        borderColor: '#E5E7EB',
        borderRadius: 6,
        paddingHorizontal: 8,
        paddingVertical: 4,
        fontSize: 14,
        color: '#00A09D',
        fontWeight: 'bold',
        backgroundColor: '#F3F4F6',
        width: 110,
    },
    siatBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 10,
        borderRadius: 8,
        marginTop: 15,
        justifyContent: 'center',
    },
    siatText: {
        fontSize: 13,
        fontWeight: 'bold',
        marginLeft: 8,
    },
    siatButton: {
        backgroundColor: '#2563EB', // Azul SIAT
        paddingVertical: 15,
        borderRadius: 10,
        alignItems: 'center',
        flexDirection: 'row',
        justifyContent: 'center',
    },
    qrSection: {
        marginTop: 20,
        padding: 15,
        backgroundColor: '#F3F4F6',
        borderRadius: 12,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#E5E7EB',
        borderStyle: 'dashed',
    },
    qrLabel: {
        fontSize: 12,
        fontWeight: 'bold',
        color: '#6B7280',
        marginBottom: 10,
        textTransform: 'uppercase',
    },
    qrContainer: {
        backgroundColor: '#fff',
        padding: 10,
        borderRadius: 8,
        elevation: 2,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
    },
    qrImage: {
        width: 150,
        height: 150,
    },
    qrUrl: {
        marginTop: 10,
        fontSize: 11,
        color: '#2563EB',
        textDecorationLine: 'underline',
        textAlign: 'center',
        width: 200,
    },
    badge: {
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    badgeText: {
        color: '#fff',
        fontSize: 10,
        fontWeight: 'bold',
    },
    badgeTextSmall: {
        color: '#fff',
        fontSize: 8,
        fontWeight: 'bold',
    },
    badgeDraft: {
        backgroundColor: '#9CA3AF', // Gray
    },
    badgePosted: {
        backgroundColor: '#10B981', // Emerald
    },
    badgeCancel: {
        backgroundColor: '#EF4444', // Red
    },
    whatsappButton: {
        backgroundColor: '#25D366', // WhatsApp Green
        height: 50,
        borderRadius: 8,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
    },
    emailButton: {
        backgroundColor: '#3B82F6', // Odoo Blueish
        height: 50,
        borderRadius: 8,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
    },
});

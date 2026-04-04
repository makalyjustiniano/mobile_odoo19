import React, { useEffect, useState, useCallback } from 'react';
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
import { callOdoo, pingOdoo } from '../../src/api/odooClient';
import { LoadingOverlay } from '../../src/components/LoadingOverlay';
import { useConfigStore } from '../../src/store/configStore';
import { usePartnerStore } from '../../src/store/usePartnerStore';
import { useProductStore } from '../../src/store/useProductStore';
import * as db from '../../src/services/dbService';
import { runSync, uploadAndSync, syncInvoicesByIds, syncPortalMetadata } from '../../src/services/syncService';
import { getSiatDomain } from '../../src/utils/permissionUtils';
import { useAuthStore } from '../../src/store/authStore';
import ListFilters, { DateFilterType } from '../../src/components/ListFilters';

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
    max_discount?: number;
    discount_rules?: string;
    qty_available?: number;
}

interface NewLine {
    product_id: number;
    product_name: string;
    quantity: number;
    price: number;
    discount: number;
    max_discount: number;
    discount_rules?: string;
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
    const { user } = useAuthStore();
    const permissions = user?.permissions;
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
    const [globalDiscount, setGlobalDiscount] = useState<string>('0');
    const [shouldConfirm, setShouldConfirm] = useState(false);
    
    // Main Research Search
    const [mainSearchQuery, setMainSearchQuery] = useState('');
    const [filteredResult, setFilteredResult] = useState<SaleOrder[]>([]);
    const [isSavingSales, setIsSavingSales] = useState(false);
    const [loadingMessage, setLoadingMessage] = useState('Procesando...');
    
    // Edit/Duplicate state
    const [isEditing, setIsEditing] = useState(false);
    const [editingOrderId, setEditingOrderId] = useState<number | null>(null);
    const [generatedXmlId, setGeneratedXmlId] = useState<string | null>(null);
    
    // Filters state
    const [limit, setLimit] = useState<number>(50);
    const [offset, setOffset] = useState<number>(0);
    const [totalCount, setTotalCount] = useState<number>(0);
    const [dateFilter, setDateFilter] = useState<DateFilterType>('Today');
    const [hasUnsyncedData, setHasUnsyncedData] = useState(false);

    const getBestDiscount = (rulesStr: string | undefined, qty: number): number => {
        if (!rulesStr || rulesStr === '[]') return 0;
        try {
            const rules = JSON.parse(rulesStr);
            if (!Array.isArray(rules)) return 0;
            const now = new Date();
            // Filtrar por reglas vigentes y cantidad suficiente
            const validRules = rules.filter((r: any) => {
                const start = r.start ? new Date(r.start) : null;
                const end = r.end ? new Date(r.end) : null;
                const isStarted = !start || now >= start;
                const isNotEnded = !end || now <= end;
                return isStarted && isNotEnded && qty >= r.min_qty;
            });
            
            if (validRules.length === 0) return 0;
            
            // SORTEAR DESCENDENTE por min_qty para agarrar siempre el nivel más alto alcanzado
            validRules.sort((a, b) => b.min_qty - a.min_qty);
            
            return validRules[0].discount;
        } catch (e) {
            console.error('Error parsing rules:', e);
            return 0;
        }
    };

    const handleMainSearch = (text: string) => {
        setMainSearchQuery(text);
        if (!text.trim()) {
            setFilteredResult(result);
            return;
        }
        const filtered = result.filter(order => 
            (order.display_name && order.display_name.toLowerCase().includes(text.toLowerCase())) ||
            (order.partner_id && order.partner_id[1].toLowerCase().includes(text.toLowerCase()))
        );
        setFilteredResult(filtered);
    };

    useEffect(() => {
        setFilteredResult(result);
    }, [result]);

    useEffect(() => {
        fetchData();
    }, [isOffline]);

    const handleNextPage = () => {
        if (offset + limit < totalCount) {
            const newOffset = offset + limit;
            setOffset(newOffset);
            fetchData(false, newOffset);
        }
    };

    const handlePrevPage = () => {
        const newOffset = Math.max(0, offset - limit);
        if (newOffset !== offset) {
            setOffset(newOffset);
            fetchData(false, newOffset);
        }
    };

    const handleManualSync = async () => {
        setLoading(true);
        try {
            const { success, errors } = await uploadAndSync((msg) => console.log(`[MANUAL SYNC] ${msg}`));
            if (!success) {
                Alert.alert(
                    'Sincronización Parcial',
                    `Se descargaron datos de Odoo, pero algunos registros locales no pudieron subirse:\n\n${errors.slice(0, 3).join('\n')}${errors.length > 3 ? '\n...' : ''}`
                );
            } else {
                Alert.alert('Éxito', 'Sincronización completada correctamente.');
            }
            await fetchData(true);
        } catch (error: any) {
            Alert.alert('Error', 'No se pudo conectar con Odoo: ' + error.message);
        } finally {
            setLoading(false);
        }
    };

    const fetchData = async (isPullToRefresh = false, customOffset?: number) => {
        const currentOffset = customOffset !== undefined ? customOffset : (isPullToRefresh ? 0 : offset);
        if (isPullToRefresh) setOffset(0);
        try {
            await db.initDB();
            if (!refreshing) setLoading(true);

            // 1. CARGA INSTANTÁNEA (Siempre de SQLite primero)
            console.log('Cargando ventas desde SQLite...');
            const localOrders = await db.getSaleOrders();
            setResult(localOrders as any);
            
            const unsynced = await db.getUnsyncedCount();
            setHasUnsyncedData(unsynced > 0);
            
            if (localOrders && localOrders.length > 0) setLoading(false);

            // 2. ACTUALIZACIÓN EN SEGUNDO PLANO (Si online)
            if (!isOffline) {
                console.log('Verificando privilegios y sincronizando historial...');
                try {
                    // Refrescar metadatos y permisos primero
                    await syncPortalMetadata();

                    const user = useAuthStore.getState().user;
                    const saleDomain: any[] = getSiatDomain('sale.order', user);
                    
                    if (dateFilter !== 'All') {
                        const today = new Date();
                        const pad = (n: number) => n.toString().padStart(2, '0');
                        const formatStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
                        if (dateFilter === 'Today') {
                            saleDomain.push(['date_order', '>=', `${formatStr(today)} 00:00:00`]);
                        } else if (dateFilter === '7Days') {
                            const d = new Date(); d.setDate(d.getDate() - 7);
                            saleDomain.push(['date_order', '>=', `${formatStr(d)} 00:00:00`]);
                        } else if (dateFilter === '30Days') {
                            const d = new Date(); d.setDate(d.getDate() - 30);
                            saleDomain.push(['date_order', '>=', `${formatStr(d)} 00:00:00`]);
                        }
                    }

                    const count: number = await callOdoo('sale.order', 'search_count', {
                        domain: saleDomain
                    }, true);
                    setTotalCount(count);

                    const orders: SaleOrder[] = await callOdoo('sale.order', 'search_read', {
                        domain: saleDomain,
                        fields: ["name", "display_name", "partner_id", "date_order", "state", "amount_total", "order_line", "invoice_ids", "company_id", "user_id", "client_order_ref"],
                        limit: limit,
                        offset: currentOffset,
                        order: 'id desc'
                    }, true);

                    if (orders && Array.isArray(orders)) {
                        // Guardar en SQLite
                        await db.saveSaleOrders(orders);
                        
                        // Descargar facturas vinculadas de estos pedidos (IMPORTANTE PARA MODO OFFLINE)
                        const invoiceIds = orders
                            .flatMap((o: any) => o.invoice_ids || [])
                            .filter(id => !!id);
                        if (invoiceIds.length > 0) {
                            await syncInvoicesByIds(invoiceIds);
                        }

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
                    fields: [
                        "display_name", "email", "phone", "lang", "vat",
                        "street", "street2", "city", "zip",
                        "credit", "debit", "credit_limit", "total_due", "total_overdue",
                        "comment", "image_128", 
                        "x_studio_razon_social", "x_studio_complemento", "x_studio_giro",
                        "x_studio_pago_a_proveedor", "x_studio_pago_de_cliente", "x_studio_tipo_de_documento",
                        "user_id", "company_id", "partner_latitude", "partner_longitude"
                    ],
                    limit: 10
                }, true); // Silent = true
                
                const partnerArray = Array.isArray(results) ? results : (results?.result || []);
                if (partnerArray.length > 0) {
                    // ACTUALIZAR SQLITE CON DATOS FRESCOS
                    await db.savePartners(partnerArray);
                    
                    setPartners(partnerArray.map((p: any) => ({
                        id: p.id,
                        display_name: p.display_name || p.name
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
                    fields: ['display_name', 'list_price', 'qty_available'],
                    limit: 10
                }, true); // Silent = true
                
                const productArray = Array.isArray(results) ? results : (results?.result || []);
                if (productArray.length > 0) {
                    const enrichedResults = productArray.map((onlineP: any) => {
                        // Enriquecer con datos locales (reglas de descuento) que no están en Odoo
                        const localP = localResults.find(lp => lp.id === onlineP.id);
                        return {
                            ...onlineP,
                            max_discount: localP?.max_discount || 0,
                            discount_rules: localP?.discount_rules || "[]",
                            qty_available: onlineP.qty_available ?? localP?.qty_available ?? 0
                        };
                    });
                    setProducts(enrichedResults);
                }
            } catch (error) {
                console.log('Online product search failed, using local SQLite.');
            }
        }
    };

    const addProductToQuote = (product: Product) => {
        const existing = quoteLines.find(l => l.product_id === product.id);
        if (existing) {
            updateQuantity(product.id, 1);
        } else {
            const bestDisc = getBestDiscount(product.discount_rules, 1);
            
            const newLine: NewLine = {
                product_id: product.id,
                product_name: product.display_name,
                quantity: 1,
                price: product.list_price,
                discount: bestDisc,
                max_discount: Math.max(bestDisc, product.max_discount || 0),
                discount_rules: product.discount_rules
            };
            setQuoteLines([...quoteLines, newLine]);
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
                const currentRuleDisc = getBestDiscount(l.discount_rules, l.quantity);
                const newRuleDisc = getBestDiscount(l.discount_rules, newQty);
                
                // REGLA: 
                // 1. Si la nueva cantidad activa una regla (newRuleDisc > 0), se aplica.
                // 2. Si la nueva cantidad NO activa regla (newRuleDisc == 0) PERO la anterior SÍ (currentRuleDisc > 0), 
                //    significa que bajamos del umbral: reseteamos a 0.
                // 3. De lo contrario, mantenemos el descuento manual previo (l.discount).
                let finalDiscount = l.discount;
                if (newRuleDisc > 0) {
                    finalDiscount = newRuleDisc;
                } else if (currentRuleDisc > 0 && newRuleDisc === 0) {
                    finalDiscount = 0;
                }
                
                return { 
                    ...l, 
                    quantity: newQty, 
                    discount: finalDiscount,
                    max_discount: Math.max(newRuleDisc, l.max_discount || 0)
                };
            }
            return l;
        }));
    };

    const updatePrice = (productId: number, newPrice: string) => {
        // Bloqueado según requerimiento: El precio base es de lectura únicamente.
        // No se realiza ninguna acción si se intenta editar.
    };

    const updateLineDiscount = (productId: number, discountStr: string) => {
        const val = parseFloat(discountStr) || 0;
        setQuoteLines(quoteLines.map(l => {
            if (l.product_id === productId) {
                if (val > l.max_discount) {
                    Alert.alert('Límite de Descuento', `El descuento máximo permitido para este producto es ${l.max_discount}%`);
                    return l;
                }
                return { ...l, discount: val };
            }
            return l;
        }));
    };

    const saveQuotation = async (shouldConfirm = false) => {
        if (!selectedPartner) {
            Alert.alert('Error', 'Seleccione un cliente');
            return;
        }
        if (quoteLines.length === 0) {
            Alert.alert('Error', 'La cotización no tiene productos');
            return;
        }

        try {
            setLoadingMessage('Verificando conexión...');
            setIsSavingSales(true);
            
            if (!isOffline) {
                const p = await pingOdoo();
                if (p.status !== 'ok') {
                    if (p.status === 'no-internet') {
                        Alert.alert('Sin Internet', 'No tienes acceso a Internet. La venta se guardará localmente en Modo Offline para su futura sincronización.');
                    } else if (p.status === 'odoo-down') {
                        Alert.alert('Servidor Inaccesible', `Odoo no responde (${p.message}). La venta se guardará localmente en Modo Offline para su futura sincronización.`);
                    }
                    // Forzamos offline preventivo para que el usuario no espere en balde
                    useConfigStore.getState().toggleOffline();
                }
            }

            setLoadingMessage('Guardando Venta...');
            setLoading(true);

            const user = useAuthStore.getState().user;
            const gDisc = parseFloat(globalDiscount) || 0;
            const amountTotal = quoteLines.reduce((acc, l) => acc + (l.price * l.quantity * (1 - (l.discount || 0) / 100)), 0) * (1 - gDisc / 100);

            const commonVals: any = {
                partner_id: selectedPartner.id,
                partner_name: selectedPartner.display_name,
                date_order: new Date().toISOString().slice(0, 19).replace('T', ' '),
                amount_total: amountTotal,
                user_id: user?.uid || null,
                user_name: user?.name || '',
                company_id: user?.company_id || 1,
                global_discount: gDisc,
                state: 'draft',
                xml_id: generatedXmlId
            };

            // 1. GUARDADO LOCAL INMEDIATO
            const orderId = isEditing ? editingOrderId! : -(Date.now());
            const clientOrderRef = isEditing ? undefined : `APP-${Math.abs(orderId)}-${Math.floor(Math.random() * 1000)}`;
            
            await db.createSaleOrderLocal({ ...commonVals, id: orderId, name: clientOrderRef, sync_status: 'new' }, quoteLines);
            
            // FEEDBACK INMEDIATO
            fetchData();
            setModalVisible(false);
            setQuoteLines([]);
            setSelectedPartner(null);
            setPartnerSearch('');
            setGlobalDiscount('0');
            setIsEditing(false);
            setEditingOrderId(null);
            const currentGeneratedXmlId = generatedXmlId;
            setGeneratedXmlId(null);
            setLoading(false);
            setIsSavingSales(false);

            // 2. SINCRONIZACIÓN EN SEGUNDO PLANO
            if (!isOffline) {
                const backgroundSync = async () => {
                    try {
                        const sqlite = await db.getDb();
                        await sqlite.runAsync('UPDATE sale_orders SET sync_status = "syncing" WHERE id = ?', [orderId]);

                        const orderLinesOdoo = quoteLines.map(line => [0, 0, {
                            product_id: line.product_id,
                            product_uom_qty: line.quantity,
                            price_unit: line.price,
                            discount: line.discount || 0,
                        }]);

                        let finalOdooId: number | null = null;

                        if (isEditing && orderId > 0) {
                            // MODO EDICIÓN
                            await callOdoo('sale.order', 'write', [[orderId], {
                                partner_id: commonVals.partner_id,
                                order_line: [[5, 0, 0], ...orderLinesOdoo.map(l => [0, 0, l[2]])]
                            }], true);
                            finalOdooId = orderId;
                        } else {
                            const createVals: any = {
                                partner_id: commonVals.partner_id,
                                user_id: commonVals.user_id,
                                company_id: commonVals.company_id,
                                client_order_ref: clientOrderRef,
                                order_line: orderLinesOdoo,
                            };

                            const response: any = await callOdoo('sale.order', 'create', {
                                vals_list: [createVals]
                            }, true, undefined, 30000);

                            finalOdooId = (Array.isArray(response) && response.length > 0) 
                                ? (response[0].id || response[0]) 
                                : (response && typeof response === 'object' ? response.id || response.result : response);
                        }

                        if (finalOdooId && typeof finalOdooId === 'number') {
                            if (shouldConfirm) {
                                await callOdoo('sale.order', 'action_confirm', { ids: [finalOdooId] }, true, undefined, 30000);
                            }
                            
                            if (!isEditing || orderId < 0) {
                                await db.swapLocalIdWithOdooId(orderId, finalOdooId, `S${finalOdooId.toString().padStart(5, '0')}`);
                            } else {
                                await sqlite.runAsync('UPDATE sale_orders SET sync_status = "synced" WHERE id = ?', [finalOdooId]);
                            }
                            console.log('[BackgroundSync] Operación completada:', finalOdooId);
                            fetchData();
                        }
                    } catch (e: any) {
                        console.warn('[BackgroundSync] Error:', e.message);
                        Alert.alert('Fallo de Sincronización Odoo', `Motivo del servidor: ${e.message}`);
                        const sqlite = await db.getDb();
                        await sqlite.runAsync('UPDATE sale_orders SET sync_status = "new" WHERE id = ?', [orderId]);
                    }
                };
                backgroundSync();
            }
        } catch (error: any) {
            console.error('[ERROR] saveQuotation:', error);
            Alert.alert('Error', 'No se pudo procesar la venta.');
            setLoading(false);
            setIsSavingSales(false);
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
            const user = useAuthStore.getState().user;
            const uid = user?.uid || null;
            const userName = user?.name || '';

            // 1. INTENTO DE OPERACIÓN EN TIEMPO REAL (Si online)
            if (!isOffline && orderId > 0) {
                console.log('[RealTime] Detectado modo Online. Intentando facturar en Odoo...');
                try {
                    // Fetch order info from Odoo to ensure we have the correct partner and lines
                    const orderData: any = await callOdoo('sale.order', 'search_read', {
                        domain: [['id', '=', orderId]],
                        fields: ['partner_id', 'order_line', 'name']
                    });

                    if (orderData && orderData.length > 0) {
                        const order = orderData[0];
                        
                        // Fetch order lines to build invoice lines
                        const linesData: any = await callOdoo('sale.order.line', 'search_read', {
                            domain: [['order_id', '=', orderId]],
                            fields: ['product_id', 'product_uom_qty', 'price_unit', 'name']
                        });

                        const invoiceLines = linesData.map((l: any) => [0, 0, {
                            product_id: l.product_id[0],
                            quantity: l.product_uom_qty,
                            price_unit: l.price_unit,
                            name: l.name,
                            sale_line_ids: [[4, l.id]] // Link to SO line
                        }]);

                        const invoiceVals = {
                            move_type: 'out_invoice',
                            partner_id: order.partner_id[0],
                            invoice_user_id: uid, // Responsable mobile
                            invoice_date: new Date().toISOString().split('T')[0],
                            invoice_line_ids: invoiceLines,
                            invoice_origin: order.name,
                        };

                        const invRes: any = await callOdoo('account.move', 'create', {
                            vals_list: [invoiceVals]
                        });

                        const newInvId = Array.isArray(invRes) ? (invRes[0].id || invRes[0]) : (invRes.id || invRes);

                        if (newInvId) {
                            // Publicar factura
                            await callOdoo('account.move', 'action_post', { ids: [newInvId] });
                            
                            // Guardar en SQLite local marcado como sincronizado
                            await db.createInvoiceLocal(orderId, uid, userName, newInvId, 'synced');
                            
                            Alert.alert('Éxito (RealTime)', 'Factura generada y publicada en Odoo correctamente.');
                            fetchData();
                            return;
                        }
                    }
                } catch (onlineErr: any) {
                    console.warn('[RealTime] Falló facturación directa:', onlineErr.message);
                }
            }
            
            // 2. FALLBACK: GENERAR LOCAL (Offline o fallo de red)
            console.log('[HybridSync] Generando factura local...');
            await db.createInvoiceLocal(orderId, uid, userName);
            
            if (!isOffline) {
                uploadOfflineChanges().catch(e => console.log('Background sync delayed:', e.message));
                Alert.alert('Éxito', 'Factura generada localmente. Sincronizando con Odoo...');
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
                console.log('[OFFLINE] Cargando detalle de factura local:', invoiceId);
                const dbInst = await db.getDb();
                const inv: any = await dbInst.getFirstAsync('SELECT * FROM account_moves WHERE id = ?', [invoiceId]);
                if (inv) {
                    const lines = await dbInst.getAllAsync('SELECT * FROM account_move_lines WHERE move_id = ?', [invoiceId]);
                    setSelectedInvoice({ ...inv, lines });
                } else {
                    Alert.alert('Error Offline', 'No se encontró la factura en la base de datos local.');
                }
                return;
            }

            console.log('[ONLINE] Consultando factura en Odoo:', invoiceId);
            const invData: any = await callOdoo('account.move', 'search_read', {
                domain: [['id', '=', invoiceId]],
                fields: [
                    'name', 'partner_id', 'invoice_date', 'amount_total', 'amount_residual', 
                    'invoice_line_ids', 'invoice_user_id', 'access_token', 'state',
                    'siat_estado', 'siat_cuf', 'siat_qr_string', 'siat_qr_image', 'siat_leyenda'
                ]
            });

            if (invData && invData.length > 0) {
                const rawInv = invData[0];
                
                // Mapear campos de SIAT (Odoo -> Internal Interface)
                const mappedInv: Invoice = {
                    ...rawInv,
                    partner_name: rawInv.partner_id ? rawInv.partner_id[1] : '',
                    invoice_user_id: rawInv.invoice_user_id,
                    invoice_user_name: rawInv.invoice_user_id ? rawInv.invoice_user_id[1] : '',
                    siat_status: rawInv.siat_estado,
                    siat_url: rawInv.siat_qr_string,
                    siat_qr_content: rawInv.siat_qr_image,
                };

                const lines: any = await callOdoo('account.move.line', 'search_read', {
                    domain: [['move_id', '=', rawInv.id], ['display_type', 'not in', ['line_section', 'line_note']]],
                    fields: ['name', 'product_id', 'quantity', 'price_unit', 'price_subtotal']
                });

                // Enriquecer con datos de contacto locales si están disponibles para permitir WhatsApp/Email incluso online
                const dbInst = await db.getDb();
                const partnerLoc: any = await dbInst.getFirstAsync(
                    'SELECT mobile, phone, email FROM partners WHERE id = ?', 
                    [rawInv.partner_id[0]]
                );
                
                const partner = partnerLoc || {};

                setSelectedInvoice({ 
                    ...mappedInv, 
                    lines,
                    partner_mobile: partner.mobile || partner.phone || '',
                    partner_email: partner.email || '' 
                });
            } else {
                Alert.alert('Error', 'No se pudo encontrar la factura en el servidor.');
            }
        } catch (error: any) {
            console.error('Error fetching invoice details:', error.message);
            Alert.alert('Error', 'Hubo un problema al cargar el detalle de la factura.');
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
    const handleEditOrder = useCallback(async (order: SaleOrder) => {
        try {
            setLoading(true);
            setIsEditing(true);
            setEditingOrderId(order.id);
            setGeneratedXmlId(order.xml_id || null);
            
            // Cargar datos del cliente
            setSelectedPartner({
                id: order.partner_id[0],
                display_name: order.partner_id[1]
            });

            // Cargar líneas (si no están ya en el objeto item, las buscamos en SQLite)
            let lines = order.lines_data || [];
            if (lines.length === 0) {
                const dbInst = await db.getDb();
                lines = await dbInst.getAllAsync('SELECT * FROM sale_order_lines WHERE order_id = ?', [order.id]);
            }

            const mappedLines = lines.map((l: any) => ({
                product_id: l.product_id[0] || l.product_id,
                product_name: l.product_name || l.product_id[1] || 'Producto',
                quantity: l.product_uom_qty,
                price: l.price_unit,
                discount: l.discount || 0,
                max_discount: l.max_discount || 0
            }));

            setQuoteLines(mappedLines);
            setGlobalDiscount(order.global_discount?.toString() || '0');
            setModalVisible(true);
        } catch (error) {
            console.error('Error in handleEditOrder:', error);
            Alert.alert('Error', 'No se pudo cargar el pedido para editar.');
        } finally {
            setLoading(false);
        }
    }, []);

    const handleDuplicateOrder = useCallback(async (order: SaleOrder) => {
        try {
            setLoading(true);
            setIsEditing(false); // Es una creación nueva
            setEditingOrderId(null);
            
            // Generar xml_id único para el duplicado
            const newXmlId = `APP-SO-DUPE-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
            setGeneratedXmlId(newXmlId);

            setSelectedPartner({
                id: order.partner_id[0],
                display_name: order.partner_id[1]
            });

            let lines = order.lines_data || [];
            if (lines.length === 0) {
                const dbInst = await db.getDb();
                lines = await dbInst.getAllAsync('SELECT * FROM sale_order_lines WHERE order_id = ?', [order.id]);
            }

            const mappedLines = lines.map((l: any) => ({
                product_id: l.product_id[0] || l.product_id,
                product_name: l.product_name || l.product_id[1] || 'Producto',
                quantity: l.product_uom_qty,
                price: l.price_unit,
                discount: l.discount || 0,
                max_discount: l.max_discount || 0
            }));

            setQuoteLines(mappedLines);
            setGlobalDiscount(order.global_discount?.toString() || '0');
            setModalVisible(true);
        } catch (error) {
            console.error('Error in handleDuplicateOrder:', error);
            Alert.alert('Error', 'No se pudo duplicar el pedido.');
        } finally {
            setLoading(false);
        }
    }, []);

    // Card Component optimizado con Memo
    const SaleOrderCard = React.memo(({ item, onEdit, onDuplicate, onViewDetail, onConfirm, onViewInvoice, onCreateInvoice }: { 
        item: SaleOrder, 
        onEdit: (o: SaleOrder) => void, 
        onDuplicate: (o: SaleOrder) => void,
        onViewDetail: (o: SaleOrder) => void,
        onConfirm: (id: number) => void,
        onViewInvoice: (invoiceId: number) => void,
        onCreateInvoice: (id: number) => void
    }) => (
        <View style={styles.card}>
            <TouchableOpacity 
                style={styles.cardContent} 
                onPress={() => onViewDetail(item)}
            >
                <View style={styles.cardHeader}>
                    <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <Text style={styles.orderName}>{item.name || item.display_name}</Text>
                            {item.is_local === 1 && (
                                <FontAwesome name="cloud-upload" size={14} color="#F59E0B" style={{ marginLeft: 6 }} />
                            )}
                        </View>
                        <Text style={styles.partnerName} numberOfLines={1}>{item.partner_id[1]}</Text>
                    </View>
                    <View style={[styles.statusBadge, 
                        item.state === 'draft' ? styles.statusDraft : 
                        item.state === 'sale' ? styles.statusSale : styles.statusDone
                    ]}>
                        <Text style={styles.statusText}>
                            {item.state === 'draft' ? 'BORRADOR' : 
                             item.state === 'sale' ? 'PEDIDO' : 'HECHO'}
                        </Text>
                    </View>
                </View>

                {/* Vista previa de Items (Registro de ítems) */}
                <View style={styles.itemsPreview}>
                    {item.lines_data?.slice(0, 3).map((line: any, idx: number) => (
                        <Text key={idx} style={styles.itemLineText} numberOfLines={1}>
                             • {line.product_name || line.product_id[1]}: {line.product_uom_qty} x Bs. {line.price_unit}
                        </Text>
                    ))}
                    {item.lines_data && item.lines_data.length > 3 && (
                        <Text style={styles.moreItemsText}>... y {item.lines_data.length - 3} productos más</Text>
                    )}
                </View>

                <View style={[styles.orderInfo, { borderTopWidth: 0, marginTop: 5 }]}>
                    <View style={styles.infoRow}>
                        <FontAwesome name="calendar" size={12} color="#6B7280" />
                        <Text style={styles.infoText}>{new Date(item.date_order).toLocaleDateString()}</Text>
                        
                        <View style={{ width: 15 }} />
                        
                        <FontAwesome name="money" size={12} color="#6B7280" />
                        <Text style={styles.infoText}>Bs. {item.amount_total.toFixed(2)}</Text>
                    </View>
                </View>
            </TouchableOpacity>

            <View style={styles.cardActions}>
                {item.state === 'draft' && (
                    <TouchableOpacity 
                        style={[styles.actionButton, styles.confirmInlineButton]}
                        onPress={() => onConfirm(item.id)}
                    >
                        <FontAwesome name="check" size={14} color="#fff" />
                        <Text style={styles.actionButtonText}>CONFIRMAR</Text>
                    </TouchableOpacity>
                )}
                {(item.state === 'sale' || item.state === 'done') && !item.invoice_id && (
                    <TouchableOpacity 
                        style={[styles.actionButton, { backgroundColor: '#3B82F6', marginLeft: 8 }]}
                        onPress={() => onCreateInvoice(item.id)}
                    >
                        <FontAwesome name="file-text-o" size={14} color="#fff" />
                        <Text style={styles.actionButtonText}>FACTURAR</Text>
                    </TouchableOpacity>
                )}
                {item.invoice_id ? (
                    <TouchableOpacity 
                        style={[styles.actionButton, { backgroundColor: '#8B5CF6' }]}
                        onPress={() => onViewInvoice(item.invoice_id as number)}
                    >
                        <FontAwesome name="file-text" size={14} color="#fff" />
                        <Text style={styles.actionButtonText}>VER FACTURA</Text>
                    </TouchableOpacity>
                ) : null}
                <TouchableOpacity 
                    style={[styles.actionButton, styles.editButton]}
                    onPress={() => onEdit(item)}
                >
                    <FontAwesome name="pencil" size={14} color="#fff" />
                    <Text style={styles.actionButtonText}>EDITAR</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                    style={[styles.actionButton, styles.duplicateButton]}
                    onPress={() => onDuplicate(item)}
                >
                    <FontAwesome name="copy" size={14} color="#fff" />
                    <Text style={styles.actionButtonText}>DUPLICAR</Text>
                </TouchableOpacity>
            </View>
        </View>
    ));

    const renderCard = ({ item }: { item: SaleOrder }) => (
        <SaleOrderCard 
            item={item} 
            onEdit={handleEditOrder} 
            onDuplicate={handleDuplicateOrder}
            onViewDetail={handleEditOrder}
            onConfirm={confirmExistingOrder}
            onViewInvoice={viewInvoiceDetail}
            onCreateInvoice={handleCreateInvoice}
        />
    );


    const isAuditMode = useAuthStore.getState().isAuditMode;

    return (
        <View style={styles.container}>
            <LoadingOverlay visible={isSavingSales} message={loadingMessage} />
            <View style={styles.header}>
                <Text style={styles.headerTitle}>Ventas / Sectores</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    {permissions?.create_sale && !isAuditMode && (
                        <TouchableOpacity 
                            style={[styles.newButton, { marginRight: 15 }]} 
                            onPress={() => {
                                setIsEditing(false);
                                setEditingOrderId(null);
                                setGeneratedXmlId(null);
                                setSelectedPartner(null);
                                setQuoteLines([]);
                                setGlobalDiscount('0');
                                setModalVisible(true);
                            }}
                        >
                            <FontAwesome name="plus" size={14} color="#fff" />
                            <Text style={styles.newButtonText}>NUEVA</Text>
                        </TouchableOpacity>
                    )}
                    <TouchableOpacity 
                        onPress={handleManualSync} 
                        disabled={loading || isAuditMode} 
                        style={{opacity: isAuditMode ? 0.3 : 1}}
                    >
                        <FontAwesome name="refresh" size={20} color="#714B67" />
                    </TouchableOpacity>
                </View>
            </View>

            <View style={styles.searchContainer}>
                <FontAwesome name="search" size={20} color="#9CA3AF" style={styles.searchIcon} />
                <TextInput
                    style={styles.searchInput}
                    placeholder="Buscar ventas..."
                    value={mainSearchQuery}
                    onChangeText={handleMainSearch}
                />
                {mainSearchQuery.length > 0 && (
                    <TouchableOpacity onPress={() => handleMainSearch('')}>
                        <FontAwesome name="times-circle" size={18} color="#9CA3AF" />
                    </TouchableOpacity>
                )}
            </View>

            <ListFilters
                limit={limit}
                setLimit={(v) => { setLimit(v); setOffset(0); }}
                dateFilter={dateFilter}
                setDateFilter={(v) => { setDateFilter(v); setOffset(0); }}
                onApply={() => { setOffset(0); fetchData(true); }}
                disabled={isOffline || useAuthStore.getState().isAuditMode}
                offset={offset}
                totalCount={totalCount}
                onNextPage={handleNextPage}
                onPrevPage={handlePrevPage}
            />

            <FlatList
                data={filteredResult}
                keyExtractor={(item) => item.id.toString()}
                renderItem={renderCard}
                contentContainerStyle={styles.listContent}
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
                                                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                                                        <View style={{ flex: 1.5 }}>
                                                            <Text style={{ color: '#374151', fontSize: 13, fontWeight: '500' }}>{p.display_name}</Text>
                                                            {p.qty_available !== undefined && (
                                                                <Text style={{ color: (p.qty_available > 0 ? '#10B981' : '#EF4444'), fontSize: 11 }}>
                                                                    Stock: {p.qty_available % 1 === 0 ? p.qty_available : p.qty_available.toFixed(2)}
                                                                </Text>
                                                            )}
                                                        </View>
                                                        <Text style={{ fontWeight: 'bold', color: '#111827' }}>Bs. {p.list_price}</Text>
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

                            <Text style={[styles.inputLabel, { marginTop: 20 }]}>Productos Seleccionados</Text>
                            {quoteLines.length === 0 ? (
                                <Text style={styles.placeholderText}>No se han agregado productos aún.</Text>
                            ) : (
                                quoteLines.map((line, index) => (
                                    <View key={`${line.product_id}-${index}`} style={styles.quoteLine}>
                                        <View style={{ flex: 1 }}>
                                            <Text style={styles.lineName} numberOfLines={1}>{line.product_name}</Text>
                                            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 5 }}>
                                                <Text style={{ fontSize: 13, color: '#6B7280', marginRight: 5 }}>Bs.</Text>
                                                <TextInput
                                                    style={[styles.priceInput, { backgroundColor: '#F3F4F6', color: '#9CA3AF' }]}
                                                    keyboardType="numeric"
                                                    value={line.price.toString()}
                                                    editable={false}
                                                />
                                            </View>
                                            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 5 }}>
                                                <Text style={{ fontSize: 13, color: '#00A09D', marginRight: 5 }}>Desc. Linea %</Text>
                                                <TextInput
                                                    style={[
                                                        styles.priceInput, 
                                                        parseFloat(globalDiscount) > 0 && { backgroundColor: '#F3F4F6', color: '#9CA3AF' }
                                                    ]}
                                                    keyboardType="numeric"
                                                    value={line.discount.toString()}
                                                    onChangeText={(txt) => updateLineDiscount(line.product_id, txt)}
                                                    editable={parseFloat(globalDiscount) === 0}
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

                            {permissions?.confirm_sale && (
                                <View style={styles.toggleRow}>
                                    <Text style={styles.inputLabel}>¿Confirmar Orden Automáticamente?</Text>
                                    <TouchableOpacity
                                        onPress={() => setShouldConfirm(!shouldConfirm)}
                                        style={[styles.toggleSwitch, shouldConfirm && styles.toggleSwitchActive]}
                                    >
                                        <View style={[styles.toggleCircle, shouldConfirm && styles.toggleCircleActive]} />
                                    </TouchableOpacity>
                                </View>
                            )}

                            <View style={{ height: 100 }} />
                        </ScrollView>

                        <View style={styles.modalFooter}>
                            <View style={{ marginBottom: 10, borderBottomWidth: 1, borderBottomColor: '#F3F4F6', paddingBottom: 10 }}>
                                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                        <FontAwesome name="globe" size={16} color="#714B67" style={{ marginRight: 8 }} />
                                        <Text style={[styles.inputLabel, { marginTop: 0 }]}>Descuento Global %</Text>
                                    </View>
                                    <TextInput
                                        style={[
                                            styles.priceInput, 
                                            { width: 80 },
                                            quoteLines.some(l => l.discount > 0) && { backgroundColor: '#F3F4F6', color: '#9CA3AF' }
                                        ]}
                                        keyboardType="numeric"
                                        value={globalDiscount}
                                        onChangeText={setGlobalDiscount}
                                        editable={!quoteLines.some(l => l.discount > 0)}
                                    />
                                </View>
                                {quoteLines.some(l => l.discount > 0) && (
                                    <Text style={{ fontSize: 10, color: '#EF4444', textAlign: 'right', marginTop: 2 }}>
                                        * Deshabilitado: Ya hay descuentos por línea.
                                    </Text>
                                )}
                            </View>

                            <Text style={styles.modalTotal}>
                                Total: Bs. {(
                                    quoteLines.reduce((acc, l) => acc + (l.price * l.quantity * (1 - l.discount / 100)), 0) * 
                                    (1 - (parseFloat(globalDiscount) || 0) / 100)
                                ).toFixed(2)}
                            </Text>
                            <TouchableOpacity
                                style={[
                                    styles.saveButton, 
                                    { backgroundColor: shouldConfirm ? '#22C55E' : '#00A09D' },
                                    (!selectedPartner || quoteLines.length === 0 || isSavingSales) && { opacity: 0.5 }
                                ]}
                                onPress={saveQuotation}
                                disabled={!selectedPartner || quoteLines.length === 0 || isSavingSales}
                            >
                                {isSavingSales ? (
                                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                        <ActivityIndicator color="#fff" size="small" style={{ marginRight: 10 }} />
                                        <Text style={styles.saveButtonText}>PROCESANDO...</Text>
                                    </View>
                                ) : (
                                    <Text style={styles.saveButtonText}>
                                        {shouldConfirm ? 'CONFIRMAR Y CREAR ORDEN' : 'GUARDAR COMO COTIZACION'}
                                    </Text>
                                )}
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
        fontSize: 22,
        fontWeight: 'bold',
        color: '#714B67',
    },
    searchContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#fff',
        margin: 15,
        marginBottom: 5,
        paddingHorizontal: 15,
        borderRadius: 12,
        height: 48,
        borderWidth: 1,
        borderColor: '#E5E7EB',
        elevation: 2,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
    },
    searchIcon: {
        marginRight: 10,
    },
    searchInput: {
        flex: 1,
        fontSize: 15,
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
        alignItems: 'flex-start',
        marginBottom: 10,
    },
    cardContent: {
        padding: 15,
        paddingBottom: 5,
    },
    orderName: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#111827',
    },
    partnerName: {
        fontSize: 14,
        color: '#4B5563',
        marginTop: 2,
    },
    orderInfo: {
        marginTop: 5,
        borderTopWidth: 1,
        borderTopColor: '#F3F4F6',
        paddingTop: 10,
    },
    infoRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 4,
    },
    infoText: {
        fontSize: 13,
        color: '#6B7280',
        marginLeft: 8,
    },
    statusBadge: {
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 6,
    },
    statusDraft: { backgroundColor: '#F3F4F6' },
    statusSale: { backgroundColor: '#D1FAE5' },
    statusDone: { backgroundColor: '#DBEAFE' },
    statusText: {
        fontSize: 10,
        fontWeight: 'bold',
        color: '#374151',
    },
    cardActions: {
        flexDirection: 'row',
        borderTopWidth: 1,
        borderTopColor: '#F3F4F6',
        padding: 8,
        justifyContent: 'space-between',
    },
    actionButton: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 8,
        borderRadius: 8,
        marginHorizontal: 4,
    },
    editButton: {
        backgroundColor: '#F59E0B',
    },
    duplicateButton: {
        backgroundColor: '#6366F1',
    },
    actionButtonText: {
        color: '#fff',
        fontSize: 12,
        fontWeight: 'bold',
        marginLeft: 6,
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
    itemsPreview: {
        marginTop: 8,
        paddingTop: 8,
        borderTopWidth: 1,
        borderTopColor: '#F3F4F6',
    },
    itemLineText: {
        fontSize: 12,
        color: '#4B5563',
        marginBottom: 2,
    },
    moreItemsText: {
        fontSize: 11,
        color: '#9CA3AF',
        fontStyle: 'italic',
        marginTop: 2,
    },
});

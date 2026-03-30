import React, { useEffect, useMemo, useState } from 'react';
import {
    StyleSheet,
    View,
    Text,
    FlatList,
    ActivityIndicator,
    TouchableOpacity,
    RefreshControl,
    LayoutAnimation,
    Platform,
    UIManager,
    TextInput,
    Alert
} from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { callOdoo } from '../../src/api/odooClient';
import { useConfigStore } from '../../src/store/configStore';
import * as db from '../../src/services/dbService';
import { runSync, submitPickingDelivery } from '../../src/services/syncService';
import { getSiatDomain } from '../../src/utils/permissionUtils';
import { useAuthStore } from '../../src/store/authStore';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
    UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface StockMove {
    id: number;
    picking_id?: [number, string] | number | false;
    reference: string;
    product_id: [number, string];
    product_uom_qty: number;
    product_uom: [number, string];
    state: string;
    origin: string;
    partner_id: [number, string] | false;
    date: string;
    date_deadline?: string;
    pending_delivery_qty?: number | null;
    user_name?: string;
}

type ViewMode = 'client' | 'product';

interface DeliveryGroup {
    key: string;
    pickingId: number | null;
    reference: string;
    partnerName: string;
    origin: string;
    scheduledDate: string;
    userName: string;
    moves: StockMove[];
}

const getMoveQuantityInput = (move: StockMove, qtyMap: Record<number, string>) =>
    qtyMap[move.id] ?? String(move.pending_delivery_qty ?? move.product_uom_qty ?? '');

const getRemainingQty = (move: StockMove, qtyMap: Record<number, string>) => {
    const enteredQty = parseFloat(getMoveQuantityInput(move, qtyMap));
    if (Number.isNaN(enteredQty)) {
        return Number(move.product_uom_qty || 0);
    }
    return Math.max(0, Number(move.product_uom_qty || 0) - enteredQty);
};

export default function DistribucionScreen() {
    const user = useAuthStore((state) => state.user);
    const [moves, setMoves] = useState<StockMove[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [viewMode, setViewMode] = useState<ViewMode>('client');
    const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
    const [deliveryQtyByMove, setDeliveryQtyByMove] = useState<Record<number, string>>({});
    const [submittingGroupKey, setSubmittingGroupKey] = useState<string | null>(null);
    const isOffline = useConfigStore((state) => state.isOffline);

    const fetchMoves = async () => {
        try {
            await db.initDB();
            if (!refreshing) setLoading(true);

            // 1. CARGA INSTANTÁNEA (Offline-First por defecto)
            console.log('Cargando distribución desde SQLite...');
            const localData = await db.getStockMoves();
            setMoves(localData as any);
            if (localData && localData.length > 0) setLoading(false);

            // 2. ACTUALIZACIÓN EN SEGUNDO PLANO (Si online)
            if (!isOffline) {
                console.log('Refrescando movimientos de stock desde Odoo...');
                try {
                    const stockDomain = getSiatDomain('stock.move', user);
                    
                    // Combinamos con filtros específicos de movimientos pendientes
                    const fullDomain = [
                        '&',
                        ...stockDomain,
                        '&',
                        ['partner_id', '!=', false],
                        ['state', 'in', ['draft', 'waiting', 'confirmed', 'partially_available', 'assigned']]
                    ];

                    const result: any[] = await callOdoo('stock.move', 'search_read', {
                        domain: fullDomain,
                        fields: [
                            'picking_id', 'reference', 'product_id', 'product_uom_qty', 'product_uom',
                            'state', 'origin', 'partner_id', 'date', 'date_deadline', 'company_id'
                        ],
                        limit: 300
                    }, true);

                    if (result && Array.isArray(result)) {
                        // All results from Odoo are already filtered by the current user in the domain
                        result.forEach(m => {
                            m.user_id = user?.uid || 0;
                            m.user_name = user?.name || '';
                        });
                        await db.saveStockMoves(result as any);
                        const updatedLocal = await db.getStockMoves();
                        setMoves(updatedLocal as any);
                    }
                } catch (e) {
                    console.warn('No se pudo refrescar distribución de Odoo.');
                }
            }
        } catch (error) {
            console.error('Error fetching delivery moves:', error);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    useEffect(() => {
        fetchMoves();
    }, [isOffline]);

    const groups = useMemo(() => {
        const map = new Map<string, DeliveryGroup>();

        for (const move of moves) {
            const pickingId = Array.isArray(move.picking_id) ? move.picking_id[0] : (move.picking_id || null);
            const key = String(pickingId ?? move.reference ?? move.id);
            if (!map.has(key)) {
                map.set(key, {
                    key,
                    pickingId,
                    reference: move.reference || `MOVE/${move.id}`,
                    partnerName: Array.isArray(move.partner_id) ? move.partner_id[1] : 'Cliente No Definido',
                    origin: move.origin || 'N/A',
                    scheduledDate: move.date_deadline || move.date,
                    userName: move.user_name || user?.name || 'Asignado',
                    moves: []
                });
            }
            map.get(key)?.moves.push(move);
        }

        const result = Array.from(map.values());
        if (viewMode === 'product') {
            result.forEach(group => {
                group.moves.sort((a, b) => a.product_id[1].localeCompare(b.product_id[1]));
            });
        }
        return result.sort((a, b) => a.reference.localeCompare(b.reference));
    }, [moves, viewMode]);

    const onRefresh = () => {
        setRefreshing(true);
        fetchMoves();
    };

    const toggleExpand = (groupKey: string) => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setExpandedGroups(prev => ({ ...prev, [groupKey]: !prev[groupKey] }));
    };

    const handleDeliveryQtyChange = (moveId: number, value: string) => {
        setDeliveryQtyByMove(prev => ({ ...prev, [moveId]: value }));
    };

    const handleFillAllQuantities = (group: DeliveryGroup) => {
        const nextValues: Record<number, string> = {};
        for (const move of group.moves) {
            nextValues[move.id] = String(move.product_uom_qty || 0);
        }
        setDeliveryQtyByMove(prev => ({ ...prev, ...nextValues }));
    };

    const handleDeliverGroup = async (group: DeliveryGroup) => {
        if (!group.pickingId) {
            Alert.alert('Error', 'La transferencia no tiene `picking_id` asociado.');
            return;
        }

        const deliveries = [];
        for (const move of group.moves) {
            const qty = parseFloat(getMoveQuantityInput(move, deliveryQtyByMove));
            if (Number.isNaN(qty) || qty <= 0) {
                Alert.alert('Error', `La cantidad de ${move.product_id[1]} debe ser mayor a cero.`);
                return;
            }
            if (qty > Number(move.product_uom_qty || 0)) {
                Alert.alert('Error', `No puedes entregar mas de lo solicitado en ${move.product_id[1]}.`);
                return;
            }
            deliveries.push({ moveId: move.id, quantity: qty });
        }

        try {
            setSubmittingGroupKey(group.key);

            if (isOffline) {
                for (const delivery of deliveries) {
                    await db.queueStockMoveDelivery(delivery.moveId, group.pickingId, delivery.quantity);
                }
                Alert.alert('Éxito', 'Entrega guardada localmente. Se enviara a Odoo al sincronizar.');
                fetchMoves();
                return;
            }

            await submitPickingDelivery(group.pickingId, deliveries);
            await runSync();
            Alert.alert('Éxito', 'Entrega registrada en Odoo.');
            fetchMoves();
        } catch (error: any) {
            console.error('Error delivering picking:', error);
            Alert.alert('Error', `No se pudo registrar la entrega: ${error.message}`);
        } finally {
            setSubmittingGroupKey(null);
        }
    };

    const renderProductRow = (move: StockMove) => (
        <View key={move.id} style={styles.productCard}>
            <View style={styles.productInfo}>
                <Text style={styles.productName}>{move.product_id[1]}</Text>
                <Text style={styles.productMeta}>
                    Solicitado: {move.product_uom_qty} {move.product_uom[1]}
                </Text>
                <Text style={styles.remainingText}>
                    Faltante: {getRemainingQty(move, deliveryQtyByMove)} {move.product_uom[1]}
                </Text>
                {move.pending_delivery_qty ? (
                    <Text style={styles.pendingText}>
                        Pendiente de sincronizar: {move.pending_delivery_qty} {move.product_uom[1]}
                    </Text>
                ) : null}
            </View>
            <TextInput
                value={getMoveQuantityInput(move, deliveryQtyByMove)}
                onChangeText={(value) => handleDeliveryQtyChange(move.id, value)}
                keyboardType="decimal-pad"
                style={styles.deliveryInput}
                placeholder="Cant."
            />
        </View>
    );

    const renderGroup = ({ item }: { item: DeliveryGroup }) => {
        const expanded = !!expandedGroups[item.key];
        const totalRequested = item.moves.reduce((acc, move) => acc + Number(move.product_uom_qty || 0), 0);

        return (
            <View style={[styles.card, expanded && styles.cardExpanded]}>
                <TouchableOpacity
                    activeOpacity={0.7}
                    onPress={() => toggleExpand(item.key)}
                    style={styles.cardHeader}
                >
                    <View style={styles.headerInfo}>
                        <View style={styles.topRow}>
                            <View style={styles.refRow}>
                                <FontAwesome name="truck" size={14} color="#714B67" />
                                <Text style={styles.reference}>{item.reference}</Text>
                                <Text style={styles.responsible}>({item.userName})</Text>
                            </View>
                            <View style={styles.dateBadge}>
                                <FontAwesome name="calendar" size={10} color="#714B67" />
                                <Text style={styles.dateBadgeText}>
                                    {new Date(item.scheduledDate).toLocaleDateString()}
                                </Text>
                            </View>
                        </View>

                        {viewMode === 'client' ? (
                            <View style={styles.mainInfoRow}>
                                <FontAwesome name="user" size={14} color="#00A09D" />
                                <Text style={styles.mainTitle}>{item.partnerName}</Text>
                            </View>
                        ) : (
                            <View style={styles.mainInfoRow}>
                                <FontAwesome name="cubes" size={14} color="#00A09D" />
                                <Text style={styles.mainTitle}>{item.moves.length} productos</Text>
                            </View>
                        )}

                        <Text style={styles.originText}>Origen: {item.origin}</Text>
                    </View>

                    <View style={styles.headerRight}>
                        <Text style={styles.mainQty}>{item.moves.length} items</Text>
                        <Text style={styles.totalQty}>Total: {totalRequested}</Text>
                        <FontAwesome
                            name={expanded ? 'chevron-up' : 'chevron-down'}
                            size={14}
                            color="#714B67"
                            style={{ marginTop: 8 }}
                        />
                    </View>
                </TouchableOpacity>

                {expanded && (
                    <View style={styles.expandedContent}>
                        <View style={styles.divider} />
                        <View style={styles.sectionHeader}>
                            <Text style={styles.linesTitle}>Productos</Text>
                            <TouchableOpacity
                                style={styles.fillAllButton}
                                onPress={() => handleFillAllQuantities(item)}
                            >
                                <Text style={styles.fillAllButtonText}>ENTREGAR TODO</Text>
                            </TouchableOpacity>
                        </View>
                        {item.moves.map(renderProductRow)}
                        <TouchableOpacity
                            style={[
                                styles.deliverButton,
                                submittingGroupKey === item.key && styles.deliverButtonDisabled
                            ]}
                            onPress={() => handleDeliverGroup(item)}
                            disabled={submittingGroupKey === item.key}
                        >
                            <FontAwesome name="check" size={14} color="#fff" />
                            <Text style={styles.deliverButtonText}>
                                {submittingGroupKey === item.key ? 'GUARDANDO...' : 'ENTREGAR TRANSFERENCIA'}
                            </Text>
                        </TouchableOpacity>
                    </View>
                )}
            </View>
        );
    };

    if (loading && !refreshing) {
        return (
            <View style={styles.centerContainer}>
                <ActivityIndicator size="large" color="#714B67" />
                <Text style={styles.loadingText}>Cargando datos de distribucion...</Text>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <View style={styles.topHeader}>
                <Text style={styles.headerTitle}>Distribucion</Text>
                <View style={styles.selectorContainer}>
                    <TouchableOpacity
                        style={[styles.selectorBtn, viewMode === 'client' && styles.selectorBtnActive]}
                        onPress={() => {
                            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                            setViewMode('client');
                        }}
                    >
                        <Text style={[styles.selectorText, viewMode === 'client' && styles.selectorTextActive]}>Por Cliente</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.selectorBtn, viewMode === 'product' && styles.selectorBtnActive]}
                        onPress={() => {
                            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                            setViewMode('product');
                        }}
                    >
                        <Text style={[styles.selectorText, viewMode === 'product' && styles.selectorTextActive]}>Por Producto</Text>
                    </TouchableOpacity>
                </View>
            </View>

            <FlatList
                data={groups}
                keyExtractor={(item) => item.key}
                renderItem={renderGroup}
                contentContainerStyle={styles.listContent}
                refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#714B67']} />
                }
                ListEmptyComponent={
                    <View style={styles.emptyContainer}>
                        <FontAwesome name="dropbox" size={80} color="#ccc" />
                        <Text style={styles.emptyText}>No hay entregas pendientes</Text>
                    </View>
                }
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F3F4F6',
    },
    topHeader: {
        padding: 15,
        backgroundColor: '#fff',
        borderBottomWidth: 1,
        borderBottomColor: '#E5E7EB',
    },
    headerTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#111827',
        marginBottom: 12,
    },
    selectorContainer: {
        flexDirection: 'row',
        backgroundColor: '#F3F4F6',
        borderRadius: 8,
        padding: 4,
    },
    selectorBtn: {
        flex: 1,
        paddingVertical: 8,
        alignItems: 'center',
        borderRadius: 6,
    },
    selectorBtnActive: {
        backgroundColor: '#fff',
        elevation: 2,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 1,
    },
    selectorText: {
        fontSize: 13,
        fontWeight: '600',
        color: '#6B7280',
    },
    selectorTextActive: {
        color: '#714B67',
    },
    listContent: {
        padding: 12,
        paddingBottom: 40,
    },
    card: {
        backgroundColor: '#fff',
        borderRadius: 12,
        marginBottom: 12,
        elevation: 2,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: '#E5E7EB',
    },
    cardExpanded: {
        borderColor: '#714B67',
        borderWidth: 2,
    },
    cardHeader: {
        flexDirection: 'row',
        padding: 15,
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    headerInfo: {
        flex: 1,
    },
    topRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 6,
    },
    refRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    reference: {
        fontSize: 12,
        fontWeight: '700',
        color: '#9CA3AF',
        marginLeft: 6,
    },
    responsible: {
        fontSize: 10,
        color: '#714B67',
        marginLeft: 26,
        marginTop: -2,
        fontWeight: '600',
    },
    dateBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FDF2F8',
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 12,
    },
    dateBadgeText: {
        fontSize: 11,
        fontWeight: 'bold',
        color: '#714B67',
        marginLeft: 4,
    },
    mainInfoRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginVertical: 2,
    },
    mainTitle: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#111827',
        marginLeft: 8,
        flex: 1,
    },
    originText: {
        fontSize: 12,
        color: '#9CA3AF',
        marginTop: 4,
        marginLeft: 22,
    },
    headerRight: {
        alignItems: 'flex-end',
        marginLeft: 10,
    },
    mainQty: {
        fontSize: 15,
        fontWeight: 'bold',
        color: '#714B67',
    },
    totalQty: {
        fontSize: 12,
        color: '#6B7280',
        marginTop: 2,
    },
    expandedContent: {
        backgroundColor: '#F9FAFB',
        padding: 15,
        paddingTop: 0,
    },
    divider: {
        height: 1,
        backgroundColor: '#E5E7EB',
        marginBottom: 12,
    },
    linesTitle: {
        fontSize: 11,
        fontWeight: 'bold',
        color: '#6B7280',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    sectionHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 10,
    },
    fillAllButton: {
        backgroundColor: '#ECFDF5',
        borderWidth: 1,
        borderColor: '#A7F3D0',
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 8,
    },
    fillAllButtonText: {
        color: '#065F46',
        fontSize: 11,
        fontWeight: '700',
    },
    productCard: {
        backgroundColor: '#fff',
        borderRadius: 10,
        padding: 12,
        marginBottom: 8,
        borderWidth: 1,
        borderColor: '#E5E7EB',
        flexDirection: 'row',
        alignItems: 'center',
    },
    productInfo: {
        flex: 1,
        marginRight: 10,
    },
    productName: {
        fontSize: 14,
        fontWeight: '600',
        color: '#111827',
    },
    productMeta: {
        fontSize: 12,
        color: '#6B7280',
        marginTop: 3,
    },
    remainingText: {
        fontSize: 12,
        color: '#1D4ED8',
        marginTop: 3,
        fontWeight: '600',
    },
    pendingText: {
        fontSize: 12,
        color: '#B45309',
        marginTop: 4,
        fontWeight: '600',
    },
    deliveryInput: {
        width: 96,
        borderWidth: 1,
        borderColor: '#D1D5DB',
        borderRadius: 10,
        paddingHorizontal: 10,
        paddingVertical: 10,
        fontSize: 15,
        textAlign: 'center',
        backgroundColor: '#fff',
    },
    deliverButton: {
        marginTop: 12,
        backgroundColor: '#059669',
        borderRadius: 10,
        paddingVertical: 12,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 8,
    },
    deliverButtonDisabled: {
        opacity: 0.7,
    },
    deliverButtonText: {
        color: '#fff',
        fontSize: 13,
        fontWeight: '700',
    },
    centerContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    loadingText: {
        marginTop: 10,
        color: '#666',
    },
    emptyContainer: {
        marginTop: 100,
        alignItems: 'center',
    },
    emptyText: {
        marginTop: 15,
        fontSize: 16,
        color: '#9CA3AF',
    },
});

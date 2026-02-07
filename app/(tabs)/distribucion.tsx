import React, { useEffect, useState } from 'react';
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
    UIManager
} from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { callOdoo } from '../../src/api/odooClient';

// Enable LayoutAnimation for Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
    UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface StockMoveLine {
    id: number;
    product_id: [number, string];
    quantity: number;
    product_uom_id: [number, string];
    lot_id: [number, string] | false;
    location_id: [number, string];
    location_dest_id: [number, string];
}

interface StockMove {
    id: number;
    reference: string;
    product_id: [number, string];
    product_uom_qty: number;
    product_uom: [number, string];
    state: string;
    origin: string;
    partner_id: [number, string] | false;
    date: string;
    date_deadline?: string;
    move_line_ids: number[];
    // UI state
    expanded?: boolean;
    lines?: StockMoveLine[];
    loadingLines?: boolean;
}

type ViewMode = 'client' | 'product';

export default function DistribucionScreen() {
    const [moves, setMoves] = useState<StockMove[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [viewMode, setViewMode] = useState<ViewMode>('client');

    const fetchMoves = async () => {
        try {
            setLoading(true);
            const result = await callOdoo('stock.move', 'search_read', {
                domain: [['state', '=', 'assigned']],
                fields: [
                    'reference',
                    'product_id',
                    'product_uom_qty',
                    'product_uom',
                    'state',
                    'origin',
                    'partner_id',
                    'date',
                    'date_deadline',
                    'move_line_ids'
                ],
                limit: 100
            });
            setMoves(result.map((m: any) => ({ ...m, expanded: false, lines: [], loadingLines: false })));
        } catch (error) {
            console.error('Error fetching delivery moves:', error);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    const fetchLinesForMove = async (moveId: number) => {
        try {
            setMoves(prev => prev.map(m => m.id === moveId ? { ...m, loadingLines: true } : m));

            const lines = await callOdoo('stock.move.line', 'search_read', {
                domain: [['move_id', '=', moveId]],
                fields: [
                    'product_id',
                    'quantity',
                    'product_uom_id',
                    'lot_id',
                    'location_id',
                    'location_dest_id'
                ]
            });

            setMoves(prev => prev.map(m =>
                m.id === moveId ? { ...m, lines, loadingLines: false } : m
            ));
        } catch (error) {
            console.error(`Error fetching lines for move ${moveId}:`, error);
            setMoves(prev => prev.map(m => m.id === moveId ? { ...m, loadingLines: false } : m));
        }
    };

    const toggleExpand = (moveId: number) => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);

        let targetMove: StockMove | undefined;
        setMoves(prev => {
            const newState = prev.map(m => {
                if (m.id === moveId) {
                    const isExpanding = !m.expanded;
                    targetMove = { ...m, expanded: isExpanding };
                    return targetMove;
                }
                return m;
            });
            return newState;
        });

        if (targetMove && targetMove.expanded && targetMove.lines && targetMove.lines.length === 0) {
            fetchLinesForMove(targetMove.id);
        }
    };

    useEffect(() => {
        fetchMoves();
    }, []);

    const onRefresh = () => {
        setRefreshing(true);
        fetchMoves();
    };

    const getGroupedData = () => {
        if (viewMode === 'client') {
            return moves;
        } else {
            // Sort by product name for 'Por Producto' view
            return [...moves].sort((a, b) => a.product_id[1].localeCompare(b.product_id[1]));
        }
    };

    const renderLine = (line: StockMoveLine) => (
        <View key={line.id} style={styles.lineItem}>
            <View style={styles.lineRow}>
                <FontAwesome name="cube" size={12} color="#00A09D" />
                <Text style={styles.lineProductName}>{line.product_id[1]}</Text>
            </View>
            <View style={styles.lineDetailRow}>
                <Text style={styles.lineQty}>{line.quantity} {line.product_uom_id[1]}</Text>
                {line.lot_id && (
                    <View style={styles.lineLotBadge}>
                        <Text style={styles.lineLotText}>Lot: {line.lot_id[1]}</Text>
                    </View>
                )}
            </View>
            <View style={styles.lineLocationRow}>
                <Text style={styles.locationText}>De: {line.location_id[1].split('/').pop()}</Text>
                <FontAwesome name="long-arrow-right" size={10} color="#999" style={{ marginHorizontal: 5 }} />
                <Text style={styles.locationText}>A: {line.location_dest_id[1].split('/').pop()}</Text>
            </View>
        </View>
    );

    const renderItem = ({ item }: { item: StockMove }) => (
        <View style={[styles.card, item.expanded && styles.cardExpanded]}>
            <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => toggleExpand(item.id)}
                style={styles.cardHeader}
            >
                <View style={styles.headerInfo}>
                    <View style={styles.topRow}>
                        <View style={styles.refRow}>
                            <FontAwesome name="truck" size={14} color="#714B67" />
                            <Text style={styles.reference}>{item.reference}</Text>
                        </View>
                        <View style={styles.dateBadge}>
                            <FontAwesome name="calendar" size={10} color="#714B67" />
                            <Text style={styles.dateBadgeText}>
                                {new Date(item.date_deadline || item.date).toLocaleDateString()}
                            </Text>
                        </View>
                    </View>

                    {viewMode === 'client' ? (
                        <>
                            <View style={styles.mainInfoRow}>
                                <FontAwesome name="user" size={14} color="#00A09D" />
                                <Text style={styles.mainTitle}>{item.partner_id ? item.partner_id[1] : 'Cliente No Definido'}</Text>
                            </View>
                            <View style={styles.productRow}>
                                <FontAwesome name="tag" size={12} color="#6B7280" />
                                <Text style={styles.subTitle}>{item.product_id[1]}</Text>
                            </View>
                        </>
                    ) : (
                        <>
                            <View style={styles.mainInfoRow}>
                                <FontAwesome name="cube" size={14} color="#00A09D" />
                                <Text style={styles.mainTitle}>{item.product_id[1]}</Text>
                            </View>
                            <View style={styles.productRow}>
                                <FontAwesome name="user" size={12} color="#6B7280" />
                                <Text style={styles.subTitle}>{item.partner_id ? item.partner_id[1] : 'Cliente No Definido'}</Text>
                            </View>
                        </>
                    )}

                    <Text style={styles.originText}>Origen: {item.origin || 'N/A'}</Text>
                </View>

                <View style={styles.headerRight}>
                    <Text style={styles.mainQty}>{item.product_uom_qty} {item.product_uom[1]}</Text>
                    <FontAwesome
                        name={item.expanded ? "chevron-up" : "chevron-down"}
                        size={14}
                        color="#714B67"
                        style={{ marginTop: 8 }}
                    />
                </View>
            </TouchableOpacity>

            {item.expanded && (
                <View style={styles.expandedContent}>
                    <View style={styles.divider} />
                    <Text style={styles.linesTitle}>Detalles de Movimiento (stock.move.line)</Text>

                    {item.loadingLines ? (
                        <ActivityIndicator size="small" color="#00A09D" style={{ marginVertical: 10 }} />
                    ) : item.lines && item.lines.length > 0 ? (
                        item.lines.map(renderLine)
                    ) : (
                        <Text style={styles.noLinesText}>No hay líneas...</Text>
                    )}
                </View>
            )}
        </View>
    );

    if (loading && !refreshing) {
        return (
            <View style={styles.centerContainer}>
                <ActivityIndicator size="large" color="#714B67" />
                <Text style={styles.loadingText}>Cargando datos de distribución...</Text>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <View style={styles.topHeader}>
                <Text style={styles.headerTitle}>Distribución</Text>
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
                data={getGroupedData()}
                keyExtractor={(item) => item.id.toString()}
                renderItem={renderItem}
                contentContainerStyle={styles.listContent}
                refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#714B67']} />
                }
                ListEmptyComponent={
                    <View style={styles.emptyContainer}>
                        <FontAwesome name="dropbox" size={80} color="#ccc" />
                        <Text style={styles.emptyText}>No hay movimientos asignados</Text>
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
    subTitle: {
        fontSize: 14,
        color: '#4B5563',
        marginVertical: 2,
        marginLeft: 8,
    },
    productRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginLeft: 22,
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
        marginBottom: 10,
        letterSpacing: 0.5,
    },
    lineItem: {
        backgroundColor: '#fff',
        borderRadius: 8,
        padding: 10,
        marginBottom: 8,
        borderWidth: 1,
        borderColor: '#F3F4FB',
    },
    lineRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 4,
    },
    lineProductName: {
        fontSize: 14,
        color: '#374151',
        marginLeft: 6,
        flex: 1,
    },
    lineDetailRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginVertical: 4,
    },
    lineQty: {
        fontSize: 13,
        fontWeight: 'bold',
        color: '#00A09D',
    },
    lineLotBadge: {
        backgroundColor: '#E6F6F5',
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
    },
    lineLotText: {
        fontSize: 10,
        color: '#00A09D',
        fontWeight: 'bold',
    },
    lineLocationRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 4,
    },
    locationText: {
        fontSize: 11,
        color: '#9CA3AF',
    },
    noLinesText: {
        textAlign: 'center',
        color: '#9CA3AF',
        fontSize: 13,
        padding: 10,
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

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

interface AccountMoveLine {
    id: number;
    product_id: [number, string] | false;
    quantity: number;
    price_unit: number;
    price_subtotal: number;
    debit: number;
    credit: number;
    name: string;
    product_uom_id: [number, string];
}

interface AccountMove {
    id: number;
    name: string;
    partner_id: [number, string];
    invoice_date: string;
    invoice_date_due: string;
    amount_total: number;
    amount_residual: number;
    invoice_line_ids: number[];
    // UI state
    expanded?: boolean;
    lines?: AccountMoveLine[];
    loadingLines?: boolean;
}

export default function CobranzasScreen() {
    const [invoices, setInvoices] = useState<AccountMove[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    const fetchInvoices = async () => {
        try {
            setLoading(true);
            const result = await callOdoo('account.move', 'search_read', {
                domain: [
                    ['move_type', '=', 'out_invoice'],
                    ['state', '=', 'posted'],
                    ['payment_state', 'in', ['not_paid', 'partial']]
                ],
                fields: [
                    'name',
                    'partner_id',
                    'invoice_date',
                    'invoice_date_due',
                    'amount_total',
                    'amount_residual',
                    'invoice_line_ids'
                ],
                limit: 50
            });
            setInvoices(result.map((m: any) => ({ ...m, expanded: false, lines: [], loadingLines: false })));
        } catch (error) {
            console.error('Error fetching invoices for cobranzas:', error);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    const fetchInvoiceLines = async (moveId: number) => {
        try {
            setInvoices(prev => prev.map(m => m.id === moveId ? { ...m, loadingLines: true } : m));

            const lines = await callOdoo('account.move.line', 'search_read', {
                domain: [
                    ['move_id', '=', moveId],
                    ['display_type', 'not in', ['line_section', 'line_note']]
                ],
                fields: [
                    'product_id',
                    'quantity',
                    'price_unit',
                    'price_subtotal',
                    'debit',
                    'credit',
                    'name',
                    'product_uom_id'
                ]
            });

            setInvoices(prev => prev.map(m =>
                m.id === moveId ? { ...m, lines, loadingLines: false } : m
            ));
        } catch (error) {
            console.error(`Error fetching lines for invoice ${moveId}:`, error);
            setInvoices(prev => prev.map(m => m.id === moveId ? { ...m, loadingLines: false } : m));
        }
    };

    const toggleExpand = (invoiceId: number) => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);

        let targetInvoice: AccountMove | undefined;
        setInvoices(prev => {
            return prev.map(m => {
                if (m.id === invoiceId) {
                    const isExpanding = !m.expanded;
                    targetInvoice = { ...m, expanded: isExpanding };
                    return targetInvoice;
                }
                return m;
            });
        });

        if (targetInvoice && targetInvoice.expanded && targetInvoice.lines && targetInvoice.lines.length === 0) {
            fetchInvoiceLines(targetInvoice.id);
        }
    };

    useEffect(() => {
        fetchInvoices();
    }, []);

    const onRefresh = () => {
        setRefreshing(true);
        fetchInvoices();
    };

    const renderLine = (line: AccountMoveLine) => (
        <View key={line.id} style={styles.lineItem}>
            <View style={styles.lineRow}>
                <FontAwesome name="tag" size={12} color="#714B67" />
                <Text style={styles.lineProductName}>{line.product_id ? line.product_id[1] : line.name}</Text>
            </View>
            <View style={styles.lineDetailRow}>
                <View>
                    <Text style={styles.lineQty}>{line.quantity} {line.product_uom_id ? line.product_uom_id[1] : ''}</Text>
                    <View style={styles.accountingRow}>
                        <Text style={styles.accountingLabel}>D: {(line.debit || 0).toFixed(2)}</Text>
                        <Text style={styles.accountingLabel}> | </Text>
                        <Text style={styles.accountingLabel}>H: {(line.credit || 0).toFixed(2)}</Text>



                    </View>
                </View>
            </View>
        </View>
    );

    const renderItem = ({ item }: { item: AccountMove }) => (
        <View style={[styles.card, item.expanded && styles.cardExpanded]}>
            <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => toggleExpand(item.id)}
                style={styles.cardHeader}
            >
                <View style={styles.headerTop}>
                    <View style={styles.invoiceInfo}>
                        <Text style={styles.invoiceName}>{item.name}</Text>
                        <View style={styles.clientRow}>
                            <FontAwesome name="user" size={12} color="#00A09D" />
                            <Text style={styles.clientName}>{item.partner_id[1]}</Text>
                        </View>
                    </View>
                    <View style={styles.amountContainer}>
                        <Text style={styles.residualLabel}>A COBRAR</Text>
                        <Text style={styles.residualValue}>Bs. {item.amount_residual.toFixed(2)}</Text>
                        <Text style={styles.totalLabel}>Total: Bs. {item.amount_total.toFixed(2)}</Text>
                    </View>
                </View>

                <View style={styles.headerBottom}>
                    <View style={styles.dateInfo}>
                        <View style={styles.dateRow}>
                            <FontAwesome name="calendar" size={10} color="#6B7280" />
                            <Text style={styles.dateText}> Factura: {new Date(item.invoice_date).toLocaleDateString()}</Text>
                        </View>
                        <View style={[styles.dateRow, { marginTop: 2 }]}>
                            <FontAwesome name="clock-o" size={10} color="#EF4444" />
                            <Text style={[styles.dateText, { color: '#B91C1C', fontWeight: 'bold' }]}> Vence: {new Date(item.invoice_date_due).toLocaleDateString()}</Text>
                        </View>
                    </View>
                    <FontAwesome
                        name={item.expanded ? "chevron-up" : "chevron-down"}
                        size={14}
                        color="#714B67"
                    />
                </View>
            </TouchableOpacity>

            {item.expanded && (
                <View style={styles.expandedContent}>
                    <View style={styles.divider} />
                    <Text style={styles.linesTitle}>Detalle de Productos</Text>

                    {item.loadingLines ? (
                        <ActivityIndicator size="small" color="#714B67" style={{ marginVertical: 10 }} />
                    ) : item.lines && item.lines.length > 0 ? (
                        item.lines.map(renderLine)
                    ) : (
                        <Text style={styles.noLinesText}>Cargando detalle...</Text>
                    )}
                </View>
            )}
        </View>
    );

    if (loading && !refreshing) {
        return (
            <View style={styles.centerContainer}>
                <ActivityIndicator size="large" color="#714B67" />
                <Text style={styles.loadingText}>Cargando cuentas por cobrar...</Text>
            </View>
        );
    }

    const totalToCollect = invoices.reduce((acc, inv) => acc + inv.amount_residual, 0);

    return (
        <View style={styles.container}>
            <View style={styles.topHeader}>
                <View>
                    <Text style={styles.headerTitle}>Cobranzas</Text>
                    <Text style={styles.headerSub}>{invoices.length} facturas pendientes</Text>
                </View>
                <View style={styles.totalBadge}>
                    <Text style={styles.totalBadgeLabel}>TOTAL GENERAL</Text>
                    <Text style={styles.totalBadgeValue}>Bs. {totalToCollect.toFixed(2)}</Text>
                </View>
            </View>

            <FlatList
                data={invoices}
                keyExtractor={(item) => item.id.toString()}
                renderItem={renderItem}
                contentContainerStyle={styles.listContent}
                refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#714B67']} />
                }
                ListEmptyComponent={
                    <View style={styles.emptyContainer}>
                        <FontAwesome name="money" size={80} color="#ccc" />
                        <Text style={styles.emptyText}>No hay facturas pendientes de cobro</Text>
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
        padding: 20,
        backgroundColor: '#fff',
        borderBottomWidth: 1,
        borderBottomColor: '#E5E7EB',
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    headerTitle: {
        fontSize: 22,
        fontWeight: 'bold',
        color: '#111827',
    },
    headerSub: {
        fontSize: 13,
        color: '#6B7280',
    },
    totalBadge: {
        backgroundColor: '#714B67',
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 10,
        alignItems: 'center',
    },
    totalBadgeLabel: {
        fontSize: 9,
        fontWeight: 'bold',
        color: '#D1D5DB',
        letterSpacing: 0.5,
    },
    totalBadgeValue: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#fff',
    },
    listContent: {
        padding: 12,
        paddingBottom: 40,
    },
    card: {
        backgroundColor: '#fff',
        borderRadius: 15,
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
        padding: 15,
    },
    headerTop: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 12,
    },
    invoiceInfo: {
        flex: 1,
        marginRight: 10,
    },
    invoiceName: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#111827',
        marginBottom: 4,
    },
    clientRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    clientName: {
        fontSize: 13,
        color: '#00A09D',
        fontWeight: '600',
        marginLeft: 6,
    },
    amountContainer: {
        alignItems: 'flex-end',
    },
    residualLabel: {
        fontSize: 9,
        fontWeight: 'bold',
        color: '#714B67',
        letterSpacing: 0.5,
    },
    residualValue: {
        fontSize: 18,
        fontWeight: '900',
        color: '#714B67',
    },
    totalLabel: {
        fontSize: 11,
        color: '#9CA3AF',
        marginTop: 2,
    },
    headerBottom: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-end',
        borderTopWidth: 1,
        borderTopColor: '#F3F4FB',
        paddingTop: 10,
    },
    dateInfo: {
        flex: 1,
    },
    dateRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    dateText: {
        fontSize: 12,
        color: '#6B7280',
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
        marginLeft: 8,
        flex: 1,
    },
    lineDetailRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: 4,
    },
    lineQty: {
        fontSize: 13,
        color: '#6B7280',
    },
    lineAmount: {
        fontSize: 14,
        fontWeight: 'bold',
        color: '#111827',
    },
    accountingRow: {
        flexDirection: 'row',
        marginTop: 2,
    },
    accountingLabel: {
        fontSize: 11,
        color: '#9CA3AF',
        fontStyle: 'italic',
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

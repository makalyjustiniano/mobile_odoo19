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
    UIManager,
    Modal,
    ScrollView,
    TextInput
} from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { callOdoo } from '../../src/api/odooClient';
import { useConfigStore } from '../../src/store/configStore';
import * as db from '../../src/services/dbService';
import { getSiatDomain } from '../../src/utils/permissionUtils';
import { useAuthStore } from '../../src/store/authStore';
import ListFilters, { DateFilterType } from '../../src/components/ListFilters';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
    UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface InvoiceLine {
    id: number;
    product_name: string;
    quantity: number;
    price_unit: number;
    price_subtotal: number;
    uom_name: string;
}

interface Invoice {
    id: number;
    name: string;
    partner_id: number;
    partner_name: string;
    invoice_date: string;
    invoice_date_due: string;
    amount_total: number;
    amount_residual: number;
    state: string;
    payment_state: string;
    move_type: string;
    siat_status: string;
    siat_url: string;
    siat_qr_content: string;
    siat_cuf: string;
    invoice_user_name: string;
    // UI state
    expanded?: boolean;
    lines?: InvoiceLine[];
    loadingLines?: boolean;
}

export default function CarteraScreen() {
    const [invoices, setInvoices] = useState<Invoice[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [searchText, setSearchText] = useState('');
    
    // Filters state
    const [limit, setLimit] = useState<number>(100);
    const [offset, setOffset] = useState<number>(0);
    const [totalCount, setTotalCount] = useState<number>(0);
    const [dateFilter, setDateFilter] = useState<DateFilterType>('All');
    
    const isOffline = useConfigStore((state) => state.isOffline);

    const handleNextPage = () => {
        if (offset + limit < totalCount) {
            setOffset(offset + limit);
            fetchInvoices(false, offset + limit);
        }
    };

    const handlePrevPage = () => {
        const newOffset = Math.max(0, offset - limit);
        if (newOffset !== offset) {
            setOffset(newOffset);
            fetchInvoices(false, newOffset);
        }
    };

    const fetchInvoices = async (isPullToRefresh = false, customOffset?: number) => {
        const currentOffset = customOffset !== undefined ? customOffset : (isPullToRefresh ? 0 : offset);
        if (isPullToRefresh) setOffset(0);
        try {
            setLoading(true);
            // Load from SQLite (Pendings only as requested: amount_residual > 0)
            const localData = await db.getAccountMoves();
            const pendingOnly = (localData as any[]).filter(m => m.amount_residual > 0 && m.state === 'posted');
            setInvoices(pendingOnly);
            setLoading(false);

            if (!isOffline) {
                try {
                    const user = useAuthStore.getState().user;
                    const domain = getSiatDomain('account.move', user);
                    const result = await callOdoo('account.move', 'search_read', {
                        domain: domain,
                        fields: [
                            'name', 'partner_id', 'move_type', 'state', 'payment_state',
                            'invoice_date', 'invoice_date_due', 'amount_total',
                            'amount_residual', 'invoice_line_ids', 'invoice_user_id', 
                            'siat_estado', 'siat_qr_string', 'siat_qr_image', 'siat_cuf'
                        ],
                        limit: limit,
                        offset: currentOffset,
                        order: 'id desc'
                    }, true);

                    const count: number = await callOdoo('account.move', 'search_count', {
                        domain: domain
                    }, true);
                    setTotalCount(count);

                    if (result && Array.isArray(result)) {
                        await db.saveAccountMoves(result);
                        const updated = await db.getAccountMoves();
                        setInvoices((updated as any[]).filter(m => m.amount_residual > 0 && m.state === 'posted'));
                    }
                } catch (e) {
                    console.warn('Sync failed, using offline data');
                }
            }
        } catch (error) {
            console.error('Error fetching carteras:', error);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    useEffect(() => {
        fetchInvoices();
    }, [isOffline]);

    const onRefresh = () => {
        setRefreshing(true);
        fetchInvoices();
    };

    const toggleExpand = async (invoiceId: number) => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setInvoices(prev => prev.map(inv => {
            if (inv.id === invoiceId) {
                const isExpanding = !inv.expanded;
                return { ...inv, expanded: isExpanding };
            }
            return inv;
        }));

        // Load lines if expanding and not loaded
        const current = invoices.find(i => i.id === invoiceId);
        if (current && !current.expanded && (!current.lines || current.lines.length === 0)) {
            try {
                setInvoices(prev => prev.map(i => i.id === invoiceId ? { ...i, loadingLines: true } : i));
                const lines = await db.getAccountMoveLines(invoiceId);
                setInvoices(prev => prev.map(i => i.id === invoiceId ? { ...i, lines: lines as any[], loadingLines: false } : i));
            } catch (e) {
                setInvoices(prev => prev.map(i => i.id === invoiceId ? { ...i, loadingLines: false } : i));
            }
        }
    };

    const filteredInvoices = invoices.filter(inv => 
        inv.name.toLowerCase().includes(searchText.toLowerCase()) || 
        inv.partner_name.toLowerCase().includes(searchText.toLowerCase())
    );

    const getPaymentBadge = (state: string) => {
        switch (state) {
            // Updated states for Odoo 17+ / mobile logic
            case 'paid': return { label: 'PAGADO', color: '#10B981', bg: '#D1FAE5' };
            case 'partial': return { label: 'PARCIAL', color: '#F59E0B', bg: '#FEF3C7' };
            case 'not_paid': return { label: 'PENDIENTE', color: '#EF4444', bg: '#FEE2E2' };
            case 'in_payment': return { label: 'EN PAGO', color: '#3B82F6', bg: '#DBEAFE' };
            default: return { label: 'POSTEADO', color: '#6B7280', bg: '#F3F4FB' };
        }
    };

    const renderItem = ({ item }: { item: Invoice }) => {
        const badge = getPaymentBadge(item.payment_state);
        return (
            <View style={[styles.card, item.expanded && styles.cardExpanded]}>
                <TouchableOpacity 
                    style={styles.cardHeader} 
                    onPress={() => toggleExpand(item.id)}
                    activeOpacity={0.7}
                >
                    <View style={styles.topInfo}>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.invoiceName}>{item.name}</Text>
                            <Text style={styles.partnerName}>{item.partner_name}</Text>
                            <View style={styles.userRow}>
                                <FontAwesome name="user-circle" size={10} color="#6B7280" />
                                <Text style={styles.userName}> {item.invoice_user_name}</Text>
                            </View>
                        </View>
                        <View style={[styles.badge, { backgroundColor: badge.bg }]}>
                            <Text style={[styles.badgeText, { color: badge.color }]}>{badge.label}</Text>
                        </View>
                    </View>
                    
                    <View style={styles.amountGrid}>
                        <View>
                            <Text style={styles.amountLabel}>SALDO PENDIENTE</Text>
                            <Text style={styles.amountMain}>Bs. {item.amount_residual.toFixed(2)}</Text>
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                            <Text style={styles.amountLabel}>TOTAL FACTURA</Text>
                            <Text style={styles.amountTotal}>Bs. {item.amount_total.toFixed(2)}</Text>
                        </View>
                    </View>

                    <View style={styles.footer}>
                        <View style={styles.footerItem}>
                            <FontAwesome name="calendar" size={12} color="#6B7280" />
                            <Text style={styles.footerText}> {item.invoice_date}</Text>
                        </View>
                        <View style={styles.footerItem}>
                            <FontAwesome name="clock-o" size={12} color={new Date(item.invoice_date_due) < new Date() ? '#EF4444' : '#6B7280'} />
                            <Text style={[styles.footerText, new Date(item.invoice_date_due) < new Date() && { color: '#EF4444', fontWeight: 'bold' }]}> Vence: {item.invoice_date_due}</Text>
                        </View>
                    </View>
                </TouchableOpacity>

                {item.expanded && (
                    <View style={styles.detailSection}>
                        <View style={styles.divider} />
                        <Text style={styles.detailTitle}>LÍNEAS DE FACTURA</Text>
                        {item.loadingLines ? (
                            <ActivityIndicator size="small" color="#00A09D" style={{ margin: 10 }} />
                        ) : item.lines && item.lines.length > 0 ? (
                            item.lines.map(line => (
                                <View key={line.id} style={styles.lineRow}>
                                    <Text style={styles.lineProduct}>{line.product_name}</Text>
                                    <View style={styles.linePricing}>
                                        <Text style={styles.lineQty}>{line.quantity} x Bs. {line.price_unit.toFixed(2)}</Text>
                                        <Text style={styles.lineSub}>Bs. {line.price_subtotal.toFixed(2)}</Text>
                                    </View>
                                </View>
                            ))
                        ) : (
                            <Text style={styles.noLines}>Sin detalles disponibles offline</Text>
                        )}

                        {!!item.siat_cuf && (
                            <View style={styles.siatBox}>
                                <View style={styles.siatHeader}>
                                    <FontAwesome name="shield" size={14} color="#00A09D" />
                                    <Text style={styles.siatTitle}> INFORMACIÓN FISCAL (SIAT)</Text>
                                </View>
                                <Text style={styles.siatText} numberOfLines={1} ellipsizeMode="middle">CUF: {item.siat_cuf}</Text>
                                <Text style={styles.siatText}>Estado: {item.siat_status.toUpperCase()}</Text>
                            </View>
                        )}
                    </View>
                )}
            </View>
        );
    };

    if (loading && !refreshing) {
        return (
            <View style={styles.center}>
                <ActivityIndicator size="large" color="#00A09D" />
                <Text style={{ marginTop: 10, color: '#6B7280' }}>Cargando Cartera...</Text>
            </View>
        );
    }

    const totalPortfolio = filteredInvoices.reduce((acc, inv) => acc + inv.amount_residual, 0);

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <View style={styles.headerTitleRow}>
                    <View>
                        <Text style={styles.headerTitle}>Cuentas por Cobrar</Text>
                        <Text style={styles.headerSubText}>{filteredInvoices.length} facturas con saldo</Text>
                    </View>
                    <View style={styles.totalBox}>
                        <Text style={styles.totalLabel}>CARTERA TOTAL</Text>
                        <Text style={styles.totalValue}>Bs. {totalPortfolio.toLocaleString([], { minimumFractionDigits: 2 })}</Text>
                    </View>
                </View>

                <View style={styles.searchContainer}>
                    <FontAwesome name="search" size={14} color="#9CA3AF" style={styles.searchIcon} />
                    <TextInput 
                        style={styles.searchInput}
                        placeholder="Buscar cliente o factura..."
                        value={searchText}
                        onChangeText={setSearchText}
                    />
                </View>
            </View>

            <ListFilters
                limit={limit}
                setLimit={(v) => { setLimit(v); setOffset(0); }}
                dateFilter={dateFilter}
                setDateFilter={(v) => { setDateFilter(v); setOffset(0); }}
                onApply={() => { setOffset(0); fetchInvoices(false); }}
                showDateFilter={false}
                disabled={isOffline || useAuthStore.getState().isAuditMode}
                offset={offset}
                totalCount={totalCount}
                onNextPage={handleNextPage}
                onPrevPage={handlePrevPage}
            />

            <FlatList
                data={filteredInvoices}
                renderItem={renderItem}
                keyExtractor={item => item.id.toString()}
                contentContainerStyle={styles.list}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
                ListEmptyComponent={
                    <View style={styles.empty}>
                        <FontAwesome name="check-circle" size={60} color="#D1D5DB" />
                        <Text style={styles.emptyText}>No hay facturas con saldo pendiente</Text>
                    </View>
                }
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#F9FAFB' },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    header: { padding: 20, paddingTop: 10, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
    headerTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 },
    headerTitle: { fontSize: 20, fontWeight: 'bold', color: '#111827' },
    headerSubText: { fontSize: 13, color: '#6B7280' },
    totalBox: { alignItems: 'flex-end', backgroundColor: '#E6F6F5', padding: 10, borderRadius: 12 },
    totalLabel: { fontSize: 9, fontWeight: 'bold', color: '#00A09D', letterSpacing: 0.5 },
    totalValue: { fontSize: 18, fontWeight: '900', color: '#00A09D' },
    searchContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F3F4F6', borderRadius: 10, paddingHorizontal: 15 },
    searchIcon: { marginRight: 10 },
    searchInput: { flex: 1, height: 40, fontSize: 14 },
    list: { padding: 15, paddingBottom: 40 },
    card: { backgroundColor: '#fff', borderRadius: 15, marginBottom: 12, elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 3, overflow: 'hidden' },
    cardExpanded: { borderWidth: 1, borderColor: '#00A09D' },
    cardHeader: { padding: 15 },
    topInfo: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
    invoiceName: { fontSize: 16, fontWeight: 'bold', color: '#111827' },
    partnerName: { fontSize: 13, color: '#00A09D', fontWeight: '600' },
    userRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
    userName: { fontSize: 11, color: '#6B7280', fontStyle: 'italic' },
    badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
    badgeText: { fontSize: 10, fontWeight: 'bold' },
    amountGrid: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 15 },
    amountLabel: { fontSize: 9, color: '#9CA3AF', fontWeight: 'bold', marginBottom: 4 },
    amountMain: { fontSize: 18, fontWeight: 'bold', color: '#EF4444' },
    amountTotal: { fontSize: 15, fontWeight: '600', color: '#374151' },
    footer: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: '#F3F4F6', paddingTop: 10 },
    footerItem: { flexDirection: 'row', alignItems: 'center' },
    footerText: { fontSize: 11, color: '#6B7280', marginLeft: 5 },
    detailSection: { padding: 15, paddingTop: 0, backgroundColor: '#FAFAFA' },
    divider: { height: 1, backgroundColor: '#E5E7EB', marginBottom: 15 },
    detailTitle: { fontSize: 10, fontWeight: 'bold', color: '#9CA3AF', marginBottom: 10, letterSpacing: 1 },
    lineRow: { marginBottom: 10 },
    lineProduct: { fontSize: 13, color: '#374151', fontWeight: '500' },
    linePricing: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
    lineQty: { fontSize: 12, color: '#6B7280' },
    lineSub: { fontSize: 13, fontWeight: 'bold', color: '#111827' },
    noLines: { textAlign: 'center', fontSize: 12, color: '#9CA3AF', padding: 10 },
    siatBox: { marginTop: 15, backgroundColor: '#F3F4FB', padding: 10, borderRadius: 8, borderLeftWidth: 3, borderLeftColor: '#00A09D' },
    siatHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 5 },
    siatTitle: { fontSize: 11, fontWeight: 'bold', color: '#1F2937' },
    siatText: { fontSize: 11, color: '#4B5563', marginTop: 2 },
    empty: { alignItems: 'center', marginTop: 100 },
    emptyText: { marginTop: 15, fontSize: 16, color: '#9CA3AF' }
});

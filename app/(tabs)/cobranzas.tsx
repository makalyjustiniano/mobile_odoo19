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
    TextInput,
    Alert,
    ScrollView
} from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { callOdoo } from '../../src/api/odooClient';
import { useConfigStore } from '../../src/store/configStore';
import * as db from '../../src/services/dbService';

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
    const [journals, setJournals] = useState<any[]>([]);
    const [paymentModalVisible, setPaymentModalVisible] = useState(false);
    const [selectedInvoice, setSelectedInvoice] = useState<AccountMove | null>(null);
    const [paymentAmount, setPaymentAmount] = useState('');
    const [selectedJournal, setSelectedJournal] = useState<number | null>(null);
    const [paymentMemo, setPaymentMemo] = useState('');
    const [submittingPayment, setSubmittingPayment] = useState(false);

    const isOffline = useConfigStore((state) => state.isOffline);

    const fetchInvoices = async () => {
        try {
            await db.initDB();
            setLoading(true);

            if (isOffline) {
                console.log('Fetching invoices from SQLite...');
                const localData = await db.getAccountMoves();
                setInvoices(localData as any);
                return;
            }

            console.log('Fetching invoices from Odoo...');
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

    const fetchJournals = async () => {
        try {
            const data: any = await db.getJournals();
            if (data && data.length > 0) {
                setJournals(data);
                setSelectedJournal(data[0].id);
            }
        } catch (error) {
            console.error('Error fetching journals:', error);
        }
    };

    const openPaymentModal = (invoice: AccountMove) => {
        setSelectedInvoice(invoice);
        setPaymentAmount(invoice.amount_residual.toString());
        setPaymentMemo(`Pago de ${invoice.name}`);
        setPaymentModalVisible(true);
    };

    const handleRegisterPayment = async () => {
        if (!selectedInvoice || !selectedJournal || !paymentAmount) {
            Alert.alert('Error', 'Por favor complete todos los campos');
            return;
        }

        const amountNum = parseFloat(paymentAmount);
        if (isNaN(amountNum) || amountNum <= 0) {
            Alert.alert('Error', 'Monto inválido');
            return;
        }

        if (amountNum > selectedInvoice.amount_residual + 0.01) {
            Alert.alert('Error', 'El monto no puede superar el saldo pendiente');
            return;
        }

        try {
            setSubmittingPayment(true);
            
            let syncStatus: 'new' | 'synced' = 'new';
            let odooPaymentId: number | null = null;

            if (!isOffline) {
                // Online registration via Odoo wizard to ensure reconciliation
                try {
                    const wizContext = {
                        active_model: 'account.move',
                        active_ids: [selectedInvoice.id]
                    };
                    const wizVals = {
                        amount: amountNum,
                        payment_date: new Date().toISOString().split('T')[0],
                        journal_id: selectedJournal,
                        communication: paymentMemo || `Pago desde móvil`
                    };

                    const wizRes: any = await callOdoo('account.payment.register', 'create', {
                        vals_list: [wizVals],
                        context: wizContext
                    });

                    const wizId = Array.isArray(wizRes) ? (wizRes[0].id || wizRes[0]) : (wizRes.id || wizRes);

                    if (wizId) {
                        const payRes: any = await callOdoo('account.payment.register', 'action_create_payments', {
                            ids: [wizId],
                            context: wizContext
                        });
                        odooPaymentId = payRes && payRes.res_id ? payRes.res_id : wizId;
                        syncStatus = 'synced';
                    }
                } catch (onlineErr: any) {
                    console.error('Error in online payment registration:', onlineErr);
                    // Fallback to local only if online fails (app will sync later)
                    Alert.alert('Aviso', 'No se pudo registrar en Odoo, se guardará localmente para sincronizar luego.');
                }
            }

            await db.saveLocalPayment({
                id: odooPaymentId, // If syncStatus is 'synced', we use this ID
                amount: amountNum,
                payment_date: new Date().toISOString().split('T')[0],
                journal_id: selectedJournal,
                partner_id: (selectedInvoice.partner_id as any)[0],
                invoice_id: selectedInvoice.id,
                memo: paymentMemo,
                sync_status: syncStatus
            });

            setPaymentModalVisible(false);
            if (syncStatus === 'synced') {
                Alert.alert('Éxito', 'Pago registrado y conciliado en Odoo.');
            } else {
                Alert.alert('Éxito', 'Pago registrado localmente. Pendiente de sincronización.');
            }
            fetchInvoices();
        } catch (error: any) {
            console.error('Error registering payment:', error);
            Alert.alert('Error', 'No se pudo registrar el pago: ' + error.message);
        } finally {
            setSubmittingPayment(false);
        }
    };

    const fetchInvoiceLines = async (moveId: number) => {
        if (isOffline) return; // Lines are already loaded in getAccountMoves
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
        fetchJournals();
    }, [isOffline]);

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

                    <View style={styles.actionContainer}>
                        <TouchableOpacity 
                            style={styles.payButton}
                            onPress={() => openPaymentModal(item)}
                        >
                            <FontAwesome name="money" size={16} color="#fff" />
                            <Text style={styles.payButtonText}>Registrar Pago</Text>
                        </TouchableOpacity>
                    </View>
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

            {/* Payment Modal */}
            <Modal
                visible={paymentModalVisible}
                animationType="slide"
                transparent={true}
                onRequestClose={() => setPaymentModalVisible(false)}
            >
                <View style={styles.modalOverlay}>
                    <View style={styles.modalContent}>
                        <View style={styles.modalHeader}>
                            <Text style={styles.modalTitle}>Registrar Pago</Text>
                            <TouchableOpacity onPress={() => setPaymentModalVisible(false)}>
                                <FontAwesome name="times" size={20} color="#6B7280" />
                            </TouchableOpacity>
                        </View>

                        <ScrollView style={styles.modalForm}>
                            <Text style={styles.invoiceRef}>Factura: {selectedInvoice?.name}</Text>
                            
                            <Text style={styles.inputLabel}>Monto a Cobrar (Bs.)</Text>
                            <TextInput
                                style={styles.input}
                                value={paymentAmount}
                                onChangeText={setPaymentAmount}
                                keyboardType="numeric"
                                placeholder="0.00"
                            />

                            <Text style={styles.inputLabel}>Método de Pago</Text>
                            <View style={styles.journalsContainer}>
                                {journals.map((j: any) => (
                                    <TouchableOpacity 
                                        key={j.id}
                                        style={[
                                            styles.journalOption, 
                                            selectedJournal === j.id && styles.journalSelected
                                        ]}
                                        onPress={() => setSelectedJournal(j.id)}
                                    >
                                        <FontAwesome 
                                            name={j.type === 'bank' ? 'bank' : 'money'} 
                                            size={14} 
                                            color={selectedJournal === j.id ? '#fff' : '#714B67'} 
                                        />
                                        <Text style={[
                                            styles.journalText,
                                            selectedJournal === j.id && styles.journalTextSelected
                                        ]}>{j.name}</Text>
                                    </TouchableOpacity>
                                ))}
                            </View>

                            <Text style={styles.inputLabel}>Nota / Referencia</Text>
                            <TextInput
                                style={[styles.input, { height: 80, textAlignVertical: 'top' }]}
                                value={paymentMemo}
                                onChangeText={setPaymentMemo}
                                multiline={true}
                                placeholder="Ej: Pago en efectivo recibo #123"
                            />

                            <TouchableOpacity 
                                style={[styles.submitButton, submittingPayment && styles.buttonDisabled]}
                                onPress={handleRegisterPayment}
                                disabled={submittingPayment}
                            >
                                {submittingPayment ? (
                                    <ActivityIndicator color="#fff" />
                                ) : (
                                    <Text style={styles.submitButtonText}>Confirmar Cobro</Text>
                                )}
                            </TouchableOpacity>
                            
                            <View style={{ height: 20 }} />
                        </ScrollView>
                    </View>
                </View>
            </Modal>
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
    actionContainer: {
        marginTop: 15,
        borderTopWidth: 1,
        borderTopColor: '#E5E7EB',
        paddingTop: 15,
        alignItems: 'flex-end',
    },
    payButton: {
        backgroundColor: '#714B67',
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingVertical: 10,
        borderRadius: 10,
    },
    payButtonText: {
        color: '#fff',
        fontWeight: 'bold',
        marginLeft: 8,
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'flex-end',
    },
    modalContent: {
        backgroundColor: '#fff',
        borderTopLeftRadius: 25,
        borderTopRightRadius: 25,
        height: '80%',
        padding: 20,
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 20,
    },
    modalTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#111827',
    },
    modalForm: {
        flex: 1,
    },
    invoiceRef: {
        fontSize: 14,
        color: '#714B67',
        fontWeight: 'bold',
        marginBottom: 20,
        backgroundColor: '#F3F4FB',
        padding: 10,
        borderRadius: 8,
    },
    inputLabel: {
        fontSize: 14,
        fontWeight: '600',
        color: '#374151',
        marginBottom: 8,
    },
    input: {
        backgroundColor: '#F9FAFB',
        borderWidth: 1,
        borderColor: '#E5E7EB',
        borderRadius: 10,
        padding: 12,
        fontSize: 16,
        color: '#111827',
        marginBottom: 20,
    },
    journalsContainer: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        marginBottom: 20,
    },
    journalOption: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#F3F4FB',
        paddingHorizontal: 15,
        paddingVertical: 10,
        borderRadius: 20,
        marginRight: 10,
        marginBottom: 10,
        borderWidth: 1,
        borderColor: '#714B67',
    },
    journalSelected: {
        backgroundColor: '#714B67',
    },
    journalText: {
        color: '#714B67',
        marginLeft: 6,
        fontWeight: '600',
    },
    journalTextSelected: {
        color: '#fff',
    },
    submitButton: {
        backgroundColor: '#00A09D',
        padding: 15,
        borderRadius: 12,
        alignItems: 'center',
        marginTop: 10,
    },
    buttonDisabled: {
        opacity: 0.6,
    },
    submitButtonText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: 'bold',
    },
});

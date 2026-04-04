import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { Picker } from '@react-native-picker/picker';

export type DateFilterType = 'All' | 'Today' | '7Days' | '30Days';

interface ListFiltersProps {
    limit: number;
    setLimit: (val: number) => void;
    dateFilter: DateFilterType;
    setDateFilter: (val: DateFilterType) => void;
    onApply: () => void;
    disabled?: boolean;
    showDateFilter?: boolean;
    offset?: number;
    totalCount?: number;
    onNextPage?: () => void;
    onPrevPage?: () => void;
}

export default function ListFilters({ limit, setLimit, dateFilter, setDateFilter, onApply, disabled = false, showDateFilter = true, offset = 0, totalCount = 0, onNextPage, onPrevPage }: ListFiltersProps) {
    const fromVal = offset + 1;
    const toVal = Math.min(offset + limit, totalCount || offset + limit);

    return (
        <View style={styles.container}>
            {/* Cabecera de paginación */}
            <View style={styles.paginationHeader}>
                <Text style={styles.paginationText}>
                    {totalCount > 0 ? `${fromVal}-${toVal} de ${totalCount}` : `Mostrando ${limit} max`}
                </Text>
                <View style={styles.arrowControls}>
                    <TouchableOpacity 
                        style={styles.arrowBtn} 
                        onPress={onPrevPage} 
                        disabled={disabled || offset === 0}
                    >
                        <FontAwesome name="chevron-left" size={14} color={(disabled || offset === 0) ? "#D1D5DB" : "#4B5563"} />
                    </TouchableOpacity>
                    <TouchableOpacity 
                        style={styles.arrowBtn} 
                        onPress={onNextPage} 
                        disabled={disabled || totalCount === 0 || toVal >= totalCount}
                    >
                        <FontAwesome name="chevron-right" size={14} color={(disabled || totalCount === 0 || toVal >= totalCount) ? "#D1D5DB" : "#4B5563"} />
                    </TouchableOpacity>
                </View>
            </View>

            <View style={styles.row}>
                <View style={styles.filterBlock}>
                    <Text style={styles.label}>Mostrar:</Text>
                    <View style={styles.pickerContainer}>
                        <Picker
                            selectedValue={limit}
                            onValueChange={(itemValue) => setLimit(itemValue)}
                            enabled={!disabled}
                            style={styles.picker}
                        >
                            <Picker.Item label="50 Registros" value={50} />
                            <Picker.Item label="100 Registros" value={100} />
                            <Picker.Item label="200 Registros" value={200} />
                            <Picker.Item label="500 Registros" value={500} />
                            <Picker.Item label="1000 Registros" value={1000} />
                        </Picker>
                    </View>
                </View>
                {showDateFilter && (
                    <View style={styles.filterBlock}>
                        <Text style={styles.label}>Fecha:</Text>
                        <View style={styles.pickerContainer}>
                            <Picker
                                selectedValue={dateFilter}
                                onValueChange={(itemValue) => setDateFilter(itemValue)}
                                enabled={!disabled}
                                style={styles.picker}
                            >
                                <Picker.Item label="Hoy" value="Today" />
                                <Picker.Item label="Últimos 7 días" value="7Days" />
                                <Picker.Item label="Últimos 30 días" value="30Days" />
                                <Picker.Item label="Cualquier Fecha" value="All" />
                            </Picker>
                        </View>
                    </View>
                )}
            </View>
            <TouchableOpacity 
                style={[styles.applyBtn, disabled && { opacity: 0.5 }]} 
                onPress={onApply} 
                disabled={disabled}
            >
                <FontAwesome name="filter" size={14} color="#fff" />
                <Text style={styles.applyBtnText}>Aplicar Filtros</Text>
            </TouchableOpacity>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        backgroundColor: '#fff',
        padding: 12,
        marginHorizontal: 15,
        marginBottom: 10,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: '#E5E7EB',
        elevation: 1,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
    },
    row: {
        flexDirection: 'row',
        gap: 10,
        marginBottom: 10,
    },
    filterBlock: {
        flex: 1,
    },
    label: {
        fontSize: 12,
        color: '#6B7280',
        marginBottom: 4,
        fontWeight: 'bold',
    },
    pickerContainer: {
        backgroundColor: '#F9FAFB',
        borderWidth: 1,
        borderColor: '#D1D5DB',
        borderRadius: 8,
        height: 40,
        justifyContent: 'center',
        padding: 0,
        overflow: 'hidden'
    },
    picker: {
        width: '100%',
        color: '#374151',
    },
    applyBtn: {
        backgroundColor: '#714B67',
        padding: 10,
        borderRadius: 8,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
    },
    applyBtnText: {
        color: '#fff',
        fontWeight: 'bold',
        fontSize: 14,
    },
    paginationHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 10,
        paddingBottom: 8,
        borderBottomWidth: 1,
        borderBottomColor: '#F3F4F6',
    },
    paginationText: {
        fontSize: 12,
        color: '#6B7280',
        fontWeight: '500',
    },
    arrowControls: {
        flexDirection: 'row',
        gap: 15,
    },
    arrowBtn: {
        padding: 4,
        paddingHorizontal: 8,
    }
});

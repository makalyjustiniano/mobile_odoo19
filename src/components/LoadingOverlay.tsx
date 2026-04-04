import React from 'react';
import { Modal, View, Text, ActivityIndicator, StyleSheet } from 'react-native';

interface LoadingOverlayProps {
    visible: boolean;
    message?: string;
}

export const LoadingOverlay: React.FC<LoadingOverlayProps> = ({ visible, message = 'Cargando...' }) => {
    return (
        <Modal
            transparent={true}
            animationType="fade"
            visible={visible}
            onRequestClose={() => {}} // Bloquea el cierre con el botón atrás de Android
        >
            <View style={styles.overlay}>
                <View style={styles.container}>
                    <ActivityIndicator size="large" color="#00A09D" />
                    <Text style={styles.text}>{message}</Text>
                </View>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.4)', // Fondo oscuro translúcido
        justifyContent: 'center',
        alignItems: 'center',
    },
    container: {
        backgroundColor: '#FFFFFF',
        padding: 24,
        borderRadius: 16,
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 10,
        elevation: 8,
        minWidth: 150,
    },
    text: {
        marginTop: 16,
        fontSize: 14,
        color: '#4B5563',
        fontWeight: 'bold',
        textAlign: 'center',
    }
});

import { Text, View, StyleSheet } from 'react-native';

export default function CobranzasScreen() {
    return (
        <View style={styles.container}>
            <Text style={styles.title}>Cobranzas</Text>
            <Text style={styles.subtitle}>Gestión de pagos y créditos</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#f5f5f5',
    },
    title: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#714B67',
    },
    subtitle: {
        fontSize: 16,
        color: '#666',
        marginTop: 10,
    }
});

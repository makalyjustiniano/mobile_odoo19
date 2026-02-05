import { Text, View, StyleSheet } from 'react-native';

export default function StockScreen() {
    return (
        <View style={styles.container}>
            <Text style={styles.title}>Módulo de Stock</Text>
            <Text>Aquí podrás realizar tus ventas offline.</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    title: {
        fontSize: 22,
        fontWeight: 'bold',
        marginBottom: 10,
    },
});

import { Tabs, useRouter } from 'expo-router';
import { FontAwesome } from '@expo/vector-icons';
import { Pressable } from 'react-native';
import { useAuthStore } from '../../src/store/authStore';

export default function TabLayout() {
    const router = useRouter();
    const logout = useAuthStore((state) => state.logout);

    const handleLogout = () => {
        console.log('Ejecutando Logout...');
        logout(); // Limpiamos el estado global
        console.log('Estado limpiado, redirigiendo a /');
        router.replace('/');
    };

    return (
        <Tabs screenOptions={{
            tabBarActiveTintColor: '#007AFF',
            headerRight: () => (
                <Pressable onPress={handleLogout} style={{ marginRight: 15 }}>
                    <FontAwesome name="sign-out" size={24} color="#FF3B30" />
                </Pressable>
            ),
        }}>
            <Tabs.Screen
                name="home"
                options={{
                    title: 'Inicio',
                    tabBarIcon: ({ color }) => <FontAwesome name="th-large" size={24} color={color} />,
                }}
            />
            <Tabs.Screen
                name="clientes"
                options={{
                    title: 'Clientes',
                    tabBarIcon: ({ color }) => <FontAwesome name="users" size={24} color={color} />,
                }}
            />
            <Tabs.Screen
                name="ventas"
                options={{
                    title: 'Ventas',
                    tabBarIcon: ({ color }) => <FontAwesome name="shopping-cart" size={24} color={color} />,
                }}
            />
            <Tabs.Screen
                name="distribucion"
                options={{
                    title: 'Distribución',
                    tabBarIcon: ({ color }) => <FontAwesome name="truck" size={24} color={color} />,
                }}
            />
            <Tabs.Screen
                name="cobranzas"
                options={{
                    title: 'Cobranzas',
                    tabBarIcon: ({ color }) => <FontAwesome name="money" size={24} color={color} />,
                }}
            />

            <Tabs.Screen
                name="inventario"
                options={{
                    title: 'Inventario',
                    tabBarIcon: ({ color }) => <FontAwesome name="archive" size={24} color={color} />,
                }}
            />

            <Tabs.Screen
                name="configuracion"
                options={{
                    title: 'Ajustes',
                    tabBarIcon: ({ color }) => <FontAwesome name="cog" size={24} color={color} />,
                }}
            />
            {/* Opcionales/Existentes si se desean mantener */}

        </Tabs>
    );
}

import { Tabs, useRouter } from 'expo-router';
import { FontAwesome } from '@expo/vector-icons';
import { Pressable } from 'react-native';
import { useAuthStore } from '../../src/store/authStore';
import { useConfigStore } from '../../src/store/configStore';
import { View, Text } from 'react-native';

export default function TabLayout() {
    const router = useRouter();
    const logout = useAuthStore((state) => state.logout);
    const isOffline = useConfigStore((state) => state.isOffline);
    const toggleOffline = useConfigStore((state) => state.toggleOffline);

    const handleLogout = () => {
        console.log('Ejecutando Logout...');
        logout(); // Limpiamos el estado global
        console.log('Estado limpiado, redirigiendo a /');
        router.replace('/');
    };

    const user = useAuthStore((state) => state.user);
    const permissions = user?.permissions;

    return (
        <Tabs screenOptions={{
            tabBarActiveTintColor: '#007AFF',
            headerRight: () => (
                <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: 15 }}>
                     <Pressable 
                        onPress={toggleOffline} 
                        style={{ 
                            flexDirection: 'row', 
                            alignItems: 'center', 
                            backgroundColor: isOffline ? '#F3F4F6' : '#E6F6F5',
                            paddingHorizontal: 10,
                            paddingVertical: 5,
                            borderRadius: 20,
                            marginRight: 15,
                            borderWidth: 1,
                            borderColor: isOffline ? '#D1D5DB' : '#00A09D'
                        }}
                    >
                        <FontAwesome 
                            name={isOffline ? "cloud-download" : "cloud"} 
                            size={18} 
                            color={isOffline ? "#6B7280" : "#00A09D"} 
                        />
                        <Text style={{ 
                            marginLeft: 5, 
                            fontSize: 12, 
                            fontWeight: 'bold',
                            color: isOffline ? "#6B7280" : "#00A09D"
                        }}>
                            {isOffline ? 'OFFLINE' : 'ONLINE'}
                        </Text>
                    </Pressable>
                    <Pressable onPress={handleLogout}>
                        <FontAwesome name="sign-out" size={24} color="#FF3B30" />
                    </Pressable>
                </View>
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
                    href: permissions?.view_contacts ? undefined : null,
                    tabBarIcon: ({ color }) => <FontAwesome name="users" size={24} color={color} />,
                }}
            />
            <Tabs.Screen
                name="ventas"
                options={{
                    title: 'Ventas',
                    href: permissions?.view_sales ? undefined : null,
                    tabBarIcon: ({ color }) => <FontAwesome name="shopping-cart" size={24} color={color} />,
                }}
            />
            <Tabs.Screen
                name="distribucion"
                options={{
                    title: 'Distribución',
                    href: permissions?.view_pickings ? undefined : null,
                    tabBarIcon: ({ color }) => <FontAwesome name="truck" size={24} color={color} />,
                }}
            />
            <Tabs.Screen
                name="cobranzas"
                options={{
                    title: 'Cobranzas',
                    href: permissions?.view_receivables ? undefined : null,
                    tabBarIcon: ({ color }) => <FontAwesome name="money" size={24} color={color} />,
                }}
            />

            <Tabs.Screen
                name="cartera"
                options={{
                    title: 'Cartera',
                    href: permissions?.view_receivables ? undefined : null,
                    tabBarIcon: ({ color }) => <FontAwesome name="folder-open" size={24} color={color} />,
                }}
            />

            <Tabs.Screen
                name="inventario"
                options={{
                    title: 'Inventario',
                    href: permissions?.view_inventory ? undefined : null,
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
        </Tabs>
    );
}

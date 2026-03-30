import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { startAutoSync } from '../src/services/autoSyncService';

export default function RootLayout() {
  useEffect(() => {
    startAutoSync();
  }, []);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="(tabs)" />
    </Stack>
  );
}

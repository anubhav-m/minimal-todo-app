import { Stack } from 'expo-router';
import { AuthProvider } from '../context/AuthContext';
import { useColorScheme } from 'nativewind';
import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';

import '../global.css';

export default function RootLayout() {
  const { colorScheme } = useColorScheme();

  return (
    <AuthProvider>
      <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: 'transparent' },
        }}
      >
        <Stack.Screen name="index" />
      </Stack>
    </AuthProvider>
  );
}

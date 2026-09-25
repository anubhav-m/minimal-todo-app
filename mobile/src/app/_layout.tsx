import { Stack } from 'expo-router';
import { AuthProvider } from '../context/AuthContext';
import { useColorScheme } from 'nativewind';
import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';

import '../global.css';

import { View } from 'react-native';

export default function RootLayout() {
  const { colorScheme } = useColorScheme();

  return (
    <View style={{ flex: 1 }} className={colorScheme === 'dark' ? 'dark' : ''}>
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
    </View>
  );
}

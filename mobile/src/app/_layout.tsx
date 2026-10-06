import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { AuthProvider } from '../context/AuthContext';
import { useColorScheme } from 'nativewind';
import { StatusBar } from 'expo-status-bar';
import { loadThemePreference } from '../theme/themePreference';

import '../global.css';

export default function RootLayout() {
  const { colorScheme, setColorScheme } = useColorScheme();

  // The toggle's last choice outlives a restart; with none saved the system setting applies
  useEffect(() => {
    loadThemePreference().then(saved => {
      if (saved) setColorScheme(saved);
    });
  }, []);

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

import React from 'react';
import { View, Text, Pressable, ActivityIndicator, Image } from 'react-native';
import { useAuth } from '../context/AuthContext';
import TodoScreen from '../components/TodoScreen';
import GoogleIcon from '../components/GoogleIcon';
import { useThemeColors } from '../theme/colors';

export default function Index() {
  const { user, isLoading } = useAuth();
  const colors = useThemeColors();

  if (isLoading) {
    return (
      <View className="flex-1 justify-center items-center bg-background">
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return user ? <TodoScreen /> : <LoginScreen />;
}

function LoginScreen() {
  const { signIn, isSigningIn } = useAuth();
  const colors = useThemeColors();

  return (
    <View className="flex-1 items-center justify-center bg-background p-4">
      <View className="w-full max-w-sm bg-card p-6 rounded-2xl border border-border">
        <View className="items-center mb-8">
          <View className="flex-row items-center mb-2">
            <Image 
              source={require('../../assets/images/logo.png')} 
              style={{ width: 40, height: 40, marginRight: 12 }} 
              resizeMode="contain"
            />
            <Text className="text-4xl font-extrabold text-foreground tracking-tight">Todo</Text>
          </View>
          <Text className="text-sm text-muted-foreground text-center px-4 mt-2">
            Organize your days, track your priorities, and never miss a task again.
          </Text>
        </View>

        <Pressable 
          className={`w-full bg-primary py-4 rounded-full flex-row justify-center items-center ${isSigningIn ? 'opacity-70' : ''}`}
          onPress={signIn}
          disabled={isSigningIn}
          accessibilityRole="button"
          accessibilityLabel="Sign in with Google"
          accessibilityState={{ busy: isSigningIn, disabled: isSigningIn }}
        >
          {isSigningIn ? (
            <ActivityIndicator size="small" color={colors.primaryForeground} />
          ) : (
            <>
              <GoogleIcon size={20} />
              <Text className="text-primary-foreground font-semibold text-base ml-3">
                Sign in with Google
              </Text>
            </>
          )}
        </Pressable>

        <Text className="text-xs text-muted-foreground text-center mt-6">
          By continuing, you are setting up a secure workspace synced to your account.
        </Text>
      </View>
    </View>
  );
}

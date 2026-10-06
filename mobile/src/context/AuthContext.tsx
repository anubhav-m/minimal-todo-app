import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import { authenticate } from '../api/api';
import { TOKEN_KEY, clearSession, loadStoredUser, storeSession } from '../auth/session';

interface User {
  name: string;
  email: string;
  picture?: string;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isSigningIn: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Initialize Google Signin. This requires the Web Client ID from Google Cloud Console.
GoogleSignin.configure({
  webClientId: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID,
});

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSigningIn, setIsSigningIn] = useState(false);

  useEffect(() => {
    checkToken();
  }, []);

  const checkToken = async () => {
    try {
      // Signed in before: open straight away, with or without a connection.
      // The access token is refreshed when a request actually needs it.
      const stored = await loadStoredUser();
      if (stored) {
        setUser(stored);
        return;
      }

      // Signed in on a build that did not keep the profile: restore it through Google once
      const token = await AsyncStorage.getItem(TOKEN_KEY);
      if (token) {
        try {
          let account = GoogleSignin.getCurrentUser()?.user;
          if (!account) {
            const silent = await GoogleSignin.signInSilently();
            if (silent.type === 'success') account = silent.data.user;
          }
          if (account) {
            const restored = { name: account.name || 'User', email: account.email };
            const tokens = await GoogleSignin.getTokens().catch(() => null);
            await storeSession(restored, tokens?.accessToken ?? token);
            setUser(restored);
            return;
          }
        } catch (e) {
          // silent sign in failed
        }
      }

      // If we are here, we are not signed in
      await clearSession();
      setUser(null);
    } catch (error) {
      console.error('Error checking token:', error);
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  };

  const signIn = async () => {
    setIsSigningIn(true);
    try {
      await GoogleSignin.hasPlayServices();
      await GoogleSignin.signIn();
      const tokens = await GoogleSignin.getTokens();
      
      if (tokens.accessToken) {
        const res = await authenticate(tokens.accessToken);
        const signedIn = { name: res.user.name, email: res.user.email, picture: res.user.picture };
        await storeSession(signedIn, tokens.accessToken);
        setUser(signedIn);
      }
    } catch (error: any) {
      console.error('Raw Login Error:', error);
      
      if (error.code === statusCodes.SIGN_IN_CANCELLED || error.code === '12501') {
        Alert.alert('Sign In Cancelled', 'The sign in flow was cancelled. If you did not cancel it, please check your internet connection.');
      } else if (error.code === statusCodes.IN_PROGRESS) {
        Alert.alert('Please Wait', 'Sign in is already in progress.');
      } else if (error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        Alert.alert('Error', 'Google Play Services are not available on this device.');
      } else {
        const errorMessage = error.message || 'We could not sign you in. Please check your internet connection and try again.';
        Alert.alert(`Sign In Failed (${error.code || 'unknown'})`, errorMessage);
      }
    } finally {
      setIsSigningIn(false);
    }
  };

  const signOut = async () => {
    // Google's sign-out needs the network; leaving this device must not
    try {
      await GoogleSignin.signOut();
    } catch (error) {
      console.error('Sign out error:', error);
    }
    await clearSession().catch(() => {});
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, isSigningIn, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

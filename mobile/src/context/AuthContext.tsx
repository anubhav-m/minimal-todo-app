import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import { authenticate } from '../api/api';

interface User {
  name: string;
  email: string;
  picture?: string;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
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

  useEffect(() => {
    checkToken();
  }, []);

  const checkToken = async () => {
    try {
      const token = await AsyncStorage.getItem('todo_token');
      
      if (token) {
        // Just verify if Google still considers us signed in natively
        let userInfo = null;
        try {
          userInfo = GoogleSignin.getCurrentUser();
        } catch (e) {
          // ignore
        }

        // If we have a local token and Google still knows who we are, restore session
        if (userInfo) {
          try {
            const tokens = await GoogleSignin.getTokens();
            await AsyncStorage.setItem('todo_token', tokens.accessToken);
          } catch (e) {
            console.error('Failed to refresh tokens', e);
          }
          setUser({ name: userInfo.user.name || 'User', email: userInfo.user.email });
          setIsLoading(false);
          return;
        } else {
          // If getCurrentUser is null, try silent sign in to restore the session
          try {
            userInfo = await GoogleSignin.signInSilently();
            if (userInfo) {
              const tokens = await GoogleSignin.getTokens();
              await AsyncStorage.setItem('todo_token', tokens.accessToken);
              setUser({ name: userInfo.user.name || 'User', email: userInfo.user.email });
              setIsLoading(false);
              return;
            }
          } catch (e) {
            // silent sign in failed
          }
        }
      }
      
      // If we are here, we are not signed in
      await AsyncStorage.removeItem('todo_token');
      setUser(null);
    } catch (error) {
      console.error('Error checking token:', error);
      await AsyncStorage.removeItem('todo_token');
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  };

  const signIn = async () => {
    try {
      await GoogleSignin.hasPlayServices();
      const userInfo = await GoogleSignin.signIn();
      const tokens = await GoogleSignin.getTokens();
      
      if (tokens.accessToken) {
        const res = await authenticate(tokens.accessToken);
        await AsyncStorage.setItem('todo_token', tokens.accessToken);
        setUser(res.user);
      }
    } catch (error: any) {
      if (error.code === statusCodes.SIGN_IN_CANCELLED) {
        // user cancelled the login flow
      } else if (error.code === statusCodes.IN_PROGRESS) {
        // operation (e.g. sign in) is in progress already
      } else if (error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        // play services not available or outdated
      } else {
        console.error('Login error:', error);
      }
    }
  };

  const signOut = async () => {
    try {
      await GoogleSignin.signOut();
      await AsyncStorage.removeItem('todo_token');
      setUser(null);
    } catch (error) {
      console.error('Sign out error:', error);
    }
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, signIn, signOut }}>
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

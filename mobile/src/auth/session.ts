import AsyncStorage from '@react-native-async-storage/async-storage';
import { GoogleSignin } from '@react-native-google-signin/google-signin';

export const TOKEN_KEY = 'todo_token';
const USER_KEY = 'todo_user';

export interface StoredUser {
  name: string;
  email: string;
  picture?: string;
}

// The profile is kept on the device so a launch with no connection can still
// open the task list; Google is only needed again when a request is sent.
export const loadStoredUser = async (): Promise<StoredUser | null> => {
  try {
    const raw = await AsyncStorage.getItem(USER_KEY);
    const user = raw ? JSON.parse(raw) : null;
    return user && typeof user.email === 'string' ? user : null;
  } catch {
    return null;
  }
};

export const storeSession = async (user: StoredUser, accessToken: string) => {
  await AsyncStorage.multiSet([[USER_KEY, JSON.stringify(user)], [TOKEN_KEY, accessToken]]);
};

export const clearSession = async () => {
  await AsyncStorage.multiRemove([USER_KEY, TOKEN_KEY]);
};

// Gets a new Google access token and stores it. Throws when Google cannot be
// reached or no longer knows this account; the caller decides what that means.
export const refreshAccessToken = async (): Promise<string> => {
  const stale = await AsyncStorage.getItem(TOKEN_KEY).catch(() => null);
  // After a cold start the native module has no account until a silent sign-in
  if (!GoogleSignin.getCurrentUser()) {
    const silent = await GoogleSignin.signInSilently();
    if (silent.type !== 'success') throw new Error('Google session has ended');
  }
  // getTokens() hands back its cached token unless told that one is no longer good
  if (stale) await GoogleSignin.clearCachedAccessToken(stale).catch(() => {});
  const { accessToken } = await GoogleSignin.getTokens();
  await AsyncStorage.setItem(TOKEN_KEY, accessToken);
  return accessToken;
};

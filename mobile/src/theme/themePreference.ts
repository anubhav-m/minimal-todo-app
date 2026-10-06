import AsyncStorage from '@react-native-async-storage/async-storage';

const THEME_KEY = 'todo_theme';

export type ThemePreference = 'light' | 'dark';

// The theme the user picked with the toggle, or null to follow the system
export const loadThemePreference = async (): Promise<ThemePreference | null> => {
  const stored = await AsyncStorage.getItem(THEME_KEY).catch(() => null);
  return stored === 'light' || stored === 'dark' ? stored : null;
};

export const saveThemePreference = (theme: ThemePreference) =>
  AsyncStorage.setItem(THEME_KEY, theme).catch(() => {});

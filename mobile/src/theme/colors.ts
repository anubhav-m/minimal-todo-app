import { useColorScheme } from 'nativewind';

// The tokens in global.css as plain values, for the places that take a colour
// as a prop and cannot take a class: icons, placeholders, spinners, the calendar.
const light = {
  background: '#ffffff',
  card: '#ffffff',
  foreground: '#020817',
  muted: '#f1f5f9',
  mutedForeground: '#64748b',
  border: '#e2e8f0',
  primary: '#15754d',
  primaryForeground: '#ffffff',
  destructive: '#b81e1e',
  warning: '#a05408',
};

const dark: ThemeColors = {
  background: '#131211',
  card: '#1c1b19',
  foreground: '#efeeeb',
  muted: '#2a2927',
  mutedForeground: '#a5a29c',
  border: '#353431',
  primary: '#41c889',
  primaryForeground: '#0c1d14',
  destructive: '#ef756c',
  warning: '#f0b44c',
};

export type ThemeColors = typeof light;

export const useThemeColors = (): ThemeColors => {
  const { colorScheme } = useColorScheme();
  return colorScheme === 'dark' ? dark : light;
};

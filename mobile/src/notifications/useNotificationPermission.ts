import { useCallback, useEffect, useState } from 'react';
import { Alert, AppState, Linking } from 'react-native';
import * as Notifications from 'expo-notifications';

// Whether reminders can actually be delivered. Read at launch and again every
// time the app comes forward, because the user can change it in system settings.
export const useNotificationPermission = () => {
  // Assumed fine until the first read, so nothing flashes at launch
  const [granted, setGranted] = useState(true);

  const refresh = useCallback(async () => {
    const current = await Notifications.getPermissionsAsync().catch(() => null);
    if (current) setGranted(current.granted);
    return current;
  }, []);

  useEffect(() => {
    refresh();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  // Called when the user asks for a reminder. Shows the system prompt while it
  // can still be shown; after that the only way is system settings, so offer it.
  const ensure = useCallback(async (): Promise<boolean> => {
    const current = await refresh();
    if (current?.granted) return true;

    if (!current || current.canAskAgain) {
      const asked = await Notifications.requestPermissionsAsync().catch(() => null);
      if (asked) setGranted(asked.granted);
      if (asked?.granted) return true;
      // Declined just now: they have seen the prompt, no need for a second dialog
      if (asked?.canAskAgain) return false;
    }

    Alert.alert(
      'Notifications are off',
      'Todo cannot send reminders until notifications are allowed in system settings.',
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'Open settings', onPress: () => Linking.openSettings() },
      ]
    );
    return false;
  }, [refresh]);

  return { granted, ensure };
};

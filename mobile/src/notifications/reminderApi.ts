import * as Notifications from 'expo-notifications';
import type { ReminderApi } from './reminders';

export const reminderApi: ReminderApi = {
  schedule: ({ identifier, title, body, data, date }) =>
    Notifications.scheduleNotificationAsync({
      identifier,
      content: { title, body, data, sound: true },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date, // explicitly pass the absolute date object
        channelId: 'default',
      },
    }),
  cancel: (identifier) => Notifications.cancelScheduledNotificationAsync(identifier),
  getAllScheduled: async () => {
    const requests = await Notifications.getAllScheduledNotificationsAsync();
    return requests.map(r => ({ identifier: r.identifier, body: r.content.body, data: r.content.data }));
  },
};

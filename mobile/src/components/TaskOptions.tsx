import React, { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { format, parse } from 'date-fns';
import { Bell, BellOff, Clock, Flag, X } from 'lucide-react-native';
import { useThemeColors } from '../theme/colors';
import PrioritySelector from './PrioritySelector';

export const TIME_FORMAT = 'h:mm a';

export interface TaskOptionValues {
  time: Date | null;
  notify: boolean;
  priority: string;
}

interface TaskOptionsProps extends TaskOptionValues {
  // The day the task is on (yyyy-MM-dd); decides whether the chosen time is still ahead
  date: string;
  onChange: (changes: Partial<TaskOptionValues>) => void;
  // Resolves to whether reminders can be delivered; asks the user if needed
  onRequestReminder: () => Promise<boolean>;
  // Show the priority choices straight away instead of behind the chip
  priorityOpen?: boolean;
}

// Whether `time` on `date` is already behind us. Only the clock part of `time` is used.
export const hasTimePassed = (date: string, time: Date | null, now: Date = new Date()) => {
  if (!time) return false;
  const due = parse(`${date} ${format(time, 'HH:mm')}`, 'yyyy-MM-dd HH:mm', now);
  return due.getTime() < now.getTime();
};

// The optional parts of a task: time, reminder and priority. Used by both the
// add form and the edit dialog so the two cannot drift apart.
export default function TaskOptions({ date, time, notify, priority, onChange, onRequestReminder, priorityOpen = false }: TaskOptionsProps) {
  const colors = useThemeColors();
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [showPriority, setShowPriority] = useState(priorityOpen);

  const passed = hasTimePassed(date, time);
  const hasPriority = priority !== 'none';

  const toggleNotify = async () => {
    if (notify) onChange({ notify: false });
    else if (await onRequestReminder()) onChange({ notify: true });
  };

  return (
    <View>
      <View className="flex-row items-center flex-wrap gap-2">
        {time ? (
          <View className="flex-row items-center bg-muted border border-border rounded-full min-h-[44px]">
            <Pressable
              onPress={() => setShowTimePicker(true)}
              accessibilityRole="button"
              accessibilityLabel={`Time, ${format(time, TIME_FORMAT)}. Change`}
              className="flex-row items-center pl-4 pr-1 min-h-[44px]"
            >
              <Clock size={16} color={colors.foreground} />
              <Text className="text-sm font-semibold text-foreground ml-2">{format(time, TIME_FORMAT)}</Text>
            </Pressable>
            <Pressable
              onPress={() => onChange({ time: null, notify: false })}
              accessibilityRole="button"
              accessibilityLabel="Remove time"
              className="w-11 min-h-[44px] items-center justify-center"
            >
              <X size={16} color={colors.mutedForeground} />
            </Pressable>
          </View>
        ) : (
          <Pressable
            onPress={() => setShowTimePicker(true)}
            accessibilityRole="button"
            accessibilityLabel="Add a time"
            className="flex-row items-center bg-muted px-4 min-h-[44px] rounded-full border border-border"
          >
            <Clock size={16} color={colors.mutedForeground} />
            <Text className="text-sm font-semibold text-muted-foreground ml-2">Time</Text>
          </Pressable>
        )}

        {time && (
          <Pressable
            onPress={toggleNotify}
            disabled={passed}
            accessibilityRole="switch"
            accessibilityState={{ checked: notify, disabled: passed }}
            accessibilityLabel="Remind me at this time"
            className={`flex-row items-center px-4 min-h-[44px] rounded-full border ${notify ? 'border-primary bg-background' : 'border-border bg-muted'} ${passed ? 'opacity-50' : ''}`}
          >
            {notify ? <Bell size={16} color={colors.primary} /> : <BellOff size={16} color={colors.mutedForeground} />}
            <Text className={`text-sm font-semibold ml-2 ${notify ? 'text-primary' : 'text-muted-foreground'}`}>
              {notify ? 'Reminder on' : 'Remind me'}
            </Text>
          </Pressable>
        )}

        {!priorityOpen && (
          <Pressable
            onPress={() => setShowPriority(!showPriority)}
            accessibilityRole="button"
            accessibilityState={{ expanded: showPriority }}
            accessibilityLabel={hasPriority ? `Priority, ${priority}. Change` : 'Add a priority'}
            className="flex-row items-center bg-muted px-4 min-h-[44px] rounded-full border border-border"
          >
            <Flag size={16} color={hasPriority ? colors.foreground : colors.mutedForeground} />
            <Text className={`text-sm font-semibold capitalize ml-2 ${hasPriority ? 'text-foreground' : 'text-muted-foreground'}`}>
              {hasPriority ? priority : 'Priority'}
            </Text>
          </Pressable>
        )}
      </View>

      {passed && (
        <Text className="text-xs text-muted-foreground mt-2">
          This time has already passed, so no reminder will be sent.
        </Text>
      )}

      {showPriority && (
        <View className="h-12 mt-3">
          {/* Tapping the selected priority again clears it */}
          <PrioritySelector
            selected={priority}
            onSelect={(p) => {
              onChange({ priority: p === priority ? 'none' : p });
              if (!priorityOpen) setShowPriority(false);
            }}
          />
        </View>
      )}

      {showTimePicker && (
        <DateTimePicker
          value={time || new Date()}
          mode="time"
          display="default"
          onChange={(event, selected) => {
            setShowTimePicker(false);
            if (event.type !== 'set' || !selected) return;
            // A time that has gone by is still a valid time for the task; it just cannot remind
            onChange(hasTimePassed(date, selected) ? { time: selected, notify: false } : { time: selected });
          }}
        />
      )}
    </View>
  );
}

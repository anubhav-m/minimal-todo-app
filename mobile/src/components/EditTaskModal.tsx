import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, Modal, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { format, parse } from 'date-fns';
import { CalendarDays } from 'lucide-react-native';
import { useThemeColors } from '../theme/colors';
import { toLocalDateString } from '../utils/localDate';
import TaskOptions, { TIME_FORMAT } from './TaskOptions';
import type { TaskOptionValues } from './TaskOptions';

interface EditableTask {
  text: string;
  date: string;
  time: string | null;
  notify: boolean;
  priority: string;
}

interface EditTaskModalProps {
  task: EditableTask;
  onSave: (changes: EditableTask) => void;
  // Resolves to whether reminders can be delivered; asks the user if needed
  onRequestReminder: () => Promise<boolean>;
  onClose: () => void;
}

// Same limit as the server; see backend/utils/taskValidation.js
export const MAX_TASK_TEXT = 1000;

const parseTime = (time: string | null): Date | null => {
  if (!time) return null;
  const parsed = parse(time, TIME_FORMAT, new Date());
  return isNaN(parsed.getTime()) ? null : parsed;
};

const parseLocalDate = (date: string) => parse(date, 'yyyy-MM-dd', new Date());

export default function EditTaskModal({ task, onSave, onRequestReminder, onClose }: EditTaskModalProps) {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState(task.text);
  const [date, setDate] = useState(task.date);
  const [options, setOptions] = useState<TaskOptionValues>(() => ({
    time: parseTime(task.time),
    notify: task.notify,
    priority: task.priority || 'none',
  }));
  const [showDatePicker, setShowDatePicker] = useState(false);

  const canSave = text.trim().length > 0;
  const edited: EditableTask = {
    text: text.trim(),
    date,
    time: options.time ? format(options.time, TIME_FORMAT) : null,
    notify: options.time ? options.notify : false,
    priority: options.priority,
  };
  const isDirty =
    edited.text !== task.text ||
    edited.date !== task.date ||
    edited.time !== task.time ||
    edited.notify !== task.notify ||
    edited.priority !== (task.priority || 'none');

  const save = () => {
    if (canSave) onSave(edited);
  };

  // The backdrop and the back button are easy to hit by accident; ask before dropping work
  const requestClose = () => {
    if (!isDirty) {
      onClose();
      return;
    }
    Alert.alert('Discard changes?', undefined, [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: onClose },
    ]);
  };

  const today = toLocalDateString();

  return (
    <Modal visible transparent animationType="fade" onRequestClose={requestClose}>
      {/* Anchored to the top so the keyboard cannot cover Save */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
        <Pressable
          accessible={false}
          className="flex-1 items-center bg-black/50 px-4"
          style={{ paddingTop: insets.top + 48 }}
          onPress={requestClose}
        >
          <Pressable accessible={false} accessibilityViewIsModal className="bg-card w-full max-w-[360px] p-6 rounded-2xl border border-border">
            <Text accessibilityRole="header" className="text-foreground font-bold text-lg mb-4">Edit task</Text>

            <View className="border border-input rounded-xl px-4 bg-background min-h-[56px] justify-center mb-4">
              <TextInput
                className="text-base text-foreground py-3 max-h-32"
                accessibilityLabel="Task"
                placeholder="Task"
                placeholderTextColor={colors.mutedForeground}
                value={text}
                onChangeText={setText}
                onSubmitEditing={save}
                submitBehavior="blurAndSubmit"
                returnKeyType="done"
                maxLength={MAX_TASK_TEXT}
                multiline
                autoFocus
              />
            </View>

            <Pressable
              onPress={() => setShowDatePicker(true)}
              accessibilityRole="button"
              accessibilityLabel={`Day, ${format(parseLocalDate(date), 'EEEE, MMMM d')}. Change`}
              className="flex-row items-center self-start bg-muted px-4 min-h-[44px] rounded-full border border-border mb-2"
            >
              <CalendarDays size={16} color={colors.foreground} />
              <Text className="text-sm font-semibold text-foreground ml-2">
                {date === today ? 'Today' : format(parseLocalDate(date), 'EEE, MMM d')}
              </Text>
            </Pressable>

            <View className="mb-6">
              <TaskOptions
                date={date}
                {...options}
                onChange={(changes) => setOptions(current => ({ ...current, ...changes }))}
                onRequestReminder={onRequestReminder}
                priorityOpen
              />
            </View>

            <View className="flex-row justify-end gap-3">
              <Pressable onPress={requestClose} accessibilityRole="button" className="px-5 min-h-[48px] justify-center rounded-xl bg-muted active:opacity-70">
                <Text className="text-sm font-semibold text-foreground">Cancel</Text>
              </Pressable>
              <Pressable
                onPress={save}
                disabled={!canSave}
                accessibilityRole="button"
                accessibilityState={{ disabled: !canSave }}
                className={`px-5 min-h-[48px] justify-center rounded-xl bg-primary active:opacity-80 ${canSave ? '' : 'opacity-50'}`}
              >
                <Text className="text-sm font-semibold text-primary-foreground">Save</Text>
              </Pressable>
            </View>

            {showDatePicker && (
              <DateTimePicker
                value={parseLocalDate(date)}
                mode="date"
                display="default"
                // Tasks cannot be put on a day that is over
                minimumDate={date < today ? parseLocalDate(date) : parseLocalDate(today)}
                onChange={(event, selected) => {
                  setShowDatePicker(false);
                  if (event.type === 'set' && selected) setDate(toLocalDateString(selected));
                }}
              />
            )}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

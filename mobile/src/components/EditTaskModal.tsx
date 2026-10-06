import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, Modal } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { format, parse } from 'date-fns';
import { Bell, BellOff } from 'lucide-react-native';
import { useColorScheme } from 'nativewind';
import PrioritySelector from './PrioritySelector';

interface EditableTask {
  text: string;
  time: string | null;
  notify: boolean;
  priority: string;
}

interface EditTaskModalProps {
  task: EditableTask;
  onSave: (changes: EditableTask) => void;
  onClose: () => void;
}

const TIME_FORMAT = 'h:mm a';

const parseTime = (time: string | null): Date | null => {
  if (!time) return null;
  const parsed = parse(time, TIME_FORMAT, new Date());
  return isNaN(parsed.getTime()) ? null : parsed;
};

export default function EditTaskModal({ task, onSave, onClose }: EditTaskModalProps) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const [text, setText] = useState(task.text);
  const [time, setTime] = useState<Date | null>(() => parseTime(task.time));
  const [notify, setNotify] = useState(task.notify);
  const [priority, setPriority] = useState(task.priority || 'none');
  const [showTimePicker, setShowTimePicker] = useState(false);

  const canSave = text.trim().length > 0;

  const save = () => {
    if (!canSave) return;
    onSave({
      text: text.trim(),
      time: time ? format(time, TIME_FORMAT) : null,
      notify: time ? notify : false,
      priority,
    });
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 justify-center items-center bg-black/50 p-4" onPress={onClose}>
        <Pressable className="bg-card w-full max-w-[360px] p-6 rounded-2xl border border-border">
          <Text className="text-foreground font-bold text-lg mb-4">Edit task</Text>

          <View className="border border-input rounded-xl px-4 bg-background h-14 justify-center mb-4">
            <TextInput
              className="flex-1 text-base text-foreground"
              placeholder="Task"
              placeholderTextColor={isDark ? '#94a3b8' : '#64748b'}
              value={text}
              onChangeText={setText}
              onSubmitEditing={save}
              autoFocus
            />
          </View>

          <View className="flex-row items-center mb-4">
            {time ? (
              <View className="flex-row items-center bg-muted border border-border rounded-full pl-4 pr-1.5 h-10">
                <Pressable onPress={() => setShowTimePicker(true)} hitSlop={10}>
                  <Text className="text-sm font-semibold text-foreground mr-2">{format(time, TIME_FORMAT)}</Text>
                </Pressable>
                <Pressable onPress={() => setNotify(!notify)} className="p-1 mr-1" hitSlop={10}>
                  {notify ? (
                    <Bell size={16} color={isDark ? '#3b82f6' : '#2563eb'} />
                  ) : (
                    <BellOff size={16} color={isDark ? '#64748b' : '#94a3b8'} />
                  )}
                </Pressable>
                <Pressable
                  onPress={() => {
                    setTime(null);
                    setNotify(false);
                  }}
                  className="w-6 h-6 items-center justify-center bg-background rounded-full"
                >
                  <Text className="text-muted-foreground font-bold text-xs leading-none">✕</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable
                onPress={() => setShowTimePicker(true)}
                className="bg-muted px-4 h-10 justify-center rounded-full border border-border"
              >
                <Text numberOfLines={1} className="text-sm font-semibold text-muted-foreground">+ Time</Text>
              </Pressable>
            )}
          </View>

          <View className="h-12 mb-6">
            {/* Tapping the selected priority again clears it */}
            <PrioritySelector selected={priority} onSelect={(p) => setPriority(p === priority ? 'none' : p)} />
          </View>

          <View className="flex-row justify-end gap-3">
            <Pressable onPress={onClose} className="px-5 h-11 justify-center rounded-xl bg-muted">
              <Text className="text-sm font-semibold text-foreground">Cancel</Text>
            </Pressable>
            <Pressable
              onPress={save}
              disabled={!canSave}
              className={`px-5 h-11 justify-center rounded-xl bg-primary ${canSave ? '' : 'opacity-50'}`}
            >
              <Text className="text-sm font-semibold text-primary-foreground">Save</Text>
            </Pressable>
          </View>

          {showTimePicker && (
            <DateTimePicker
              value={time || new Date()}
              mode="time"
              display="default"
              onChange={(event, selectedDate) => {
                setShowTimePicker(false);
                if (event.type === 'set' && selectedDate) setTime(selectedDate);
              }}
            />
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

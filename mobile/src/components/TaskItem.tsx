import React from 'react';
import { View, Text, Pressable, Alert, Vibration } from 'react-native';
import Checkbox from 'expo-checkbox';
import { Clock, Bell, CloudUpload, EllipsisVertical } from 'lucide-react-native';
import { useThemeColors } from '../theme/colors';

interface TaskItemProps {
  task: {
    text: string;
    priority?: string;
    time?: string | null;
    notify?: boolean;
    completed: boolean;
  };
  // Has changes the server has not confirmed yet
  pending?: boolean;
  // Still open after its time today has passed
  overdue?: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

const MENU_TITLE_LENGTH = 60;

export default function TaskItem({ task, pending, overdue, onToggle, onEdit, onDelete }: TaskItemProps) {
  const colors = useThemeColors();

  const priority = task.priority && task.priority !== 'none' ? task.priority : null;
  const priorityColor = priority === 'high' ? colors.destructive : priority === 'medium' ? colors.warning : colors.mutedForeground;
  const hasMeta = !!priority || !!task.time || pending;

  const toggle = () => {
    if (!task.completed) Vibration.vibrate(10);
    onToggle();
  };

  const openMenu = () => {
    const title = task.text.length > MENU_TITLE_LENGTH ? `${task.text.slice(0, MENU_TITLE_LENGTH)}…` : task.text;
    Alert.alert(
      title,
      undefined,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Edit", onPress: onEdit },
        { text: "Delete", style: "destructive", onPress: onDelete }
      ]
    );
  };

  const handleLongPress = () => {
    Vibration.vibrate(50);
    openMenu();
  };

  // Read out as one item; the parts below are not separate stops
  const label = [
    task.text,
    task.time ? (overdue ? `${task.time}, overdue` : task.time) : null,
    task.time && task.notify ? 'reminder on' : null,
    priority ? `${priority} priority` : null,
    pending ? 'waiting to sync' : null,
  ].filter(Boolean).join(', ');

  return (
    <View className="flex-row items-center bg-card pl-4 rounded-2xl border border-border mb-3">
      <Pressable
        onPress={toggle}
        onLongPress={handleLongPress}
        delayLongPress={400}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: task.completed }}
        accessibilityLabel={label}
        accessibilityActions={[{ name: 'edit', label: 'Edit' }, { name: 'delete', label: 'Delete' }]}
        onAccessibilityAction={event => {
          if (event.nativeEvent.actionName === 'edit') onEdit();
          if (event.nativeEvent.actionName === 'delete') onDelete();
        }}
        className="flex-1 flex-row py-4"
      >
        <View className="pt-0.5" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <Checkbox
            value={task.completed}
            onValueChange={toggle}
            color={task.completed ? colors.primary : colors.mutedForeground}
            className="rounded-md w-6 h-6 mr-3"
          />
        </View>

        <View className="flex-1 justify-center">
          <Text
            className={`text-base ${task.completed ? 'line-through text-muted-foreground' : 'text-foreground'}`}
          >
            {task.text}
          </Text>

          {hasMeta && (
            <View className="flex-row items-center mt-2 flex-wrap gap-x-4 gap-y-1">
              {task.time && (
                <View className="flex-row items-center">
                  <Clock size={12} color={overdue ? colors.destructive : colors.mutedForeground} />
                  <Text className={`text-xs ml-1 ${overdue ? 'text-destructive' : 'text-muted-foreground'}`}>
                    {overdue ? `${task.time} · overdue` : task.time}
                  </Text>
                  {task.notify && !task.completed && (
                    <View className="ml-1.5">
                      <Bell size={12} color={colors.primary} />
                    </View>
                  )}
                </View>
              )}

              {priority && (
                <View className="flex-row items-center">
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: priorityColor }} />
                  <Text className="text-xs text-muted-foreground capitalize ml-1.5">{priority}</Text>
                </View>
              )}

              {pending && (
                <View className="flex-row items-center">
                  <CloudUpload size={12} color={colors.mutedForeground} />
                  <Text className="text-xs text-muted-foreground ml-1">Waiting to sync</Text>
                </View>
              )}
            </View>
          )}
        </View>
      </Pressable>

      <Pressable
        onPress={openMenu}
        accessibilityRole="button"
        accessibilityLabel={`Edit or delete ${task.text}`}
        className="w-12 h-12 items-center justify-center rounded-full active:bg-muted"
      >
        <EllipsisVertical size={20} color={colors.mutedForeground} />
      </Pressable>
    </View>
  );
}

import React from 'react';
import { View, Text, Pressable } from 'react-native';
import Checkbox from 'expo-checkbox';
import { Trash2, Clock, Flag, Bell, BellOff } from 'lucide-react-native'; 
import { useColorScheme } from 'nativewind';

interface TaskItemProps {
  task: {
    _id: string;
    text: string;
    priority?: string;
    time?: string | null;
    notify?: boolean;
    completed: boolean;
  };
  onToggle: () => void;
  onDelete: () => void;
}

export default function TaskItem({ task, onToggle, onDelete }: TaskItemProps) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';

  const hasExtra = (task.priority && task.priority !== 'none') || task.time;

  return (
    <View className="flex-row items-center bg-card p-4 rounded-xl border border-border mb-3">
      <Pressable onPress={onToggle} className="flex-1 flex-row mr-2">
        <View className="pt-0.5">
          <Checkbox
            value={task.completed}
            onValueChange={onToggle}
            color={task.completed ? (isDark ? '#3b82f6' : '#0f172a') : undefined}
            className="rounded-md w-6 h-6 border-2 border-muted-foreground mr-3"
          />
        </View>
        
        <View className="flex-1 justify-center">
          <Text 
            className={`text-base ${task.completed ? 'line-through text-muted-foreground' : 'text-foreground'}`}
          >
            {task.text}
          </Text>
          
          {hasExtra && (
            <View className="flex-row items-center mt-2 flex-wrap gap-y-1">
              {task.time && (
                <View className="flex-row items-center mr-4">
                  <Clock size={12} color={isDark ? '#94a3b8' : '#64748b'} />
                  <Text className="text-xs text-muted-foreground ml-1 mr-1.5">{task.time}</Text>
                  {task.notify ? (
                    <Bell size={12} color={isDark ? '#3b82f6' : '#2563eb'} />
                  ) : (
                    <BellOff size={12} color={isDark ? '#64748b' : '#94a3b8'} />
                  )}
                </View>
              )}
              
              {task.priority && task.priority !== 'none' && (
                <View className="flex-row items-center">
                  <Text className="text-xs text-muted-foreground mr-1">
                    {task.priority === 'high' ? '🔴' : task.priority === 'medium' ? '🟠' : '🟢'}
                  </Text>
                  <Text className="text-xs text-muted-foreground capitalize">{task.priority}</Text>
                </View>
              )}
            </View>
          )}
        </View>
      </Pressable>

      <Pressable onPress={onDelete} className="p-2 ml-1">
        <Trash2 size={20} color="#ef4444" />
      </Pressable>
    </View>
  );
}

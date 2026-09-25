import React from 'react';
import { View, Text, Pressable } from 'react-native';
import Checkbox from 'expo-checkbox';
import { Trash2 } from 'lucide-react-native'; 

interface TaskItemProps {
  task: {
    _id: string;
    text: string;
    priority: string;
    completed: boolean;
  };
  onToggle: () => void;
  onDelete: () => void;
}

export default function TaskItem({ task, onToggle, onDelete }: TaskItemProps) {
  return (
    <View className="flex-row items-center bg-card p-4 rounded-xl border border-border mb-3">
      <Pressable onPress={onToggle} className="flex-1 flex-row items-center gap-3 mr-2">
        <Checkbox
          value={task.completed}
          onValueChange={onToggle}
          color={task.completed ? '#0f172a' : undefined}
          className="rounded-md w-6 h-6 border-2 border-muted-foreground mr-2"
        />
        
        <Text 
          className={`flex-1 text-base ${task.completed ? 'line-through text-muted-foreground' : 'text-foreground'}`}
        >
          {task.text}
        </Text>
        
        <View className={`px-3 py-1 rounded-full ${
            task.priority === 'high' ? 'bg-red-100 dark:bg-red-900' :
            task.priority === 'medium' ? 'bg-yellow-100 dark:bg-yellow-900' :
            'bg-green-100 dark:bg-green-900'
        }`}>
          <Text className={`text-xs font-semibold ${
            task.priority === 'high' ? 'text-red-800 dark:text-red-200' :
            task.priority === 'medium' ? 'text-yellow-800 dark:text-yellow-200' :
            'text-green-800 dark:text-green-200'
          }`}>
            {task.priority}
          </Text>
        </View>
      </Pressable>

      <Pressable onPress={onDelete} className="p-2">
        <Trash2 size={20} color="#ef4444" />
      </Pressable>
    </View>
  );
}

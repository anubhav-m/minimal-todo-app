import React from 'react';
import { View, Text, Pressable } from 'react-native';

interface PrioritySelectorProps {
  selected: string;
  onSelect: (priority: string) => void;
}

export default function PrioritySelector({ selected, onSelect }: PrioritySelectorProps) {
  const options = ['low', 'medium', 'high'];

  return (
    <View className="flex-1 flex-row bg-muted rounded-xl p-1">
      {options.map((option) => {
        const isSelected = selected === option;
        return (
          <Pressable
            key={option}
            onPress={() => onSelect(option)}
            className={`flex-1 items-center justify-center py-2 rounded-lg ${
              isSelected ? 'bg-background' : 'bg-transparent'
            }`}
          >
            <Text 
              className={`text-sm font-semibold capitalize ${
                isSelected ? 'text-foreground' : 'text-muted-foreground'
              }`}
            >
              {option}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

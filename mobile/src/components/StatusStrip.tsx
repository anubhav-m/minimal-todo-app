import React from 'react';
import { View, Text, Pressable } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { useThemeColors } from '../theme/colors';

interface StatusStripProps {
  icon: LucideIcon;
  tone?: 'muted' | 'warning' | 'destructive';
  text: string;
  // With an action the whole strip is a button and `action` names what it does
  action?: string;
  onPress?: () => void;
}

// One line under the header for something the user should know about the app's
// state: offline, a sync problem, reminders that cannot be delivered.
export default function StatusStrip({ icon: Icon, tone = 'muted', text, action, onPress }: StatusStripProps) {
  const colors = useThemeColors();
  const iconColor = tone === 'destructive' ? colors.destructive : tone === 'warning' ? colors.warning : colors.mutedForeground;

  const content = (
    <>
      <Icon size={16} color={iconColor} />
      <Text className={`flex-1 text-sm ml-2 ${tone === 'muted' ? 'text-muted-foreground' : 'text-foreground'}`}>{text}</Text>
      {action ? <Text className="text-sm font-semibold text-primary ml-3">{action}</Text> : null}
    </>
  );

  if (!onPress) {
    return (
      <View accessibilityLiveRegion="polite" className="flex-row items-center px-4 py-2 bg-muted border-b border-border">
        {content}
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={action ? `${text}. ${action}` : text}
      accessibilityLiveRegion="polite"
      className="flex-row items-center px-4 py-2 min-h-[48px] bg-muted border-b border-border active:opacity-70"
    >
      {content}
    </Pressable>
  );
}

import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, Pressable, FlatList, KeyboardAvoidingView, Platform, Modal, Image, Alert, PanResponder, Animated, Dimensions, ActivityIndicator, AccessibilityInfo, AppState, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Calendar } from 'react-native-calendars';
import * as Notifications from 'expo-notifications';
import { format, differenceInCalendarDays } from 'date-fns';
import { useAuth } from '../context/AuthContext';
import { useTasks } from '../sync/useTasks';
import { useNotificationPermission } from '../notifications/useNotificationPermission';
import { createDraft } from '../tasks/taskSync';
import { toLocalDateString } from '../utils/localDate';
import { getReminderDate } from '../notifications/reminders';
import TaskItem from './TaskItem';
import EditTaskModal, { MAX_TASK_TEXT } from './EditTaskModal';
import TaskOptions, { TIME_FORMAT } from './TaskOptions';
import type { TaskOptionValues } from './TaskOptions';
import StatusStrip from './StatusStrip';
import { LogOut, Moon, Sun, BellOff, ChevronLeft, ChevronRight, CloudOff, AlertCircle, Plus } from 'lucide-react-native';
import { useColorScheme } from 'nativewind';
import { useThemeColors } from '../theme/colors';
import { saveThemePreference } from '../theme/themePreference';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const NO_OPTIONS: TaskOptionValues = { time: null, notify: false, priority: 'none' };

// How long a delete can be taken back; longer when a screen reader has to get to the button
const UNDO_MS = 5000;
const UNDO_MS_SCREEN_READER = 15000;

// A sync shorter than this is not worth showing
const SPINNER_DELAY_MS = 1000;

export default function TodoScreen() {
  const { user, signOut, reauthenticate } = useAuth();
  const { colorScheme, setColorScheme } = useColorScheme();
  const colors = useThemeColors();
  // Everything below reads and writes the copy on this device; see useTasks
  const { tasks, pending, status, today, isLoading, addTask, toggleTask, editTask, deleteTask, syncNow, retryFailed, discardFailed, refreshReminders, forgetAccount } = useTasks(user!.email);
  const notifications = useNotificationPermission();
  const [date, setDate] = useState(new Date());
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [newTaskText, setNewTaskText] = useState('');
  const [newTaskOptions, setNewTaskOptions] = useState<TaskOptionValues>(NO_OPTIONS);
  const [isRefreshing, setIsRefreshing] = useState(false);
  // Deleted on screen but not yet for real; see requestDelete
  const [heldDelete, setHeldDelete] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showSpinner, setShowSpinner] = useState(false);
  const { width: SCREEN_WIDTH } = Dimensions.get('window');
  const insets = useSafeAreaInsets();

  const headerTranslateX = useRef(new Animated.Value(0)).current;
  const listTranslateX = useRef(new Animated.Value(0)).current;
  const draft = useRef(createDraft()).current;
  const shownToday = useRef(today);
  // Refs, not state: the swipe handler below is created once and would not see new state
  const isFlipping = useRef(false);
  const reduceMotion = useRef(false);
  const screenReader = useRef(false);
  const heldDeleteRef = useRef<string | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const changeNewTaskText = (text: string) => {
    draft.set(text);
    setNewTaskText(text);
  };

  const triggerSwipeAnimation = (direction: -1 | 1, updateDateFn: () => void) => {
    // Taps that arrive mid-slide would stack a second slide on the first
    if (isFlipping.current) return;
    if (reduceMotion.current) {
      updateDateFn();
      return;
    }
    isFlipping.current = true;
    Animated.parallel([
      Animated.timing(headerTranslateX, {
        toValue: direction * SCREEN_WIDTH * 0.8,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.timing(listTranslateX, {
        toValue: direction * SCREEN_WIDTH,
        duration: 150,
        useNativeDriver: true,
      })
    ]).start(() => {
      updateDateFn();
      headerTranslateX.setValue(-direction * SCREEN_WIDTH * 0.8);
      listTranslateX.setValue(-direction * SCREEN_WIDTH);
      
      Animated.parallel([
        Animated.timing(headerTranslateX, {
          toValue: 0,
          duration: 150,
          useNativeDriver: true,
        }),
        Animated.timing(listTranslateX, {
          toValue: 0,
          duration: 150,
          useNativeDriver: true,
        })
      ]).start(() => {
        isFlipping.current = false;
      });
    });
  };

  const goToNextDay = () => {
    triggerSwipeAnimation(-1, () => {
      setDate(current => {
        const nextDay = new Date(current);
        nextDay.setDate(nextDay.getDate() + 1);
        return nextDay;
      });
    });
  };

  const goToPreviousDay = () => {
    triggerSwipeAnimation(1, () => {
      setDate(current => {
        const prevDay = new Date(current);
        prevDay.setDate(prevDay.getDate() - 1);
        return prevDay;
      });
    });
  };

  const goToToday = () => {
    const direction = toLocalDateString(date) < today ? -1 : 1;
    triggerSwipeAnimation(direction, () => setDate(new Date()));
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        // Only trigger on clear horizontal swipes
        return Math.abs(gestureState.dx) > 30 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy);
      },
      onPanResponderRelease: (evt, gestureState) => {
        if (gestureState.dx > 50) {
          goToPreviousDay();
        } else if (gestureState.dx < -50) {
          goToNextDay();
        }
      },
    })
  ).current;

  // Permission is not asked for here: it is asked for when a reminder is first wanted
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    Notifications.setNotificationChannelAsync('default', {
      name: 'Task reminders',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#41c889',
    }).catch(() => {});
  }, []);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(on => { reduceMotion.current = on; }).catch(() => {});
    AccessibilityInfo.isScreenReaderEnabled().then(on => { screenReader.current = on; }).catch(() => {});
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', on => { reduceMotion.current = on; });
    const reader = AccessibilityInfo.addEventListener('screenReaderChanged', on => { screenReader.current = on; });
    return () => {
      motion.remove();
      reader.remove();
    };
  }, []);

  // Left open across midnight on "today": follow it to the new day
  useEffect(() => {
    const previous = shownToday.current;
    shownToday.current = today;
    if (previous !== today) setDate(current => toLocalDateString(current) === previous ? new Date() : current);
  }, [today]);

  useEffect(() => {
    if (!status.syncing) {
      setShowSpinner(false);
      return;
    }
    const timer = setTimeout(() => setShowSpinner(true), SPINNER_DELAY_MS);
    return () => clearTimeout(timer);
  }, [status.syncing]);

  const handleAddTask = () => {
    // Taken, not read: a second call before the re-render finds nothing to add
    const text = draft.take();
    if (!text) return;

    // Saved on the device straight away; it reaches the server whenever there is a connection
    addTask({
      text: text.trim(),
      date: format(date, 'yyyy-MM-dd'),
      time: newTaskOptions.time ? format(newTaskOptions.time, TIME_FORMAT) : null,
      notify: newTaskOptions.time ? newTaskOptions.notify : false,
      priority: newTaskOptions.priority
    });

    // Reset form
    setNewTaskText('');
    setNewTaskOptions(NO_OPTIONS);
  };

  // A reminder may only be switched on once it can be delivered
  const allowReminders = async () => {
    const allowed = await notifications.ensure();
    if (allowed) refreshReminders();
    return allowed;
  };

  // Carries out the delete that was being held for Undo, if there is one
  const commitHeldDelete = () => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = null;
    const clientId = heldDeleteRef.current;
    if (!clientId) return;
    heldDeleteRef.current = null;
    setHeldDelete(null);
    deleteTask(clientId);
  };
  // Timers and listeners outlive the render that made them; they reach the current version through this
  const commitHeldDeleteRef = useRef(commitHeldDelete);
  useEffect(() => {
    commitHeldDeleteRef.current = commitHeldDelete;
  });

  // Hides the task and waits before deleting it, so Undo has nothing to reverse:
  // no operation is queued and the reminder is still in place.
  const requestDelete = (clientId: string) => {
    commitHeldDelete();
    heldDeleteRef.current = clientId;
    setHeldDelete(clientId);
    undoTimer.current = setTimeout(() => commitHeldDeleteRef.current(), screenReader.current ? UNDO_MS_SCREEN_READER : UNDO_MS);
  };

  const undoDelete = () => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = null;
    heldDeleteRef.current = null;
    setHeldDelete(null);
  };

  // The timer may never fire once the app is in the background, so do not leave a delete hanging
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') commitHeldDeleteRef.current();
    });
    return () => {
      subscription.remove();
      commitHeldDeleteRef.current();
    };
  }, []);

  const refresh = async () => {
    setIsRefreshing(true);
    await syncNow();
    setIsRefreshing(false);
  };

  const handleSignOut = () => {
    // A delete still waiting for Undo counts as a change that has not synced
    const held = heldDeleteRef.current ? 1 : 0;
    commitHeldDelete();
    const leave = async () => {
      await forgetAccount();
      await signOut();
    };
    const unsynced = status.pending + status.failed.length + held;
    // Always asked: the button is one tap from the theme toggle, and signing
    // out offline leaves no way back in until there is a connection
    Alert.alert(
      `Sign out of ${user!.email}?`,
      unsynced === 0
        ? 'Your tasks and reminders will be removed from this device. They stay in your account.'
        : `${unsynced} ${unsynced === 1 ? 'change has' : 'changes have'} not synced and will be lost.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign out', style: 'destructive', onPress: leave }
      ]
    );
  };

  const showFailedChanges = () => {
    // A rejected create is no longer in the list; its text is in the operation
    const names = [...new Set(status.failed.map(op =>
      op.payload.text ?? tasks.find(t => t.clientId === op.taskId)?.text ?? 'A deleted task'
    ))];
    const shown = names.slice(0, 5).map(name => `• ${name.length > 60 ? `${name.slice(0, 60)}…` : name}`);
    if (names.length > 5) shown.push(`• and ${names.length - 5} more`);
    const reasons = [...new Set(status.failed.map(op => op.error))].join('\n');
    Alert.alert(
      'Changes not saved to your account',
      `${shown.join('\n')}\n\nReason: ${reasons}\n\nDiscarding puts these tasks back to the last synced version.`,
      [
        { text: 'Close', style: 'cancel' },
        { text: 'Try again', onPress: retryFailed },
        { text: 'Discard changes', style: 'destructive', onPress: discardFailed }
      ]
    );
  };

  const signInAgain = async () => {
    if (await reauthenticate()) syncNow();
  };

  // Shown only when there is something to say; fully synced shows nothing
  const waiting = status.pending === 0 ? '' : status.pending === 1 ? ' · 1 change waiting' : ` · ${status.pending} changes waiting`;
  // Reminders that are still due but cannot be delivered
  const blockedReminders = notifications.granted
    ? 0
    : tasks.filter(t => !t.completed && t.notify && (getReminderDate(t)?.getTime() ?? 0) > Date.now()).length;
  const editingTask = editingId ? tasks.find(t => t.clientId === editingId) : undefined;
  // Nothing saved on this device yet and the first answer has not arrived
  const showSkeleton = isLoading || (!status.synced && status.syncing && tasks.length === 0);

  const toggleTheme = () => {
    const next = colorScheme === 'dark' ? 'light' : 'dark';
    setColorScheme(next);
    saveThemePreference(next);
  };

  const canAdd = newTaskText.trim().length > 0;
  const selectedDateStr = toLocalDateString(date);
  const todayStr = today;
  
  // Open tasks first; within each group timed tasks in time order, then the rest as created
  const timeOf = (task: (typeof tasks)[number]) => getReminderDate(task)?.getTime() ?? Infinity;
  const currentDayTasks = tasks
    .filter(t => t.date === selectedDateStr && t.clientId !== heldDelete)
    .map((task, index) => ({ task, index, time: timeOf(task) }))
    .sort((a, b) => Number(a.task.completed) - Number(b.task.completed) || (a.time === b.time ? a.index - b.index : a.time - b.time))
    .map(entry => entry.task);
  const doneCount = currentDayTasks.filter(t => t.completed).length;

  const daysFromToday = differenceInCalendarDays(date, new Date());
  const weekday = format(date, 'EEEE');
  const dayName = daysFromToday === 0 ? `Today · ${weekday}` : daysFromToday === 1 ? `Tomorrow · ${weekday}` : daysFromToday === -1 ? `Yesterday · ${weekday}` : weekday;
  const sameYear = date.getFullYear() === new Date().getFullYear();

  // Open, dated today, and its time has gone by: typically a task carried over with its old time
  const isOverdue = (task: (typeof tasks)[number]) => {
    if (task.completed || task.date !== todayStr) return false;
    const due = getReminderDate(task);
    return !!due && due.getTime() < Date.now();
  };
  
  const isDark = colorScheme === 'dark';

  return (
    <KeyboardAvoidingView 
      className="flex-1 bg-background" 
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      {...panResponder.panHandlers}
    >
      <View style={{ paddingTop: insets.top + 12 }} className="flex-row justify-between items-center px-4 pb-3 bg-card border-b border-border">
        <View className="flex-row items-center">
          <Image 
            source={require('../../assets/images/logo.png')} 
            style={{ width: 28, height: 28, marginRight: 8 }} 
            resizeMode="contain"
          />
          <Text accessibilityRole="header" className="text-2xl font-bold tracking-tight text-foreground">Todo</Text>
          {showSpinner && status.online && !status.problem ? (
            <ActivityIndicator size="small" color={colors.mutedForeground} style={{ marginLeft: 12 }} />
          ) : null}
        </View>
        <View className="flex-row gap-2">
          <Pressable
            onPress={toggleTheme}
            accessibilityRole="button"
            accessibilityLabel={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
            className="bg-muted w-12 h-12 rounded-full items-center justify-center active:opacity-70"
          >
            {isDark ? <Sun size={20} color={colors.foreground} /> : <Moon size={20} color={colors.foreground} />}
          </Pressable>
          <Pressable
            onPress={handleSignOut}
            accessibilityRole="button"
            accessibilityLabel="Sign out"
            className="bg-muted w-12 h-12 rounded-full items-center justify-center active:opacity-70"
          >
            <LogOut size={20} color={colors.foreground} />
          </Pressable>
        </View>
      </View>

      {!status.online ? (
        <StatusStrip icon={CloudOff} text={`Offline${waiting}`} />
      ) : status.problem === 'auth' ? (
        <StatusStrip
          icon={AlertCircle}
          tone="destructive"
          text={`Your sign-in has expired${waiting}`}
          action="Sign in"
          onPress={signInAgain}
        />
      ) : status.problem === 'error' ? (
        <StatusStrip
          icon={AlertCircle}
          tone="warning"
          text={`Can't reach the server${waiting || ' · showing saved tasks'}`}
          action="Retry"
          onPress={syncNow}
        />
      ) : null}

      {status.failed.length > 0 && (
        <StatusStrip
          icon={AlertCircle}
          tone="destructive"
          text={`${status.failed.length === 1 ? '1 change was' : `${status.failed.length} changes were`} not saved to your account`}
          action="Review"
          onPress={showFailedChanges}
        />
      )}

      {blockedReminders > 0 && (
        <StatusStrip
          icon={BellOff}
          tone="warning"
          text={`${blockedReminders === 1 ? '1 reminder' : `${blockedReminders} reminders`} will not arrive: notifications are off`}
          action="Turn on"
          onPress={allowReminders}
        />
      )}

      <FlatList
        className="flex-1 px-4 pt-4"
        contentContainerStyle={{ paddingBottom: insets.bottom + (heldDelete ? 112 : 40) }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={refresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
            progressBackgroundColor={colors.card}
          />
        }
        data={(showSkeleton ? [1, 2, 3, 4] : currentDayTasks) as any[]}
        keyExtractor={(item: any, index) => showSkeleton ? `skeleton-${index}` : item.clientId}
        ListHeaderComponent={
          <View className="mb-4">
            <Animated.View style={{ transform: [{ translateX: headerTranslateX }] }} className="mb-6 mt-4">
              <View className="flex-row items-center justify-between w-full px-2">
                <Pressable
                  onPress={goToPreviousDay}
                  accessibilityRole="button"
                  accessibilityLabel="Previous day"
                  className="w-12 h-12 items-center justify-center bg-card border border-border rounded-full active:opacity-70"
                >
                  <ChevronLeft size={24} color={colors.foreground} />
                </Pressable>
                
                <Pressable
                  onPress={() => setIsCalendarOpen(true)}
                  accessibilityRole="button"
                  accessibilityLabel={`${dayName.replace(' · ', ', ')}, ${format(date, 'MMMM d, yyyy')}. Choose a day`}
                  className="items-center justify-center flex-1 px-4"
                >
                  <Text
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    maxFontSizeMultiplier={1.5}
                    className="text-4xl font-extrabold text-foreground tracking-tight mb-1 text-center"
                  >
                    {format(date, sameYear ? 'MMMM d' : 'MMM d, yyyy')}
                  </Text>
                  <Text className="text-sm font-semibold text-primary text-center">
                    {dayName}
                  </Text>
                </Pressable>

                <Pressable
                  onPress={goToNextDay}
                  accessibilityRole="button"
                  accessibilityLabel="Next day"
                  className="w-12 h-12 items-center justify-center bg-card border border-border rounded-full active:opacity-70"
                >
                  <ChevronRight size={24} color={colors.foreground} />
                </Pressable>
              </View>

              {daysFromToday !== 0 && (
                <Pressable
                  onPress={goToToday}
                  accessibilityRole="button"
                  accessibilityLabel="Go to today"
                  className="self-center mt-2 px-4 min-h-[44px] justify-center rounded-full bg-muted border border-border active:opacity-70"
                >
                  <Text className="text-sm font-semibold text-foreground">Back to today</Text>
                </Pressable>
              )}
            </Animated.View>

            {selectedDateStr >= todayStr && (
              <Animated.View style={{ transform: [{ translateX: listTranslateX }] }} className="bg-card p-4 rounded-2xl border border-border">
                <View className="flex-row items-center mb-3">
                  <View className="flex-1 border border-input rounded-xl px-4 bg-background min-h-[56px] justify-center mr-3">
                    <TextInput
                      className="text-base text-foreground"
                      accessibilityLabel="New task"
                      placeholder="Add a task"
                      placeholderTextColor={colors.mutedForeground}
                      value={newTaskText}
                      onChangeText={changeNewTaskText}
                      onSubmitEditing={handleAddTask}
                      // Stays focused, so several tasks can be entered in a row
                      submitBehavior="submit"
                      returnKeyType="done"
                      maxLength={MAX_TASK_TEXT}
                    />
                  </View>
                  <Pressable
                    onPress={handleAddTask}
                    disabled={!canAdd}
                    accessibilityRole="button"
                    accessibilityLabel="Add task"
                    accessibilityState={{ disabled: !canAdd }}
                    className={`w-14 h-14 bg-primary rounded-xl items-center justify-center active:opacity-80 ${canAdd ? '' : 'opacity-40'}`}
                  >
                    <Plus size={26} color={colors.primaryForeground} />
                  </Pressable>
                </View>

                <TaskOptions
                  date={selectedDateStr}
                  {...newTaskOptions}
                  onChange={(changes) => setNewTaskOptions(current => ({ ...current, ...changes }))}
                  onRequestReminder={allowReminders}
                />
              </Animated.View>
            )}

            {!showSkeleton && currentDayTasks.length > 0 && (
              <Animated.View style={{ transform: [{ translateX: listTranslateX }] }}>
                <Text className="text-sm text-muted-foreground mt-6 px-1">
                  {doneCount === currentDayTasks.length ? `All ${doneCount} done` : `${doneCount} of ${currentDayTasks.length} done`}
                </Text>
              </Animated.View>
            )}
          </View>
        }
        renderItem={({ item }) => (
          <Animated.View style={{ transform: [{ translateX: listTranslateX }] }}>
            {showSkeleton ? (
              <View className="flex-row items-center bg-card p-4 rounded-2xl mb-3 border border-border">
                <View className="w-6 h-6 rounded-md bg-muted animate-pulse mr-3" />
                <View className="flex-1">
                  <View className="h-4 bg-muted rounded w-3/4 animate-pulse mb-2" />
                  <View className="h-3 bg-muted rounded w-1/4 animate-pulse" />
                </View>
              </View>
            ) : (
              <TaskItem 
                task={item} 
                pending={pending.has(item.clientId)}
                overdue={isOverdue(item)}
                onToggle={() => toggleTask(item.clientId)}
                onEdit={() => setEditingId(item.clientId)}
                onDelete={() => requestDelete(item.clientId)}
              />
            )}
          </Animated.View>
        )}
        ListEmptyComponent={
          !showSkeleton ? (
            <Animated.View style={{ transform: [{ translateX: listTranslateX }] }}>
              <Text className="text-center text-base text-foreground mt-8">
                {selectedDateStr >= todayStr ? 'Nothing planned yet' : 'Nothing left over from this day'}
              </Text>
              <Text className="text-center text-sm text-muted-foreground mt-1 px-6">
                {selectedDateStr >= todayStr
                  ? 'Add a task above. Anything you do not finish moves to the next day.'
                  : 'Tasks can only be added to today or a later day.'}
              </Text>
            </Animated.View>
          ) : null
        }
      />

      {heldDelete && (
        <View
          accessibilityLiveRegion="polite"
          style={{ bottom: insets.bottom + 16, elevation: 6, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } }}
          className="absolute left-4 right-4 flex-row items-center bg-card border border-border rounded-xl pl-4 pr-1"
        >
          <Text className="flex-1 text-sm text-foreground">Task deleted</Text>
          <Pressable
            onPress={undoDelete}
            accessibilityRole="button"
            accessibilityLabel="Undo delete"
            className="px-4 min-h-[48px] justify-center active:opacity-70"
          >
            <Text className="text-sm font-bold text-primary">Undo</Text>
          </Pressable>
        </View>
      )}

      <Modal
        visible={isCalendarOpen}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setIsCalendarOpen(false)}
      >
        <Pressable 
          className="flex-1 justify-center items-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
          onPress={() => setIsCalendarOpen(false)}
        >
          <Pressable className="w-full bg-card rounded-2xl overflow-hidden p-2">
            <Calendar
              // The calendar reads its theme once, when it mounts
              key={colorScheme}
              current={selectedDateStr}
              onDayPress={(day: any) => {
                // Local midnight; new Date('yyyy-MM-dd') would be UTC midnight
                setDate(new Date(day.year, day.month - 1, day.day));
                setIsCalendarOpen(false);
              }}
              markedDates={{
                [todayStr]: { marked: true, dotColor: colors.primary },
                [selectedDateStr]: { selected: true, selectedColor: colors.primary, selectedTextColor: colors.primaryForeground }
              }}
              theme={{
                calendarBackground: colors.card,
                textSectionTitleColor: colors.mutedForeground,
                todayTextColor: colors.primary,
                dayTextColor: colors.foreground,
                textDisabledColor: colors.border,
                arrowColor: colors.foreground,
                monthTextColor: colors.foreground,
                textDayFontWeight: '500',
                textMonthFontWeight: 'bold',
                textDayHeaderFontWeight: '600'
              }}
            />
          </Pressable>
        </Pressable>
      </Modal>

      {editingTask && (
        <EditTaskModal
          task={editingTask}
          onSave={(changes) => {
            editTask(editingTask.clientId, changes);
            setEditingId(null);
          }}
          onRequestReminder={allowReminders}
          onClose={() => setEditingId(null)}
        />
      )}
    </KeyboardAvoidingView>
  );
}

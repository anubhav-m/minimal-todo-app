import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, Pressable, FlatList, KeyboardAvoidingView, Platform, Modal, Image, Alert, PanResponder, Animated, Dimensions, AppState } from 'react-native';
import { Calendar } from 'react-native-calendars';
import DateTimePicker from '@react-native-community/datetimepicker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { format } from 'date-fns';
import { useAuth } from '../context/AuthContext';
import { getTasks, createTask, setTaskCompleted, deleteTask } from '../api/api';
import { reminderApi } from '../notifications/reminderApi';
import { createReminderQueue } from '../notifications/reminders';
import { createClientIdSource, createDraft, createMutationTracker, createSingleFlight, createToggleQueue, loadFreshSnapshot } from '../tasks/taskSync';
import { toLocalDateString, getDeviceTimeZone, msUntilNextLocalMidnight, isRolloverDue } from '../utils/localDate';
import TaskItem from './TaskItem';
import PrioritySelector from './PrioritySelector';
import { LogOut, Moon, Sun, Bell, BellOff, ChevronLeft, ChevronRight } from 'lucide-react-native';
import { useColorScheme } from 'nativewind';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const LAST_ROLLOVER_KEY = 'todo_last_rollover_date';

export default function TodoScreen() {
  const { signOut } = useAuth();
  const { colorScheme, toggleColorScheme } = useColorScheme();
  const [date, setDate] = useState(new Date());
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [tasks, setTasks] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [newTaskText, setNewTaskText] = useState('');
  const [newTaskPriority, setNewTaskPriority] = useState('none');
  const [isPriorityActive, setIsPriorityActive] = useState(false);
  const [newTaskTime, setNewTaskTime] = useState<Date | null>(null);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [notifyMe, setNotifyMe] = useState(false);
  const [isFlipping, setIsFlipping] = useState(false);
  const { width: SCREEN_WIDTH } = Dimensions.get('window');
  
  const headerTranslateX = useRef(new Animated.Value(0)).current;
  const listTranslateX = useRef(new Animated.Value(0)).current;
  // Local date (yyyy-MM-dd) this device last caught up with rollover; mirrors AsyncStorage
  const lastRolloverDate = useRef<string | null>(null);
  // Set on sign-out; anything still in flight must not touch the screen or reminders after it
  const unmounted = useRef(false);
  const hasLoaded = useRef(false);

  // The task list as it is right now. Handlers read and change it through here, so
  // overlapping ones never work from the copy a past render captured.
  const tasksRef = useRef<any[]>([]);
  const updateTasks = (change: (current: any[]) => any[]) => {
    tasksRef.current = change(tasksRef.current);
    setTasks(tasksRef.current);
  };

  // Which creates/toggles/deletes are in flight, for fetchTasks to wait on
  const tracker = useRef(createMutationTracker()).current;
  const fetchFlight = useRef(createSingleFlight<boolean>()).current;
  const draft = useRef(createDraft()).current;
  const clientIds = useRef(createClientIdSource()).current;
  const deleting = useRef(new Set<string>()).current;
  const reminders = useRef(createReminderQueue(reminderApi, () => unmounted.current ? null : tasksRef.current)).current;
  const toggleQueue = useRef(createToggleQueue<any>({
    send: setTaskCompleted,
    tracker,
    onConfirmed: (task, desired) => {
      updateTasks(current => current.map(t => t._id === task._id ? { ...task, completed: desired } : t));
    },
    onFailed: (id, confirmed, error) => {
      console.error('Error updating task', error);
      if (unmounted.current) return;
      updateTasks(current => current.map(t => t._id === id ? { ...t, completed: confirmed } : t)); // rollback
      const task = tasksRef.current.find(t => t._id === id);
      if (task) reminders.sync(task);
      Alert.alert('Error', 'Failed to update the task. Please check your connection.');
    },
    // Deleted on another device: drop it here too
    onGone: (id) => {
      const task = tasksRef.current.find(t => t._id === id);
      if (task) reminders.cancel(task);
      updateTasks(current => current.filter(t => t._id !== id));
    },
  })).current;

  const changeNewTaskText = (text: string) => {
    draft.set(text);
    setNewTaskText(text);
  };

  const triggerSwipeAnimation = (direction: -1 | 1, updateDateFn: () => void) => {
    setIsFlipping(true);
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
        setIsFlipping(false);
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

  useEffect(() => {
    unmounted.current = false;
    let midnightTimer: ReturnType<typeof setTimeout>;
    // Timers do not fire while the app is suspended, so midnight is only one of the
    // triggers; launch and foreground run the same catch-up fetch.
    const armMidnightTimer = (caughtUp: boolean) => {
      if (unmounted.current) return;
      clearTimeout(midnightTimer);
      midnightTimer = setTimeout(
        async () => armMidnightTimer(await fetchTasks(true)),
        caughtUp ? msUntilNextLocalMidnight() + 1000 : 60 * 1000
      );
    };

    (async () => {
      lastRolloverDate.current = await AsyncStorage.getItem(LAST_ROLLOVER_KEY).catch(() => null);
      armMidnightTimer(await fetchTasks());
    })();
    (async () => {
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('default', {
          name: 'default',
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#FF231F7C',
        });
      }

      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      if (existingStatus !== 'granted') {
        await Notifications.requestPermissionsAsync();
      }
    })();

    // Pick up deletes/completions/rollover from elsewhere whenever the app comes back
    const subscription = AppState.addEventListener('change', async (state) => {
      if (state === 'active') armMidnightTimer(await fetchTasks(true));
    });
    return () => {
      unmounted.current = true;
      clearTimeout(midnightTimer);
      subscription.remove();
    };
  }, []);

  // The server rolls unfinished tasks over to the local date sent here, at most once
  // per day. Returns whether this device is now caught up with that day.
  // Launch, foreground and the midnight timer can all ask at once; they share one request.
  const fetchTasks = async (silent = false): Promise<boolean> => {
    if (!silent) setIsLoading(true);
    const today = toLocalDateString();
    try {
      return await fetchFlight(today, () => loadTasks(today));
    } catch (error: any) {
      console.error('Error fetching tasks', error);
      if (!silent && !unmounted.current) Alert.alert('Network Error', 'Failed to load your tasks. Please check your connection and try again.');
      return false;
    } finally {
      if (!silent) setIsLoading(false);
    }
  };

  const loadTasks = async (today: string): Promise<boolean> => {
    const { data, fresh } = await loadFreshSnapshot<any[]>(tracker, () => getTasks(today, getDeviceTimeZone()));
    if (unmounted.current) return false;

    if (fresh) {
      updateTasks(() => data);
    } else if (!hasLoaded.current) {
      // Nothing on screen yet, so show it, keeping anything added while it loaded
      updateTasks(current => [...data, ...current.filter(t => !data.some(d => d._id === t._id))]);
    }
    hasLoaded.current = true;
    // A snapshot that overlapped a local create/toggle/delete may already be out of date
    if (!fresh) return false;

    // Drop reminders whose task is gone, completed or moved, then schedule the
    // ones a rolled-over task now needs on its new day
    reminders.reconcile();

    const previousDay = lastRolloverDate.current;
    if (isRolloverDue(today, previousDay)) {
      lastRolloverDate.current = today;
      AsyncStorage.setItem(LAST_ROLLOVER_KEY, today).catch(() => {});
      // Left open across midnight on "today": follow it to the new day
      if (previousDay) setDate(current => toLocalDateString(current) === previousDay ? new Date() : current);
    }
    return true;
  };

  const handleAddTask = async () => {
    // Taken, not read: a second call before the re-render finds nothing to add
    const text = draft.take();
    if (!text) return;

    const form = { time: newTaskTime, notify: notifyMe, priority: newTaskPriority };
    const timeStr = newTaskTime ? format(newTaskTime, 'h:mm a') : null;
    const payload = {
      text,
      date: format(date, 'yyyy-MM-dd'),
      time: timeStr,
      notify: notifyMe,
      priority: newTaskPriority
    };
    const clientId = clientIds.idFor(payload);

    // Reset form
    setNewTaskText('');
    setNewTaskPriority('none');
    setIsPriorityActive(false);
    setNewTaskTime(null);
    setNotifyMe(false);

    const done = tracker.begin();
    try {
      const created = await createTask({
        ...payload,
        clientId,
        // Chosen up front so the id is saved with the task before anything is scheduled
        notificationId: notifyMe && timeStr ? `reminder-${clientId}` : null
      });
      clientIds.succeeded(clientId);
      if (unmounted.current) return;
      updateTasks(current => current.some(t => t._id === created._id) ? current : [...current, created]);

      // Schedule notification if requested
      reminders.sync(created);
    } catch (error: any) {
      console.error('Error creating task', error);
      // The server may have saved it anyway; the same clientId makes a retry safe
      clientIds.failed(payload, clientId);
      if (unmounted.current) return;
      if (draft.restore(text)) {
        setNewTaskText(text);
        setNewTaskTime(form.time);
        setNotifyMe(form.notify);
        setNewTaskPriority(form.priority);
      }
      Alert.alert('Error', 'Failed to save the task. Please try again.');
    } finally {
      done();
    }
  };

  const toggleTaskCompletion = (id: string) => {
    const task = tasksRef.current.find(t => t._id === id);
    if (!task) return;
    // Requests for one task go out one at a time; see createToggleQueue
    const completed = toggleQueue.toggle(task);
    updateTasks(current => current.map(t => t._id === id ? { ...t, completed } : t));
    // Completing cancels the reminder; un-completing brings it back if it is still due
    reminders.sync({ ...task, completed });
  };

  const handleDeleteTask = async (id: string) => {
    const taskToDelete = tasksRef.current.find(t => t._id === id);
    if (!taskToDelete || deleting.has(id)) return;
    deleting.add(id);
    updateTasks(current => current.filter(t => t._id !== id));
    const done = tracker.begin();
    // Cancel while we still hold the task (and its notification id)
    reminders.cancel(taskToDelete);
    try {
      await deleteTask(id);
    } catch (error: any) {
      console.error('Error deleting task', error);
      if (unmounted.current) return;
      updateTasks(current => current.some(t => t._id === id) ? current : [...current, taskToDelete]); // rollback
      reminders.sync(taskToDelete);
      Alert.alert('Error', 'Failed to delete the task. Please try again.');
    } finally {
      deleting.delete(id);
      done();
    }
  };

  const selectedDateStr = toLocalDateString(date);
  const todayStr = toLocalDateString();
  
  const currentDayTasks = tasks.filter(t => t.date === selectedDateStr);
  
  const isDark = colorScheme === 'dark';

  return (
    <KeyboardAvoidingView 
      className="flex-1 bg-background" 
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      {...panResponder.panHandlers}
    >
      <View className="flex-row justify-between items-center px-4 pt-12 pb-4 bg-card border-b border-border">
        <View className="flex-row items-center">
          <Image 
            source={require('../../assets/images/logo.png')} 
            style={{ width: 28, height: 28, marginRight: 8 }} 
            resizeMode="contain"
          />
          <Text className="text-2xl font-bold tracking-tight text-foreground">Todo</Text>
        </View>
        <View className="flex-row gap-2">
          <Pressable onPress={toggleColorScheme} className="bg-muted w-10 h-10 rounded-full items-center justify-center">
            {isDark ? <Sun size={20} color="#e2e8f0" /> : <Moon size={20} color="#0f172a" />}
          </Pressable>
          <Pressable onPress={signOut} className="bg-muted w-10 h-10 rounded-full items-center justify-center">
            <LogOut size={20} color={isDark ? '#e2e8f0' : '#0f172a'} />
          </Pressable>
        </View>
      </View>

      <FlatList
        className="flex-1 px-4 pt-4"
        contentContainerStyle={{ paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
        data={isLoading ? [1, 2, 3, 4] : currentDayTasks}
        keyExtractor={(item, index) => isLoading ? `skeleton-${index}` : item._id}
        ListHeaderComponent={
          <View className="mb-6">
            <Animated.View style={{ transform: [{ translateX: headerTranslateX }] }} className="mb-8 mt-4">
              <View className="flex-row items-center justify-between w-full px-2">
                <Pressable onPress={goToPreviousDay} className="w-12 h-12 items-center justify-center bg-card rounded-full shadow-sm" hitSlop={10}>
                  <ChevronLeft size={24} color={isDark ? '#e2e8f0' : '#0f172a'} />
                </Pressable>
                
                <Pressable 
                  onPress={() => setIsCalendarOpen(true)}
                  className="items-center justify-center flex-1 px-4"
                >
                  <Text className="text-4xl font-extrabold text-foreground tracking-tighter mb-1 text-center">
                    {format(date, 'MMMM d')}
                  </Text>
                  <Text className="text-xs font-bold text-primary uppercase tracking-[0.2em] text-center">
                    {format(date, 'EEEE')}
                  </Text>
                </Pressable>

                <Pressable onPress={goToNextDay} className="w-12 h-12 items-center justify-center bg-card rounded-full shadow-sm" hitSlop={10}>
                  <ChevronRight size={24} color={isDark ? '#e2e8f0' : '#0f172a'} />
                </Pressable>
              </View>
            </Animated.View>

            {selectedDateStr >= todayStr && (
              <Animated.View style={{ transform: [{ translateX: listTranslateX }] }} className="bg-card p-4 rounded-2xl border border-border">
                <View className="flex-row items-center mb-4">
                  <View className="flex-1 border border-input rounded-xl px-4 bg-background h-14 justify-center mr-3">
                    <TextInput
                      className="flex-1 text-base text-foreground"
                      placeholder="Add a new task..."
                      placeholderTextColor={isDark ? '#94a3b8' : '#64748b'}
                      value={newTaskText}
                      onChangeText={changeNewTaskText}
                      onSubmitEditing={handleAddTask}
                    />
                  </View>
                  <Pressable 
                    onPress={handleAddTask}
                    className="w-14 h-14 bg-primary rounded-xl items-center justify-center shadow-sm"
                  >
                    <Text className="text-primary-foreground font-bold text-3xl leading-none mb-1">+</Text>
                  </Pressable>
                </View>
                
                <View className="flex-row items-center flex-wrap gap-3">
                  {newTaskTime ? (
                    <View className="flex-row items-center bg-muted border border-border rounded-full pl-4 pr-1.5 h-10">
                      <Pressable onPress={() => setShowTimePicker(true)} hitSlop={10}>
                        <Text className="text-sm font-semibold text-foreground mr-2">
                          {format(newTaskTime, 'h:mm a')}
                        </Text>
                      </Pressable>
                      <Pressable 
                        onPress={() => setNotifyMe(!notifyMe)}
                        className="p-1 mr-1"
                        hitSlop={10}
                      >
                        {notifyMe ? (
                          <Bell 
                            size={16} 
                            color={isDark ? '#3b82f6' : '#2563eb'} 
                          />
                        ) : (
                          <BellOff 
                            size={16} 
                            color={isDark ? '#64748b' : '#94a3b8'} 
                          />
                        )}
                      </Pressable>
                      <Pressable 
                        onPress={() => {
                          setNewTaskTime(null);
                          setNotifyMe(false);
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

                  {newTaskPriority === 'none' && (
                    <Pressable 
                      onPress={() => setIsPriorityActive(true)}
                      className="bg-muted px-4 h-10 justify-center rounded-full border border-border"
                    >
                      <Text numberOfLines={1} className="text-sm font-semibold text-muted-foreground">+ Priority</Text>
                    </Pressable>
                  )}

                  {newTaskPriority !== 'none' && (
                    <View className="flex-row items-center bg-muted border border-border rounded-full pl-4 pr-1.5 h-10">
                      <Pressable onPress={() => setIsPriorityActive(true)} hitSlop={10}>
                        <Text className="text-sm font-semibold text-foreground capitalize mr-2">
                          {newTaskPriority === 'high' ? '🔴 ' : newTaskPriority === 'medium' ? '🟠 ' : '🟢 '}{newTaskPriority}
                        </Text>
                      </Pressable>
                      <Pressable 
                        onPress={() => setNewTaskPriority('none')}
                        className="w-6 h-6 items-center justify-center bg-background rounded-full"
                      >
                        <Text className="text-muted-foreground font-bold text-xs leading-none">✕</Text>
                      </Pressable>
                    </View>
                  )}

                  {isPriorityActive && (
                    <Modal visible={isPriorityActive} transparent animationType="fade">
                      <Pressable 
                        className="flex-1 justify-center items-center bg-black/50 p-4"
                        onPress={() => setIsPriorityActive(false)}
                      >
                        <Pressable className="bg-card w-full max-w-[300px] p-6 rounded-2xl border border-border">
                          <Text className="text-foreground font-bold text-lg mb-4 text-center">Select Priority</Text>
                          <View className="h-12">
                            <PrioritySelector 
                              selected={newTaskPriority} 
                              onSelect={(p) => {
                                setNewTaskPriority(p);
                                setIsPriorityActive(false);
                              }} 
                            />
                          </View>
                        </Pressable>
                      </Pressable>
                    </Modal>
                  )}
                </View>

                {showTimePicker && (
                  <DateTimePicker
                    value={newTaskTime || new Date()}
                    mode="time"
                    display="default"
                    onChange={(event, selectedDate) => {
                      setShowTimePicker(false);
                      if (event.type === 'set' && selectedDate) {
                        const isToday = format(date, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd');
                        if (isToday) {
                          const now = new Date();
                          if (
                            selectedDate.getHours() < now.getHours() || 
                            (selectedDate.getHours() === now.getHours() && selectedDate.getMinutes() < now.getMinutes())
                          ) {
                            Alert.alert("Invalid Time", "You cannot select a time that has already passed today.");
                            return;
                          }
                        }
                        setNewTaskTime(selectedDate);
                      }
                    }}
                  />
                )}
              </Animated.View>
            )}
          </View>
        }
        renderItem={({ item }) => (
          <Animated.View style={{ transform: [{ translateX: listTranslateX }] }}>
            {isLoading ? (
              <View className="flex-row items-center bg-card p-4 rounded-2xl mb-3 border border-border">
                <View className="w-6 h-6 rounded-md bg-muted animate-pulse mr-3" />
                <View className="flex-1">
                  <View className="h-4 bg-muted rounded w-3/4 animate-pulse mb-2" />
                  <View className="h-3 bg-muted rounded w-1/4 animate-pulse" />
                </View>
                <View className="w-16 h-6 rounded-full bg-muted animate-pulse ml-3" />
              </View>
            ) : (
              <TaskItem 
                task={item} 
                onToggle={() => toggleTaskCompletion(item._id)}
                onDelete={() => handleDeleteTask(item._id)}
              />
            )}
          </Animated.View>
        )}
        ListEmptyComponent={
          !isLoading ? (
            <Animated.View style={{ transform: [{ translateX: listTranslateX }] }}>
              <Text className="text-center text-muted-foreground mt-8">No tasks for this day.</Text>
            </Animated.View>
          ) : null
        }
      />

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
              current={selectedDateStr}
              onDayPress={(day: any) => {
                // Local midnight; new Date('yyyy-MM-dd') would be UTC midnight
                setDate(new Date(day.year, day.month - 1, day.day));
                setIsCalendarOpen(false);
              }}
              markedDates={{
                [todayStr]: { marked: true, dotColor: isDark ? '#e2e8f0' : '#0f172a' },
                [selectedDateStr]: { selected: true, selectedColor: isDark ? '#e2e8f0' : '#0f172a', selectedTextColor: isDark ? '#0f172a' : '#ffffff' }
              }}
              theme={{
                calendarBackground: isDark ? '#020817' : '#ffffff',
                textSectionTitleColor: isDark ? '#94a3b8' : '#64748b',
                todayTextColor: isDark ? '#ffffff' : '#000000',
                dayTextColor: isDark ? '#e2e8f0' : '#0f172a',
                textDisabledColor: isDark ? '#334155' : '#cbd5e1',
                arrowColor: isDark ? '#e2e8f0' : '#0f172a',
                monthTextColor: isDark ? '#e2e8f0' : '#0f172a',
                textDayFontWeight: '500',
                textMonthFontWeight: 'bold',
                textDayHeaderFontWeight: '600'
              }}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

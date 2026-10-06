import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, Pressable, FlatList, KeyboardAvoidingView, Platform, Modal, Image, Alert, PanResponder, Animated, Dimensions, ActivityIndicator } from 'react-native';
import { Calendar } from 'react-native-calendars';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Notifications from 'expo-notifications';
import { format } from 'date-fns';
import { useAuth } from '../context/AuthContext';
import { useTasks } from '../sync/useTasks';
import { createDraft } from '../tasks/taskSync';
import { toLocalDateString } from '../utils/localDate';
import TaskItem from './TaskItem';
import EditTaskModal from './EditTaskModal';
import PrioritySelector from './PrioritySelector';
import { LogOut, Moon, Sun, Bell, BellOff, ChevronLeft, ChevronRight, CloudOff, AlertCircle } from 'lucide-react-native';
import { useColorScheme } from 'nativewind';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// A sync shorter than this is not worth showing
const SPINNER_DELAY_MS = 1000;

export default function TodoScreen() {
  const { user, signOut } = useAuth();
  const { colorScheme, toggleColorScheme } = useColorScheme();
  // Everything below reads and writes the copy on this device; see useTasks
  const { tasks, pending, status, today, isLoading, addTask, toggleTask, editTask, deleteTask, retryFailed, discardFailed, forgetAccount } = useTasks(user!.email);
  const [date, setDate] = useState(new Date());
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [newTaskText, setNewTaskText] = useState('');
  const [newTaskPriority, setNewTaskPriority] = useState('none');
  const [isPriorityActive, setIsPriorityActive] = useState(false);
  const [newTaskTime, setNewTaskTime] = useState<Date | null>(null);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [notifyMe, setNotifyMe] = useState(false);
  const [isFlipping, setIsFlipping] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showSpinner, setShowSpinner] = useState(false);
  const { width: SCREEN_WIDTH } = Dimensions.get('window');

  const headerTranslateX = useRef(new Animated.Value(0)).current;
  const listTranslateX = useRef(new Animated.Value(0)).current;
  const draft = useRef(createDraft()).current;
  const shownToday = useRef(today);

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
      time: newTaskTime ? format(newTaskTime, 'h:mm a') : null,
      notify: notifyMe,
      priority: newTaskPriority
    });

    // Reset form
    setNewTaskText('');
    setNewTaskPriority('none');
    setIsPriorityActive(false);
    setNewTaskTime(null);
    setNotifyMe(false);
  };

  const handleSignOut = () => {
    const leave = async () => {
      await forgetAccount();
      await signOut();
    };
    const unsynced = status.pending + status.failed.length;
    if (unsynced === 0) {
      leave();
      return;
    }
    Alert.alert(
      'Sign out?',
      `${unsynced} ${unsynced === 1 ? 'change has' : 'changes have'} not synced and will be lost.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign out', style: 'destructive', onPress: leave }
      ]
    );
  };

  const showFailedChanges = () => {
    const count = status.failed.length === 1 ? 'a change' : `${status.failed.length} changes`;
    const reasons = [...new Set(status.failed.map(op => op.error))].join('\n');
    Alert.alert(
      'Could not sync',
      `The server did not accept ${count}:\n\n${reasons}`,
      [
        { text: 'Close', style: 'cancel' },
        { text: 'Retry', onPress: retryFailed },
        { text: 'Discard', style: 'destructive', onPress: discardFailed }
      ]
    );
  };

  // Shown only when there is something to say; fully synced shows nothing
  const waiting = status.pending > 0 ? ` · ${status.pending} pending` : '';
  const syncLabel =
    !status.online ? `Offline${waiting}`
    : status.problem === 'auth' ? 'Sign in again to sync'
    : status.problem === 'error' && status.pending > 0 ? `Waiting to sync${waiting}`
    : null;
  const editingTask = editingId ? tasks.find(t => t.clientId === editingId) : undefined;
  // Nothing saved on this device yet and the first answer has not arrived
  const showSkeleton = isLoading || (!status.synced && status.syncing && tasks.length === 0);

  const selectedDateStr = toLocalDateString(date);
  const todayStr = today;
  
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
          {syncLabel ? (
            <View className="flex-row items-center ml-3">
              <CloudOff size={12} color={isDark ? '#94a3b8' : '#64748b'} />
              <Text className="text-xs text-muted-foreground ml-1">{syncLabel}</Text>
            </View>
          ) : showSpinner ? (
            <ActivityIndicator size="small" color={isDark ? '#94a3b8' : '#64748b'} style={{ marginLeft: 12 }} />
          ) : null}
        </View>
        <View className="flex-row gap-2">
          <Pressable onPress={toggleColorScheme} className="bg-muted w-10 h-10 rounded-full items-center justify-center">
            {isDark ? <Sun size={20} color="#e2e8f0" /> : <Moon size={20} color="#0f172a" />}
          </Pressable>
          <Pressable onPress={handleSignOut} className="bg-muted w-10 h-10 rounded-full items-center justify-center">
            <LogOut size={20} color={isDark ? '#e2e8f0' : '#0f172a'} />
          </Pressable>
        </View>
      </View>

      {status.failed.length > 0 && (
        <Pressable onPress={showFailedChanges} className="flex-row items-center px-4 py-2 bg-muted border-b border-border">
          <AlertCircle size={14} color={isDark ? '#fca5a5' : '#b91c1c'} />
          <Text className="text-xs text-foreground ml-2">
            {status.failed.length === 1 ? '1 change' : `${status.failed.length} changes`} could not be synced
          </Text>
        </Pressable>
      )}

      <FlatList
        className="flex-1 px-4 pt-4"
        contentContainerStyle={{ paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
        data={(showSkeleton ? [1, 2, 3, 4] : currentDayTasks) as any[]}
        keyExtractor={(item: any, index) => showSkeleton ? `skeleton-${index}` : item.clientId}
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
            {showSkeleton ? (
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
                pending={pending.has(item.clientId)}
                onToggle={() => toggleTask(item.clientId)}
                onEdit={() => setEditingId(item.clientId)}
                onDelete={() => deleteTask(item.clientId)}
              />
            )}
          </Animated.View>
        )}
        ListEmptyComponent={
          !showSkeleton ? (
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

      {editingTask && (
        <EditTaskModal
          task={editingTask}
          onSave={(changes) => {
            editTask(editingTask.clientId, changes);
            setEditingId(null);
          }}
          onClose={() => setEditingId(null)}
        />
      )}
    </KeyboardAvoidingView>
  );
}

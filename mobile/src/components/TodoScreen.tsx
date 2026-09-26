import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, Pressable, FlatList, KeyboardAvoidingView, Platform, Modal, Image, Switch, Alert, PanResponder } from 'react-native';
import { Calendar } from 'react-native-calendars';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Notifications from 'expo-notifications';
import { format } from 'date-fns';
import { useAuth } from '../context/AuthContext';
import { getTasks, createTask, updateTask, deleteTask } from '../api/api';
import TaskItem from './TaskItem';
import PrioritySelector from './PrioritySelector';
import { LogOut, Calendar as CalendarIcon, Moon, Sun, Bell, ChevronLeft, ChevronRight } from 'lucide-react-native';
import { useColorScheme } from 'nativewind';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export default function TodoScreen() {
  const { signOut, user } = useAuth();
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

  const goToNextDay = () => {
    setIsFlipping(true);
    setDate(current => {
      const nextDay = new Date(current);
      nextDay.setDate(nextDay.getDate() + 1);
      return nextDay;
    });
    setTimeout(() => setIsFlipping(false), 150);
  };

  const goToPreviousDay = () => {
    setIsFlipping(true);
    setDate(current => {
      const prevDay = new Date(current);
      prevDay.setDate(prevDay.getDate() - 1);
      return prevDay;
    });
    setTimeout(() => setIsFlipping(false), 150);
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
    fetchTasks();
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
      let finalStatus = existingStatus;
      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }
    })();
  }, []);

  const fetchTasks = async () => {
    setIsLoading(true);
    try {
      const data = await getTasks();
      setTasks(data);
    } catch (error) {
      console.error('Error fetching tasks', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddTask = async () => {
    if (!newTaskText.trim()) return;

    const dateStr = format(date, 'yyyy-MM-dd');
    const timeStr = newTaskTime ? format(newTaskTime, 'h:mm a') : null;
    const tempId = Date.now().toString();
    const tempTask = { 
      _id: tempId, 
      text: newTaskText, 
      date: dateStr, 
      time: timeStr,
      notify: notifyMe,
      priority: newTaskPriority, 
      completed: false 
    };
    
    setTasks([...tasks, tempTask]);
    
    // Schedule notification if requested
    if (notifyMe && newTaskTime) {
      const notificationDate = new Date(date);
      notificationDate.setHours(newTaskTime.getHours(), newTaskTime.getMinutes(), 0, 0);
      
      const secondsRemaining = Math.floor((notificationDate.getTime() - new Date().getTime()) / 1000);

      if (secondsRemaining > 0) {
        try {
          await Notifications.scheduleNotificationAsync({
            content: {
              title: "Todo Reminder",
              body: newTaskText,
              sound: true,
            },
            trigger: { 
              type: Notifications.SchedulableTriggerInputTypes.DATE,
              date: notificationDate, // explicitly pass the absolute date object
              channelId: 'default'
            },
          });
        } catch (e) {
          console.error("Failed to schedule notification", e);
        }
      }
    }

    // Reset form
    setNewTaskText('');
    setNewTaskPriority('none');
    setIsPriorityActive(false);
    setNewTaskTime(null);
    setNotifyMe(false);

    try {
      const newTask = await createTask({ 
        text: tempTask.text, 
        date: tempTask.date, 
        time: tempTask.time,
        notify: tempTask.notify,
        priority: tempTask.priority 
      });
      setTasks(current => current.map(t => t._id === tempId ? newTask : t));
    } catch (error) {
      console.error('Error creating task', error);
      setTasks(current => current.filter(t => t._id !== tempId));
    }
  };

  const toggleTaskCompletion = async (id: string, completed: boolean) => {
    setTasks(current => current.map(t => t._id === id ? { ...t, completed: !completed } : t));
    try {
      await updateTask(id, { completed: !completed });
    } catch (error) {
      console.error('Error updating task', error);
      setTasks(current => current.map(t => t._id === id ? { ...t, completed } : t)); // rollback
    }
  };

  const handleDeleteTask = async (id: string) => {
    const taskToDelete = tasks.find(t => t._id === id);
    setTasks(current => current.filter(t => t._id !== id));
    try {
      await deleteTask(id);
    } catch (error) {
      console.error('Error deleting task', error);
      if (taskToDelete) setTasks(current => [...current, taskToDelete]); // rollback
    }
  };

  const selectedDateStr = format(date, 'yyyy-MM-dd');
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  
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
        data={(isLoading || isFlipping) ? [1, 2, 3, 4] : currentDayTasks}
        keyExtractor={(item, index) => (isLoading || isFlipping) ? `skeleton-${index}` : item._id}
        ListHeaderComponent={
          <View className="mb-6">
            <View className="flex-row justify-center items-center mb-6">
              <View className="flex-row items-center bg-card border border-border rounded-xl">
                <Pressable onPress={goToPreviousDay} className="px-4 py-3 border-r border-border" hitSlop={10}>
                  <ChevronLeft size={24} color={isDark ? '#94a3b8' : '#64748b'} />
                </Pressable>
                <Pressable 
                  onPress={() => setIsCalendarOpen(true)}
                  className="flex-row items-center px-6 py-3"
                >
                  <CalendarIcon size={20} color={isDark ? '#e2e8f0' : '#0f172a'} />
                  <Text className="text-lg font-bold text-foreground ml-2">
                    {format(date, 'MMMM d, yyyy')}
                  </Text>
                </Pressable>
                <Pressable onPress={goToNextDay} className="px-4 py-3 border-l border-border" hitSlop={10}>
                  <ChevronRight size={24} color={isDark ? '#94a3b8' : '#64748b'} />
                </Pressable>
              </View>
            </View>

            {selectedDateStr >= todayStr && (
              <View className="bg-card p-4 rounded-2xl border border-border">
                <View className="flex-row items-center border border-input rounded-xl px-4 bg-background mb-4">
                  <TextInput
                    className="flex-1 h-12 text-foreground"
                    placeholder="Add a new task..."
                    placeholderTextColor={isDark ? '#94a3b8' : '#64748b'}
                    value={newTaskText}
                    onChangeText={setNewTaskText}
                    onSubmitEditing={handleAddTask}
                  />
                  <Pressable 
                    onPress={handleAddTask}
                    className="w-8 h-8 bg-primary rounded-full items-center justify-center ml-2"
                  >
                    <Text className="text-primary-foreground font-bold text-lg leading-none">+</Text>
                  </Pressable>
                </View>
                
                <View className="flex-row items-center flex-wrap gap-2">
                  {newTaskTime ? (
                    <View className="flex-row items-center bg-muted border border-border rounded-full pl-3 pr-1 h-8">
                      <Pressable onPress={() => setShowTimePicker(true)} hitSlop={10}>
                        <Text className="text-xs font-semibold text-foreground mr-2">
                          {format(newTaskTime, 'h:mm a')}
                        </Text>
                      </Pressable>
                      <Pressable 
                        onPress={() => setNotifyMe(!notifyMe)}
                        className="p-1 mr-1"
                        hitSlop={10}
                      >
                        <Bell 
                          size={14} 
                          color={notifyMe ? (isDark ? '#3b82f6' : '#2563eb') : (isDark ? '#64748b' : '#94a3b8')} 
                        />
                      </Pressable>
                      <Pressable 
                        onPress={() => {
                          setNewTaskTime(null);
                          setNotifyMe(false);
                        }}
                        className="w-5 h-5 items-center justify-center bg-background rounded-full"
                      >
                        <Text className="text-muted-foreground font-bold text-xs leading-none">✕</Text>
                      </Pressable>
                    </View>
                  ) : (
                    <Pressable 
                      onPress={() => setShowTimePicker(true)}
                      className="bg-muted px-3 h-8 justify-center rounded-full border border-border"
                    >
                      <Text className="text-xs font-semibold text-muted-foreground">+ Time</Text>
                    </Pressable>
                  )}

                  {!isPriorityActive && newTaskPriority === 'none' && (
                    <Pressable 
                      onPress={() => setIsPriorityActive(true)}
                      className="bg-muted px-3 h-8 justify-center rounded-full border border-border"
                    >
                      <Text className="text-xs font-semibold text-muted-foreground">+ Priority</Text>
                    </Pressable>
                  )}

                  {!isPriorityActive && newTaskPriority !== 'none' && (
                    <View className="flex-row items-center bg-muted border border-border rounded-full pl-3 pr-1 h-8">
                      <Pressable onPress={() => setIsPriorityActive(true)} hitSlop={10}>
                        <Text className="text-xs font-semibold text-foreground capitalize mr-2">
                          {newTaskPriority === 'high' ? '🔴 ' : newTaskPriority === 'medium' ? '🟠 ' : '🟢 '}{newTaskPriority}
                        </Text>
                      </Pressable>
                      <Pressable 
                        onPress={() => setNewTaskPriority('none')}
                        className="w-5 h-5 items-center justify-center bg-background rounded-full"
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
                      if (selectedDate) {
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
              </View>
            )}
          </View>
        }
        renderItem={({ item }) => (
          (isLoading || isFlipping) ? (
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
              onToggle={() => toggleTaskCompletion(item._id, item.completed)}
              onDelete={() => handleDeleteTask(item._id)}
            />
          )
        )}
        ListEmptyComponent={
          !isLoading ? <Text className="text-center text-muted-foreground mt-8">No tasks for this day.</Text> : null
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
                setDate(new Date(day.dateString));
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

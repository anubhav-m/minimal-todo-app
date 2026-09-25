import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, Pressable, FlatList, KeyboardAvoidingView, Platform, Modal, Image } from 'react-native';
import { Calendar } from 'react-native-calendars';
import { format } from 'date-fns';
import { useAuth } from '../context/AuthContext';
import { getTasks, createTask, updateTask, deleteTask } from '../api/api';
import TaskItem from './TaskItem';
import PrioritySelector from './PrioritySelector';
import { LogOut, Calendar as CalendarIcon, Moon, Sun } from 'lucide-react-native';
import { useColorScheme } from 'nativewind';

export default function TodoScreen() {
  const { signOut, user } = useAuth();
  const { colorScheme, toggleColorScheme } = useColorScheme();
  
  const [date, setDate] = useState(new Date());
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [tasks, setTasks] = useState<any[]>([]);
  const [newTaskText, setNewTaskText] = useState('');
  const [newTaskPriority, setNewTaskPriority] = useState('medium');

  useEffect(() => {
    fetchTasks();
  }, []);

  const fetchTasks = async () => {
    try {
      const data = await getTasks();
      setTasks(data);
    } catch (error) {
      console.error('Error fetching tasks', error);
    }
  };

  const handleAddTask = async () => {
    if (!newTaskText.trim()) return;

    const dateStr = format(date, 'yyyy-MM-dd');
    const tempId = Date.now().toString();
    const tempTask = { _id: tempId, text: newTaskText, date: dateStr, priority: newTaskPriority, completed: false };
    
    setTasks([...tasks, tempTask]);
    setNewTaskText('');

    try {
      const newTask = await createTask({ text: tempTask.text, date: dateStr, priority: tempTask.priority });
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
        data={currentDayTasks}
        keyExtractor={(item) => item._id}
        ListHeaderComponent={
          <View className="mb-6">
            <View className="flex-row justify-between items-center mb-6">
              <Text className="text-lg font-bold text-foreground">
                {format(date, 'MMMM do, yyyy')}
              </Text>
              
              <Pressable 
                onPress={() => setIsCalendarOpen(true)}
                className="flex-row items-center bg-card border border-border px-4 py-2 rounded-lg"
              >
                <CalendarIcon size={16} color={isDark ? '#e2e8f0' : '#0f172a'} />
                <Text className="text-foreground font-medium ml-2">Calendar</Text>
              </Pressable>
            </View>

            <View className="bg-card p-4 rounded-2xl border border-border">
              <TextInput
                className="h-12 border border-input rounded-xl px-4 text-foreground bg-background mb-4"
                placeholder="Add a new task..."
                placeholderTextColor={isDark ? '#94a3b8' : '#64748b'}
                value={newTaskText}
                onChangeText={setNewTaskText}
                onSubmitEditing={handleAddTask}
              />
              <View className="flex-row justify-between items-center">
                <PrioritySelector selected={newTaskPriority} onSelect={setNewTaskPriority} />
                <Pressable 
                  className="bg-primary px-6 py-3 rounded-full ml-4"
                  onPress={handleAddTask}
                >
                  <Text className="text-primary-foreground font-semibold">Add</Text>
                </Pressable>
              </View>
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <TaskItem 
            task={item} 
            onToggle={() => toggleTaskCompletion(item._id, item.completed)}
            onDelete={() => handleDeleteTask(item._id)}
          />
        )}
        ListEmptyComponent={
          <Text className="text-center text-muted-foreground mt-8">No tasks for this day.</Text>
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

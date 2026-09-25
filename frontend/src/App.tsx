import { useState, useEffect } from 'react';
import { useGoogleLogin, googleLogout } from '@react-oauth/google';
import { Calendar } from '@/components/ui/calendar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { authenticate, getTasks, createTask, updateTask, deleteTask } from '@/lib/api';
import { useTheme } from '@/components/ThemeProvider';
import { format } from 'date-fns';
import { Calendar as CalendarIcon } from 'lucide-react';

import { LoginScreen } from '@/components/LoginScreen';
import { Header } from '@/components/Header';
import { TaskForm } from '@/components/TaskForm';
import { TaskList } from '@/components/TaskList';

export default function App() {
  const [user, setUser] = useState<{ name: string; email: string } | null>(null);
  const [date, setDate] = useState<Date | undefined>(new Date());
  const [tasks, setTasks] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [newTaskText, setNewTaskText] = useState('');
  const [newTaskPriority, setNewTaskPriority] = useState('medium');
  const { theme, setTheme } = useTheme();
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);

  const handleDateSelect = (newDate: Date | undefined) => {
    setDate(newDate);
    setIsCalendarOpen(false);
  };

  useEffect(() => {
    const token = localStorage.getItem('todo_token');
    if (token) {
      setUser({ name: 'User', email: '' });
      fetchTasks();
    } else {
      setIsLoading(false);
    }
  }, []);

  const fetchTasks = async () => {
    setIsLoading(true);
    try {
      const localToday = format(new Date(), 'yyyy-MM-dd');
      const data = await getTasks(localToday);
      setTasks(data);
    } catch (error) {
      console.error('Error fetching tasks', error);
      if ((error as any).response?.status === 401) {
        handleLogout();
      }
    } finally {
      setIsLoading(false);
    }
  };

  const login = useGoogleLogin({
    onSuccess: async (tokenResponse) => {
      try {
        const res = await authenticate(tokenResponse.access_token);
        localStorage.setItem('todo_token', tokenResponse.access_token);
        setUser(res.user);
        setDate(new Date());
        fetchTasks();
      } catch (err) {
        console.error('Login failed on backend', err);
      }
    },
    onError: () => console.error('Login Failed'),
  });

  const handleLogout = () => {
    googleLogout();
    localStorage.removeItem('todo_token');
    setUser(null);
    setTasks([]);
    setDate(new Date());
  };

  const handleAddTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskText.trim() || !date) return;

    try {
      const dateStr = format(date, 'yyyy-MM-dd');
      const newTask = await createTask({ text: newTaskText, date: dateStr, priority: newTaskPriority });
      setTasks([...tasks, newTask]);
      setNewTaskText('');
    } catch (error) {
      console.error('Error creating task', error);
    }
  };

  const toggleTaskCompletion = async (id: string, completed: boolean) => {
    setTasks(prevTasks => prevTasks.map(t => t._id === id ? { ...t, completed: !completed } : t));
    try {
      const updated = await updateTask(id, { completed: !completed });
      setTasks(prevTasks => prevTasks.map(t => t._id === id ? updated : t));
    } catch (error) {
      console.error('Error updating task', error);
      setTasks(prevTasks => prevTasks.map(t => t._id === id ? { ...t, completed: completed } : t));
    }
  };

  const handleDeleteTask = async (id: string) => {
    const taskToDelete = tasks.find(t => t._id === id);
    setTasks(prevTasks => prevTasks.filter(t => t._id !== id));
    try {
      await deleteTask(id);
    } catch (error) {
      console.error('Error deleting task', error);
      if (taskToDelete) {
        setTasks(prevTasks => [...prevTasks, taskToDelete]);
      }
    }
  };

  const selectedDateStr = date ? format(date, 'yyyy-MM-dd') : '';
  const currentDayTasks = tasks.filter(t => t.date === selectedDateStr);

  if (!user) {
    return <LoginScreen theme={theme} setTheme={setTheme} onLogin={() => login()} />;
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col items-center py-10 px-4">
      <Header theme={theme} setTheme={setTheme} onLogout={handleLogout} />

      <div className="w-full max-w-4xl grid grid-cols-1 md:grid-cols-3 gap-8">
        <Card className="hidden md:block col-span-1 h-fit">
          <CardContent className="p-4 flex justify-center">
            <Calendar
              mode="single"
              selected={date}
              onSelect={handleDateSelect}
              className="rounded-md border"
            />
          </CardContent>
        </Card>

        <Card className="col-span-1 md:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
            <CardTitle key={`title-${selectedDateStr}`} className="animate-in fade-in slide-in-from-left-2 duration-300">
              {date ? format(date, 'MMMM do, yyyy') : 'Select a date'}
            </CardTitle>
            <div className="md:hidden">
              <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="flex gap-2 h-10">
                    <CalendarIcon className="h-4 w-4" />
                    <span>Calendar</span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="end">
                  <Calendar
                    mode="single"
                    selected={date}
                    onSelect={handleDateSelect}
                  />
                </PopoverContent>
              </Popover>
            </div>
          </CardHeader>
          <CardContent>
            <TaskForm 
              newTaskText={newTaskText} 
              setNewTaskText={setNewTaskText} 
              newTaskPriority={newTaskPriority} 
              setNewTaskPriority={setNewTaskPriority} 
              onSubmit={handleAddTask} 
            />

            <TaskList 
              isLoading={isLoading} 
              tasks={currentDayTasks} 
              selectedDateStr={selectedDateStr} 
              onToggleCompletion={toggleTaskCompletion} 
              onDelete={handleDeleteTask} 
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

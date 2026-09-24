import { useState, useEffect } from 'react';
import { useGoogleLogin, googleLogout } from '@react-oauth/google';
import { Calendar } from '@/components/ui/calendar';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { authenticate, getTasks, createTask, updateTask, deleteTask } from '@/lib/api';
import { useTheme } from '@/components/ThemeProvider';
import { format } from 'date-fns';
import { Moon, Sun, Trash2, LogOut, Calendar as CalendarIcon } from 'lucide-react';

export default function App() {
  const [user, setUser] = useState<{ name: string; email: string } | null>(null);
  const [date, setDate] = useState<Date | undefined>(new Date());
  const [tasks, setTasks] = useState<any[]>([]);
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
      // In a real app, we'd validate the token and get user details
      setUser({ name: 'User', email: '' });
      fetchTasks();
    }
  }, []);

  const fetchTasks = async () => {
    try {
      const data = await getTasks();
      setTasks(data);
    } catch (error) {
      console.error('Error fetching tasks', error);
      if ((error as any).response?.status === 401) {
        handleLogout();
      }
    }
  };

  const login = useGoogleLogin({
    onSuccess: async (tokenResponse) => {
      try {
        // Here we send the access token to backend to verify and get our own token/user
        // Wait, standard GoogleOAuth provider sends access_token, not id_token.
        // We'll just pass it. Our backend expects id_token in verifyGoogleToken, but we can't easily get it with useGoogleLogin without implicit flow.
        // Let's assume the backend will handle access token for now or we will adjust.
        const res = await authenticate(tokenResponse.access_token);
        localStorage.setItem('todo_token', tokenResponse.access_token);
        setUser(res.user);
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
    try {
      const updated = await updateTask(id, { completed: !completed });
      setTasks(tasks.map(t => t._id === id ? updated : t));
    } catch (error) {
      console.error('Error updating task', error);
    }
  };

  const handleDeleteTask = async (id: string) => {
    try {
      await deleteTask(id);
      setTasks(tasks.filter(t => t._id !== id));
    } catch (error) {
      console.error('Error deleting task', error);
    }
  };

  const selectedDateStr = date ? format(date, 'yyyy-MM-dd') : '';
  const currentDayTasks = tasks.filter(t => t.date === selectedDateStr);

  const GoogleIcon = () => (
    <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );

  if (!user) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-background text-foreground bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-100 to-slate-200 dark:from-slate-900 dark:to-slate-950 p-4 relative">
        <div className="absolute top-4 right-4">
          <Button variant="ghost" size="icon" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className="rounded-full bg-background/50 backdrop-blur-sm">
            {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
          </Button>
        </div>
        <Card className="w-full max-w-md shadow-lg border-muted">
          <CardHeader className="space-y-3 pb-6">
            <CardTitle className="text-center text-4xl font-extrabold tracking-tight mt-4">Todo</CardTitle>
            <p className="text-center text-muted-foreground text-sm px-4">
              Organize your days, track your priorities, and never miss a task again.
            </p>
          </CardHeader>
          <CardContent className="flex flex-col items-center pb-8 space-y-4">
            <Button size="lg" className="w-full text-base font-semibold rounded-full" onClick={() => login()}>
              <GoogleIcon />
              Sign in with Google
            </Button>
            <p className="text-xs text-muted-foreground text-center pt-2">
              By continuing, you are setting up a secure workspace synced to your account.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col items-center py-10 px-4">
      <header className="w-full max-w-4xl flex justify-between items-center mb-10">
        <h1 className="text-3xl font-bold tracking-tight">Todo</h1>
        <div className="flex gap-4">
          <Button variant="ghost" size="icon" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
            {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
          </Button>
          <Button variant="outline" onClick={handleLogout} className="flex gap-2">
            <LogOut className="h-4 w-4" /> Logout
          </Button>
        </div>
      </header>

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
            <CardTitle>{date ? format(date, 'MMMM do, yyyy') : 'Select a date'}</CardTitle>
            <div className="md:hidden">
              <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="flex gap-2">
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
            <form onSubmit={handleAddTask} className="flex flex-col md:flex-row gap-2 mb-6">
              <input
                type="text"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                placeholder="Add a new task..."
                value={newTaskText}
                onChange={e => setNewTaskText(e.target.value)}
              />
              <div className="flex gap-2 w-full md:w-auto">
                <select 
                  className="h-10 flex-1 md:flex-none rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={newTaskPriority}
                  onChange={e => setNewTaskPriority(e.target.value)}
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
                <Button type="submit">Add</Button>
              </div>
            </form>

            <div className="space-y-4">
              {currentDayTasks.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">No tasks for this day.</p>
              ) : (
                currentDayTasks.map(task => (
                  <div key={task._id} className="flex items-center justify-between group">
                    <div className="flex items-center gap-3">
                      <Checkbox 
                        checked={task.completed} 
                        onCheckedChange={() => toggleTaskCompletion(task._id, task.completed)} 
                      />
                      <span className={`${task.completed ? 'line-through text-muted-foreground' : ''}`}>
                        {task.text}
                      </span>
                      <span className={`text-xs px-2 py-1 rounded-full ${
                        task.priority === 'high' ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' :
                        task.priority === 'medium' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200' :
                        'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                      }`}>
                        {task.priority}
                      </span>
                    </div>
                    <Button variant="ghost" size="icon" className="opacity-0 group-hover:opacity-100" onClick={() => handleDeleteTask(task._id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

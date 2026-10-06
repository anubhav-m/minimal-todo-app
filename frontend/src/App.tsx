import { useState, useEffect, useRef } from 'react';
import { useGoogleLogin, googleLogout } from '@react-oauth/google';
import { Calendar } from '@/components/ui/calendar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { authenticate, getTasks, createTask, setTaskCompleted, deleteTask } from '@/lib/api';
import { createClientIdSource, createDraft, createMutationTracker, createSingleFlight, createToggleQueue, loadFreshSnapshot } from '@/lib/taskSync';
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
  // Local date (yyyy-MM-dd) of the last successful fetch, i.e. the last day rollover ran for
  const lastFetchDay = useRef('');
  // Bumped on logout; anything still in flight from the previous session must not touch this one
  const session = useRef(0);
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
  const fetchFlight = useRef(createSingleFlight<void>()).current;
  const draft = useRef(createDraft()).current;
  const clientIds = useRef(createClientIdSource()).current;
  const deleting = useRef(new Set<string>()).current;
  const toggleQueue = useRef(createToggleQueue<any>({
    send: setTaskCompleted,
    tracker,
    onConfirmed: (task, desired) => {
      updateTasks(current => current.map(t => t._id === task._id ? { ...task, completed: desired } : t));
    },
    onFailed: (id, confirmed, error) => {
      console.error('Error updating task', error);
      updateTasks(current => current.map(t => t._id === id ? { ...t, completed: confirmed } : t));
    },
    // Deleted on another device: drop it here too
    onGone: (id) => updateTasks(current => current.filter(t => t._id !== id)),
  })).current;

  const changeNewTaskText = (text: string) => {
    draft.set(text);
    setNewTaskText(text);
  };

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

  // Rollover catch-up: refetch once the local day has moved past the last fetch.
  // A sleeping tab misses the midnight timer, so becoming visible checks too.
  useEffect(() => {
    if (!user) return;
    let midnightTimer: number;
    const armMidnightTimer = () => {
      window.clearTimeout(midnightTimer);
      const now = new Date();
      const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      midnightTimer = window.setTimeout(catchUp, nextMidnight.getTime() - now.getTime() + 1000);
    };
    const catchUp = () => {
      if (format(new Date(), 'yyyy-MM-dd') > lastFetchDay.current) fetchTasks(true);
      armMidnightTimer();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') catchUp();
    };

    armMidnightTimer();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(midnightTimer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [user]);

  // Mount, login, the midnight timer and a tab becoming visible can all ask at once;
  // they share one request.
  const fetchTasks = async (silent = false) => {
    if (!silent) setIsLoading(true);
    const startedIn = session.current;
    const localToday = format(new Date(), 'yyyy-MM-dd');
    try {
      await fetchFlight(`${startedIn}:${localToday}`, async () => {
        const { data, fresh } = await loadFreshSnapshot<any[]>(
          tracker,
          () => getTasks(localToday, Intl.DateTimeFormat().resolvedOptions().timeZone)
        );
        if (startedIn !== session.current) return;

        if (fresh) {
          updateTasks(() => data);
          lastFetchDay.current = localToday;
        } else if (!hasLoaded.current) {
          // Nothing on screen yet, so show it, keeping anything added while it loaded.
          // A snapshot that overlapped a local change is otherwise left for the next catch-up.
          updateTasks(current => [...data, ...current.filter(t => !data.some(d => d._id === t._id))]);
        }
        hasLoaded.current = true;
      });
    } catch (error) {
      console.error('Error fetching tasks', error);
      if (startedIn === session.current && (error as any).response?.status === 401) {
        handleLogout();
      }
    } finally {
      if (!silent) setIsLoading(false);
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
    session.current++;
    hasLoaded.current = false;
    lastFetchDay.current = '';
    setUser(null);
    updateTasks(() => []);
    setDate(new Date());
  };

  const handleAddTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!date) return;
    // Taken, not read: a second submit before the re-render finds nothing to add
    const text = draft.take();
    if (!text) return;

    const startedIn = session.current;
    const payload = { text, date: format(date, 'yyyy-MM-dd'), priority: newTaskPriority };
    const clientId = clientIds.idFor(payload);
    setNewTaskText('');

    const done = tracker.begin();
    try {
      const newTask = await createTask({ ...payload, clientId });
      clientIds.succeeded(clientId);
      if (startedIn !== session.current) return;
      updateTasks(current => current.some(t => t._id === newTask._id) ? current : [...current, newTask]);
    } catch (error) {
      console.error('Error creating task', error);
      // The server may have saved it anyway; the same clientId makes a retry safe
      clientIds.failed(payload, clientId);
      if (startedIn === session.current && draft.restore(text)) setNewTaskText(text);
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
  };

  const handleDeleteTask = async (id: string) => {
    const taskToDelete = tasksRef.current.find(t => t._id === id);
    if (!taskToDelete || deleting.has(id)) return;
    deleting.add(id);
    const startedIn = session.current;
    updateTasks(current => current.filter(t => t._id !== id));
    const done = tracker.begin();
    try {
      await deleteTask(id);
    } catch (error) {
      console.error('Error deleting task', error);
      if (startedIn === session.current) {
        updateTasks(current => current.some(t => t._id === id) ? current : [...current, taskToDelete]);
      }
    } finally {
      deleting.delete(id);
      done();
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
              setNewTaskText={changeNewTaskText} 
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

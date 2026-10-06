import { Bell, Clock, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';

interface TaskListProps {
  isLoading: boolean;
  // The list could not be fetched and there is nothing to show in its place
  loadFailed: boolean;
  onRetry: () => void;
  tasks: any[];
  selectedDateStr: string;
  onToggleCompletion: (id: string) => void;
  onDelete: (id: string) => void;
}

const PRIORITY_STYLES: Record<string, string> = {
  high: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  medium: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  low: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
};

export function TaskList({
  isLoading,
  loadFailed,
  onRetry,
  tasks,
  selectedDateStr,
  onToggleCompletion,
  onDelete
}: TaskListProps) {
  return (
    <div key={selectedDateStr} className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
      {isLoading ? (
        <>
          <div className="flex items-center space-x-4 p-2 -mx-2">
            <Skeleton className="h-4 w-4 rounded-sm" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-12 rounded-full" />
          </div>
          <div className="flex items-center space-x-4 p-2 -mx-2">
            <Skeleton className="h-4 w-4 rounded-sm" />
            <Skeleton className="h-4 w-[60%]" />
            <Skeleton className="h-4 w-12 rounded-full" />
          </div>
          <div className="flex items-center space-x-4 p-2 -mx-2">
            <Skeleton className="h-4 w-4 rounded-sm" />
            <Skeleton className="h-4 w-[40%]" />
            <Skeleton className="h-4 w-12 rounded-full" />
          </div>
        </>
      ) : loadFailed ? (
        // Not the empty message: the tasks exist, they just did not arrive
        <div role="alert" className="flex flex-col items-center gap-3 py-8 text-center">
          <p>Couldn't load your tasks.</p>
          <p className="text-sm text-muted-foreground">Check your connection and try again.</p>
          <Button variant="outline" onClick={onRetry}>Try again</Button>
        </div>
      ) : tasks.length === 0 ? (
        <p className="text-center text-muted-foreground py-8">Nothing planned for this day. Add a task above.</p>
      ) : (
        tasks.map(task => (
          <div key={task._id} className="flex items-center justify-between group p-2 -mx-2 rounded-md hover:bg-muted/50 transition-colors">
            <label
              htmlFor={`task-${task._id}`}
              className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer"
            >
              <Checkbox
                id={`task-${task._id}`}
                checked={task.completed}
                onCheckedChange={() => onToggleCompletion(task._id)}
              />
              <span className={`min-w-0 break-words ${task.completed ? 'line-through text-muted-foreground' : ''}`}>
                {task.text}
              </span>
              {task.time && (
                <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" aria-hidden="true" />
                  {task.time}
                  {task.notify && <Bell className="h-3 w-3 text-primary" aria-label="reminder set on phone" />}
                </span>
              )}
              {PRIORITY_STYLES[task.priority] && (
                <span className={`shrink-0 text-xs px-2 py-1 rounded-full ${PRIORITY_STYLES[task.priority]}`}>
                  {task.priority}
                </span>
              )}
            </label>
            {/* Hidden until hover only where hover exists; always shown on touch screens and on keyboard focus */}
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Delete ${task.text}`}
              className="shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
              onClick={() => onDelete(task._id)}
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        ))
      )}
    </div>
  );
}

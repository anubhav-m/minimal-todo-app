import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';

interface TaskListProps {
  isLoading: boolean;
  tasks: any[];
  selectedDateStr: string;
  onToggleCompletion: (id: string, completed: boolean) => void;
  onDelete: (id: string) => void;
}

export function TaskList({
  isLoading,
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
      ) : tasks.length === 0 ? (
        <p className="text-center text-muted-foreground py-8">No tasks for this day.</p>
      ) : (
        tasks.map(task => (
          <div key={task._id} className="flex items-center justify-between group p-2 -mx-2 rounded-md hover:bg-muted/50 transition-colors">
            <label
              htmlFor={`task-${task._id}`}
              className="flex items-center gap-3 flex-1 cursor-pointer"
            >
              <Checkbox
                id={`task-${task._id}`}
                checked={task.completed}
                onCheckedChange={() => onToggleCompletion(task._id, task.completed)}
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
            </label>
            <Button variant="ghost" size="icon" className="opacity-0 group-hover:opacity-100" onClick={() => onDelete(task._id)}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        ))
      )}
    </div>
  );
}

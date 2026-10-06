import { Button } from '@/components/ui/button';

interface TaskFormProps {
  newTaskText: string;
  setNewTaskText: (text: string) => void;
  newTaskPriority: string;
  setNewTaskPriority: (priority: string) => void;
  onSubmit: (e: React.FormEvent) => void;
}

// Same limit as the server; see backend/utils/taskValidation.js
const MAX_TASK_TEXT = 1000;

export function TaskForm({
  newTaskText,
  setNewTaskText,
  newTaskPriority,
  setNewTaskPriority,
  onSubmit
}: TaskFormProps) {
  return (
    <form onSubmit={onSubmit} className="flex flex-col md:flex-row gap-3 mb-6">
      <input
        type="text"
        aria-label="New task"
        maxLength={MAX_TASK_TEXT}
        className="flex h-12 w-full rounded-md border border-input bg-background px-5 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        placeholder="Add a task"
        value={newTaskText}
        onChange={e => setNewTaskText(e.target.value)}
      />
      <div className="flex gap-3 w-full md:w-auto">
        <select
          aria-label="Priority"
          className="h-12 flex-1 md:flex-none rounded-md border border-input bg-background px-5 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          value={newTaskPriority}
          onChange={e => setNewTaskPriority(e.target.value)}
        >
          <option value="none">No priority</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
        <Button className='h-12 flex-1' type="submit" disabled={!newTaskText.trim()}>Add Task</Button>
      </div>
    </form>
  );
}

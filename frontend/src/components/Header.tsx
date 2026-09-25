import { Moon, Sun, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface HeaderProps {
  theme: "dark" | "light" | "system";
  setTheme: (theme: "dark" | "light" | "system") => void;
  onLogout: () => void;
}

export function Header({ theme, setTheme, onLogout }: HeaderProps) {
  return (
    <header className="w-full max-w-4xl flex justify-between items-center mb-10">
      <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight">
        <img src="/logo.png" alt="Todo App Logo" className="w-8 h-8 object-contain" />
        Todo
      </h1>
      <div className="flex gap-4">
        <Button variant="ghost" size="icon" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
          {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </Button>
        <Button variant="outline" onClick={onLogout} className="flex gap-2 h-10">
          <LogOut className="h-4 w-4" /> Logout
        </Button>
      </div>
    </header>
  );
}

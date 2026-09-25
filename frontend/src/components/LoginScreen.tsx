import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const GoogleIcon = () => (
  <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
  </svg>
);

interface LoginScreenProps {
  theme: "dark" | "light" | "system";
  setTheme: (theme: "dark" | "light" | "system") => void;
  onLogin: () => void;
}

export function LoginScreen({ theme, setTheme, onLogin }: LoginScreenProps) {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background text-foreground bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-100 to-slate-200 dark:from-slate-900 dark:to-slate-950 p-4 relative">
      <div className="absolute top-4 right-4">
        <Button variant="ghost" size="icon" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className="rounded-full bg-background/50 backdrop-blur-sm">
          {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </Button>
      </div>
      <Card className="w-full max-w-md shadow-lg border-muted">
        <CardHeader className="space-y-3 pb-6">
          <CardTitle className="flex items-center justify-center gap-4 text-center text-4xl font-extrabold tracking-tight mt-4">
            <img src="/logo.png" alt="Todo App Logo" className="w-10 h-10 object-contain" />
            Todo
          </CardTitle>
          <p className="text-center text-muted-foreground text-sm px-4">
            Organize your days, track your priorities, and never miss a task again.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col items-center pb-8 space-y-4">
          <Button size="lg" className="w-full text-base font-semibold rounded-full" onClick={onLogin}>
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

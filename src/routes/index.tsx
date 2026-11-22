import { createFileRoute, Navigate } from '@tanstack/react-router';
import { Spinner } from '@/components/ui/spinner';
import { useAuthStore } from '@/stores/auth';

export const Route = createFileRoute('/')({
  component: IndexRedirect,
});

function IndexRedirect() {
  const user = useAuthStore((state) => state.user);
  const restoring = useAuthStore((state) => state.restoring);

  if (restoring) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background">
        <Spinner className="size-6 text-primary" />
      </div>
    );
  }

  return <Navigate to={user ? '/dashboard' : '/login'} replace />;
}

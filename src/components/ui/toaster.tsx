'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

type Toast = { id: number; title: string; description?: string; variant?: 'default' | 'error' | 'success' };

const ToastCtx = React.createContext<{
  toast: (t: Omit<Toast, 'id'>) => void;
}>({ toast: () => {} });

export function useToast() {
  return React.useContext(ToastCtx);
}

export function Toaster() {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const idRef = React.useRef(1);

  const toast = React.useCallback((t: Omit<Toast, 'id'>) => {
    const id = idRef.current++;
    setToasts((prev) => [...prev, { ...t, id }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== id));
    }, 4000);
  }, []);

  return (
    <ToastCtx.Provider value={{ toast }}>
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              'pointer-events-auto flex w-80 flex-col gap-1 rounded-lg border p-4 shadow-lg animate-fade-in',
              t.variant === 'error'
                ? 'border-kumo-danger/30 bg-kumo-danger-tint text-kumo-danger'
                : t.variant === 'success'
                  ? 'border-kumo-success/30 bg-kumo-success-tint text-kumo-success'
                  : 'border-kumo-line bg-kumo-elevated text-kumo-default',
            )}
          >
            <span className="text-sm font-semibold">{t.title}</span>
            {t.description && (
              <span className="text-xs opacity-80">{t.description}</span>
            )}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export interface SwitchProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  size?: 'sm' | 'default';
}

const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(
  ({ className, size = 'default', ...props }, ref) => (
    <label className="relative inline-flex cursor-pointer items-center">
      <input
        ref={ref}
        type="checkbox"
        className="peer sr-only"
        {...props}
      />
      <span
        className={cn(
          'relative inline-flex shrink-0 cursor-pointer appearance-none rounded-full border border-transparent transition-colors',
          'bg-muted peer-checked:bg-primary',
          'peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2',
          'after:absolute after:top-0.5 after:left-0.5 after:rounded-full after:bg-white after:shadow after:transition-transform',
          'after:content-[""] peer-checked:after:translate-x-full',
          size === 'sm' ? 'h-5 w-9 after:h-4 after:w-4' : 'h-6 w-11 after:h-5 after:w-5',
          className,
        )}
      />
    </label>
  ),
);
Switch.displayName = 'Switch';

export { Switch };

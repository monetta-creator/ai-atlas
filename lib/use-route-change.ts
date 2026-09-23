'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';

// The persistent-chrome rule: the rail, header bar and agent orb render once
// in the root layout (since 6585809) and no longer remount on a client
// navigation, so whatever the per-page remount used to reset must be reset on
// navigation explicitly. These hooks are React's derived-state recipe (a
// guarded setState during render, which react-hooks/set-state-in-render
// allows): the callback runs in the render that first sees the new value.

export function useValueChange<T>(value: T, onChange: (v: T) => void): void {
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    onChange(value);
  }
}

export function usePathnameChange(onChange: (path: string) => void): void {
  useValueChange(usePathname(), onChange);
}

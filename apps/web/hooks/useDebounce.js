"use client";

import { useState, useEffect } from "react";

/**
 * Debounce a value by the given delay in milliseconds.
 * Returns the debounced value which updates only after
 * the caller stops changing the input for `delay` ms.
 */
export function useDebounce(value, delay = 300) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

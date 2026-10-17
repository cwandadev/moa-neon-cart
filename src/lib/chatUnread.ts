import { useSyncExternalStore } from "react";

let count = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function setChatUnread(n: number) {
  if (n === count) return;
  count = n;
  emit();
}

export function bumpChatUnread() {
  count += 1;
  emit();
}

export function useChatUnread() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => count,
    () => 0,
  );
}

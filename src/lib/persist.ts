import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

/*
 * Remembers UI state for the life of the browser tab (sessionStorage), so a reload brings people
 * back to where they were. Only values that differ from the default are stored, writes are batched,
 * and everything is flushed when the page is hidden or unloaded.
 */

const MAX_BYTES = 200_000;
const pending = new Map<string, string | null>();
let timer: number | undefined;
let listening = false;

function flush() {
  if (typeof window === "undefined") return;
  window.clearTimeout(timer);
  timer = undefined;
  for (const [k, v] of pending) {
    try {
      if (v === null) window.sessionStorage.removeItem(k);
      else window.sessionStorage.setItem(k, v);
    } catch {
      /* storage full or blocked: the state simply is not remembered */
    }
  }
  pending.clear();
}

function queue(key: string, json: string | null) {
  if (typeof window === "undefined") return;
  pending.set(key, json);
  if (!listening) {
    listening = true;
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush();
    });
  }
  window.clearTimeout(timer);
  timer = window.setTimeout(flush, 200);
}

function readStored<T>(key: string): { found: true; value: T } | { found: false } {
  if (typeof window === "undefined") return { found: false };
  try {
    const waiting = pending.get(key);
    const raw = waiting !== undefined ? waiting : window.sessionStorage.getItem(key);
    if (raw === null || raw === undefined) return { found: false };
    return { found: true, value: JSON.parse(raw) as T };
  } catch {
    return { found: false };
  }
}

/** Forget everything remembered under a key prefix (for example after a successful save). */
export function clearPersisted(prefix: string) {
  if (typeof window === "undefined") return;
  for (const k of [...pending.keys()]) if (k.startsWith(prefix)) pending.delete(k);
  try {
    for (let i = window.sessionStorage.length - 1; i >= 0; i--) {
      const k = window.sessionStorage.key(i);
      if (k && k.startsWith(prefix)) window.sessionStorage.removeItem(k);
    }
  } catch {
    /* ignore */
  }
}

/**
 * Same as useState, but remembered across reloads of this tab.
 * Pages that are rendered on the server restore after load (no hydration mismatch).
 * Components that only exist on the client (dialogs) can use { sync: true } to restore on the first render.
 */
export function usePersistedState<T>(
  key: string,
  initial: T | (() => T),
  opts?: { sync?: boolean },
): [T, Dispatch<SetStateAction<T>>] {
  const sync = opts?.sync === true;
  const resolveInitial = (): T => (typeof initial === "function" ? (initial as () => T)() : initial);

  const [value, setValue] = useState<T>(() => {
    if (sync) {
      const s = readStored<T>(key);
      if (s.found) return s.value;
    }
    return resolveInitial();
  });

  const initialJson = useRef<string | null>(null);
  if (initialJson.current === null) {
    try {
      initialJson.current = JSON.stringify(resolveInitial()) ?? "undefined";
    } catch {
      initialJson.current = "";
    }
  }

  const ready = useRef(false);
  const skipWrite = useRef(false);
  const lastKey = useRef(key);

  useEffect(() => {
    if (sync) {
      ready.current = true;
      return;
    }
    const s = readStored<T>(key);
    if (s.found) setValue(s.value);
    else if (lastKey.current !== key) setValue(resolveInitial());
    lastKey.current = key;
    skipWrite.current = true;
    ready.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, sync]);

  useEffect(() => {
    if (!ready.current) return;
    if (skipWrite.current) {
      skipWrite.current = false;
      return;
    }
    let json: string | undefined;
    try {
      json = JSON.stringify(value);
    } catch {
      return;
    }
    if (json === undefined || json === initialJson.current || json.length > MAX_BYTES) queue(key, null);
    else queue(key, json);
  }, [key, value]);

  return [value, setValue];
}

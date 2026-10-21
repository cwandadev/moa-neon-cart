import { createContext, useContext } from "react";
import type { AdminAlerts } from "@/lib/adminAlerts";

const CLEAR = { level: "green", count: 0, label: "All clear" } as const;

/** What needs attention right now. The frame computes it once; any admin page can read it without asking the database again. */
export const AlertsContext = createContext<AdminAlerts>({ orders: CLEAR, inventory: CLEAR, inbox: CLEAR, worst: "green" });

export const useShellAlerts = (): AdminAlerts => useContext(AlertsContext);

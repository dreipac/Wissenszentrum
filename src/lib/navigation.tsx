import { createContext, useContext } from "react";

export type ViewId = "dashboard" | "tasks" | "calendar" | "notes" | "docs" | "assistant" | "trading" | "strategies";

/** Erlaubt jeder Ansicht, zu einem anderen Bereich zu wechseln (z. B. Dashboard → Notizen). */
export const NavigationContext = createContext<(view: ViewId) => void>(() => {});

export const useNavigate = () => useContext(NavigationContext);

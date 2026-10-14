import { useEffect, useState, type ComponentType } from "react";
import { TitleBar } from "./components/layout/TitleBar";
import { Sidebar } from "./components/layout/Sidebar";
import { NavigationContext, type ViewId } from "./lib/navigation";
import { DashboardView } from "./views/DashboardView";
import { TasksView } from "./views/TasksView";
import { CalendarView } from "./views/CalendarView";
import { NotesView } from "./views/NotesView";
import { DocsView } from "./views/DocsView";
import { TradingView } from "./views/TradingView";
import { StrategiesView } from "./views/StrategiesView";
import { DialogsProvider } from "./lib/dialogs";
import "./App.css";

const views: Record<ViewId, ComponentType> = {
  dashboard: DashboardView,
  tasks: TasksView,
  calendar: CalendarView,
  notes: NotesView,
  docs: DocsView,
  trading: TradingView,
  strategies: StrategiesView,
};

const SIDEBAR_KEY = "sidebarCollapsed";

function App() {
  const [view, setView] = useState<ViewId>("dashboard");
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === "1";
    } catch {
      return false;
    }
  });
  const View = views[view];

  const toggleSidebar = () => setCollapsed((c) => !c);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_KEY, collapsed ? "1" : "0");
    } catch {
      /* Speichern ist nur Komfort */
    }
  }, [collapsed]);

  // Strg+B blendet die Seitenleiste ein/aus
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setCollapsed((c) => !c);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <NavigationContext.Provider value={setView}>
      <DialogsProvider>
        <div className="app-shell">
          <TitleBar sidebarCollapsed={collapsed} onToggleSidebar={toggleSidebar} />
          <div className="app-body">
            <Sidebar active={view} onNavigate={setView} collapsed={collapsed} />
            <main className="app-content">
              <View />
            </main>
          </div>
        </div>
      </DialogsProvider>
    </NavigationContext.Provider>
  );
}

export default App;

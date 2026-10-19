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
import { Onboarding } from "./components/onboarding/Onboarding";
import { DialogsProvider } from "./lib/dialogs";
import { getAppState } from "./lib/api/app";
import { ProfileProvider, type AppState } from "./lib/profile";
import { SyncProvider } from "./lib/useSync";
import { EditorThemeProvider } from "./lib/editorTheme";
import { SyncBanner } from "./components/sync/SyncBanner";
import { CommandPalette } from "./components/search/CommandPalette";
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

function Main() {
  const [view, setView] = useState<ViewId>("dashboard");
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [searchOpen, setSearchOpen] = useState(false);
  const View = views[view];

  const toggleSidebar = () => setCollapsed((c) => !c);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_KEY, collapsed ? "1" : "0");
    } catch {
      /* Speichern ist nur Komfort */
    }
  }, [collapsed]);

  // Strg+B blendet die Seitenleiste ein/aus, Strg+K öffnet den Schnellzugriff
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key === "b") {
        e.preventDefault();
        setCollapsed((c) => !c);
      } else if (key === "k") {
        e.preventDefault();
        setSearchOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <NavigationContext.Provider value={setView}>
      <DialogsProvider>
        <div className="app-shell">
          <TitleBar sidebarCollapsed={collapsed} onToggleSidebar={toggleSidebar} onSearch={() => setSearchOpen(true)} />
          <div className="app-body">
            <Sidebar active={view} onNavigate={setView} collapsed={collapsed} />
            <main className="app-content">
              <View />
            </main>
            <SyncBanner />
          </div>
        </div>
        {searchOpen && <CommandPalette onClose={() => setSearchOpen(false)} onToggleSidebar={toggleSidebar} />}
      </DialogsProvider>
    </NavigationContext.Provider>
  );
}

function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAppState()
      .then(setState)
      .catch((e) => setError(String(e)));
  }, []);

  if (state?.onboarded && state.profile) {
    return (
      <ProfileProvider profile={state.profile} dbPath={state.dbPath} onChange={(profile) => setState((prev) => (prev ? { ...prev, profile } : prev))}>
        <SyncProvider>
          <EditorThemeProvider>
            <Main />
          </EditorThemeProvider>
        </SyncProvider>
      </ProfileProvider>
    );
  }
  if (state) return <Onboarding state={state} onDone={setState} />;

  // Kurz beim Start, bis der Zustand da ist: nur der leere Rahmen, damit nichts aufblitzt
  return (
    <div className="app-shell">
      <TitleBar minimal />
      {error && <p className="field-error app-error">Das Wissenszentrum konnte nicht gestartet werden: {error}</p>}
    </div>
  );
}

export default App;

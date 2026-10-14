import {
  BookOpen,
  CalendarDays,
  CheckSquare,
  LayoutDashboard,
  NotebookText,
  Plus,
  Settings,
  HelpCircle,
  DatabaseBackup,
  type LucideIcon,
} from "lucide-react";
import { Button } from "../ui/Button";
import { SecondaryButton } from "../ui/SecondaryButton";
import { useDialogs } from "../../lib/dialogs";
import { useTasks } from "../../lib/useTasks";
import "./Sidebar.css";

export type ViewId = "dashboard" | "tasks" | "calendar" | "notes" | "docs";

const navItems: { id: ViewId; label: string; icon: LucideIcon }[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "tasks", label: "Aufgaben", icon: CheckSquare },
  { id: "calendar", label: "Kalender", icon: CalendarDays },
  { id: "notes", label: "Notizen", icon: NotebookText },
  { id: "docs", label: "Dokumentation", icon: BookOpen },
];

interface SidebarProps {
  active: ViewId;
  onNavigate: (view: ViewId) => void;
  collapsed: boolean;
}

export function Sidebar({ active, onNavigate, collapsed }: SidebarProps) {
  const { tasks, buckets } = useTasks();
  const { openNewTask, openNewBucket } = useDialogs();
  const openCount = tasks.filter((t) => !t.done).length;

  return (
    <aside className={`sidebar${collapsed ? " collapsed" : ""}`} aria-hidden={collapsed} inert={collapsed}>
      <div className="sidebar-inner">
        <div className="sidebar-actions">
          <Button className="sidebar-action-btn" onClick={() => openNewTask()}>
            <Plus size={16} />
            Neue Aufgabe
          </Button>
          <SecondaryButton className="sidebar-action-btn">
            <Plus size={16} />
            Neue Notiz
          </SecondaryButton>
        </div>

        <nav className="sidebar-nav">
          {navItems.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              className={`sidebar-link${active === id ? " active" : ""}`}
              onClick={() => onNavigate(id)}
            >
              <Icon size={17} strokeWidth={1.75} />
              <span className="sidebar-link-label">{label}</span>
              {id === "tasks" && openCount > 0 && <span className="sidebar-badge">{openCount}</span>}
            </button>
          ))}
        </nav>

        <div className="sidebar-section">
          <div className="sidebar-section-head">
            <span>Buckets</span>
            <button type="button" className="icon-btn" aria-label="Bucket hinzufügen" onClick={openNewBucket}>
              <Plus size={14} />
            </button>
          </div>
          <div className="sidebar-list">
            {buckets.length === 0 && <p className="sidebar-empty">Noch keine Buckets</p>}
            {buckets.map((b) => (
              <button key={b.id} type="button" className="sidebar-link small" onClick={() => onNavigate("tasks")}>
                <span className="sidebar-link-label">{b.name}</span>
                <span className="sidebar-count">{tasks.filter((t) => t.bucketId === b.id && !t.done).length}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="sidebar-footer">
          <div className="sidebar-user">
            <span className="avatar">AD</span>
            <div className="sidebar-user-text">
              <span className="sidebar-user-name">Armin</span>
              <span className="sidebar-user-sub">Lokaler Arbeitsbereich</span>
            </div>
          </div>
          <div className="sidebar-footer-actions">
            <button type="button" className="icon-btn" aria-label="Backup">
              <DatabaseBackup size={16} />
            </button>
            <button type="button" className="icon-btn" aria-label="Hilfe">
              <HelpCircle size={16} />
            </button>
            <button type="button" className="icon-btn" aria-label="Einstellungen">
              <Settings size={16} />
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}

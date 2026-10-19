import {
  BookOpen,
  CalendarDays,
  CheckSquare,
  LayoutDashboard,
  Network,
  NotebookText,
  TrendingUp,
  Plus,
  Settings,
  HelpCircle,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";
import { Button } from "../ui/Button";
import { SecondaryButton } from "../ui/SecondaryButton";
import { useDialogs } from "../../lib/dialogs";
import { useProfile } from "../../lib/profile";
import { bucketAccent } from "../../lib/tasks";
import { stateLabel, stateTone } from "../../lib/sync";
import { useSync } from "../../lib/useSync";
import "../sync/Sync.css";
import type { ViewId } from "../../lib/navigation";
import { createAndOpenNote } from "../../lib/notesActions";
import { useTasks } from "../../lib/useTasks";
import "./Sidebar.css";

export type { ViewId };

const navItems: { id: ViewId; label: string; icon: LucideIcon }[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "tasks", label: "Aufgaben", icon: CheckSquare },
  { id: "calendar", label: "Kalender", icon: CalendarDays },
  { id: "notes", label: "Notizen", icon: NotebookText },
  { id: "docs", label: "Dokumentation", icon: BookOpen },
];

const tradingItems: { id: ViewId; label: string; icon: LucideIcon }[] = [
  { id: "trading", label: "Trading", icon: TrendingUp },
  { id: "strategies", label: "Strategien", icon: Network },
];

interface SidebarProps {
  active: ViewId;
  onNavigate: (view: ViewId) => void;
  collapsed: boolean;
}

export function Sidebar({ active, onNavigate, collapsed }: SidebarProps) {
  const profile = useProfile();
  const sync = useSync();
  const { tasks, buckets } = useTasks();
  const { openNewTask, openNewBucket, openSettings, openBucketMenu, openBoardMenu } = useDialogs();
  const openCount = tasks.filter((t) => !t.done).length;

  return (
    <aside className={`sidebar${collapsed ? " collapsed" : ""}`} aria-hidden={collapsed} inert={collapsed}>
      <div className="sidebar-inner">
        <div className="sidebar-actions">
          <Button className="sidebar-action-btn" onClick={() => openNewTask()}>
            <Plus size={16} />
            Neue Aufgabe
          </Button>
          <SecondaryButton className="sidebar-action-btn" onClick={() => void createAndOpenNote(onNavigate)}>
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
            <span>Trading</span>
          </div>
          <div className="sidebar-list">
            {tradingItems.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                className={`sidebar-link${active === id ? " active" : ""}`}
                onClick={() => onNavigate(id)}
              >
                <Icon size={17} strokeWidth={1.75} />
                <span className="sidebar-link-label">{label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="sidebar-section">
          <div className="sidebar-section-head">
            <span>Buckets</span>
            <button type="button" className="icon-btn" aria-label="Bucket hinzufügen" onClick={openNewBucket}>
              <Plus size={14} />
            </button>
          </div>
          <div
            className="sidebar-list"
            onContextMenu={(e) => {
              e.preventDefault();
              if (e.target === e.currentTarget || (e.target as Element).closest(".sidebar-empty")) openBoardMenu(e.clientX, e.clientY);
            }}
          >
            {buckets.length === 0 && <p className="sidebar-empty">Noch keine Buckets</p>}
            {buckets.map((b) => (
              <button key={b.id} type="button" className="sidebar-link small"
                onClick={() => onNavigate("tasks")}
                onContextMenu={(e) => {
                  e.preventDefault();
                  openBucketMenu(b, e.clientX, e.clientY);
                }}
              >
                <span className={`sidebar-dot${b.color ? " colored" : ""}`} style={b.color ? { backgroundColor: bucketAccent(b) } : undefined} aria-hidden />
                <span className="sidebar-link-label">{b.name}</span>
                <span className="sidebar-count">{tasks.filter((t) => t.bucketId === b.id && !t.done).length}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="sidebar-footer">
          <div className="sidebar-user">
            <span className="avatar">{profile.initials}</span>
            <div className="sidebar-user-text">
              <span className="sidebar-user-name">{profile.fullName}</span>
              <span className="sidebar-user-sub">Lokaler Arbeitsbereich</span>
            </div>
          </div>
          <div className="sidebar-footer-actions">
            <button
              type="button"
              className={`icon-btn sync-btn ${stateTone(sync.status?.state ?? "off")}`}
              aria-label="Abgleich zwischen Rechnern"
              title={sync.status?.enabled ? `Abgleich: ${stateLabel[sync.status.state]}` : "Abgleich zwischen Rechnern einrichten"}
              onClick={() => openSettings("sync")}
            >
              <RefreshCw size={16} />
              <span className="sync-dot" aria-hidden />
            </button>
            <button type="button" className="icon-btn" aria-label="Hilfe">
              <HelpCircle size={16} />
            </button>
            <button type="button" className="icon-btn" aria-label="Einstellungen" title="Einstellungen" onClick={() => openSettings()}>
              <Settings size={16} />
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}

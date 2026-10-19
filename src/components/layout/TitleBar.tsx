import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, PanelLeftClose, PanelLeftOpen, Search, Square, X } from "lucide-react";
import { Logo } from "../ui/Logo";
import "./TitleBar.css";


interface TitleBarProps {
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  /** Öffnet den Schnellzugriff (Suche und Befehle) */
  onSearch?: () => void;
  /** Nur Marke und Fenstersteuerung, z. B. im Onboarding */
  minimal?: boolean;
}

export function TitleBar({ sidebarCollapsed = false, onToggleSidebar, onSearch, minimal = false }: TitleBarProps) {
  const ToggleIcon = sidebarCollapsed ? PanelLeftOpen : PanelLeftClose;
  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="titlebar-brand" data-tauri-drag-region>
        <Logo size={20} className="brand-logo" />
        <span className="brand-name" data-tauri-drag-region>
          Wissenszentrum
        </span>
        {!minimal && (
          <button
            type="button"
            className="icon-btn titlebar-toggle"
            aria-label={sidebarCollapsed ? "Seitenleiste einblenden" : "Seitenleiste ausblenden"}
            title={`${sidebarCollapsed ? "Seitenleiste einblenden" : "Seitenleiste ausblenden"} (Strg B)`}
            onClick={onToggleSidebar}
          >
            <ToggleIcon size={16} />
          </button>
        )}
      </div>

      {!minimal && (
        <button type="button" className="titlebar-search" aria-label="Suchen oder Befehl eingeben" onClick={onSearch}>
          <Search size={14} />
          <span>Suchen oder Befehl eingeben …</span>
          <span className="kbd">Strg K</span>
        </button>
      )}

      <div className="window-controls">
        <button
          type="button"
          className="window-control"
          aria-label="Minimieren"
          onClick={() => getCurrentWindow().minimize()}
        >
          <Minus size={14} />
        </button>
        <button
          type="button"
          className="window-control"
          aria-label="Maximieren"
          onClick={() => getCurrentWindow().toggleMaximize()}
        >
          <Square size={11} />
        </button>
        <button
          type="button"
          className="window-control close"
          aria-label="Schließen"
          onClick={() => getCurrentWindow().close()}
        >
          <X size={15} />
        </button>
      </div>
    </header>
  );
}

import { Eye, FolderOpen, PenLine, ArrowRight } from "lucide-react";
import { Button } from "../ui/Button";
import { SecondaryButton } from "../ui/SecondaryButton";
import type { DocEdit } from "../../lib/api/assistant";

/** Wie weit ein Vorschlag ist: offen, wird gerade übernommen, übernommen oder verworfen. */
export type DocEditStatus = "open" | "applying" | "applied" | "dismissed";

export interface DocEditItem {
  key: number;
  data: DocEdit;
  status: DocEditStatus;
  error?: string;
}

interface DocEditCardProps {
  item: DocEditItem;
  /** Öffnet die große Vorschau mit den hervorgehobenen Änderungen */
  onPreview: () => void;
  onDismiss: () => void;
  onShow: () => void;
}

/** „+3 neu · 1 ersetzt · 2 entfernt“ als farbige Marken. */
export function EditChips({ edit }: { edit: DocEdit }) {
  const { added, replaced, removed } = edit.stats;
  return (
    <div className="as-edit-chips">
      {added > 0 && <span className="add">+{added} neu</span>}
      {replaced > 0 && <span className="rep">{replaced} ersetzt</span>}
      {removed > 0 && <span className="del">{removed} entfällt</span>}
      {edit.newTitle && <span className="rep">neuer Titel</span>}
    </div>
  );
}

/**
 * Vorschlag des Assistenten, eine bestehende Seite der Dokumentation zu ändern, als kompakte Karte im Chat. Die
 * Änderungen prüft und bestätigt man in der großen Vorschau („Änderungen ansehen“): der Chat ist dafür zu schmal.
 */
export function DocEditCard({ item, onPreview, onDismiss, onShow }: DocEditCardProps) {
  const { data, status, error } = item;
  const done = status === "applied" || status === "dismissed";

  return (
    <article className={`as-proposal as-docedit ${status}`} aria-label={`Seitenänderung: ${data.title}`}>
      <header className="as-prop-head">
        <PenLine size={14} />
        <span>{status === "applied" ? "Seite geändert" : status === "dismissed" ? "Verworfen" : "Seite ändern"}</span>
      </header>

      <h3 className="as-prop-title">
        {data.title}
        {data.newTitle && (
          <span className="as-newtitle">
            <ArrowRight size={13} />
            {data.newTitle}
          </span>
        )}
      </h3>

      {data.path && (
        <p className="as-docs-target">
          <FolderOpen size={13} />
          <span>{data.path}</span>
        </p>
      )}

      <EditChips edit={data} />

      {error && !done && <p className="as-prop-error">{error}</p>}

      {!done && (
        <div className="as-prop-actions">
          <Button className="sm" disabled={status === "applying"} onClick={onPreview}>
            <Eye size={14} />
            {status === "applying" ? "Übernehme …" : "Änderungen ansehen"}
          </Button>
          <SecondaryButton className="sm" disabled={status === "applying"} onClick={onDismiss}>
            Verwerfen
          </SecondaryButton>
        </div>
      )}

      {status === "applied" && (
        <button type="button" className="as-prop-link" onClick={onShow}>
          Seite öffnen
        </button>
      )}
    </article>
  );
}

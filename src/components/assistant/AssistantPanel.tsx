import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowUp, BookOpen, CalendarDays, CalendarPlus, Check, CheckSquare, KeyRound, NotebookText, RotateCcw, ShieldCheck, SquarePen, Sparkles, X, type LucideIcon } from "lucide-react";
import { Button } from "../ui/Button";
import { EventModal } from "../calendar/EventModal";
import { ASSISTANT_CHANGED_EVENT, askAssistant, assistantStatus, modelLabel, type AssistantSource, type AssistantStatus, type EventProposal } from "../../lib/api/assistant";
import { createEvent, deleteEvent } from "../../lib/api/events";
import { useDialogs } from "../../lib/dialogs";
import { requestOpenDoc } from "../../lib/docsNav";
import { useNavigate } from "../../lib/navigation";
import { requestOpenNote } from "../../lib/notesNav";
import { requestOpen } from "../../lib/openTarget";
import { Markdown } from "./Markdown";
import { DeletionCard, type DeletionItem, type DeletionStatus } from "./DeletionCard";
import { ProposalCard, type ProposalItem, type ProposalStatus } from "./ProposalCard";
import "./Assistant.css";

interface Message {
  id: number;
  role: "user" | "assistant";
  text: string;
  steps?: string[];
  sources?: AssistantSource[];
  /** Vorgeschlagene Termine mit ihrem Stand */
  proposals?: ProposalItem[];
  /** Vorgeschlagene Löschungen mit ihrem Stand */
  deletions?: DeletionItem[];
  /** Fehlermeldung statt Antwort */
  error?: string;
}

const SUGGESTIONS: { icon: LucideIcon; text: string }[] = [
  { icon: CheckSquare, text: "Was steht heute an?" },
  { icon: CheckSquare, text: "Welche Aufgaben sind überfällig?" },
  { icon: CalendarDays, text: "Welche Termine habe ich diese Woche?" },
  { icon: BookOpen, text: "Gib mir einen Überblick über meine Dokumentation" },
  { icon: CalendarPlus, text: "Trag morgen um 10 Uhr einen Termin „Team-Abstimmung“ ein" },
];

/** Was der Assistent beim nächsten Mal über seine Vorschläge wissen muss: wurden sie angelegt oder verworfen? */
const STATUS_NOTE: Record<ProposalStatus, string> = {
  open: "noch nicht bestätigt",
  creating: "noch nicht bestätigt",
  created: "von der Person bestätigt und eingetragen",
  dismissed: "von der Person verworfen",
};

const DELETION_NOTE: Record<DeletionStatus, string> = {
  open: "noch nicht bestätigt",
  deleting: "noch nicht bestätigt",
  deleted: "von der Person bestätigt und gelöscht",
  dismissed: "von der Person abgelehnt, der Termin bleibt",
};

const proposalNote = (proposals: ProposalItem[] | undefined, deletions: DeletionItem[] | undefined) =>
  [
    ...(proposals ?? []).map((p) => `\n[Terminvorschlag „${p.data.title}“ am ${p.data.startsAt}: ${STATUS_NOTE[p.status]}]`),
    ...(deletions ?? []).map((d) => `\n[Löschvorschlag für den Termin „${d.data.title}“ am ${d.data.startsAt}: ${DELETION_NOTE[d.status]}]`),
  ].join("");

/** Angaben eines Vorschlags für den Termin-Dialog (Bearbeiten). */
const draftOf = (p: EventProposal) => ({
  title: p.title,
  description: p.description,
  location: p.location,
  startsAt: p.startsAt,
  endsAt: p.endsAt,
  allDay: p.allDay,
});

interface AssistantPanelProps {
  open: boolean;
  onClose: () => void;
}

/** Seitenpanel rechts: Fragen an den Assistenten zu Aufgaben, Terminen, Notizen und Dokumentation. */
export function AssistantPanel({ open, onClose }: AssistantPanelProps) {
  const navigate = useNavigate();
  const { openSettings } = useDialogs();
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [liveSteps, setLiveSteps] = useState<string[]>([]);
  const nextId = useRef(1);
  /** Vorschlag, den die Person gerade im Termin-Dialog bearbeitet */
  const [editing, setEditing] = useState<{ messageId: number; key: number } | null>(null);
  /** Zählt die Anfragen: Antworten einer überholten Anfrage (neuer Chat, Schließen) werden verworfen */
  const request = useRef(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const loadStatus = useCallback(() => {
    assistantStatus()
      .then(setStatus)
      .catch(() => setStatus({ hasKey: false, model: "" }));
  }, []);

  // Zustand beim Öffnen und nach Änderungen in den Einstellungen neu laden
  useEffect(() => {
    if (open) loadStatus();
  }, [open, loadStatus]);

  useEffect(() => {
    window.addEventListener(ASSISTANT_CHANGED_EVENT, loadStatus);
    return () => window.removeEventListener(ASSISTANT_CHANGED_EVENT, loadStatus);
  }, [loadStatus]);

  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );

  // Eingabefeld wächst mit dem Text (bis zu einer Höchstgrenze)
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [draft]);

  const ready = status?.hasKey ?? true;

  // Beim Öffnen ins Eingabefeld springen
  useEffect(() => {
    if (open && ready) inputRef.current?.focus();
  }, [open, ready]);

  // Neue Nachrichten sichtbar halten
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, pending, liveSteps]);

  const run = async (history: Message[]) => {
    const mine = ++request.current;
    setPending(true);
    setLiveSteps([]);
    try {
      const turns = history.filter((m) => !m.error).map((m) => ({ role: m.role, text: m.text + proposalNote(m.proposals, m.deletions) }));
      const answer = await askAssistant(turns, (step) => {
        if (mine === request.current) setLiveSteps((s) => (s.includes(step) ? s : [...s, step]));
      });
      if (mine !== request.current) return;
      const proposals = (answer.proposals ?? []).map<ProposalItem>((data) => ({ key: nextId.current++, data, status: "open" }));
      const deletions = (answer.deletions ?? []).map<DeletionItem>((data) => ({ key: nextId.current++, data, status: "open" }));
      setMessages((m) => [...m, { id: nextId.current++, role: "assistant", text: answer.text, steps: answer.steps, sources: answer.sources, proposals, deletions }]);
    } catch (e) {
      if (mine !== request.current) return;
      setMessages((m) => [...m, { id: nextId.current++, role: "assistant", text: "", error: String(e) }]);
    } finally {
      if (mine === request.current) {
        setPending(false);
        setLiveSteps([]);
      }
    }
  };

  const send = (raw: string) => {
    const text = raw.trim();
    if (!text || pending || !ready) return;
    const history = [...messages.filter((m) => !m.error), { id: nextId.current++, role: "user" as const, text }];
    setMessages(history);
    setDraft("");
    void run(history);
  };

  const retry = () => {
    if (pending) return;
    const history = messages.filter((m) => !m.error);
    setMessages(history);
    void run(history);
  };

  const patchProposal = (messageId: number, key: number, patch: Partial<ProposalItem>) =>
    setMessages((list) =>
      list.map((m) => (m.id === messageId ? { ...m, proposals: m.proposals?.map((p) => (p.key === key ? { ...p, ...patch } : p)) } : m)),
    );

  /** „Anlegen“: trägt den Termin über dieselbe Funktion ein wie der Termin-Dialog. */
  const createProposal = async (messageId: number, item: ProposalItem) => {
    patchProposal(messageId, item.key, { status: "creating", error: undefined });
    try {
      const { title, description, location, startsAt, endsAt, allDay } = item.data;
      const event = await createEvent({ title, description, location, startsAt, endsAt, allDay });
      patchProposal(messageId, item.key, { status: "created", eventId: event.id });
    } catch (e) {
      patchProposal(messageId, item.key, { status: "open", error: String(e) });
    }
  };

  const patchDeletion = (messageId: number, key: number, patch: Partial<DeletionItem>) =>
    setMessages((list) =>
      list.map((m) => (m.id === messageId ? { ...m, deletions: m.deletions?.map((d) => (d.key === key ? { ...d, ...patch } : d)) } : m)),
    );

  /** „Termin löschen“: löscht über dieselbe Funktion wie der Termin-Dialog. */
  const deleteProposal = async (messageId: number, item: DeletionItem) => {
    patchDeletion(messageId, item.key, { status: "deleting", error: undefined });
    try {
      await deleteEvent(item.data.id);
      patchDeletion(messageId, item.key, { status: "deleted" });
    } catch (e) {
      patchDeletion(messageId, item.key, { status: "open", error: String(e) });
    }
  };

  const showInCalendar = (item: ProposalItem) => {
    if (item.eventId !== undefined) requestOpen({ kind: "event", id: item.eventId, date: item.data.startsAt.slice(0, 10) });
    navigate("calendar");
  };

  const reset = () => {
    request.current++;
    setMessages([]);
    setDraft("");
    setPending(false);
    setLiveSteps([]);
    inputRef.current?.focus();
  };

  const openSource = (source: AssistantSource) => {
    if (source.kind === "doc") {
      requestOpenDoc(source.id);
      navigate("docs");
    } else {
      requestOpenNote(source.id);
      navigate("notes");
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(draft);
    }
  };

  const empty = messages.length === 0 && !pending;
  const lastIsError = messages[messages.length - 1]?.error !== undefined;

  return (
    <aside className={`assistant${open ? "" : " collapsed"}`} aria-label="Assistent" aria-hidden={!open} inert={!open}>
      <div className="as-inner">
        <header className="as-head">
          <div className="as-title">
            <Sparkles size={15} />
            <span>Assistent</span>
            {status?.hasKey && status.model && <span className="tag">{modelLabel(status.model)}</span>}
          </div>
          <div className="as-head-actions">
            <button type="button" className="icon-btn" aria-label="Neuer Chat" title="Neuer Chat" disabled={empty} onClick={reset}>
              <SquarePen size={15} />
            </button>
            <button type="button" className="icon-btn" aria-label="Assistent schließen" title="Schließen (Strg J)" onClick={onClose}>
              <X size={16} />
            </button>
          </div>
        </header>

        <div className="as-body" ref={bodyRef}>
          {!ready ? (
            <div className="as-empty">
              <span className="as-empty-icon">
                <KeyRound size={18} />
              </span>
              <h2>Assistent einrichten</h2>
              <p>Hinterlege deinen API-Key von Anthropic, dann kannst du Fragen zu deinen Aufgaben, Terminen, Notizen und deiner Dokumentation stellen.</p>
              <Button className="as-setup" onClick={() => openSettings("assistant")}>
                Einstellungen öffnen
              </Button>
            </div>
          ) : empty ? (
            <div className="as-empty">
              <span className="as-empty-icon">
                <Sparkles size={18} />
              </span>
              <h2>Wie kann ich helfen?</h2>
              <p>Frag mich zu deinen Aufgaben, Terminen, Notizen und deiner Dokumentation.</p>
              <div className="as-suggestions">
                {SUGGESTIONS.map(({ icon: Icon, text }) => (
                  <button key={text} type="button" className="as-suggest" onClick={() => send(text)}>
                    <Icon size={15} />
                    <span>{text}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {messages.map((m) =>
                m.role === "user" ? (
                  <div key={m.id} className="as-user">
                    {m.text}
                  </div>
                ) : m.error ? (
                  <div key={m.id} className="as-error" role="alert">
                    <AlertTriangle size={15} />
                    <div>
                      <p>{m.error}</p>
                      {lastIsError && m.id === messages[messages.length - 1].id && (
                        <button type="button" className="as-retry" disabled={pending} onClick={retry}>
                          <RotateCcw size={12} />
                          Noch einmal versuchen
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div key={m.id} className="as-reply">
                    {m.steps && m.steps.length > 0 && <Steps steps={m.steps} />}
                    <Markdown text={m.text} />
                    {m.proposals && m.proposals.length > 0 && (
                      <div className="as-proposals">
                        {m.proposals.map((p) => (
                          <ProposalCard
                            key={p.key}
                            item={p}
                            onCreate={() => void createProposal(m.id, p)}
                            onEdit={() => setEditing({ messageId: m.id, key: p.key })}
                            onDismiss={() => patchProposal(m.id, p.key, { status: "dismissed", error: undefined })}
                            onShow={() => showInCalendar(p)}
                          />
                        ))}
                      </div>
                    )}
                    {m.deletions && m.deletions.length > 0 && (
                      <div className="as-proposals">
                        {m.deletions.map((d) => (
                          <DeletionCard
                            key={d.key}
                            item={d}
                            onDelete={() => void deleteProposal(m.id, d)}
                            onKeep={() => patchDeletion(m.id, d.key, { status: "dismissed", error: undefined })}
                          />
                        ))}
                      </div>
                    )}
                    {m.sources && m.sources.length > 0 && (
                      <div className="as-sources">
                        <span className="as-label">Quellen</span>
                        <div className="as-chips">
                          {m.sources.map((s) => (
                            <button key={`${s.kind}-${s.id}`} type="button" className="as-chip" title={s.title} onClick={() => openSource(s)}>
                              {s.kind === "doc" ? <BookOpen size={12} /> : <NotebookText size={12} />}
                              <span>{s.title}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ),
              )}
              {pending && (
                <div className="as-pending" role="status">
                  <div className="as-pending-row">
                    <span className="as-dots" aria-hidden>
                      <i />
                      <i />
                      <i />
                    </span>
                    <span>{liveSteps.length ? "Denkt nach …" : "Liest deinen Stand …"}</span>
                  </div>
                  {liveSteps.length > 0 && <Steps steps={liveSteps} />}
                </div>
              )}
            </>
          )}
        </div>

        <div className="as-composer">
          <div className="as-box">
            <textarea
              ref={inputRef}
              rows={1}
              value={draft}
              disabled={!ready}
              placeholder={ready ? "Frag etwas zu deinem Stand …" : "Erst den API-Key hinterlegen …"}
              aria-label="Nachricht an den Assistenten"
              spellCheck={false}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKey}
            />
            <div className="as-box-foot">
              <span className="as-scope" title="Der Assistent liest nur. Einen Termin einzutragen oder zu löschen schlägt er vor; es passiert erst, wenn du bestätigst.">
                <ShieldCheck size={13} />
                Ändert nichts ohne dein OK
              </span>
              <button type="button" className="as-send" aria-label="Senden" disabled={!draft.trim() || pending || !ready} onClick={() => send(draft)}>
                <ArrowUp size={15} strokeWidth={2.25} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {editing &&
        (() => {
          const item = messages.find((m) => m.id === editing.messageId)?.proposals?.find((p) => p.key === editing.key);
          if (!item) return null;
          return (
            <EventModal
              draft={draftOf(item.data)}
              onClose={() => setEditing(null)}
              // Gespeichert über den Dialog: der Vorschlag gilt als eingetragen
              onChanged={() => patchProposal(editing.messageId, editing.key, { status: "created", error: undefined })}
            />
          );
        })()}
    </aside>
  );
}

function Steps({ steps }: { steps: string[] }) {
  return (
    <ul className="as-steps">
      {steps.map((s) => (
        <li key={s}>
          <Check size={12} />
          {s}
        </li>
      ))}
    </ul>
  );
}

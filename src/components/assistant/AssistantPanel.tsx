import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowUp, BookOpen, CalendarDays, CalendarPlus, Check, CheckSquare, FolderKanban, ListPlus, Maximize2, PanelRight, PenLine, KeyRound, NotebookText, RotateCcw, ShieldCheck, SquarePen, Sparkles, X, type LucideIcon } from "lucide-react";
import { Button } from "../ui/Button";
import { EventModal } from "../calendar/EventModal";
import { ASSISTANT_CHANGED_EVENT, askAssistant, assistantStatus, modelLabel, type AssistantSource, type AssistantStatus, type EventProposal } from "../../lib/api/assistant";
import { createEvent, deleteEvent, updateEvent } from "../../lib/api/events";
import { createTask, deleteTask, setTaskDone, updateTask } from "../../lib/api/tasks";
import { applyDocEdit, createDocTree } from "../../lib/api/docs";
import type { EventInput } from "../../lib/calendar";
import { useTasks } from "../../lib/useTasks";
import { TaskModal } from "../tasks/TaskModal";
import type { Priority, TaskInput } from "../../lib/tasks";
import { useDialogs } from "../../lib/dialogs";
import { requestOpenDoc } from "../../lib/docsNav";
import { useNavigate } from "../../lib/navigation";
import { requestOpenNote } from "../../lib/notesNav";
import { requestOpen } from "../../lib/openTarget";
import { useDocs } from "../../lib/useDocs";
import { useProjects } from "../../lib/useProjects";
import { docPath, type Project } from "../../lib/projects";
import { ProjectBar } from "./ProjectBar";
import { ProjectModal } from "./ProjectModal";
import { Markdown } from "./Markdown";
import { ActionCard, type ActionItem, type ActionStatus } from "./ActionCard";
import { DocEditCard, type DocEditItem, type DocEditStatus } from "./DocEditCard";
import { DocEditOverlay } from "./DocEditOverlay";
import { DocsPreviewOverlay } from "./DocsPreviewOverlay";
import { DocsProposalCard, type DocsItem, type DocsStatus } from "./DocsProposalCard";
import { BucketChoiceCard, type BucketChoiceItem } from "./BucketChoiceCard";
import { DeletionCard, type DeletionItem, type DeletionStatus } from "./DeletionCard";
import { TaskProposalCard, type TaskProposalItem, type TaskProposalStatus } from "./TaskProposalCard";
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
  /** Vorgeschlagene Aufgaben mit ihrem Stand */
  tasks?: TaskProposalItem[];
  /** Vorgeschlagene Änderungen an Bestehendem mit ihrem Stand */
  actions?: ActionItem[];
  /** Vorgeschlagene Ordner und Seiten der Dokumentation mit ihrem Stand */
  docs?: DocsItem[];
  /** Vorgeschlagene Änderungen an bestehenden Seiten mit ihrem Stand */
  docEdits?: DocEditItem[];
  /** Bucket-Auswahl vor einem Aufgabenvorschlag */
  choices?: BucketChoiceItem[];
  /** Fehlermeldung statt Antwort */
  error?: string;
}

const SUGGESTIONS: { icon: LucideIcon; text: string }[] = [
  { icon: CheckSquare, text: "Was steht heute an?" },
  { icon: CheckSquare, text: "Welche Aufgaben sind überfällig?" },
  { icon: CalendarDays, text: "Welche Termine habe ich diese Woche?" },
  { icon: BookOpen, text: "Gib mir einen Überblick über meine Dokumentation" },
  { icon: CalendarPlus, text: "Trag morgen um 10 Uhr einen Termin „Team-Abstimmung“ ein" },
  { icon: ListPlus, text: "Leg eine neue Aufgabe „Angebot überarbeiten“ an" },
  { icon: BookOpen, text: "Leg in der Dokumentation einen Ordner mit Seiten für ein Projekt an" },
  { icon: PenLine, text: "Überarbeite die Seite „Überblick“ in meiner Dokumentation" },
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

const TASK_NOTE: Record<TaskProposalStatus, string> = {
  open: "noch nicht bestätigt",
  creating: "noch nicht bestätigt",
  created: "von der Person bestätigt und angelegt",
  dismissed: "von der Person verworfen",
};

const ACTION_NOTE: Record<ActionStatus, string> = {
  open: "noch nicht bestätigt",
  working: "noch nicht bestätigt",
  done: "von der Person bestätigt und ausgeführt",
  dismissed: "von der Person abgelehnt, es bleibt wie es ist",
};

const DOCS_NOTE: Record<DocsStatus, string> = {
  open: "noch nicht bestätigt",
  creating: "noch nicht bestätigt",
  created: "von der Person bestätigt und angelegt",
  dismissed: "von der Person verworfen",
};

const EDIT_NOTE: Record<DocEditStatus, string> = {
  open: "noch nicht bestätigt, die Seite ist unverändert",
  applying: "noch nicht bestätigt, die Seite ist unverändert",
  applied: "von der Person bestätigt und übernommen: lies die Seite neu, bevor du weiter änderst",
  dismissed: "von der Person verworfen, die Seite ist unverändert",
};

const proposalNote = (
  proposals: ProposalItem[] | undefined,
  deletions: DeletionItem[] | undefined,
  tasks: TaskProposalItem[] | undefined,
  actions: ActionItem[] | undefined,
  docs: DocsItem[] | undefined,
  docEdits: DocEditItem[] | undefined,
) =>
  [
    ...(docEdits ?? []).map((e) => `\n[Änderungsvorschlag für die Seite „${e.data.title}“ (id ${e.data.pageId}): ${EDIT_NOTE[e.status]}]`),
    ...(docs ?? []).map((d) => `\n[Vorschlag für die Dokumentation (${d.data.parentPath}: ${d.data.nodes.map((n) => n.title).join(", ")}): ${DOCS_NOTE[d.status]}]`),
    ...(actions ?? []).map((a) => `\n[Vorschlag ${a.data.kind} für „${a.data.title}“ (id ${a.data.id}): ${ACTION_NOTE[a.status]}]`),
    ...(tasks ?? []).map((t) => `\n[Aufgabenvorschlag „${t.data.title}“ (Bucket: ${t.data.bucketName ?? "Ohne Bucket"}): ${TASK_NOTE[t.status]}]`),
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

/** Vorschläge, wenn ein Projekt mit Dokumentation gewählt ist: Fragen und Aufträge zu diesem Bereich. */
const PROJECT_SUGGESTIONS: { icon: LucideIcon; text: string }[] = [
  { icon: BookOpen, text: "Gib mir einen Überblick über diesen Bereich" },
  { icon: BookOpen, text: "Welche Seiten fehlen hier noch?" },
  { icon: PenLine, text: "Leg hier eine neue Seite an" },
  { icon: CheckSquare, text: "Welche Aufgaben und Termine passen dazu?" },
];

const PROJECT_KEY = "assistantProject";
const NO_MESSAGES: Message[] = [];

interface AssistantPanelProps {
  open: boolean;
  onClose: () => void;
  /** "panel": schmale Seitenleiste rechts, "page": große Ansicht mit der Leiste der Projekte */
  mode?: "panel" | "page";
  /** Öffnet die große Ansicht (nur in der Seitenleiste) */
  onExpand?: () => void;
  /** Zurück zur Seitenleiste (nur in der großen Ansicht) */
  onCollapse?: () => void;
}

/**
 * Der Assistent: Fragen zu Aufgaben, Terminen, Notizen und Dokumentation. Als Seitenleiste oder als große Ansicht mit
 * Projekten; es ist dieselbe Instanz, das Gespräch geht beim Wechsel also weiter. Je Projekt gibt es ein eigenes Gespräch.
 */
export function AssistantPanel({ open, onClose, mode = "panel", onExpand, onCollapse }: AssistantPanelProps) {
  const navigate = useNavigate();
  const page = mode === "page";
  const { openSettings } = useDialogs();
  const { pages } = useDocs();
  const { projects } = useProjects();
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  // Das aktive Projekt gibt dem Gespräch seinen Kontext; je Projekt bleibt das Gespräch für diese Sitzung erhalten
  const [activeId, setActiveId] = useState<number | null>(() => {
    try {
      const saved = localStorage.getItem(PROJECT_KEY);
      return saved ? Number(saved) : null;
    } catch {
      return null;
    }
  });
  const project = projects.find((p) => p.id === activeId) ?? null;
  const [projectModal, setProjectModal] = useState<{ project?: Project } | null>(null);
  const [chats, setChats] = useState<Record<string, Message[]>>({});
  const chatKey = project ? String(project.id) : "none";
  const messages = chats[chatKey] ?? NO_MESSAGES;
  const setMessages = (next: Message[] | ((m: Message[]) => Message[])) =>
    setChats((all) => ({ ...all, [chatKey]: typeof next === "function" ? next(all[chatKey] ?? NO_MESSAGES) : next }));
  const contextPath = project ? docPath(pages, project.docId) : "";
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [liveSteps, setLiveSteps] = useState<string[]>([]);
  const nextId = useRef(1);
  /** Vorschlag, den die Person gerade im Termin-Dialog bearbeitet */
  const [editing, setEditing] = useState<{ messageId: number; key: number } | null>(null);
  const [editingTask, setEditingTask] = useState<{ messageId: number; key: number } | null>(null);
  /** Dokumentationsvorschlag, dessen große Vorschau gerade in der Mitte des Fensters offen ist */
  const [docsPreview, setDocsPreview] = useState<{ messageId: number; key: number } | null>(null);
  /** Seitenänderung, deren Vorschau mit den hervorgehobenen Änderungen gerade offen ist */
  const [editPreview, setEditPreview] = useState<{ messageId: number; key: number } | null>(null);
  /** Gewählter Bucket je Auswahlkarte (Schlüssel der Karte → Name) */
  const [chosen, setChosen] = useState<Record<number, string>>({});
  const { buckets } = useTasks();
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
      const turns = history.filter((m) => !m.error).map((m) => ({ role: m.role, text: m.text + proposalNote(m.proposals, m.deletions, m.tasks, m.actions, m.docs, m.docEdits) }));
      const answer = await askAssistant(turns, project?.id ?? null, (step) => {
        if (mine === request.current) setLiveSteps((s) => (s.includes(step) ? s : [...s, step]));
      });
      if (mine !== request.current) return;
      const proposals = (answer.proposals ?? []).map<ProposalItem>((data) => ({ key: nextId.current++, data, status: "open" }));
      const deletions = (answer.deletions ?? []).map<DeletionItem>((data) => ({ key: nextId.current++, data, status: "open" }));
      const tasks = (answer.tasks ?? []).map<TaskProposalItem>((data) => ({ key: nextId.current++, data, status: "open" }));
      const choices = (answer.choices ?? []).map<BucketChoiceItem>((data) => ({ key: nextId.current++, data }));
      const actions = (answer.actions ?? []).map<ActionItem>((data) => ({ key: nextId.current++, data, status: "open" }));
      const docs = (answer.docs ?? []).map<DocsItem>((data) => ({ key: nextId.current++, data, status: "open" }));
      const docEdits = (answer.docEdits ?? []).map<DocEditItem>((data) => ({ key: nextId.current++, data, status: "open" }));
      const messageId = nextId.current++;
      // Ein neuer Vorschlag für dieselbe Seite ersetzt den alten, der noch offen ist
      const replaced = new Set(docEdits.map((e) => e.data.pageId));
      setMessages((m) => [
        ...m.map((msg) =>
          msg.docEdits?.some((e) => e.status === "open" && replaced.has(e.data.pageId))
            ? { ...msg, docEdits: msg.docEdits.map((e) => (e.status === "open" && replaced.has(e.data.pageId) ? { ...e, status: "dismissed" as const } : e)) }
            : msg,
        ),
        { id: messageId, role: "assistant", text: answer.text, steps: answer.steps, sources: answer.sources, proposals, deletions, tasks, choices, actions, docs, docEdits },
      ]);
      if (docEdits.length > 0) setEditPreview({ messageId, key: docEdits[0].key });
      // Seiteninhalte sind für den schmalen Chat zu groß: die Vorschau öffnet sich gleich in der Mitte des Fensters
      if (docs.length > 0) setDocsPreview({ messageId, key: docs[0].key });
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

  const patchTask = (messageId: number, key: number, patch: Partial<TaskProposalItem>) =>
    setMessages((list) => list.map((m) => (m.id === messageId ? { ...m, tasks: m.tasks?.map((t) => (t.key === key ? { ...t, ...patch } : t)) } : m)));

  /** „Anlegen“: legt die Aufgabe über dieselbe Funktion an wie der Aufgaben-Dialog. */
  const createTaskProposal = async (messageId: number, item: TaskProposalItem) => {
    patchTask(messageId, item.key, { status: "creating", error: undefined });
    try {
      const { title, description, priority, dueDate, bucketId, subtasks } = item.data;
      await createTask({
        title,
        description,
        priority: priority as Priority,
        dueDate,
        startDate: null,
        bucketId,
        showSubtasks: false,
        showDescription: false,
        eventId: null,
        eventOffset: null,
        subtasks: subtasks.map((s) => ({ id: null, title: s, done: false })),
      });
      patchTask(messageId, item.key, { status: "created" });
    } catch (e) {
      patchTask(messageId, item.key, { status: "open", error: String(e) });
    }
  };

  const patchEdit = (messageId: number, key: number, patch: Partial<DocEditItem>) =>
    setMessages((list) => list.map((m) => (m.id === messageId ? { ...m, docEdits: m.docEdits?.map((e) => (e.key === key ? { ...e, ...patch } : e)) } : m)));

  /** „Änderungen übernehmen“: setzt die bestätigte Änderung um; die Seite darf sich seit dem Vorschlag nicht geändert haben. */
  const applyEdit = async (messageId: number, item: DocEditItem) => {
    patchEdit(messageId, item.key, { status: "applying", error: undefined });
    try {
      await applyDocEdit(item.data.pageId, item.data.baseUpdatedAt, item.data.newTitle, item.data.ops);
      patchEdit(messageId, item.key, { status: "applied" });
      setEditPreview(null);
    } catch (e) {
      patchEdit(messageId, item.key, { status: "open", error: String(e) });
    }
  };

  const patchDocs = (messageId: number, key: number, patch: Partial<DocsItem>) =>
    setMessages((list) => list.map((m) => (m.id === messageId ? { ...m, docs: m.docs?.map((d) => (d.key === key ? { ...d, ...patch } : d)) } : m)));

  /** „Anlegen“: legt Ordner und Seiten samt Inhalt in einem Zug an (ganz oder gar nicht). */
  const createDocs = async (messageId: number, item: DocsItem) => {
    patchDocs(messageId, item.key, { status: "creating", error: undefined });
    try {
      const ids = await createDocTree(item.data.parentId, item.data.nodes);
      patchDocs(messageId, item.key, { status: "created", firstId: ids[0] });
      setDocsPreview(null);
    } catch (e) {
      patchDocs(messageId, item.key, { status: "open", error: String(e) });
    }
  };

  const patchAction = (messageId: number, key: number, patch: Partial<ActionItem>) =>
    setMessages((list) => list.map((m) => (m.id === messageId ? { ...m, actions: m.actions?.map((a) => (a.key === key ? { ...a, ...patch } : a)) } : m)));

  /** Führt eine bestätigte Änderung über dieselben Funktionen aus wie die Dialoge der App. */
  const runAction = async (messageId: number, item: ActionItem) => {
    patchAction(messageId, item.key, { status: "working", error: undefined });
    const { kind, id, input } = item.data;
    try {
      if (kind === "task_done") await setTaskDone(id, true);
      else if (kind === "task_reopen") await setTaskDone(id, false);
      else if (kind === "task_delete") await deleteTask(id);
      else if (kind === "task_update") await updateTask(id, input as TaskInput);
      else await updateEvent(id, input as EventInput);
      patchAction(messageId, item.key, { status: "done" });
    } catch (e) {
      patchAction(messageId, item.key, { status: "open", error: String(e) });
    }
  };

  const showAction = (item: ActionItem) => {
    if (item.data.kind === "event_update") {
      const at = (item.data.input as EventInput | null)?.startsAt ?? item.data.startsAt ?? "";
      requestOpen({ kind: "event", id: item.data.id, date: at.slice(0, 10) });
      navigate("calendar");
    } else navigate("tasks");
  };

  /** Die Wahl in der Bucket-Karte geht als Nachricht an den Assistenten, der danach die Aufgabe vorschlägt. */
  const chooseBucket = (item: BucketChoiceItem, name: string | null) => {
    if (pending) return;
    const label = name ?? "Ohne Bucket";
    setChosen((c) => ({ ...c, [item.key]: label }));
    send(`Bucket: ${label}`);
  };

  const showInCalendar = (item: ProposalItem) => {
    if (item.eventId !== undefined) requestOpen({ kind: "event", id: item.eventId, date: item.data.startsAt.slice(0, 10) });
    navigate("calendar");
  };

  const selectProject = (id: number | null) => {
    if (pending) return;
    setActiveId(id);
    try {
      localStorage.setItem(PROJECT_KEY, id === null ? "" : String(id));
    } catch {
      /* Speichern ist nur Komfort */
    }
    // Offene Vorschauen gehören zum Gespräch des bisherigen Projekts
    setDocsPreview(null);
    setEditPreview(null);
    setEditing(null);
    setEditingTask(null);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  const reset = () => {
    request.current++;
    setMessages([]);
    setChosen({});
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
  const suggestions = project?.docId != null && contextPath ? PROJECT_SUGGESTIONS : SUGGESTIONS;
  const lastIsError = messages[messages.length - 1]?.error !== undefined;

  return (
    <aside className={`assistant${page ? " page" : ""}${open ? "" : " collapsed"}`} aria-label="Assistent" aria-hidden={!open} inert={!open}>
      {page && (
        <ProjectBar
          projects={projects}
          pages={pages}
          activeId={project?.id ?? null}
          disabled={pending}
          onSelect={selectProject}
          onCreate={() => setProjectModal({})}
          onEdit={(p) => setProjectModal({ project: p })}
        />
      )}
      <div className="as-inner">
        <header className="as-head">
          {page ? (
            <div className="as-page-title">
              <h1>{project?.name ?? "Assistent"}</h1>
              <span className="as-context">
                {project ? contextPath || (project.docId === null ? "Keine Dokumentation zugeordnet" : "Die zugeordnete Seite gibt es nicht mehr") : "Ohne festen Kontext: er sieht alle deine Daten"}
              </span>
            </div>
          ) : (
            <div className="as-title">
              <Sparkles size={15} />
              <span>Assistent</span>
              {status?.hasKey && status.model && <span className="tag">{modelLabel(status.model)}</span>}
            </div>
          )}
          <div className="as-head-actions">
            {page && status?.hasKey && status.model && <span className="tag as-model">{modelLabel(status.model)}</span>}
            <button type="button" className="icon-btn" aria-label="Neuer Chat" title="Neuer Chat" disabled={empty} onClick={reset}>
              <SquarePen size={15} />
            </button>
            {page ? (
              <button type="button" className="icon-btn" aria-label="Als Seitenleiste" title="Als Seitenleiste (Strg J)" onClick={onCollapse}>
                <PanelRight size={16} />
              </button>
            ) : (
              <>
                <button type="button" className="icon-btn" aria-label="Große Ansicht öffnen" title="Große Ansicht mit Projekten" onClick={onExpand}>
                  <Maximize2 size={15} />
                </button>
                <button type="button" className="icon-btn" aria-label="Assistent schließen" title="Schließen (Strg J)" onClick={onClose}>
                  <X size={16} />
                </button>
              </>
            )}
          </div>
        </header>

        {!page && project && (
          <button type="button" className="as-project-chip" title="Projekt wechseln: große Ansicht öffnen" onClick={onExpand}>
            <FolderKanban size={13} />
            <span>{project.name}</span>
          </button>
        )}

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
              <h2>{project ? `Was steht in „${project.name}“ an?` : "Wie kann ich helfen?"}</h2>
              <p>
                {project && contextPath
                  ? `Ich kenne den Bereich „${contextPath}“ und lege Neues dort an, wenn du nichts anderes sagst.`
                  : "Frag mich zu deinen Aufgaben, Terminen, Notizen und deiner Dokumentation."}
              </p>
              <div className="as-suggestions">
                {suggestions.map(({ icon: Icon, text }) => (
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
                    {m.choices && m.choices.length > 0 && (
                      <div className="as-proposals">
                        {m.choices.map((c) => (
                          <BucketChoiceCard key={c.key} item={{ ...c, chosen: chosen[c.key] }} disabled={pending || m.id !== messages[messages.length - 1]?.id} onChoose={(name) => chooseBucket(c, name)} />
                        ))}
                      </div>
                    )}
                    {m.tasks && m.tasks.length > 0 && (
                      <div className="as-proposals">
                        {m.tasks.map((t) => (
                          <TaskProposalCard
                            key={t.key}
                            item={t}
                            bucketColor={buckets.find((b) => b.id === t.data.bucketId)?.color ?? ""}
                            onCreate={() => void createTaskProposal(m.id, t)}
                            onEdit={() => setEditingTask({ messageId: m.id, key: t.key })}
                            onDismiss={() => patchTask(m.id, t.key, { status: "dismissed", error: undefined })}
                            onShow={() => navigate("tasks")}
                          />
                        ))}
                      </div>
                    )}
                    {m.docEdits && m.docEdits.length > 0 && (
                      <div className="as-proposals">
                        {m.docEdits.map((e) => (
                          <DocEditCard
                            key={e.key}
                            item={e}
                            onPreview={() => setEditPreview({ messageId: m.id, key: e.key })}
                            onDismiss={() => patchEdit(m.id, e.key, { status: "dismissed", error: undefined })}
                            onShow={() => {
                              requestOpenDoc(e.data.pageId);
                              navigate("docs");
                            }}
                          />
                        ))}
                      </div>
                    )}
                    {m.docs && m.docs.length > 0 && (
                      <div className="as-proposals">
                        {m.docs.map((d) => (
                          <DocsProposalCard
                            key={d.key}
                            item={d}
                            onPreview={() => setDocsPreview({ messageId: m.id, key: d.key })}
                            onDismiss={() => patchDocs(m.id, d.key, { status: "dismissed", error: undefined })}
                            onShow={() => {
                              if (d.firstId !== undefined) requestOpenDoc(d.firstId);
                              navigate("docs");
                            }}
                          />
                        ))}
                      </div>
                    )}
                    {m.actions && m.actions.length > 0 && (
                      <div className="as-proposals">
                        {m.actions.map((a) => (
                          <ActionCard
                            key={a.key}
                            item={a}
                            onConfirm={() => void runAction(m.id, a)}
                            onDismiss={() => patchAction(m.id, a.key, { status: "dismissed", error: undefined })}
                            onShow={() => showAction(a)}
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
              placeholder={ready ? (project ? `Frag etwas zu „${project.name}“ …` : "Frag etwas zu deinem Stand …") : "Erst den API-Key hinterlegen …"}
              aria-label="Nachricht an den Assistenten"
              spellCheck={false}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKey}
            />
            <div className="as-box-foot">
              <span className="as-scope" title="Der Assistent liest nur. Alles, was er anlegen, ändern oder löschen möchte (Aufgaben, Termine, neue Seiten), schlägt er vor; es passiert erst, wenn du bestätigst.">
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

      {projectModal && (
        <ProjectModal
          project={projectModal.project}
          onClose={() => setProjectModal(null)}
          // Ein neues oder geändertes Projekt wird gleich das aktive
          onSaved={(p) => selectProject(p.id)}
          onDeleted={(id) => id === activeId && selectProject(null)}
        />
      )}

      {editPreview &&
        (() => {
          const item = messages.find((m) => m.id === editPreview.messageId)?.docEdits?.find((e) => e.key === editPreview.key);
          if (!item || item.status === "applied" || item.status === "dismissed") return null;
          return (
            <DocEditOverlay
              item={item}
              onApply={() => void applyEdit(editPreview.messageId, item)}
              onClose={() => setEditPreview(null)}
              onDiscard={() => {
                patchEdit(editPreview.messageId, editPreview.key, { status: "dismissed", error: undefined });
                setEditPreview(null);
              }}
            />
          );
        })()}

      {docsPreview &&
        (() => {
          const item = messages.find((m) => m.id === docsPreview.messageId)?.docs?.find((d) => d.key === docsPreview.key);
          if (!item || item.status === "created" || item.status === "dismissed") return null;
          return (
            <DocsPreviewOverlay
              item={item}
              onCreate={() => void createDocs(docsPreview.messageId, item)}
              onClose={() => setDocsPreview(null)}
              onDiscard={() => {
                patchDocs(docsPreview.messageId, docsPreview.key, { status: "dismissed", error: undefined });
                setDocsPreview(null);
              }}
            />
          );
        })()}

      {editingTask &&
        (() => {
          const item = messages.find((m) => m.id === editingTask.messageId)?.tasks?.find((t) => t.key === editingTask.key);
          if (!item) return null;
          const { title, bucketId, priority, dueDate, description, subtasks } = item.data;
          return (
            <TaskModal
              draft={{ title, bucketId, priority: priority as Priority, dueDate, description, subtasks }}
              onClose={() => setEditingTask(null)}
              // Gespeichert über den Dialog: der Vorschlag gilt als angelegt
              onSaved={() => patchTask(editingTask.messageId, editingTask.key, { status: "created", error: undefined })}
            />
          );
        })()}

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

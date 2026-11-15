import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowUp, BookOpen, Paperclip, Square, CalendarDays, CalendarPlus, CheckSquare, FolderKanban, ListPlus, Maximize2, PanelRight, PenLine, Terminal, NotebookText, RotateCcw, ShieldCheck, SquarePen, Sparkles, X, type LucideIcon } from "lucide-react";
import { Button } from "../ui/Button";
import { EventModal } from "../calendar/EventModal";
import { ASSISTANT_CHANGED_EVENT, MAX_CHAT_FILES, askAssistant, assistantStatus, cancelAssistant, modelLabel, type AssistantSource, type AssistantStatus, type ChatFile, type EventProposal, type PlanItem, type TokenUsage } from "../../lib/api/assistant";
import { addAttachment } from "../../lib/api/attachments";
import { formatBytes, kindOf } from "../files/FileAttachment";
import { PlanList } from "./PlanList";
import { Activity, WorkLog, type FeedItem } from "./Activity";
import { UsageLine } from "./UsageLine";
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
import { addProjectFile, removeProjectFile } from "../../lib/api/projects";
import { docPath, type Project } from "../../lib/projects";
import { ChatSidebar } from "./ChatSidebar";
import { ChatHistory } from "./ChatHistory";
import { ProjectOverview } from "./ProjectOverview";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { useChats } from "../../lib/useChats";
import { createChat, deleteChat, loadChat, moveChat, pinChat, renameChat, saveChatMessage, type ChatInfo } from "../../lib/api/chats";
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
  /** Dateien, die die Person angehängt hat */
  files?: ChatFile[];
  /** Verbrauch der Antwort in Token */
  usage?: TokenUsage;
  /** Das Modell, das geantwortet hat */
  model?: string;
  /** Arbeitsplan, den der Assistent bei einem größeren Auftrag abgearbeitet hat */
  plan?: PlanItem[];
  steps?: string[];
  /** Gedanken und Schritte in der Reihenfolge, wie sie geschahen (der Arbeitsverlauf) */
  feed?: FeedItem[];
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

/** Der zuletzt offene Chat: nach dem Start geht es dort weiter */
const CHAT_KEY = "assistantChat";

/** Dinge, die nur während einer Aktion gelten (wird angelegt, wird gelöscht), gelten nach dem Neuladen als offen. */
const settle = (m: Message): Message => {
  const { error: _ignored, ...rest } = m;
  const open = <T extends { status: string; error?: string }>(items: T[] | undefined, busy: string): T[] | undefined =>
    items?.map((i) => {
      const { error: _e, ...item } = i;
      return (i.status === busy ? { ...item, status: "open" } : item) as T;
    });
  return {
    ...rest,
    proposals: open(m.proposals, "creating"),
    deletions: open(m.deletions, "deleting"),
    tasks: open(m.tasks, "creating"),
    actions: open(m.actions, "working"),
    docs: open(m.docs, "creating"),
    docEdits: open(m.docEdits, "applying"),
  };
};

/** Die höchste Nummer in einer Nachricht (ihre eigene und die ihrer Karten), damit neue Nummern nicht doppelt vorkommen. */
const highestKey = (m: Message): number =>
  Math.max(
    m.id,
    ...[m.proposals, m.deletions, m.tasks, m.actions, m.docs, m.docEdits, m.choices].flatMap((list) => (list ?? []).map((i) => (i as { key: number }).key)),
  );

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
  const { chats: chatList, loaded: chatsLoaded } = useChats();
  /** Der offene Chat; null = ein neuer, noch nicht gespeicherter (er entsteht mit der ersten Nachricht) */
  const [activeChatId, setActiveChatId] = useState<number | null>(() => {
    try {
      const saved = localStorage.getItem(CHAT_KEY);
      return saved ? Number(saved) : null;
    } catch {
      return null;
    }
  });
  /** Das Projekt des offenen Chats (oder des neuen): es gibt dem Gespräch seinen Kontext */
  const [activeId, setActiveId] = useState<number | null>(null);
  const project = projects.find((p) => p.id === activeId) ?? null;
  const activeChat = chatList.find((c) => c.id === activeChatId) ?? null;
  const [projectModal, setProjectModal] = useState<{ project?: Project } | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  /** Die Nachrichten eines gespeicherten Chats werden geladen */
  const [chatLoading, setChatLoading] = useState(activeChatId !== null);
  const [deleting, setDeleting] = useState<ChatInfo | null>(null);
  const contextPath = project ? docPath(pages, project.docId) : "";
  const [draft, setDraft] = useState("");
  /** Dateien für die nächste Nachricht: gespeichert sind sie schon, verschickt wird erst mit der Nachricht */
  const [files, setFiles] = useState<ChatFile[]>([]);
  const [uploading, setUploading] = useState(0);
  const [fileError, setFileError] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  /** Gedanken und Schritte, an denen der Assistent gerade arbeitet, in der Reihenfolge, wie sie geschehen */
  const [liveFeed, setLiveFeed] = useState<FeedItem[]>([]);
  /** Die Antwort, die gerade geschrieben wird */
  const [liveText, setLiveText] = useState("");
  const feedRef = useRef<FeedItem[]>([]);
  const pushFeed = (item: FeedItem) => {
    // Derselbe Schritt steht nur einmal im Verlauf
    if (item.kind === "step" && feedRef.current.some((x) => x.kind === "step" && x.text === item.text)) return;
    feedRef.current = [...feedRef.current, item];
    setLiveFeed(feedRef.current);
  };
  const resetLive = () => {
    feedRef.current = [];
    setLiveFeed([]);
    setLiveText("");
    setLivePlan([]);
  };
  /** Plan, an dem der Assistent gerade arbeitet */
  const [livePlan, setLivePlan] = useState<PlanItem[]>([]);
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
  /** Was zuletzt gespeichert wurde (Chat:Nachricht → JSON): geschrieben wird nur, was sich geändert hat */
  const saved = useRef<Map<string, string>>(new Map());

  const rememberChat = (id: number | null) => {
    try {
      if (id === null) localStorage.removeItem(CHAT_KEY);
      else localStorage.setItem(CHAT_KEY, String(id));
    } catch {
      /* Merken ist nur Komfort */
    }
  };

  /** Alles, was nur zum bisherigen Chat gehört: Entwurf, Dateien, offene Vorschauen. */
  const clearTransient = () => {
    setChosen({});
    setDraft("");
    setFiles([]);
    setFileError(null);
    resetLive();
    setDocsPreview(null);
    setEditPreview(null);
    setEditing(null);
    setEditingTask(null);
  };

  /** Lädt die gespeicherten Nachrichten eines Chats und macht ihn zum offenen. */
  const openChat = useCallback(async (info: ChatInfo) => {
    setChatLoading(true);
    try {
      const stored = await loadChat(info.id);
      const loaded: Message[] = [];
      saved.current = new Map();
      for (const item of stored) {
        try {
          const m = JSON.parse(item.payload) as Message;
          if (m && (m.role === "user" || m.role === "assistant")) {
            loaded.push({ ...m, id: item.seq });
            saved.current.set(`${info.id}:${item.seq}`, item.payload);
          }
        } catch {
          /* eine unlesbare Nachricht überspringen, der Rest bleibt */
        }
      }
      nextId.current = Math.max(0, ...loaded.map(highestKey)) + 1;
      setMessages(loaded);
      setActiveChatId(info.id);
      setActiveId(info.projectId);
      rememberChat(info.id);
    } catch {
      setMessages([]);
    } finally {
      setChatLoading(false);
    }
  }, []);

  // Nach dem Start: der zuletzt offene Chat geht weiter, falls es ihn noch gibt
  const restored = useRef(false);
  useEffect(() => {
    if (!chatsLoaded || restored.current) return;
    restored.current = true;
    if (activeChatId === null) return;
    const info = chatList.find((c) => c.id === activeChatId);
    if (info) void openChat(info);
    else {
      setActiveChatId(null);
      setChatLoading(false);
      rememberChat(null);
    }
  }, [chatsLoaded, chatList, activeChatId, openChat]);

  // Gespeichert wird beim Schreiben, kurz gebündelt: neue Nachrichten und geänderte Karten (bestätigt, verworfen)
  useEffect(() => {
    if (activeChatId === null || chatLoading) return;
    const chatId = activeChatId;
    const timer = window.setTimeout(() => {
      for (const m of messages) {
        if (m.error) continue;
        const json = JSON.stringify(settle(m));
        const key = `${chatId}:${m.id}`;
        if (saved.current.get(key) === json) continue;
        saved.current.set(key, json);
        void saveChatMessage(chatId, m.id, m.role, m.text, json).catch(() => saved.current.delete(key));
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [messages, activeChatId, chatLoading]);

  /** Dateien für den festen Kontext des Projekts */
  const [projectUploading, setProjectUploading] = useState(0);
  const [projectFileError, setProjectFileError] = useState<string | null>(null);
  const addProjectFiles = async (list: File[]) => {
    if (!project || list.length === 0) return;
    setProjectFileError(null);
    setProjectUploading((n) => n + 1);
    try {
      for (const file of list) {
        try {
          await addProjectFile(project.id, await addAttachment(file));
        } catch (e) {
          setProjectFileError(`${file.name}: ${String(e)}`);
        }
      }
    } finally {
      setProjectUploading((n) => n - 1);
    }
  };

  const loadStatus = useCallback(() => {
    assistantStatus()
      .then(setStatus)
      .catch(() => setStatus({ model: "", available: false, cliPath: "", configuredPath: "" }));
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

  const ready = status?.available ?? true;

  // Beim Öffnen ins Eingabefeld springen
  useEffect(() => {
    if (open && ready) inputRef.current?.focus();
  }, [open, ready]);

  // Neue Nachrichten sichtbar halten
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, pending, liveFeed, liveText]);

  const run = async (history: Message[]) => {
    const mine = ++request.current;
    setPending(true);
    resetLive();
    try {
      const turns = history
        .filter((m) => !m.error)
        .map((m) => ({ role: m.role, text: m.text + proposalNote(m.proposals, m.deletions, m.tasks, m.actions, m.docs, m.docEdits), files: m.files, model: m.model }));
      const answer = await askAssistant(
        turns,
        project?.id ?? null,
        (step) => {
          if (mine === request.current) pushFeed({ kind: "step", text: step });
        },
        (items) => {
          if (mine === request.current) setLivePlan(items);
        },
        {
          onText: (chunk) => {
            if (mine === request.current) setLiveText((t) => t + chunk);
          },
          // Steht nach dem Text ein Werkzeugaufruf, war es eine Arbeitsnotiz: sie wandert in den Verlauf
          onThought: (text) => {
            if (mine !== request.current) return;
            setLiveText("");
            pushFeed({ kind: "thought", text });
          },
          onRestart: () => {
            if (mine !== request.current) return;
            setLiveText("");
            feedRef.current = [];
            setLiveFeed([]);
          },
        },
      );
      if (mine !== request.current) return;
      const proposals = (answer.proposals ?? []).map<ProposalItem>((data) => ({ key: nextId.current++, data, status: "open" }));
      const deletions = (answer.deletions ?? []).map<DeletionItem>((data) => ({ key: nextId.current++, data, status: "open" }));
      const tasks = (answer.tasks ?? []).map<TaskProposalItem>((data) => ({ key: nextId.current++, data, status: "open" }));
      const choices = (answer.choices ?? []).map<BucketChoiceItem>((data) => ({ key: nextId.current++, data }));
      const actions = (answer.actions ?? []).map<ActionItem>((data) => ({ key: nextId.current++, data, status: "open" }));
      const docs = (answer.docs ?? []).map<DocsItem>((data) => ({ key: nextId.current++, data, status: "open" }));
      const docEdits = (answer.docEdits ?? []).map<DocEditItem>((data) => ({ key: nextId.current++, data, status: "open" }));
      const messageId = nextId.current++;
      // Der Verlauf wird jetzt festgehalten: die Anzeige setzt ihn zurück, bevor die Nachricht gebaut ist
      const feed = feedRef.current.length > 0 ? feedRef.current : undefined;
      // Ein neuer Vorschlag für dieselbe Seite ersetzt den alten, der noch offen ist
      const replaced = new Set(docEdits.map((e) => e.data.pageId));
      setMessages((m) => [
        ...m.map((msg) =>
          msg.docEdits?.some((e) => e.status === "open" && replaced.has(e.data.pageId))
            ? { ...msg, docEdits: msg.docEdits.map((e) => (e.status === "open" && replaced.has(e.data.pageId) ? { ...e, status: "dismissed" as const } : e)) }
            : msg,
        ),
        { id: messageId, role: "assistant", text: answer.text, steps: answer.steps, feed, sources: answer.sources, proposals, deletions, tasks, choices, actions, docs, docEdits, usage: answer.usage, plan: answer.plan, model: answer.model },
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
        resetLive();
      }
    }
  };

  /** Speichert die Dateien als Anhänge und merkt sie für die nächste Nachricht vor. */
  const addFiles = async (list: File[]) => {
    if (list.length === 0 || !ready) return;
    setFileError(null);
    const room = MAX_CHAT_FILES - files.length;
    if (list.length > room) setFileError(`Eine Nachricht trägt höchstens ${MAX_CHAT_FILES} Dateien.`);
    setUploading((n) => n + 1);
    try {
      for (const file of list.slice(0, Math.max(room, 0))) {
        try {
          const info = await addAttachment(file);
          setFiles((all) => [...all, info]);
        } catch (e) {
          setFileError(`${file.name}: ${String(e)}`);
        }
      }
    } finally {
      setUploading((n) => n - 1);
    }
  };

  const send = (raw: string) => {
    const typed = raw.trim();
    if ((!typed && files.length === 0) || pending || uploading > 0 || !ready) return;
    // Nur Dateien, ohne Text: der Assistent soll sie ansehen und fragen, was damit geschehen soll
    const text = typed || (files.length === 1 ? "Ich habe eine Datei angehängt." : "Ich habe Dateien angehängt.");
    const history = [...messages.filter((m) => !m.error), { id: nextId.current++, role: "user" as const, text, files: files.length ? files : undefined }];
    setMessages(history);
    setDraft("");
    setFiles([]);
    setFileError(null);
    // Der erste Satz eines neuen Chats legt ihn an (im Projekt, falls eines gewählt ist)
    if (activeChatId === null) {
      void createChat(activeId)
        .then((info) => {
          setActiveChatId(info.id);
          rememberChat(info.id);
        })
        .catch((e) => setFileError(`Der Chat konnte nicht gespeichert werden: ${String(e)}`));
    }
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

  /** Ein neuer Chat, ohne Projekt oder in einem Projekt. Eine laufende Arbeit wird dabei abgebrochen. */
  const newChat = (projectId: number | null) => {
    request.current++;
    // Läuft noch eine Arbeit im Hintergrund, soll sie aufhören: sonst läuft sie weiter und verbraucht Kontingent
    if (pending) void cancelAssistant();
    clearTransient();
    saved.current = new Map();
    setMessages([]);
    setActiveChatId(null);
    setActiveId(projectId);
    setChatLoading(false);
    setPending(false);
    rememberChat(null);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  const selectChat = (id: number) => {
    if (pending) return;
    const info = chatList.find((c) => c.id === id);
    if (!info) return;
    clearTransient();
    void openChat(info);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  const removeChat = async (chat: ChatInfo) => {
    setDeleting(null);
    try {
      await deleteChat(chat.id);
      saved.current = new Map();
      if (chat.id === activeChatId) newChat(null);
    } catch (e) {
      setFileError(String(e));
    }
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
        <ChatSidebar
          chats={chatList}
          projects={projects}
          activeChatId={activeChatId}
          activeProjectId={activeChatId === null ? activeId : null}
          disabled={pending}
          onNewChat={newChat}
          onSelectChat={selectChat}
          onSelectProject={(id) => newChat(id)}
          onCreateProject={() => setProjectModal({})}
          onEditProject={(p) => setProjectModal({ project: p })}
          onRename={(chat, title) => void renameChat(chat.id, title).catch((e) => setFileError(String(e)))}
          onPin={(chat, pinned) => void pinChat(chat.id, pinned).catch((e) => setFileError(String(e)))}
          onMove={(chat, projectId) =>
            void moveChat(chat.id, projectId)
              .then(() => chat.id === activeChatId && setActiveId(projectId))
              .catch((e) => setFileError(String(e)))
          }
          onDelete={setDeleting}
        />
      )}
      <div className="as-inner">
        <header className="as-head">
          {page ? (
            <div className="as-page-title">
              <h1>{activeChat?.title || (project && activeChatId === null ? project.name : "Neuer Chat")}</h1>
              <span className="as-context">
                {project ? (
                  <>
                    <button type="button" className="as-context-link" disabled={pending} title="Projektübersicht mit Chats, Hinweisen und Dateien" onClick={() => newChat(project.id)}>
                      {project.name}
                    </button>
                    {contextPath ? ` › ${contextPath}` : project.docId === null ? " · keine Dokumentation zugeordnet" : " · die zugeordnete Seite gibt es nicht mehr"}
                  </>
                ) : (
                  "Ohne festen Kontext: er sieht alle deine Daten"
                )}
              </span>
            </div>
          ) : (
            <div className="as-title">
              <Sparkles size={15} />
              <span>Assistent</span>
              {status?.available && status.model && <span className="tag">{modelLabel(status.model)}</span>}
            </div>
          )}
          <div className="as-head-actions">
            {page && status?.available && status.model && <span className="tag as-model">{modelLabel(status.model)}</span>}
            {!page && <ChatHistory chats={chatList} activeChatId={activeChatId} disabled={pending} onSelect={selectChat} />}
            <button type="button" className="icon-btn" aria-label="Neuer Chat" title="Neuer Chat" disabled={empty} onClick={() => newChat(activeId)}>
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
                <Terminal size={18} />
              </span>
              <h2>Assistent einrichten</h2>
              <p>Der Assistent läuft über Claude Code. Die App findet es auf diesem Rechner oder bei der Claude-Desktop-App, du musst es aber einmal selbst anmelden (Einstellungen → Assistent → Verbindung testen zeigt, wie). Dann kannst du Fragen zu deinen Aufgaben, Terminen, Notizen und deiner Dokumentation stellen.</p>
              <Button className="as-setup" onClick={() => openSettings("assistant")}>
                Einstellungen öffnen
              </Button>
            </div>
          ) : chatLoading ? (
            <div className="as-empty" aria-busy="true" />
          ) : empty && project && page ? (
            <ProjectOverview
              project={project}
              contextPath={contextPath}
              chats={chatList.filter((c) => c.projectId === project.id)}
              onOpenChat={selectChat}
              onEdit={() => setProjectModal({ project })}
              onOpenDocs={() => {
                if (project.docId === null) return;
                requestOpenDoc(project.docId);
                navigate("docs");
              }}
              onAddFiles={(list) => void addProjectFiles(list)}
              onRemoveFile={(fileId) => void removeProjectFile(project.id, fileId).catch((e) => setProjectFileError(String(e)))}
              uploading={projectUploading}
              error={projectFileError}
            />
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
                    {m.files && m.files.length > 0 && (
                      <div className="as-user-files">
                        {m.files.map((f) => {
                          const { icon: Icon, tone } = kindOf(f.name, f.mime);
                          return (
                            <span key={f.id} className="as-file" title={`${f.name} (${formatBytes(f.size)})`}>
                              <Icon size={13} className={`file-card-icon ${tone}`} />
                              <span className="as-file-name">{f.name}</span>
                            </span>
                          );
                        })}
                      </div>
                    )}
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
                    <WorkLog feed={m.feed} steps={m.steps} />
                    {m.plan && m.plan.length > 0 && <PlanList items={m.plan} />}
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
                    {m.usage && <UsageLine usage={m.usage} model={m.model} />}
                  </div>
                ),
              )}
              {!pending && !lastIsError && messages.length > 0 && messages[messages.length - 1].role === "user" && (
                <div className="cs-unanswered" role="status">
                  <span>Die letzte Frage hat noch keine Antwort.</span>
                  <button type="button" className="as-retry" onClick={retry}>
                    <RotateCcw size={12} />
                    Antwort holen
                  </button>
                </div>
              )}
              {pending && <Activity feed={liveFeed} plan={livePlan} text={liveText} />}
            </>
          )}
        </div>

        <div className="as-composer">
          {(files.length > 0 || uploading > 0) && (
            <div className="as-files">
              {files.map((f) => {
                const { icon: Icon, tone } = kindOf(f.name, f.mime);
                return (
                  <span key={f.id} className="as-file" title={`${f.name} (${formatBytes(f.size)})`}>
                    <Icon size={13} className={`file-card-icon ${tone}`} />
                    <span className="as-file-name">{f.name}</span>
                    <button type="button" className="icon-btn" aria-label={`„${f.name}“ entfernen`} title="Entfernen" onClick={() => setFiles((all) => all.filter((x) => x.id !== f.id))}>
                      <X size={12} />
                    </button>
                  </span>
                );
              })}
              {uploading > 0 && <span className="as-file busy">Wird gespeichert …</span>}
            </div>
          )}
          {fileError && (
            <p className="as-file-error" role="alert">
              {fileError}
            </p>
          )}
          <div
            className={`as-box${dropping ? " drop" : ""}`}
            onDragOver={(e) => {
              if (!ready || !e.dataTransfer.types.includes("Files")) return;
              e.preventDefault();
              setDropping(true);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false);
            }}
            onDrop={(e) => {
              setDropping(false);
              if (e.dataTransfer.files.length === 0) return;
              e.preventDefault();
              void addFiles([...e.dataTransfer.files]);
            }}
          >
            <textarea
              ref={inputRef}
              rows={1}
              value={draft}
              disabled={!ready}
              placeholder={ready ? (project ? `Frag etwas zu „${project.name}“ …` : "Frag etwas zu deinem Stand …") : "Erst Claude Code einrichten …"}
              aria-label="Nachricht an den Assistenten"
              spellCheck={false}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKey}
              onPaste={(e) => {
                // Eingefügte Dateien (nicht nur Text) werden zu Anhängen
                if (e.clipboardData.files.length === 0) return;
                e.preventDefault();
                void addFiles([...e.clipboardData.files]);
              }}
            />
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                void addFiles([...(e.target.files ?? [])]);
                e.target.value = "";
              }}
            />
            <div className="as-box-foot">
              <button
                type="button"
                className="icon-btn as-attach"
                aria-label="Datei anhängen"
                title="Datei anhängen (oder hierher ziehen)"
                disabled={!ready || pending || files.length >= MAX_CHAT_FILES}
                onClick={() => fileInput.current?.click()}
              >
                <Paperclip size={15} />
              </button>
              <span className="as-scope" title="Der Assistent liest nur. Alles, was er anlegen, ändern oder löschen möchte (Aufgaben, Termine, neue Seiten), schlägt er vor; es passiert erst, wenn du bestätigst.">
                <ShieldCheck size={13} />
                Ändert nichts ohne dein OK
              </span>
              {pending ? (
                <button type="button" className="as-send stop" aria-label="Stopp" title="Arbeit abbrechen: es bleibt, was bis jetzt entstanden ist" onClick={() => void cancelAssistant()}>
                  <Square size={11} fill="currentColor" />
                </button>
              ) : (
                <button type="button" className="as-send" aria-label="Senden" disabled={(!draft.trim() && files.length === 0) || uploading > 0 || !ready} onClick={() => send(draft)}>
                  <ArrowUp size={15} strokeWidth={2.25} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {projectModal && (
        <ProjectModal
          project={projectModal.project}
          onClose={() => setProjectModal(null)}
          // Ein neues oder geändertes Projekt öffnet seine Startansicht (neuer Chat im Projekt)
          onSaved={(p) => newChat(p.id)}
          onDeleted={(id) => id === activeId && newChat(null)}
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
      {deleting && (
        <ConfirmDialog
          title="Chat löschen?"
          message={`„${deleting.title || "Neuer Chat"}“ wird mit allen Nachrichten gelöscht. Was du darin bestätigt hast (Aufgaben, Termine, Seiten), bleibt bestehen.`}
          onConfirm={() => void removeChat(deleting)}
          onCancel={() => setDeleting(null)}
        />
      )}
    </aside>
  );
}

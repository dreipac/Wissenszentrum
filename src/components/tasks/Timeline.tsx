import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { CalendarClock, ChevronDown, ChevronRight } from "lucide-react";
import { SecondaryButton } from "../ui/SecondaryButton";
import { setTaskDates } from "../../lib/api/tasks";
import { useDialogs } from "../../lib/dialogs";
import { useDoneState } from "../../lib/taskAnimation";
import { bucketAccent, subtaskProgress, type Bucket, type Task } from "../../lib/tasks";
import { useTasks } from "../../lib/useTasks";
import { TaskCheck } from "./parts";
import "./Timeline.css";

const DAY_MS = 86_400_000;
const LABEL_W = 280;
const GROUP_H = 36;
const ROW_H = 40;
const SCALE_KEY = "timelineScale";

type Scale = "week" | "month" | "quarter";

const SCALES: { id: Scale; label: string; dayW: number }[] = [
  { id: "week", label: "Woche", dayW: 52 },
  { id: "month", label: "Monat", dayW: 26 },
  { id: "quarter", label: "Quartal", dayW: 9 },
];

// --- Tage als ganze Zahlen (Tage seit 1970, lokales Kalenderdatum) ------------------------------------------------

const toIdx = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
};
const toStr = (idx: number) => new Date(idx * DAY_MS).toISOString().slice(0, 10);
const todayIdx = () => {
  const n = new Date();
  return Math.round(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) / DAY_MS);
};
/** Lokales Date-Objekt für die Formatierung. */
const dateOf = (idx: number) => {
  const d = new Date(idx * DAY_MS);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};
/** Montag = 0 … Sonntag = 6 (der 1.1.1970 war ein Donnerstag) */
const weekday = (idx: number) => (((idx + 3) % 7) + 7) % 7;

const fmtDay = new Intl.DateTimeFormat("de-CH", { day: "numeric", month: "short" });
const fmtMonth = new Intl.DateTimeFormat("de-CH", { month: "long", year: "numeric" });
const fmtWeekday = new Intl.DateTimeFormat("de-CH", { weekday: "short" });
const shortDay = (idx: number) => fmtDay.format(dateOf(idx)).replace(".", "");

const rangeLabel = (start: number, due: number) => (start === due ? shortDay(due) : `${shortDay(start)} – ${shortDay(due)}`);
const dayCount = (start: number, due: number) => due - start + 1;

// --- Zeilen ----------------------------------------------------------------------------------------------------------

interface Dates {
  start: number;
  due: number;
  /** Nur Fälligkeit, kein Beginn */
  single: boolean;
}

const datesOf = (t: Task): Dates | null => (t.dueDate === null ? null : { start: t.startDate ? toIdx(t.startDate) : toIdx(t.dueDate), due: toIdx(t.dueDate), single: t.startDate === null });

type Row =
  | { kind: "group"; key: string; bucket: Bucket | null; name: string; tasks: Task[]; span: { start: number; due: number } | null }
  | { kind: "task"; key: string; task: Task; bucket: Bucket | null };

interface DragState {
  id: number;
  mode: "move" | "start" | "end";
  originX: number;
  startIdx: number;
  dueIdx: number;
  single: boolean;
  /** Verschiebung in Tagen */
  delta: number;
  moved: boolean;
}

/** Zeigt den Verlauf eines Zeitraums: Beginn und Ende nach der Verschiebung. */
function shifted(drag: DragState): Dates {
  const d = drag.delta;
  if (drag.mode === "move") return { start: drag.startIdx + d, due: drag.dueIdx + d, single: drag.single };
  if (drag.mode === "start") return { start: Math.min(drag.startIdx + d, drag.dueIdx), due: drag.dueIdx, single: false };
  return { start: drag.startIdx, due: Math.max(drag.dueIdx + d, drag.startIdx), single: drag.single && drag.dueIdx + d <= drag.startIdx };
}

// --- Ansicht ---------------------------------------------------------------------------------------------------------

/** Zeitplan: Aufgaben je Bucket als Balken auf einer Zeitleiste. Balken lassen sich verschieben und in der Länge ziehen. */
export function Timeline() {
  const { tasks, buckets, loaded } = useTasks();
  const { openEditTask } = useDialogs();
  const [scale, setScale] = useState<Scale>(() => {
    try {
      const saved = localStorage.getItem(SCALE_KEY);
      return saved === "week" || saved === "quarter" ? saved : "month";
    } catch {
      return "month";
    }
  });
  const [showDone, setShowDone] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [drag, setDragState] = useState<DragState | null>(null);
  // Der Stand liegt zusätzlich in einer Referenz, damit schnelle Ereignisse (Loslassen vor dem nächsten Rendern) ihn sehen
  const dragRef = useRef<DragState | null>(null);
  const setDrag = (next: DragState | null) => {
    dragRef.current = next;
    setDragState(next);
  };
  const [hover, setHover] = useState<{ id: number; idx: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const didInitialScroll = useRef(false);

  const dayW = SCALES.find((s) => s.id === scale)!.dayW;
  const today = todayIdx();

  const visible = useMemo(() => tasks.filter((t) => showDone || !t.done), [tasks, showDone]);

  // Zeilen: je Bucket eine Gruppe, darin die Aufgaben nach Beginn bzw. Fälligkeit; Aufgaben ohne Datum zuletzt
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    const groups: { key: string; bucket: Bucket | null; name: string }[] = [
      { key: "none", bucket: null, name: "Ohne Bucket" },
      ...buckets.map((b) => ({ key: `b${b.id}`, bucket: b, name: b.name })),
    ];
    for (const g of groups) {
      const list = visible
        .filter((t) => (g.bucket ? t.bucketId === g.bucket.id : t.bucketId === null))
        .sort((a, b) => {
          const da = datesOf(a);
          const db = datesOf(b);
          if (!da && !db) return a.title.localeCompare(b.title, "de");
          if (!da) return 1;
          if (!db) return -1;
          return da.start - db.start || da.due - db.due;
        });
      if (list.length === 0 && g.bucket === null) continue;
      const dated = list.map(datesOf).filter((d): d is Dates => d !== null);
      const span = dated.length ? { start: Math.min(...dated.map((d) => d.start)), due: Math.max(...dated.map((d) => d.due)) } : null;
      out.push({ kind: "group", key: g.key, bucket: g.bucket, name: g.name, tasks: list, span });
      if (!collapsed.has(g.key)) for (const t of list) out.push({ kind: "task", key: `t${t.id}`, task: t, bucket: g.bucket });
    }
    return out;
  }, [visible, buckets, collapsed]);

  // Sichtbarer Zeitraum: um heute herum, aber so weit, dass alle Aufgaben hineinpassen
  const { minDay, maxDay } = useMemo(() => {
    const all = visible.map(datesOf).filter((d): d is Dates => d !== null);
    let lo = Math.min(today - 14, ...all.map((d) => d.start - 7));
    const hi = Math.max(today + 75, ...all.map((d) => d.due + 21));
    lo -= weekday(lo); // auf einen Montag
    return { minDay: lo, maxDay: hi };
  }, [visible, today]);

  const totalDays = maxDay - minDay + 1;
  const canvasW = totalDays * dayW;
  const x = (idx: number) => (idx - minDay) * dayW;

  const hasDates = visible.some((t) => t.dueDate !== null);
  const undated = visible.filter((t) => t.dueDate === null).length;

  // Beim ersten Anzeigen und beim Wechsel der Skala heute ins Bild holen
  const scrollToToday = useCallback(
    (smooth = false) => {
      const el = scroller.current;
      if (!el) return;
      el.scrollTo({ left: Math.max(0, x(today) - (el.clientWidth - LABEL_W) / 3), behavior: smooth ? "smooth" : "auto" });
    },
    // x hängt von minDay und dayW ab
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [today, minDay, dayW],
  );

  useLayoutEffect(() => {
    if (!loaded || didInitialScroll.current) return;
    didInitialScroll.current = true;
    scrollToToday();
  }, [loaded, scrollToToday]);

  const changeScale = (next: Scale) => {
    setScale(next);
    try {
      localStorage.setItem(SCALE_KEY, next);
    } catch {
      /* nur Komfort */
    }
    didInitialScroll.current = false;
  };

  useEffect(() => {
    if (!didInitialScroll.current && loaded) {
      didInitialScroll.current = true;
      requestAnimationFrame(() => scrollToToday());
    }
  }, [scale, loaded, scrollToToday]);

  // --- Ziehen ---------------------------------------------------------------------------------------------------------

  const startDrag = (e: ReactPointerEvent<HTMLElement>, task: Task, mode: DragState["mode"]) => {
    if (e.button !== 0) return;
    const d = datesOf(task);
    if (!d) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* Zeiger nicht mehr aktiv */
    }
    setDrag({ id: task.id, mode, originX: e.clientX, startIdx: d.start, dueIdx: d.due, single: d.single, delta: 0, moved: false });
  };

  const moveDrag = (e: ReactPointerEvent<HTMLElement>) => {
    const current = dragRef.current;
    if (!current) return;
    const delta = Math.round((e.clientX - current.originX) / dayW);
    const moved = current.moved || Math.abs(e.clientX - current.originX) > 3;
    if (delta !== current.delta || moved !== current.moved) setDrag({ ...current, delta, moved });
  };

  const endDrag = (task: Task) => {
    const current = dragRef.current;
    setDrag(null);
    if (!current) return;
    if (!current.moved || current.delta === 0) {
      // Ohne Bewegung war es ein Klick
      if (!current.moved) openEditTask(task);
      return;
    }
    const next = shifted(current);
    // Eine Aufgabe ohne Beginn bleibt ohne Beginn, solange nur Ende oder Lage geändert werden
    const startDate = next.single ? null : toStr(next.start);
    setError(null);
    setTaskDates(task.id, startDate, toStr(next.due)).catch((err) => setError(String(err)));
  };

  const scheduleTask = (task: Task, idx: number) => {
    setError(null);
    setTaskDates(task.id, null, toStr(idx)).catch((err) => setError(String(err)));
  };

  // --- Kopf und Raster ------------------------------------------------------------------------------------------------

  const months = useMemo(() => {
    const result: { label: string; left: number; width: number }[] = [];
    let start = minDay;
    for (let i = minDay; i <= maxDay + 1; i++) {
      const monthChanged = i > maxDay || dateOf(i).getDate() === 1;
      if (monthChanged && i > start) {
        result.push({ label: fmtMonth.format(dateOf(start)), left: (start - minDay) * dayW, width: (i - start) * dayW });
        start = i;
      }
    }
    return result;
  }, [minDay, maxDay, dayW]);

  const days = useMemo(() => Array.from({ length: totalDays }, (_, i) => minDay + i), [minDay, totalDays]);
  const weekends = useMemo(() => days.filter((d) => weekday(d) >= 5), [days]);
  const mondays = useMemo(() => days.filter((d) => weekday(d) === 0), [days]);

  const bodyHeight = rows.reduce((sum, r) => sum + (r.kind === "group" ? GROUP_H : ROW_H), 0);

  if (!loaded) return null;

  const toggleGroup = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="tl">
      <div className="tl-toolbar">
        <div className="segmented" role="radiogroup" aria-label="Zeitraum der Ansicht">
          {SCALES.map((s) => (
            <button key={s.id} type="button" role="radio" aria-checked={scale === s.id} className={scale === s.id ? "active" : ""} onClick={() => changeScale(s.id)}>
              {s.label}
            </button>
          ))}
        </div>
        <SecondaryButton className="sm" onClick={() => scrollToToday(true)}>
          <CalendarClock size={14} />
          Heute
        </SecondaryButton>
        <label className="tl-check">
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
          Erledigte anzeigen
        </label>
        <span className="tl-note">
          {hasDates
            ? undated > 0
              ? `${undated} ${undated === 1 ? "Aufgabe" : "Aufgaben"} ohne Datum: in der Zeile klicken, um den Tag zu setzen.`
              : "Balken ziehen verschiebt, die Ränder ändern Beginn und Ende."
            : "Klicke in die Zeile einer Aufgabe, um ihr einen Tag zu geben."}
        </span>
      </div>
      {error && <p className="field-error tl-error">{error}</p>}

      <div ref={scroller} className="tl-scroll">
        <div className="tl-inner" style={{ width: LABEL_W + canvasW } as CSSProperties}>
          {/* Kopf */}
          <div className="tl-head">
            <div className="tl-corner">Aufgabe</div>
            <div className="tl-scale" style={{ width: canvasW }}>
              <div className="tl-months">
                {months.map((m) => (
                  <span key={m.left} className="tl-month" style={{ left: m.left, width: m.width }}>
                    {m.label}
                  </span>
                ))}
              </div>
              <div className="tl-days">
                {days.map((d) => {
                  const showNumber = scale !== "quarter" || weekday(d) === 0;
                  return (
                    <span
                      key={d}
                      className={`tl-day${weekday(d) >= 5 ? " weekend" : ""}${d === today ? " today" : ""}`}
                      style={{ left: x(d), width: dayW }}
                    >
                      {scale === "week" && <small>{fmtWeekday.format(dateOf(d)).replace(".", "")}</small>}
                      {showNumber && dateOf(d).getDate()}
                    </span>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Körper */}
          <div className="tl-body" style={{ height: bodyHeight }}>
            <div className="tl-grid" style={{ left: LABEL_W, width: canvasW }} aria-hidden>
              {weekends.map((d) => (
                <span key={`w${d}`} className="tl-weekend" style={{ left: x(d), width: dayW }} />
              ))}
              {scale !== "quarter" && days.map((d) => <span key={`l${d}`} className="tl-line" style={{ left: x(d) }} />)}
              {scale === "quarter" && mondays.map((d) => <span key={`m${d}`} className="tl-line" style={{ left: x(d) }} />)}
              {today >= minDay && today <= maxDay && <span className="tl-today" style={{ left: x(today) + dayW / 2 }} />}
            </div>

            {rows.map((row) => {
              if (row.kind === "group") {
                const accent = bucketAccent(row.bucket);
                const open = !collapsed.has(row.key);
                return (
                  <div key={row.key} className="tl-row group" style={{ height: GROUP_H, "--accent-row": accent ?? "var(--text-muted)" } as CSSProperties}>
                    <button type="button" className="tl-label group" onClick={() => toggleGroup(row.key)} aria-expanded={open}>
                      {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      <span className={`tl-dot${accent ? "" : " none"}`} style={accent ? { backgroundColor: accent } : undefined} />
                      <strong>{row.name}</strong>
                      <span className="tl-count">{row.tasks.length}</span>
                    </button>
                    <div className="tl-lane">
                      {row.span && <span className="tl-span" style={{ left: x(row.span.start), width: Math.max((row.span.due - row.span.start + 1) * dayW - 2, 6) }} />}
                    </div>
                  </div>
                );
              }
              return (
                <TaskRow
                  key={row.key}
                  task={row.task}
                  bucket={row.bucket}
                  today={today}
                  dayW={dayW}
                  x={x}
                  drag={drag?.id === row.task.id ? drag : null}
                  hoverIdx={hover?.id === row.task.id ? hover.idx : null}
                  onHover={(idx) => setHover(idx === null ? null : { id: row.task.id, idx })}
                  minDay={minDay}
                  onOpen={() => openEditTask(row.task)}
                  onStart={startDrag}
                  onMove={moveDrag}
                  onEnd={endDrag}
                  onSchedule={scheduleTask}
                />
              );
            })}

            {rows.length === 0 && <p className="tl-empty muted">Keine Aufgaben.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Aufgabenzeile ----------------------------------------------------------------------------------------------------

interface TaskRowProps {
  task: Task;
  bucket: Bucket | null;
  today: number;
  dayW: number;
  minDay: number;
  x: (idx: number) => number;
  drag: DragState | null;
  hoverIdx: number | null;
  onHover: (idx: number | null) => void;
  onOpen: () => void;
  onStart: (e: ReactPointerEvent<HTMLElement>, task: Task, mode: DragState["mode"]) => void;
  onMove: (e: ReactPointerEvent<HTMLElement>) => void;
  onEnd: (task: Task) => void;
  onSchedule: (task: Task, idx: number) => void;
}

function TaskRow({ task, bucket, today, dayW, minDay, x, drag, hoverIdx, onHover, onOpen, onStart, onMove, onEnd, onSchedule }: TaskRowProps) {
  const done = useDoneState(task);
  const base = datesOf(task);
  const shown = drag ? shifted(drag) : base;
  const accent = bucketAccent(bucket) ?? "var(--accent)";
  const progress = subtaskProgress(task);
  const overdue = !done && base !== null && base.due < today;

  const width = shown ? Math.max(dayCount(shown.start, shown.due) * dayW - 4, 10) : 0;

  return (
    <div className={`tl-row${done ? " done" : ""}`} style={{ height: ROW_H }}>
      <div className="tl-label task">
        <TaskCheck task={task} moves={bucket?.onCompleteBucketId != null} />
        <button type="button" className="tl-title" onClick={onOpen} title={task.title}>
          <span className="strike">{task.title}</span>
        </button>
        {shown && <span className="tl-when">{rangeLabel(shown.start, shown.due)}</span>}
      </div>

      <div
        className={`tl-lane${base ? "" : " undated"}`}
        onPointerMove={(e) => {
          if (base) return;
          const rect = e.currentTarget.getBoundingClientRect();
          onHover(minDay + Math.floor((e.clientX - rect.left) / dayW));
        }}
        onPointerLeave={() => onHover(null)}
        onClick={(e) => {
          if (base) return;
          const rect = e.currentTarget.getBoundingClientRect();
          onSchedule(task, minDay + Math.floor((e.clientX - rect.left) / dayW));
        }}
      >
        {!base && hoverIdx !== null && <span className="tl-ghost" style={{ left: x(hoverIdx), width: dayW - 4 }} title="Hier fällig setzen" />}

        {shown && (
          <div
            className={`tl-bar${shown.single ? " single" : ""}${done ? " done" : ""}${overdue ? " overdue" : ""}${drag?.moved ? " dragging" : ""}`}
            style={{ left: x(shown.start) + 2, width, "--bar": accent } as CSSProperties}
            role="button"
            tabIndex={0}
            title={`${task.title} · ${rangeLabel(shown.start, shown.due)} (${dayCount(shown.start, shown.due)} ${dayCount(shown.start, shown.due) === 1 ? "Tag" : "Tage"})`}
            onPointerDown={(e) => onStart(e, task, "move")}
            onPointerMove={onMove}
            onPointerUp={() => onEnd(task)}
            onPointerCancel={() => onEnd(task)}
            onKeyDown={(e) => e.key === "Enter" && onOpen()}
          >
            {progress.total > 0 && !done && <span className="tl-fill" style={{ width: `${(progress.done / progress.total) * 100}%` }} />}
            <span
              className="tl-handle start"
              onPointerDown={(e) => onStart(e, task, "start")}
              onPointerMove={onMove}
              onPointerUp={(e) => {
                e.stopPropagation();
                onEnd(task);
              }}
            />
            {width > 90 && <span className="tl-bar-text">{progress.total > 0 ? `${progress.done}/${progress.total}` : rangeLabel(shown.start, shown.due)}</span>}
            <span
              className="tl-handle end"
              onPointerDown={(e) => onStart(e, task, "end")}
              onPointerMove={onMove}
              onPointerUp={(e) => {
                e.stopPropagation();
                onEnd(task);
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

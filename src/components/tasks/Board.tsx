import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  getFirstCollision,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, Plus, Settings2 } from "lucide-react";
import { moveTask, reorderBuckets } from "../../lib/api/tasks";
import { useDialogs } from "../../lib/dialogs";
import { bucketAccent, priorityLabel, type Bucket, type Task } from "../../lib/tasks";
import { useDoneState } from "../../lib/taskAnimation";
import { useFlip } from "../../lib/useFlip";
import { CardSubtasks, DueDate, EventLink, SubtaskProgress, TaskCheck } from "./parts";

export interface Column {
  /** null = Aufgaben ohne Bucket */
  bucket: Bucket | null;
  name: string;
  tasks: Task[];
}

// IDs für dnd-kit: Präfix verhindert Kollisionen zwischen Aufgaben, Spalten-Inhalt und Spalten selbst
const taskKey = (id: number) => `t:${id}`;
const containerKey = (bucket: Bucket | null) => `c:${bucket?.id ?? "none"}`;
const bucketKey = (id: number) => `b:${id}`;
const numberOf = (key: string) => Number(key.slice(2));

type Items = Record<string, string[]>;

const FOLD_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

// Zugeklappte Spalten merkt sich die App pro Gerät, damit sie nach einem Neustart so bleiben
const COLLAPSED_KEY = "wz.tasks.collapsedBuckets";

function loadCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === "string") : []);
  } catch {
    return new Set();
  }
}

const buildItems = (columns: Column[]): Items =>
  Object.fromEntries(columns.map((c) => [containerKey(c.bucket), c.tasks.map((t) => taskKey(t.id))]));

const buildOrder = (columns: Column[]): string[] =>
  columns.flatMap((c) => (c.bucket ? [bucketKey(c.bucket.id)] : []));

// ---------------------------------------------------------------------------
// Karte
// ---------------------------------------------------------------------------

function TaskCardView({ task, moves = false }: { task: Task; moves?: boolean }) {
  return (
    <>
      <TaskCheck task={task} moves={moves} />
      <div className="task-card-main">
        <h3 className="task-title">
          <span className="strike">{task.title}</span>
        </h3>
        {task.showDescription && task.description.trim() && <p className="task-desc">{task.description}</p>}
        <CardSubtasks task={task} />
        <div className="task-meta">
          <span className="task-priority-label">
            <span className={`priority ${task.priority}`} />
            {priorityLabel[task.priority]}
          </span>
          <DueDate task={task} />
        </div>
        <EventLink task={task} />
        <SubtaskProgress task={task} />
      </div>
    </>
  );
}

function SortableTask({ task, group, moves, suppressClick }: { task: Task; group: string; moves: boolean; suppressClick: React.RefObject<boolean> }) {
  const { openEditTask, openTaskMenu } = useDialogs();
  const done = useDoneState(task);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: taskKey(task.id),
    data: { type: "task" },
  });

  return (
    <article
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      role="group"
      data-flip={task.id}
      data-flip-group={group}
      className={`task-card draggable${done ? " done" : ""}${isDragging ? " ghost" : ""}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      onClick={() => !suppressClick.current && openEditTask(task)}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        openTaskMenu(task, e.clientX, e.clientY);
      }}
    >
      <TaskCardView task={task} moves={moves} />
    </article>
  );
}

// ---------------------------------------------------------------------------
// Spalte
// ---------------------------------------------------------------------------

interface ColumnViewProps {
  column: Column;
  ids: string[];
  taskById: Map<string, Task>;
  suppressClick: React.RefObject<boolean>;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Gerade wird eine Aufgabe gezogen: eine zugeklappte Spalte zeigt dann eine Fläche zum Ablegen */
  taskDragging: boolean;
}

function ColumnView({ column, ids, taskById, suppressClick, collapsed, onToggleCollapsed, taskDragging }: ColumnViewProps) {
  const { openNewTask, openEditBucket } = useDialogs();
  const { bucket, name } = column;

  // Spalten lassen sich per Kopfzeile verschieben; „Ohne Bucket“ bleibt fest am Anfang
  const sortable = useSortable({
    id: bucket ? bucketKey(bucket.id) : "b:none",
    data: { type: "bucket" },
    disabled: !bucket,
  });
  const drop = useDroppable({ id: containerKey(bucket), data: { type: "container" } });

  const accent = bucketAccent(bucket);
  const visibleTasks = ids.map((id) => taskById.get(id)).filter((t): t is Task => t !== undefined);

  // Auf- und Zuklappen: Der Inhalt bleibt während der Bewegung eingehängt und verschwindet erst danach ganz. Zugeklappt
  // ist er nicht im DOM, damit unsichtbare Karten beim Ziehen nicht als Ziel gelten.
  const foldRef = useRef<HTMLDivElement>(null);
  const [closing, setClosing] = useState(false);
  const wasCollapsed = useRef(collapsed);
  const bodyShown = !collapsed || closing;

  const toggle = () => {
    setClosing(!collapsed);
    onToggleCollapsed();
  };

  useLayoutEffect(() => {
    if (wasCollapsed.current === collapsed) return;
    wasCollapsed.current = collapsed;
    const fold = foldRef.current;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!fold || reduced) {
      setClosing(false);
      return;
    }
    fold.getAnimations().forEach((a) => a.cancel());
    const height = fold.getBoundingClientRect().height;
    const cards = Array.from(fold.querySelectorAll<HTMLElement>(".task-card"));
    fold.style.overflow = "hidden";

    if (collapsed) {
      // Aufgaben blenden schnell aus, während die Spalte zusammenfährt
      cards.forEach((card) => card.animate([{ opacity: 1 }, { opacity: 0, transform: "translateY(-4px)" }], { duration: 120, easing: "ease-out", fill: "forwards" }));
      const anim = fold.animate([{ height: `${height}px` }, { height: "0px" }], { duration: 200, easing: FOLD_EASING, fill: "forwards" });
      anim.onfinish = () => setClosing(false);
    } else {
      // Spalte fährt auf, die Aufgaben folgen leicht versetzt von oben nach unten
      const anim = fold.animate([{ height: "0px" }, { height }], { duration: 240, easing: FOLD_EASING });
      anim.onfinish = anim.oncancel = () => {
        fold.style.overflow = "";
      };
      cards.slice(0, 10).forEach((card, i) =>
        card.animate([{ opacity: 0, transform: "translateY(-8px)" }, { opacity: 1, transform: "none" }], { duration: 240, delay: 30 + i * 28, easing: FOLD_EASING, fill: "backwards" }),
      );
    }
  }, [collapsed]);

  return (
    <section
      ref={sortable.setNodeRef}
      data-bucket-id={bucket ? bucket.id : "none"}
      data-collapsed={collapsed}
      className={`bucket${sortable.isDragging ? " dragging" : ""}${accent ? " colored" : ""}`}
      style={{ transform: CSS.Translate.toString(sortable.transform), transition: sortable.transition, ...(accent ? { "--bucket-accent": accent } : {}) } as CSSProperties}
    >
      <header
        className={`bucket-head${bucket ? " grabbable" : ""}`}
        {...(bucket ? { ...sortable.attributes, ...sortable.listeners } : {})}
      >
        <button
          type="button"
          className="icon-btn bucket-toggle"
          aria-expanded={!collapsed}
          aria-label={collapsed ? `„${name}“ aufklappen` : `„${name}“ zuklappen`}
          title={collapsed ? "Aufklappen" : "Zuklappen"}
          onClick={toggle}
        >
          <ChevronDown size={15} className="bucket-chevron" />
        </button>
        {accent && <span className="bucket-dot" aria-hidden />}
        <h2 className="bucket-name">{name}</h2>
        <span className="bucket-count">{visibleTasks.length}</span>
        <div className="bucket-head-actions">
          <button
            type="button"
            className="icon-btn"
            aria-label={`Aufgabe zu „${name}“ hinzufügen`}
            onClick={() => openNewTask(bucket?.id ?? null)}
          >
            <Plus size={15} />
          </button>
          {bucket && (
            <button
              type="button"
              className="icon-btn"
              aria-label={`Bucket „${name}“ bearbeiten`}
              title="Bucket bearbeiten"
              onClick={() => openEditBucket(bucket)}
            >
              <Settings2 size={15} />
            </button>
          )}
        </div>
      </header>

      {bodyShown && (
        <div ref={foldRef} className="bucket-fold">
          <div ref={drop.setNodeRef} className={`bucket-body${drop.isOver ? " over" : ""}`}>
            <SortableContext items={ids} strategy={verticalListSortingStrategy}>
              {visibleTasks.length === 0 && <p className="bucket-empty">Keine Aufgaben</p>}
              {visibleTasks.map((task) => (
                <SortableTask key={task.id} task={task} group={containerKey(bucket)} moves={bucket?.onCompleteBucketId != null} suppressClick={suppressClick} />
              ))}
            </SortableContext>
            <button type="button" className="bucket-add" onClick={() => openNewTask(bucket?.id ?? null)}>
              <Plus size={14} />
              Aufgabe hinzufügen
            </button>
          </div>
        </div>
      )}
      {/* Zugeklappt: Beim Ziehen einer Aufgabe erscheint hier eine Fläche zum Ablegen, sonst bliebe die Spalte unerreichbar */}
      {!bodyShown && taskDragging && (
        <div ref={drop.setNodeRef} className={`bucket-body bucket-drop${drop.isOver ? " over" : ""}`}>
          Hier ablegen
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

export function Board({ columns }: { columns: Column[] }) {
  const { openNewBucket } = useDialogs();

  // Lokaler Zustand, damit sich Karten und Spalten beim Ziehen sofort bewegen.
  // Wird nach dem Speichern durch die Daten aus der Datenbank ersetzt (columns ändert sich).
  const [items, setItems] = useState<Items>(() => buildItems(columns));
  const [order, setOrder] = useState<string[]>(() => buildOrder(columns));
  const [active, setActive] = useState<{ type: "task" | "bucket"; id: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsed);
  const dragging = useRef(false);
  const suppressClick = useRef(false);
  const boardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (dragging.current) return;
    setItems(buildItems(columns));
    setOrder(buildOrder(columns));
  }, [columns]);

  // Nach dem Speichern gleiten Karten sanft an ihren neuen Platz, auch in eine andere Spalte
  // Ausgelöst wird beim Wechsel von `items`, denn das bestimmt, in welcher Spalte eine Karte steht. Direkt nach dem
  // Loslassen einer gezogenen Karte nicht, dort übernimmt dnd-kit die Bewegung.
  useFlip(boardRef, items, active === null && !suppressClick.current);

  const taskById = useMemo(
    () => new Map(columns.flatMap((c) => c.tasks).map((t) => [taskKey(t.id), t] as const)),
    [columns],
  );
  const unassigned = columns.find((c) => c.bucket === null);
  const bucketColumns = order
    .map((key) => columns.find((c) => c.bucket && bucketKey(c.bucket.id) === key))
    .filter((c): c is Column => c !== undefined);

  const toggleCollapsed = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
      } catch {
        // Nicht speichern zu können ist unkritisch: die Spalte bleibt bis zum Schließen zu
      }
      return next;
    });
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const findContainer = (id: UniqueIdentifier): string | undefined =>
    String(id) in items ? String(id) : Object.keys(items).find((key) => items[key].includes(String(id)));

  const collisionDetection: CollisionDetection = (args) => {
    // Spalten sortieren: nur andere Spalten kommen als Ziel in Frage
    if (args.active.data.current?.type === "bucket") {
      return closestCenter({
        ...args,
        droppableContainers: args.droppableContainers.filter((c) => c.data.current?.type === "bucket"),
      });
    }
    // Aufgaben: Spalten-Hüllen ausblenden, sonst würden sie jede Karte „verschlucken“
    const containers = args.droppableContainers.filter((c) => c.data.current?.type !== "bucket");
    const scoped = { ...args, droppableContainers: containers };
    const hits = pointerWithin(scoped);
    const collisions = hits.length > 0 ? hits : rectIntersection(scoped);
    let overId = getFirstCollision(collisions, "id");
    if (overId == null) return [];
    // Über einer Spalte: nächstgelegene Karte darin wählen, damit die Einfügeposition stimmt
    if (String(overId) in items && items[String(overId)].length > 0) {
      const inColumn = containers.filter((c) => items[String(overId)].includes(String(c.id)));
      overId = closestCenter({ ...scoped, droppableContainers: inColumn })[0]?.id ?? overId;
    }
    return [{ id: overId }];
  };

  const resync = () => {
    setItems(buildItems(columns));
    setOrder(buildOrder(columns));
  };

  const onDragStart = ({ active }: DragStartEvent) => {
    dragging.current = true;
    setError(null);
    setActive({ type: active.data.current?.type === "bucket" ? "bucket" : "task", id: String(active.id) });
  };

  // Karte wandert beim Ziehen in eine andere Spalte
  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over || active.data.current?.type !== "task") return;
    const from = findContainer(active.id);
    const to = findContainer(over.id);
    if (!from || !to || from === to) return;

    setItems((prev) => {
      const activeKey = String(active.id);
      const target = prev[to];
      let index: number;
      if (String(over.id) in prev) {
        index = target.length;
      } else {
        const overIndex = target.indexOf(String(over.id));
        const moved = active.rect.current.translated;
        const below = moved ? moved.top > over.rect.top + over.rect.height / 2 : false;
        index = overIndex >= 0 ? overIndex + (below ? 1 : 0) : target.length;
      }
      return {
        ...prev,
        [from]: prev[from].filter((k) => k !== activeKey),
        [to]: [...target.slice(0, index), activeKey, ...target.slice(index)],
      };
    });
  };

  const finish = () => {
    dragging.current = false;
    setActive(null);
    // Das Loslassen soll keinen Klick auf die Karte auslösen
    suppressClick.current = true;
    window.setTimeout(() => (suppressClick.current = false), 80);
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    finish();
    const type = active.data.current?.type;

    if (type === "bucket") {
      if (!over || active.id === over.id || over.data.current?.type !== "bucket") return;
      const next = arrayMove(order, order.indexOf(String(active.id)), order.indexOf(String(over.id)));
      setOrder(next);
      reorderBuckets(next.map(numberOf)).catch((e) => {
        setError(String(e));
        resync();
      });
      return;
    }

    if (!over) return resync();
    const activeKey = String(active.id);
    const container = findContainer(activeKey);
    const overContainer = findContainer(over.id);
    if (!container || !overContainer) return resync();

    let next = items;
    if (container === overContainer && String(over.id) !== container) {
      const from = items[container].indexOf(activeKey);
      const to = items[container].indexOf(String(over.id));
      if (from !== to && to >= 0) next = { ...items, [container]: arrayMove(items[container], from, to) };
    }
    setItems(next);

    if (JSON.stringify(next) === JSON.stringify(buildItems(columns))) return;

    // Speichern: Aufgabe in den Bucket legen, direkt vor die jetzt folgende Aufgabe
    const list = next[container];
    const following = list[list.indexOf(activeKey) + 1];
    const bucketId = container === "c:none" ? null : numberOf(container);
    moveTask(numberOf(activeKey), bucketId, following ? numberOf(following) : null).catch((e) => {
      setError(String(e));
      resync();
    });
  };

  const onDragCancel = () => {
    finish();
    resync();
  };

  const activeTask = active?.type === "task" ? taskById.get(active.id) : undefined;

  return (
    <>
      {error && <p className="field-error board-error">{error}</p>}
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        <div ref={boardRef} className={`board${active ? " is-dragging" : ""}`}>
          {unassigned && (
            <ColumnView
              column={unassigned}
              ids={items["c:none"] ?? []}
              taskById={taskById}
              suppressClick={suppressClick}
              collapsed={collapsed.has("none")}
              onToggleCollapsed={() => toggleCollapsed("none")}
              taskDragging={active?.type === "task"}
            />
          )}
          <SortableContext items={order} strategy={horizontalListSortingStrategy}>
            {bucketColumns.map((column) => (
              <ColumnView
                key={column.bucket!.id}
                column={column}
                ids={items[containerKey(column.bucket)] ?? []}
                taskById={taskById}
                suppressClick={suppressClick}
                collapsed={collapsed.has(String(column.bucket!.id))}
                onToggleCollapsed={() => toggleCollapsed(String(column.bucket!.id))}
                taskDragging={active?.type === "task"}
              />
            ))}
          </SortableContext>

          <button type="button" className="bucket-new" aria-label="Neuer Bucket" title="Neuer Bucket" onClick={openNewBucket}>
            <Plus size={16} />
          </button>
        </div>

        <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }}>
          {activeTask ? (
            <article className={`task-card overlay${activeTask.done ? " done" : ""}`}>
              <TaskCardView task={activeTask} />
            </article>
          ) : null}
        </DragOverlay>
      </DndContext>
    </>
  );
}

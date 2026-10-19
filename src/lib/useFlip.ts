import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

const SHIFT_MS = 380;
const FLY_MS = 560;
const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

interface Entry {
  rect: DOMRect;
  group: string;
}

/** Eine Kopie der Karte fliegt vom alten zum neuen Platz. Nötig, wenn Spalten ihren Inhalt abschneiden. */
function fly(el: HTMLElement, from: DOMRect, to: DOMRect) {
  const clone = el.cloneNode(true) as HTMLElement;
  clone.removeAttribute("data-flip");
  clone.classList.add("flip-clone");
  Object.assign(clone.style, {
    position: "fixed",
    left: `${from.left}px`,
    top: `${from.top}px`,
    width: `${from.width}px`,
    height: `${from.height}px`,
    margin: "0",
    zIndex: "90",
    pointerEvents: "none",
    transform: "none",
  });
  document.body.appendChild(clone);
  el.style.visibility = "hidden";

  const dx = to.left - from.left;
  const dy = to.top - from.top;
  const animation = clone.animate(
    [
      { transform: "translate(0, 0) scale(1)", boxShadow: "0 2px 6px rgba(0,0,0,0.25)" },
      { transform: `translate(${dx * 0.5}px, ${dy * 0.5}px) scale(1.03)`, boxShadow: "0 18px 40px rgba(0,0,0,0.45)", offset: 0.5 },
      { transform: `translate(${dx}px, ${dy}px) scale(1)`, boxShadow: "0 2px 6px rgba(0,0,0,0.25)" },
    ],
    { duration: FLY_MS, easing: EASE },
  );
  const done = () => {
    clone.remove();
    el.style.visibility = "";
  };
  animation.onfinish = done;
  animation.oncancel = done;
}

/**
 * Elemente mit `data-flip="<id>"` gleiten sanft an ihren neuen Platz, wenn sich `trigger` ändert (z. B. weil sich
 * die Daten geändert haben). Wechselt ein Element die Gruppe (`data-flip-group`), fliegt eine Kopie hinüber, die nicht
 * von der Spalte abgeschnitten wird. Während `enabled` false ist (z. B. beim Ziehen), passiert nichts.
 */
export function useFlip(container: RefObject<HTMLElement | null>, trigger: unknown, enabled = true) {
  const entries = useRef(new Map<string, Entry>());
  const lastTrigger = useRef(trigger);

  const measure = () => {
    const root = container.current;
    const next = new Map<string, Entry>();
    root?.querySelectorAll<HTMLElement>("[data-flip]").forEach((el) => {
      next.set(el.dataset.flip!, { rect: el.getBoundingClientRect(), group: el.dataset.flipGroup ?? "" });
    });
    return next;
  };

  // Nach jedem Rendern die Plätze merken; nur bei geänderten Daten wird daraus eine Bewegung
  useLayoutEffect(() => {
    const next = measure();
    const changed = lastTrigger.current !== trigger;
    lastTrigger.current = trigger;

    if (changed && enabled && !reducedMotion()) {
      container.current?.querySelectorAll<HTMLElement>("[data-flip]").forEach((el) => {
        const id = el.dataset.flip!;
        const prev = entries.current.get(id);
        const now = next.get(id);
        if (!prev || !now) return;
        const dx = prev.rect.left - now.rect.left;
        const dy = prev.rect.top - now.rect.top;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
        if (prev.group !== now.group) fly(el, prev.rect, now.rect);
        else el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }], { duration: SHIFT_MS, easing: EASE });
      });
    }
    entries.current = next;
  });

  // Scrollen und Größenänderungen verschieben alles gleichmäßig und sind keine Bewegung
  useEffect(() => {
    let frame = 0;
    const refresh = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => (entries.current = measure()));
    };
    window.addEventListener("scroll", refresh, true);
    window.addEventListener("resize", refresh);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", refresh, true);
      window.removeEventListener("resize", refresh);
    };
    // measure liest nur den Container
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

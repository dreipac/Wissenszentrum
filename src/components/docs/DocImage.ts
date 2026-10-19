import { Node, mergeAttributes } from "@tiptap/core";
import { docImageUrl } from "../../lib/api/docImages";

export type ImageAlign = "left" | "center" | "right";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    docImage: {
      insertDocImage: (attrs: { imageId: number; width?: number | null }) => ReturnType;
    };
  }
}

const MIN_WIDTH = 48;

/**
 * Bild in der Dokumentation. Im Text steht nur die ID (\`<img data-image-id="3">\`), die Bytes liegen in der Datenbank.
 * Angeklickt erscheint ein Anfasser unten rechts zum Skalieren; die Größe wird in Pixel gespeichert (leer = volle Breite).
 */
export const DocImage = Node.create({
  name: "docImage",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      imageId: {
        default: 0,
        parseHTML: (el) => Number(el.getAttribute("data-image-id")),
        renderHTML: (attrs) => ({ "data-image-id": attrs.imageId }),
      },
      width: {
        default: null,
        parseHTML: (el) => (el.getAttribute("data-width") ? Number(el.getAttribute("data-width")) : null),
        renderHTML: (attrs) => (attrs.width ? { "data-width": attrs.width } : {}),
      },
      align: {
        default: "left",
        parseHTML: (el) => el.getAttribute("data-align") || "left",
        renderHTML: (attrs) => ({ "data-align": attrs.align }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "img[data-image-id]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["img", mergeAttributes(HTMLAttributes, { alt: "" })];
  },

  addCommands() {
    return {
      insertDocImage:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },

  addNodeView() {
    return ({ node: initial, getPos, editor }) => {
      let node = initial;

      const dom = document.createElement("div");
      dom.className = "doc-image";
      const frame = document.createElement("div");
      frame.className = "doc-image-frame";
      const img = document.createElement("img");
      img.alt = "";
      img.draggable = false;
      const handle = document.createElement("span");
      handle.className = "doc-image-handle";
      handle.title = "Ziehen zum Skalieren";
      frame.append(img, handle);
      dom.append(frame);

      const apply = () => {
        const width = node.attrs.width as number | null;
        frame.style.width = width ? `${width}px` : "100%";
        dom.dataset.align = node.attrs.align as string;
      };
      apply();

      docImageUrl(node.attrs.imageId as number)
        .then((url) => (img.src = url))
        .catch(() => dom.classList.add("missing"));

      // Skalieren: Anfasser ziehen, beim Loslassen wird die Breite gespeichert
      handle.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        try {
          handle.setPointerCapture(e.pointerId);
        } catch {
          /* Zeiger nicht mehr aktiv */
        }
        const startX = e.clientX;
        const startWidth = frame.getBoundingClientRect().width;
        const limit = (dom.parentElement?.getBoundingClientRect().width ?? 2000) - 2;
        let width = startWidth;

        const move = (ev: PointerEvent) => {
          width = Math.round(Math.min(Math.max(startWidth + (ev.clientX - startX), MIN_WIDTH), limit));
          frame.style.width = `${width}px`;
        };
        const up = () => {
          handle.removeEventListener("pointermove", move);
          handle.removeEventListener("pointerup", up);
          handle.removeEventListener("pointercancel", up);
          const pos = getPos();
          if (typeof pos !== "number") return;
          editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, width }));
        };
        handle.addEventListener("pointermove", move);
        handle.addEventListener("pointerup", up);
        handle.addEventListener("pointercancel", up);
      });

      return {
        dom,
        update(updated) {
          if (updated.type !== node.type) return false;
          node = updated;
          apply();
          return true;
        },
        // Der Anfasser behandelt seine Ereignisse selbst
        stopEvent: (event) => event.target === handle,
        ignoreMutation: () => true,
      };
    };
  },
});

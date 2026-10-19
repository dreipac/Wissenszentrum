import { Mark, mergeAttributes } from "@tiptap/core";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    textSize: {
      /** Setzt die Schriftgröße (in Pixel) für die Auswahl */
      setTextSize: (size: number) => ReturnType;
      /** Zurück zur Standardgröße */
      unsetTextSize: () => ReturnType;
    };
  }
}

/** Auswahl in der Werkzeugleiste (Pixel); der Fließtext hat etwa 15 px. */
export const TEXT_SIZES = [12, 14, 16, 18, 20, 24, 28, 32, 40, 48];

/** Schriftgröße als Markierung: `<span style="font-size: 20px">`. Ohne Markierung gilt die Standardgröße. */
export const TextSize = Mark.create({
  name: "textSize",

  addAttributes() {
    return {
      size: {
        default: null,
        parseHTML: (el) => {
          const px = parseFloat((el as HTMLElement).style.fontSize);
          return Number.isFinite(px) ? Math.round(px) : null;
        },
        renderHTML: (attrs) => (attrs.size ? { style: `font-size: ${attrs.size}px` } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span", getAttrs: (el) => ((el as HTMLElement).style.fontSize ? null : false) }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setTextSize:
        (size) =>
        ({ commands }) =>
          commands.setMark(this.name, { size }),
      unsetTextSize:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },
});

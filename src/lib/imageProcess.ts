const MAX_SIDE = 2000;
const MAX_INPUT_BYTES = 25_000_000;
const MAX_STORED_BYTES = 12_000_000;

export interface PreparedImage {
  blob: Blob;
  mime: string;
  width: number;
  height: number;
}

/**
 * Bereitet ein Foto zum Speichern vor: sehr große Bilder werden auf höchstens 2000 Pixel Kantenlänge verkleinert und
 * als WebP abgelegt. Das hält die Datenbank klein und das Bild trotzdem scharf. GIFs (Animation) bleiben unverändert.
 */
export async function prepareImage(file: Blob): Promise<PreparedImage> {
  if (!file.type.startsWith("image/") || file.type === "image/svg+xml") {
    throw "Dieses Bildformat wird nicht unterstützt. Nutze PNG, JPEG, WebP oder GIF.";
  }
  if (file.size > MAX_INPUT_BYTES) throw "Das Bild ist zu groß (höchstens 25 MB).";

  const bitmap = await createImageBitmap(file).catch(() => {
    throw "Das Bild konnte nicht gelesen werden.";
  });
  const { width, height } = bitmap;

  if (file.type === "image/gif") {
    bitmap.close();
    if (file.size > MAX_STORED_BYTES) throw "Das GIF ist zu groß (höchstens 12 MB).";
    return { blob: file, mime: file.type, width, height };
  }

  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const encoded = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.88));
  const original = ["image/png", "image/jpeg", "image/webp", "image/avif"].includes(file.type);
  // Ist das Original schon klein und unverändert in der Größe, bleibt es, wie es ist
  const result = !encoded || (scale === 1 && original && file.size <= encoded.size) ? file : encoded;
  if (result.size > MAX_STORED_BYTES) throw "Das Bild ist auch verkleinert zu groß.";
  return { blob: result, mime: result.type || file.type, width: w, height: h };
}

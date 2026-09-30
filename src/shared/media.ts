export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
export const AUDIO_TYPES = [
  "audio/mpeg",
  "audio/mp3",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
  "audio/mp4",
  "audio/x-m4a",
  "audio/aac",
];
export const MAX_IMAGE = 3 * 1024 * 1024,
  MAX_AUDIO = 5 * 1024 * 1024;
const mb = (size: number) => `${(size / 1024 / 1024).toFixed(1)} МБ`;

/** Проверяем тип, размер и реальную читаемость файла до записи, чтобы не потерять старое медиа. */
export async function checkMedia(
  file: File,
  kind: "image" | "audio",
): Promise<{ ok: true; blob: Blob } | { ok: false; message: string }> {
  const types = kind === "image" ? IMAGE_TYPES : AUDIO_TYPES,
    limit = kind === "image" ? MAX_IMAGE : MAX_AUDIO;
  if (!types.includes(file.type))
    return {
      ok: false,
      message: `Формат «${file.type || "неизвестный"}» не подходит. Нужен ${kind === "image" ? "PNG, JPEG, WebP или SVG" : "MP3, OGG, WAV или M4A"}.`,
    };
  if (file.size > limit) return { ok: false, message: `Файл ${mb(file.size)} — больше допустимых ${mb(limit)}.` };
  const url = URL.createObjectURL(file);
  try {
    await new Promise<void>((resolve, reject) => {
      if (kind === "image") {
        if (file.type === "image/svg+xml")
          return file.text().then((text) => (text.includes("<svg") ? resolve() : reject(new Error("svg"))), reject);
        const image = new Image();
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("image"));
        image.src = url;
      } else {
        const audio = document.createElement("audio");
        audio.onloadedmetadata = () => resolve();
        audio.onerror = () => reject(new Error("audio"));
        audio.src = url;
      }
    });
  } catch {
    return { ok: false, message: "Файл не удалось прочитать — он повреждён или это не тот формат." };
  } finally {
    URL.revokeObjectURL(url);
  }
  return { ok: true, blob: file };
}

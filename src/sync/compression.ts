import { deflateSync, inflateSync } from "fflate";

const BASE64_CHUNK = 0x8000;
const toBase64 = (bytes: Uint8Array) => {
  let binary = "";
  // Порциями: spread всего массива в String.fromCharCode переполняет стек на снимке в сотни килобайт.
  for (let index = 0; index < bytes.length; index += BASE64_CHUNK)
    binary += String.fromCharCode(...bytes.subarray(index, index + BASE64_CHUNK));
  return btoa(binary);
};
const fromBase64 = (text: string) => {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
};
/**
 * Формат 6: JSON снимка → UTF-8 → raw deflate → base64, чтобы каждое значение CloudStorage было ASCII.
 * Отдельный модуль грузится только при чтении или записи формата 6: чанк синхронизации берётся сразу после запуска.
 */
export const packSnapshot = (json: string) => toBase64(deflateSync(new TextEncoder().encode(json)));
export const unpackSnapshot = (text: string) =>
  new TextDecoder("utf-8", { fatal: true }).decode(inflateSync(fromBase64(text)));

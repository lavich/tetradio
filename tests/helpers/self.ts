/** dexie-export-import рассчитан на браузер: в Node нужны глобальные self и FileReader. */
const scope = globalThis as unknown as { self?: unknown; FileReader?: unknown };
scope.self ??= globalThis;
if (!scope.FileReader) {
  class FileReaderPolyfill {
    result: string | ArrayBuffer | null = null;
    error: unknown = null;
    onload: ((event: { target: FileReaderPolyfill }) => void) | null = null;
    onerror: ((event: { target: FileReaderPolyfill }) => void) | null = null;
    onloadend: ((event: { target: FileReaderPolyfill }) => void) | null = null;
    private finish(promise: Promise<string | ArrayBuffer>) {
      promise.then(
        (value) => {
          this.result = value;
          this.onload?.({ target: this });
          this.onloadend?.({ target: this });
        },
        (error) => {
          this.error = error;
          this.onerror?.({ target: this });
          this.onloadend?.({ target: this });
        },
      );
    }
    readAsText(blob: Blob) {
      this.finish(blob.text());
    }
    readAsArrayBuffer(blob: Blob) {
      this.finish(blob.arrayBuffer());
    }
    addEventListener(type: string, listener: (event: { target: FileReaderPolyfill }) => void) {
      if (type === "load") this.onload = listener;
      if (type === "error") this.onerror = listener;
      if (type === "loadend") this.onloadend = listener;
    }
  }
  scope.FileReader = FileReaderPolyfill;
}
export {};

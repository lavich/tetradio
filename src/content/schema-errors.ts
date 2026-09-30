/** Ошибка контракта контента; вынесена отдельно, чтобы схема пакета и модель курса не импортировали друг друга. */
export type ContentErrorKind = "schema" | "unsupported" | "network" | "storage";
export class ContentError extends Error {
  readonly kind: ContentErrorKind;
  constructor(message: string, kind: ContentErrorKind = "schema") {
    super(message);
    this.kind = kind;
  }
}

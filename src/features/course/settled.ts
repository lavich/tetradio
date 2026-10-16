export const settledFor = <T extends { lessonId: string }>(result: T | undefined, lessonId: string) =>
  result?.lessonId === lessonId ? result : undefined;

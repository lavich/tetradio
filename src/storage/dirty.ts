/**
 * Отметка «есть неопубликованные изменения» пишется в той же транзакции, что и само изменение.
 * Каждое изменение пишет новую метку: публикация снимает только ту, что прочитала при сборке снимка.
 */
export const DIRTY_KEY = "sync:dirty";
let changes = 0;
export const dirtyMark = () =>
  `${Date.now().toString(36)}-${(++changes).toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

import { StrictMode, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

let root: Root | null = null;
export const appRoot = () => (root ??= createRoot(document.getElementById("root")!));

/** Замена всего дерева: без живых запросов, эффектов и границы восстановления, которая переоткрыла бы базу. */
export const showStatic = (content: ReactNode) => appRoot().render(<StrictMode>{content}</StrictMode>);

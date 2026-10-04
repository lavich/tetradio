import { useEffect, useState } from "react";

export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => typeof matchMedia === "function" && matchMedia(query).matches);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const list = matchMedia(query);
    const change = () => setMatches(list.matches);
    list.addEventListener("change", change);
    return () => list.removeEventListener("change", change);
  }, [query]);
  return matches;
}

/** Разворот из двух страниц — когда окно широкое, как у Telegram Desktop на весь экран. */
export const useSpread = () => useMediaQuery("(min-width: 1024px)");
/** Две колонки от 900 px: там список сделанного не сворачивается. */
export const useWide = () => useMediaQuery("(min-width: 900px)");

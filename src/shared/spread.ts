import { useEffect, useState } from "react";

/** Разворот из двух страниц — когда окно широкое, как у Telegram Desktop на весь экран. */
const SPREAD = "(min-width: 1024px)";
export function useSpread() {
  const [wide, setWide] = useState(() => typeof matchMedia === "function" && matchMedia(SPREAD).matches);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const query = matchMedia(SPREAD);
    const change = () => setWide(query.matches);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
  return wide;
}

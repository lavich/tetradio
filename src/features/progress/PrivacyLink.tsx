import { telegramBridge } from "../../platform/platform";

/** `openLink` требует полный адрес и не уводит Mini App с экрана. */
export function PrivacyLink({ className }: { className?: string }) {
  const address = new URL(`${import.meta.env.BASE_URL}privacy/`, location.origin).href;
  return (
    <a
      className={`underline ${className ?? ""}`}
      href={address}
      target="_blank"
      rel="noopener"
      onClick={(event) => {
        const app = telegramBridge();
        if (!app?.openLink || !app.isVersionAtLeast("6.1")) return;
        event.preventDefault();
        app.openLink(address);
      }}
    >
      Политика конфиденциальности
    </a>
  );
}

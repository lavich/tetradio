import type { ReactNode } from "react";
import { telegramBridge } from "../../platform/platform";
import { PROJECT_URL } from "../../shared/project";

/** `openLink` требует полный адрес и не уводит Mini App с экрана. */
function ExternalLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  return (
    <a
      className={`underline ${className ?? ""}`}
      href={href}
      target="_blank"
      rel="noopener"
      onClick={(event) => {
        const app = telegramBridge();
        if (!app?.openLink || !app.isVersionAtLeast("6.1")) return;
        event.preventDefault();
        app.openLink(href);
      }}
    >
      {children}
    </a>
  );
}

export const PrivacyLink = ({ className }: { className?: string }) => (
  <ExternalLink href={new URL(`${import.meta.env.BASE_URL}privacy/`, location.origin).href} className={className}>
    Политика конфиденциальности
  </ExternalLink>
);

export const ProjectLink = ({ className }: { className?: string }) => (
  <ExternalLink href={PROJECT_URL} className={className}>
    Проект на GitHub
  </ExternalLink>
);

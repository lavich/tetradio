import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Volume2 } from "lucide-react";
import { playText, useTextAudioKind } from "../../../shared/audio";
import { useProfile } from "../../../shared/language";
import { QUIET_SPEAK } from "../../words/WordCardView";
import ui from "../../../shared/ui.module.css";
import wordCss from "../../../shared/word.module.css";

/** Кнопка озвучки текста фразы или полного предложения; при отсутствии файла и голоса — подпись. */
export function SpeakText({
  text,
  audioAssetId,
  label,
  quiet,
}: {
  text: string;
  audioAssetId?: string;
  label: string;
  quiet?: boolean;
}) {
  const profile = useProfile();
  const kind = useTextAudioKind(audioAssetId, profile);
  const [failed, setFailed] = useState<"none" | "error" | null>(null);
  return (
    <div className={wordCss.speakBox}>
      <Button
        size="icon-xl"
        variant={quiet ? "outline" : "default"}
        className={quiet ? QUIET_SPEAK : "size-14 rounded-full [&_svg:not([class*='size-'])]:size-6.5"}
        disabled={kind === "none"}
        aria-label={kind === "none" ? "Озвучка недоступна" : label}
        onClick={() =>
          playText(text, audioAssetId, profile).then((result) =>
            setFailed(result === "none" || result === "error" ? result : null),
          )
        }
      >
        <Volume2 aria-hidden />
      </Button>
      {(kind === "none" || failed === "none") && (
        <span className={ui.note}>Озвучка недоступна: нет файла и {profile.voiceName}</span>
      )}
      {failed === "error" && (
        <span className={ui.note} role="status">
          Не удалось воспроизвести. Нажмите ещё раз.
        </span>
      )}
    </div>
  );
}

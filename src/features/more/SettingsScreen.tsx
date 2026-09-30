import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Screen } from "../../app/Screen";
import { useHapticsSetting } from "../../platform/haptics";
import { usePlatform } from "../../platform/platform";
import { useSettings } from "../../shared/store";
import { saveSettings } from "../../storage/ops";
import ui from "../../shared/ui.module.css";

const ZONES = ["Asia/Nicosia", "Europe/Athens", "Europe/Moscow", "Europe/Berlin", "Europe/London", "UTC"];
export function SettingsScreen() {
  const { settings } = useSettings();
  const [daily, setDaily] = useState("10");
  const [size, setSize] = useState("20");
  const [zone, setZone] = useState("Asia/Nicosia");
  const [problem, setProblem] = useState("");
  const [saved, setSaved] = useState(false);
  // Переключатель отвечает сразу, не дожидаясь живого запроса; значение из базы догоняет через эффект ниже.
  const [reports, setReports] = useState(true);
  const [reportsStatus, setReportsStatus] = useState("");
  const [autoSpeak, setAutoSpeak] = useState(true);
  const platform = usePlatform();
  const [haptics, setHaptics] = useHapticsSetting();
  useEffect(() => {
    setSize(String(settings.sessionSize));
    setZone(settings.timezone);
    setReports(settings.errorReports);
    setAutoSpeak(settings.autoSpeak);
  }, [settings]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const sessionSize = Number(size);
    if (!Number.isInteger(sessionSize) || sessionSize < 2 || sessionSize > 100)
      return setProblem("Размер занятия — целое число от 2 до 100.");
    setProblem("");
    await saveSettings({ ...settings, sessionSize, timezone: zone });
    setSaved(true);
  };
  return (
    <Screen back="Настройки">
      <form onSubmit={submit}>
        <FieldGroup>
          <Field data-invalid={problem.includes("лимит") || undefined}>
            <FieldLabel htmlFor="daily">Новых слов в день</FieldLabel>
            <Input
              id="daily"
              type="number"
              min={0}
              max={100}
              value={daily}
              aria-invalid={problem.includes("лимит") || undefined}
              onChange={(event) => {
                setDaily(event.target.value);
                setSaved(false);
              }}
            />
            <FieldDescription>Сколько новых слов Lexi может ввести за сутки.</FieldDescription>
          </Field>
          <Field data-invalid={problem.includes("Размер") || undefined}>
            <FieldLabel htmlFor="size">Упражнений в занятии</FieldLabel>
            <Input
              id="size"
              type="number"
              min={2}
              max={100}
              value={size}
              aria-invalid={problem.includes("Размер") || undefined}
              onChange={(event) => {
                setSize(event.target.value);
                setSaved(false);
              }}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="zone">Часовой пояс</FieldLabel>
            <Select
              value={zone}
              onValueChange={(value) => {
                if (value) setZone(value);
                setSaved(false);
              }}
            >
              <SelectTrigger id="zone" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {ZONES.map((item) => (
                    <SelectItem key={item} value={item}>
                      {item}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <FieldDescription>По этой зоне считаются дни, сроки и дневной лимит.</FieldDescription>
          </Field>
        </FieldGroup>
        {problem && (
          <p className={ui.error} role="alert">
            {problem}
          </p>
        )}
        <Button size="xl" type="submit" className="mt-4">
          Сохранить
        </Button>
        {saved && (
          <p className="mt-2 text-sm text-(--ok)" role="status">
            Сохранено. Новые значения применятся к следующим занятиям, история ответов не изменилась.
          </p>
        )}
      </form>
      <section className="mt-6" data-testid="auto-speak-settings">
        <h2>Озвучка</h2>
        <label
          className="flex items-center justify-between gap-3"
          style={{ color: "inherit", fontSize: 16, margin: 0 }}
        >
          <span>
            Озвучивать автоматически
            <br />
            <span className="text-sm text-muted-foreground">
              Карточка знакомства и задание «Что прозвучало?» звучат сами при открытии. Выключите, если занимаетесь там,
              где нужна тишина: кнопка озвучки работает в любом случае.
            </span>
          </span>
          <input
            type="checkbox"
            role="switch"
            aria-label="Озвучивать автоматически"
            checked={autoSpeak}
            onChange={(event) => {
              const enabled = event.target.checked;
              setAutoSpeak(enabled);
              void saveSettings({ ...settings, autoSpeak: enabled });
            }}
            style={{ width: 22, height: 22, minHeight: 0 }}
          />
        </label>
      </section>
      <section className="mt-6" data-testid="error-reports-settings">
        <h2>Отчёты об ошибках</h2>
        <label
          className="flex items-center justify-between gap-3"
          style={{ color: "inherit", fontSize: 16, margin: 0 }}
        >
          <span>
            Отправлять отчёты об ошибках
            <br />
            <span className="text-sm text-muted-foreground">
              При сбое приложение отправляет тип ошибки, стек и версию — без слов, ответов и данных Telegram. Что именно
              уходит, описано на экране «Копия данных». Действует сразу.
            </span>
          </span>
          <input
            type="checkbox"
            role="switch"
            aria-label="Отправлять отчёты об ошибках"
            checked={reports}
            onChange={(event) => {
              const enabled = event.target.checked;
              setReports(enabled);
              setReportsStatus("");
              saveSettings({ ...settings, errorReports: enabled }).then(
                () => setReportsStatus(enabled ? "Отчёты включены." : "Отчёты выключены, накопленная очередь удалена."),
                () => setReportsStatus("Не удалось сохранить настройку."),
              );
            }}
            style={{ width: 22, height: 22, minHeight: 0 }}
          />
        </label>
        {reportsStatus && (
          <p className="mt-2 text-sm text-(--ok)" role="status" data-testid="error-reports-status">
            {reportsStatus}
          </p>
        )}
      </section>
      {platform.kind === "telegram" && (
        <section className="mt-6" data-testid="telegram-settings">
          <h2>Telegram</h2>
          <label
            className="flex items-center justify-between gap-3"
            style={{ color: "inherit", fontSize: 16, margin: 0 }}
          >
            <span>
              Тактильный отклик результата
              <br />
              <span className="text-sm text-muted-foreground">
                Лёгкая вибрация после сохранённого ответа: успех, почти правильно, ошибка. Настройка хранится на этом
                устройстве.{platform.capabilities.haptics ? "" : " В этом клиенте отклик недоступен."}
              </span>
            </span>
            <input
              type="checkbox"
              role="switch"
              aria-label="Тактильный отклик результата"
              checked={haptics && platform.capabilities.haptics}
              disabled={!platform.capabilities.haptics}
              onChange={(event) => setHaptics(event.target.checked)}
              style={{ width: 22, height: 22, minHeight: 0 }}
            />
          </label>
        </section>
      )}
    </Screen>
  );
}

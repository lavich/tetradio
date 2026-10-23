import type { ReactNode } from "react";
import type { VerbGroup } from "../domain/types";
import css from "./verb-group-label.module.css";

const GROUPS: Record<Exclude<VerbGroup, "other">, { shown: string; spoken: string; greek?: string }> = {
  A: { shown: "гр. A", spoken: "группа A" },
  B1: { shown: "гр. B как ", spoken: "группа B, как ", greek: "αγαπάω" },
  B2: { shown: "гр. B как ", spoken: "группа B, как ", greek: "μπορώ" },
  mid: { shown: "на ", spoken: "глагол на ", greek: "-μαι" },
};

export interface VerbGroupFields {
  group?: VerbGroup;
  irregular?: true;
}

export const showsVerbGroup = ({ group, irregular }: VerbGroupFields) => !!group && (group !== "other" || !!irregular);

/** «гр.» и «прош.» диктор читал бы буквами, поэтому слышна полная фраза, а сокращения скрыты. */
export function VerbGroupLabel({
  group,
  irregular,
  headwordShown = false,
}: VerbGroupFields & { headwordShown?: boolean }) {
  if (!showsVerbGroup({ group, irregular })) return null;
  const known = group === "other" ? undefined : GROUPS[group!];
  const greek = (text?: string): ReactNode =>
    text && (
      <span lang="el" className={css.greek}>
        {text}
      </span>
    );
  return (
    <span className={css.label} data-testid="verb-group">
      <span aria-hidden>
        {known && (
          <span className={css.piece}>
            {known.shown}
            {greek(known.greek)}
            {irregular && "\u00a0·"}
          </span>
        )}
        {known && irregular && " "}
        {irregular && <span className={css.piece}>неправ. прош.</span>}
      </span>
      <span className="sr-only select-none">
        {headwordShown && ", "}
        {known?.spoken}
        {greek(known?.greek)}
        {irregular && (known ? ", неправильное прошедшее" : "неправильное прошедшее")}
      </span>
    </span>
  );
}

export function VerbGroupRow({
  verb,
  as: Tag = "div",
  className,
  headwordShown,
  children,
}: {
  verb: VerbGroupFields;
  as?: "div" | "span";
  className?: string;
  headwordShown?: boolean;
  children?: ReactNode;
}) {
  if (!showsVerbGroup(verb)) return children ? <Tag className={className}>{children}</Tag> : null;
  return (
    <Tag className={`${css.row} ${className ?? ""}`}>
      <VerbGroupLabel group={verb.group} irregular={verb.irregular} headwordShown={headwordShown} />
      {children}
    </Tag>
  );
}

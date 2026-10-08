import { launchContext } from "../../platform/launch";
import { useCourseProfile } from "../../shared/language";
import { coverColor } from "../../shared/notebook";
import type { ModuleView } from "../../storage/course";
import { pairs } from "./paginate";
import css from "./module-screen.module.css";

/**
 * Изнанка обложки с полки: тот же цвет и номер, школьная наклейка и шпаргалка модуля.
 * На развороте шпаргалка видна целиком, на телефоне обложка — клапан над страницей, шпаргалка свёрнута.
 */
export function ModuleCover({ view, open }: { view: ModuleView; open: boolean }) {
  const { module } = view;
  const draft = module.status === "draft";
  const name = launchContext().user?.firstName;
  const profile = useCourseProfile(module.courseId);
  const { code } = profile;
  const crib = module.crib ? (
    <>
      <table className={css.cribTable} lang={code}>
        <tbody>
          {pairs(module.crib.rows).map((line, i) => (
            <tr key={i}>
              {line.map(([label, value]) => (
                <td key={label + value}>
                  <span className={css.cribLabel}>{label}</span> <b>{value}</b>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {module.crib.note ? <p className={css.cribNote}>{module.crib.note}</p> : null}
    </>
  ) : null;
  const heading = (
    <>
      на обороте обложки <i lang={code}>{module.crib?.title}</i>
    </>
  );
  return (
    <section
      className={[open ? css.inside : css.flap, draft ? css.flapDraft : ""].join(" ")}
      style={draft ? undefined : ({ "--cover": coverColor(module.number) } as React.CSSProperties)}
      aria-label={`Обложка модуля ${module.number}`}
    >
      <p className={css.coverNum}>{String(module.number).padStart(2, "0")}</p>
      <dl className={css.sticker}>
        <div>
          <dt lang={code}>{profile.cover.lesson}</dt>
          <dd>
            <h1 className={css.stickerTitle} lang={code}>
              {module.title}
            </h1>
            <span className={css.stickerSub}>{module.subtitle}</span>
          </dd>
        </div>
        <div>
          <dt lang={code}>{profile.cover.name}</dt>
          <dd className={css.stickerInk}>{name}</dd>
        </div>
      </dl>
      {crib ? (
        open ? (
          <div className={css.crib}>
            <p className={css.cribHead}>{heading}</p>
            {crib}
          </div>
        ) : (
          <details className={css.crib}>
            <summary className={css.cribHead}>{heading}</summary>
            {crib}
          </details>
        )
      ) : null}
      {open ? null : (
        <span className={css.flapStaples} aria-hidden="true">
          <i style={{ left: "30%" }} />
          <i style={{ left: "70%" }} />
        </span>
      )}
    </section>
  );
}

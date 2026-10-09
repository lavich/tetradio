import { useLiveQuery } from "dexie-react-hooks";
import { createContext, useContext } from "react";
import { DEFAULT_LANGUAGE, isLanguage, PROFILES, type LanguageProfile } from "../domain/language";
import { db } from "../storage/db";

const fallback = PROFILES[DEFAULT_LANGUAGE];
export const courseProfile = (language: string | undefined): LanguageProfile =>
  isLanguage(language) ? PROFILES[language] : fallback;

export const noVoice = (profile: LanguageProfile) =>
  `На устройстве нет ${profile.voiceName} — включите его в настройках речи.`;

/** Язык курса на экранах урока и модуля; вне курса — язык по умолчанию. */
export const ProfileContext = createContext<LanguageProfile>(fallback);
export const useProfile = () => useContext(ProfileContext);

// Курс в базе язык не хранит: он есть у записей каталога его уроков.
export const useCourseProfile = (courseId: string | undefined): LanguageProfile =>
  useLiveQuery(
    async () =>
      courseId ? courseProfile((await db.catalog.where("courseId").equals(courseId).first())?.language) : fallback,
    [courseId],
  ) ?? fallback;
export const useLessonProfile = (lessonId: string | undefined): LanguageProfile =>
  useLiveQuery(
    async () => (lessonId ? courseProfile((await db.catalog.get(lessonId))?.language) : fallback),
    [lessonId],
  ) ?? fallback;

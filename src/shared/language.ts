import { useLiveQuery } from "dexie-react-hooks";
import { createContext, useContext } from "react";
import { DEFAULT_LANGUAGE, PROFILES, type LanguageProfile } from "../domain/language";
import { lessonCourses, profileOfCourse } from "../storage/courses";

const fallback = PROFILES[DEFAULT_LANGUAGE];

export const noVoice = (profile: LanguageProfile) =>
  `На устройстве нет ${profile.voiceName} — включите его в настройках речи.`;

/** Язык курса на экранах урока и модуля; вне курса — язык по умолчанию. */
export const ProfileContext = createContext<LanguageProfile>(fallback);
export const useProfile = () => useContext(ProfileContext);

export const useCourseProfile = (courseId: string | undefined): LanguageProfile =>
  useLiveQuery(async () => (courseId ? profileOfCourse(courseId) : fallback), [courseId]) ?? fallback;
export const useLessonProfile = (lessonId: string | undefined): LanguageProfile =>
  useLiveQuery(async () => {
    const courseId = lessonId && (await lessonCourses([lessonId])).get(lessonId);
    return courseId ? profileOfCourse(courseId) : fallback;
  }, [lessonId]) ?? fallback;

import LessonChrome from "./LessonChrome";
import { LessonBoardToasts } from "./LessonSheetSwitcher";
import { LessonPaperBackground } from "./LessonPaper.jsx";

/** Официальные слоты tldraw. null отключает стандартную панель, не прячет её через CSS. */
export const lessonBoardComponents = {
  Toolbar: null,
  Background: LessonPaperBackground,
  InFrontOfTheCanvas: LessonChrome,
  StylePanel: null,
  HelperButtons: null,
  SharePanel: null,
  MenuPanel: null,
  MainMenu: null,
  PageMenu: null,
  Toasts: LessonBoardToasts,
  HelpMenu: null,
  DebugMenu: null,
  DebugPanel: null,
  NavigationPanel: null,
  Minimap: null,
  TopPanel: null,
  ActionsMenu: null,
  KeyboardShortcutsDialog: null,
  QuickActions: null,
  ImageToolbar: null,
  RichTextToolbar: null,
};

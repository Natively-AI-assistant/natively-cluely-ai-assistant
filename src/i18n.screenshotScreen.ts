// src/i18n.screenshotScreen.ts
//
// Settings › Overlay › Screenshot screen (ScreenshotScreenRow in
// src/components/settings/OverlaySettings.tsx). English source → [ru, zh, ja,
// es], one row per string. Same shape as src/i18n.sttStatus.ts.
//
// The rows must match the strings the row passes to t() exactly:
// src/components/__tests__/ScreenshotScreenSetting2026_10_29.test.mjs fails on
// a missing row or a leftover row.

type Row = readonly [ru: string, zh: string, ja: string, es: string];

const ROWS: Record<string, Row> = {
  'Screenshot screen': [
    'Экран для снимка',
    '截图屏幕',
    'スクリーンショットの画面',
    'Pantalla de la captura',
  ],
  'Which screen the screenshot shortcut captures. In an area screenshot, a click captures the whole screen you click on.': [
    'Какой экран снимает сочетание клавиш для снимка экрана. При снимке области щелчок снимает весь экран, по которому вы щёлкнули.',
    '截图快捷键截取哪个屏幕。区域截图时，单击会截取你所点击的整个屏幕。',
    'スクリーンショットのショートカットで撮影する画面です。範囲指定のスクリーンショットでは、クリックした画面全体を撮影します。',
    'Qué pantalla captura el atajo de captura de pantalla. En una captura de área, un clic captura toda la pantalla en la que haces clic.',
  ],
  "The overlay's screen": [
    'Экран с оверлеем',
    '浮窗所在的屏幕',
    'オーバーレイのある画面',
    'La pantalla del overlay',
  ],
  'The screen under the mouse': [
    'Экран под указателем',
    '鼠标所在的屏幕',
    'マウスのある画面',
    'La pantalla bajo el ratón',
  ],
  'Screen': [
    'Экран',
    '屏幕',
    '画面',
    'Pantalla',
  ],
  'main': [
    'основной',
    '主屏幕',
    'メイン',
    'principal',
  ],
};

function column(i: 0 | 1 | 2 | 3): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [en, row] of Object.entries(ROWS)) out[en] = row[i];
  return out;
}

export const SCREENSHOT_SCREEN_EN = Object.freeze(Object.keys(ROWS));
export const SCREENSHOT_SCREEN_RU = column(0);
export const SCREENSHOT_SCREEN_ZH = column(1);
export const SCREENSHOT_SCREEN_JA = column(2);
export const SCREENSHOT_SCREEN_ES = column(3);

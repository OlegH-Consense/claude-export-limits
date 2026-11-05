# Changelog

## 2.0.0

**Repository**
- Restructured: readable sources in `src/`, generated bookmarklets in `dist/`, installer page in `docs/index.html`, build script in `tools/`, tests in `test/`.
- The installer page is now multilingual (EN / UK / RU) with a language switcher and automatic detection.
- Added `README.md` (English) and `README.uk.md` (Ukrainian).
- Added a dependency-free build script and a smoke-test suite on a mocked claude.ai.

**Claude Export 1.1**
- Dialog and error messages in English, Ukrainian or Russian, chosen by the browser language (`LANG_OVERRIDE` forces one). The exported files are unchanged.
- In the built bookmarklet `#` is written as an escape, so the URL contains neither `%` nor `#`.

**Claude Limits 2**
- Auto-refresh every 60 seconds while the panel is open; a failed refresh keeps the last data and shows an error note.
- Compact QUOTA / TIME blocks: `QUOTA LEFT … USED` and `TIME LEFT … ELAPSED` on one line each, above their bars.
- Header shows the plan (Pro, Max 5x/20x, Team, Enterprise, Free) and the organization name, or its ID when the name is a default "…'s Organization".

## 1.0.0

- First version: Claude Export (JSON + Markdown) and Claude Limits.

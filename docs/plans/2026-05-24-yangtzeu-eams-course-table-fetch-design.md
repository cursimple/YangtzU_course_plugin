# Yangtzeu EAMS Course Table Fetch Design

## Goal

Make the Yangtzeu EAMS plugin finish the authenticated WebView flow by entering the EAMS course table page, then request the EAMS AJAX endpoints with the active WebView session cookies to build the schedule draft.

## Confirmed Scope

- Modify only `plugin-packages/yangtzeu-eams`.
- Do not modify the host Android app.
- Do not commit plan documents or code changes unless explicitly requested.

## Chosen Approach

Use page navigation plus same-origin manual requests.

After ATrust authentication succeeds, the plugin opens:

```text
https://jwc3-yangtzeu-edu-cn-s.atrust.yangtzeu.edu.cn/eams/courseTableForStd!courseTable.action
```

From that page context, the plugin requests:

```text
GET /eams/courseTableForStd.action?_=<timestamp>&sf_request_type=ajax
```

It parses `semester.id`, student `ids`, `project.id`, and the maximum teaching week. Then it requests:

```text
POST /eams/courseTableForStd!courseTable.action?sf_request_type=ajax
```

for each teaching week, changing only `startWeek` while keeping the EAMS form fields consistent with the captured page metadata.

## Data Flow

1. `run(ctx)` sets the mobile user agent when supported.
2. Direct `jwc3.yangtzeu.edu.cn/eams/...` URLs are rewritten to the ATrust proxy host.
3. Authentication and verification pages return a waiting status.
4. Non-course-table pages are navigated to the EAMS course table page.
5. The home AJAX fragment is fetched and parsed for form metadata.
6. Detail AJAX HTML is fetched by week and parsed from `TaskActivity(...)` scripts.
7. Parsed courses are added through `ctx.schedule.addCourse(...)`.
8. The plugin commits the schedule draft with `ctx.schedule.commit({ termId })`.

## Error Handling

- ATrust verification HTML or JavaScript redirects are classified and opened in the WebView.
- Authentication HTML returns a waiting status instead of producing an empty schedule.
- EAMS rate-limit responses retry briefly before returning a waiting state.
- Missing course metadata throws an explicit parsing error.

## Testing

- Validate `manifest.json` and optional JSON files with `JSON.parse`.
- Validate `main.js` syntax with `node --check`.
- Recompute `checksums.json` after code and manifest changes.
- Review `git diff` to confirm only the plugin package and plan documents changed.

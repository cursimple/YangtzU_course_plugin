# Yangtzeu EAMS Local Login Gate Design

## Goal

Prevent the plugin from opening the EAMS course table while ATrust is still finishing its post-login handoff.

## Confirmed Scope

- Modify only `plugin-packages/yangtzeu-eams`.
- Use `https://jwc3-yangtzeu-edu-cn-s.atrust.yangtzeu.edu.cn:443/eams/localLogin.action` as the navigation gate.
- Do not modify the host Android app.
- Do not commit plan documents or code changes unless explicitly requested.

## Chosen Approach

Gate automatic course-table navigation on the EAMS local login URL.

The plugin should continue waiting on ATrust authentication and portal transition pages. It should only call `ctx.web.open(COURSE_DETAIL_PAGE_URL)` after the active WebView URL is on the EAMS proxy host and the path is `/eams/localLogin.action`. Once the page is already the course table detail page, the existing fetch and parsing flow continues unchanged.

## Data Flow

1. `run(ctx)` sets the plugin user agent.
2. Direct `jwc3.yangtzeu.edu.cn/eams/...` URLs are normalized to the ATrust proxy host.
3. ATrust login, verification, portal, and post-login handoff URLs return a waiting status.
4. The EAMS proxy `localLogin.action` URL opens the course table detail page.
5. The course table detail page runs the existing EAMS metadata and detail AJAX workflow.
6. Parsed courses are added and committed through the existing schedule API.

## Error Handling

- Unknown pages before `localLogin.action` return a waiting status instead of forcing navigation.
- Authentication HTML and redirect classification remain unchanged.
- Existing empty response, rate-limit, and parse-error handling remains unchanged.

## Testing

- Validate `main.js` syntax with `node --check`.
- Run a lightweight Node behavior check for `run(ctx)` navigation decisions.
- Validate JSON files with `JSON.parse`.
- Recompute `checksums.json` after code and manifest changes.
- Review `git diff` to confirm only planned plugin and documentation changes appear.

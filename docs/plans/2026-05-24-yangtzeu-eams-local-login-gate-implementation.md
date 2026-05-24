# Yangtzeu EAMS Local Login Gate Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking. Do not commit unless the user explicitly asks for a git commit.

**Goal:** Open the Yangtzeu EAMS course table only after the WebView reaches the EAMS proxy `localLogin.action` handoff URL.

**Architecture:** The plugin remains a single WebView ES module entry. `run(ctx)` owns the navigation gate, ATrust waiting states, EAMS AJAX requests, HTML parsing, and schedule draft commit. The new gate is an explicit URL classifier for the EAMS proxy local login page.

**Tech Stack:** JavaScript ES module, plugin `manifest.json`, Android WebView plugin APIs, Node.js syntax and JSON validation.

---

## File Structure

- Modify: `plugin-packages/yangtzeu-eams/main.js`
  - Add an EAMS local login path constant.
  - Add a URL classifier for the EAMS proxy local login page.
  - Change `run(ctx)` so non-course pages wait unless the current URL is the local login gate.
- Modify: `plugin-packages/yangtzeu-eams/manifest.json`
  - Increment plugin version for the package behavior change.
- Modify: `plugin-packages/yangtzeu-eams/checksums.json`
  - Recompute hashes after edits.

## Chunk 1: Navigation Gate

### Task 1: Require localLogin.action before opening the course table

**Files:**
- Modify: `plugin-packages/yangtzeu-eams/main.js`

- [ ] **Step 1: Add the local login path constant**

Add:

```javascript
const COURSE_LOCAL_LOGIN_PATH = "/eams/localLogin.action";
```

- [ ] **Step 2: Add a classifier**

Add a function that parses `toCourseProxyUrl(value) || value`, requires `COURSE_HOST`, and requires `COURSE_LOCAL_LOGIN_PATH`.

- [ ] **Step 3: Change `run(ctx)` navigation**

Keep the direct-host proxy rewrite and authentication waiting logic. Replace unconditional non-course navigation with:

```javascript
if (isCourseLocalLoginPage(currentUrl)) {
  ctx.web.open(COURSE_DETAIL_PAGE_URL);
  return { status: "opening-course-table", from: currentUrl, to: COURSE_DETAIL_PAGE_URL };
}

if (!isCourseDetailPage(currentUrl)) {
  return { status: "waiting-eams-local-login", url: currentUrl };
}
```

## Chunk 2: Package Metadata

### Task 2: Update version and checksums

**Files:**
- Modify: `plugin-packages/yangtzeu-eams/manifest.json`
- Modify: `plugin-packages/yangtzeu-eams/checksums.json`

- [ ] **Step 1: Increment plugin version**

Increment the current dirty package version by one patch version and one version code.

- [ ] **Step 2: Recompute checksums**

Run SHA-256 over the package files listed in `checksums.json` and update changed entries.

## Chunk 3: Verification

### Task 3: Validate behavior and syntax

**Files:**
- Read: `plugin-packages/yangtzeu-eams/main.js`
- Read: `plugin-packages/yangtzeu-eams/manifest.json`
- Read: `plugin-packages/yangtzeu-eams/checksums.json`

- [ ] **Step 1: Check JavaScript syntax**

Run:

```powershell
node --check plugin-packages/yangtzeu-eams/main.js
```

Expected: no syntax errors.

- [ ] **Step 2: Check navigation behavior**

Run a Node script that evaluates `main.js`, sets `globalThis.location.href`, calls `run(ctx)`, and verifies:

- ATrust portal handoff pages do not call `ctx.web.open`.
- EAMS proxy `localLogin.action` opens `COURSE_DETAIL_PAGE_URL`.
- Other EAMS pages before the course detail page return `waiting-eams-local-login`.

- [ ] **Step 3: Check JSON files**

Run:

```powershell
node -e "const fs=require('fs'); for (const f of ['plugin-packages/yangtzeu-eams/manifest.json','plugin-packages/yangtzeu-eams/checksums.json','plugin-packages/yangtzeu-eams/ui/schedule.json','plugin-packages/yangtzeu-eams/datapack/timing.json']) JSON.parse(fs.readFileSync(f,'utf8')); console.log('json ok')"
```

Expected: `json ok`.

- [ ] **Step 4: Review working tree**

Run:

```powershell
git diff -- plugin-packages/yangtzeu-eams docs/plans
```

Expected: only planned plugin and documentation changes appear.

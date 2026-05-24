# Yangtzeu EAMS Course Table Fetch Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the Yangtzeu EAMS WebView flow by navigating to the course table page and fetching EAMS AJAX course data from the authenticated page context.

**Architecture:** The plugin remains a single WebView ES module entry. `run(ctx)` controls navigation, EAMS AJAX requests, response classification, HTML parsing, and schedule draft commit. The manifest declares the same runtime package but increments the version and captures detail request bodies for future request-template inspection.

**Tech Stack:** JavaScript ES module, plugin `manifest.json`, Android WebView plugin APIs, Node.js syntax and JSON validation.

---

## File Structure

- Modify: `plugin-packages/yangtzeu-eams/main.js`
  - Navigate to `courseTableForStd!courseTable.action`.
  - Fetch home AJAX metadata from the authenticated page.
  - Build detail POST payloads from parsed metadata.
  - Use the course-table page as the request referrer.
- Modify: `plugin-packages/yangtzeu-eams/manifest.json`
  - Increment package version.
  - Capture detail request bodies.
- Modify: `plugin-packages/yangtzeu-eams/checksums.json`
  - Recompute hashes after edits.

## Chunk 1: WebView Navigation

### Task 1: Use the course table page as the terminal page

**Files:**
- Modify: `plugin-packages/yangtzeu-eams/main.js`

- [ ] **Step 1: Add a separate detail page URL constant**

Add `COURSE_DETAIL_PAGE_URL` for `/eams/courseTableForStd!courseTable.action` without the AJAX query.

- [ ] **Step 2: Replace home-page readiness with detail-page readiness**

Update `run(ctx)` so it opens `COURSE_DETAIL_PAGE_URL` whenever the current page is not the course detail page.

- [ ] **Step 3: Keep direct-host proxy rewriting**

Retain `toCourseProxyUrl(...)` so direct EAMS URLs under `jwc3.yangtzeu.edu.cn` are normalized to the ATrust proxy host.

## Chunk 2: EAMS Requests

### Task 2: Request metadata and details from the authenticated context

**Files:**
- Modify: `plugin-packages/yangtzeu-eams/main.js`

- [ ] **Step 1: Fetch home AJAX metadata with the detail page as referrer**

Use `COURSE_HOME_URL?_=${Date.now()}&sf_request_type=ajax`.

- [ ] **Step 2: POST detail AJAX with stable EAMS form fields**

Send:

```text
ignoreHead=1
setting.kind=std
startWeek=<week>
project.id=<projectId>
semester.id=<semesterId>
ids=<ids>
```

- [ ] **Step 3: Preserve response classification**

Keep existing authentication, ATrust verification, redirect, rate-limit, and empty-response handling.

## Chunk 3: Package Metadata

### Task 3: Update manifest and checksums

**Files:**
- Modify: `plugin-packages/yangtzeu-eams/manifest.json`
- Modify: `plugin-packages/yangtzeu-eams/checksums.json`

- [ ] **Step 1: Increment plugin version**

Move from `1.0.7` / `1007` to `1.0.8` / `1008`.

- [ ] **Step 2: Capture detail request bodies**

Set `captureRequestBody` to `true` on the detail POST network capture.

- [ ] **Step 3: Recompute checksums**

Run a hash command and write the new SHA-256 values for changed files.

## Chunk 4: Verification

### Task 4: Validate edited package

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

- [ ] **Step 2: Check JSON files**

Run:

```powershell
node -e "const fs=require('fs'); for (const f of ['plugin-packages/yangtzeu-eams/manifest.json','plugin-packages/yangtzeu-eams/checksums.json','plugin-packages/yangtzeu-eams/ui/schedule.json','plugin-packages/yangtzeu-eams/datapack/timing.json']) JSON.parse(fs.readFileSync(f,'utf8')); console.log('json ok')"
```

Expected: `json ok`.

- [ ] **Step 3: Review working tree**

Run:

```powershell
git diff -- plugin-packages/yangtzeu-eams docs/plans
```

Expected: only planned plugin and documentation changes appear.

# Yangtzeu EAMS JS v1 Rewrite Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite `yangtzeu-eams-js-v1` from the retired workflow model to the current `manifest.json` plus WebView `main.js` plugin model.

**Architecture:** The plugin package declares its identity, WebView entry, permissions, host allowlist, and runtime limits in `manifest.json`. `main.js` owns the WebView flow, EAMS AJAX triggering, HTML parsing, course draft creation, and `ctx.schedule.commit()` call. Optional display and timing data remain in `ui/schedule.json` and `datapack/timing.json`, and package metadata is represented by `checksums.json` plus `signature.json`.

**Tech Stack:** JavaScript ES module entry, JSON manifest, system WebView plugin API described in `X:/plugin-system.md`, Node.js syntax validation.

---

## Chunk 1: Package Shape

### Task 1: Replace legacy manifest fields

**Files:**
- Modify: `plugin-packages/yangtzeu-eams-js-v1/manifest.json`
- Create: `plugin-packages/yangtzeu-eams-js-v1/checksums.json`
- Create: `plugin-packages/yangtzeu-eams-js-v1/signature.json`
- Create: `plugin-packages/yangtzeu-eams-js-v1/assets/.gitkeep`
- Create: `plugin-packages/yangtzeu-eams-js-v1/models/.gitkeep`

- [ ] **Step 1: Write the new manifest**

Use these current-platform fields:

```json
{
  "id": "yangtzeu-eams-js-v1",
  "name": "长江大学教务插件 JS v1",
  "version": "1.0.0",
  "versionCode": 1000,
  "apiVersion": 2,
  "entry": "main.js",
  "permissions": [
    "web.navigate",
    "network.fetch",
    "schedule.write"
  ],
  "allowedHosts": [
    "atrust.yangtzeu.edu.cn",
    "jwc3-yangtzeu-edu-cn-s.atrust.yangtzeu.edu.cn",
    "jwc3.yangtzeu.edu.cn"
  ],
  "webEngine": {
    "preferred": "system_webview",
    "allowChromium": true,
    "chromiumComponent": "engine.chromium.android"
  },
  "limits": {
    "timeoutMs": 60000,
    "maxCourses": 1000,
    "maxStorageBytes": 1048576,
    "maxCapturedTextBytes": 1048576,
    "maxOutputBytes": 1048576
  }
}
```

Declare only the capabilities used by `main.js`: navigation to allowed hosts, page `fetch` for EAMS AJAX requests, and schedule draft writing. Keep `checksums.json` as a SHA-256 file manifest and keep `signature.json` explicit about unsigned development-package status until a real signing pipeline exists.

- [ ] **Step 2: Validate JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('plugin-packages/yangtzeu-eams-js-v1/manifest.json','utf8')); console.log('manifest ok')"`

Expected: `manifest ok`

### Task 2: Remove retired workflow entry

**Files:**
- Delete: `plugin-packages/yangtzeu-eams-js-v1/workflow.json`

- [ ] **Step 1: Delete the file**

Remove the file because `workflow.json` is no longer part of the current plugin platform.

- [ ] **Step 2: Verify package files**

Run: `rg --files plugin-packages/yangtzeu-eams-js-v1`

Expected: no `workflow.json`; package still contains `manifest.json`, `main.js`, `checksums.json`, `signature.json`, `assets/`, `models/`, `ui/schedule.json`, and `datapack/timing.json`.

## Chunk 2: WebView Entry

### Task 3: Create `main.js`

**Files:**
- Create: `plugin-packages/yangtzeu-eams-js-v1/main.js`
- Remove after migration: `plugin-packages/yangtzeu-eams-js-v1/scripts/yangtzeu-eams.js`

- [ ] **Step 1: Add the ES module entry**

Export `async function run(ctx)`.

The function should:
- Open `https://atrust.yangtzeu.edu.cn:4443/`.
- Wait for the EAMS course table page under `jwc3-yangtzeu-edu-cn-s.atrust.yangtzeu.edu.cn`.
- Navigate to `/eams/courseTableForStd.action` when the user reaches EAMS home.
- Trigger the same EAMS course detail AJAX request with page `fetch` for every teaching week.
- Parse metadata and course activities from the captured or returned HTML.
- Add each parsed course with `ctx.schedule.addCourse(course)`.
- Return `ctx.schedule.commit({ termId })`.

- [ ] **Step 2: Migrate parser logic**

Move the existing helpers from `scripts/yangtzeu-eams.js` into `main.js`:
- `extractMeta`
- `buildSchedule`
- `parseTeacherMap`
- `parseActivities`
- slot mapping helpers
- week parsing and stable ID helpers

Keep parser behavior equivalent to the existing implementation.

- [ ] **Step 3: Avoid legacy workflow compatibility**

Do not keep `extractMeta(input)` and `buildSchedule(input)` as plugin API entry points. They can remain internal helpers, but the public plugin entry is only `run(ctx)`.

- [ ] **Step 4: Validate JavaScript syntax**

Run: `node --check plugin-packages/yangtzeu-eams-js-v1/main.js`

Expected: no syntax errors.

## Chunk 3: Verification

### Task 4: Validate package against the new documentation

**Files:**
- Read: `X:/plugin-system.md`
- Read: `plugin-packages/yangtzeu-eams-js-v1/manifest.json`
- Read: `plugin-packages/yangtzeu-eams-js-v1/main.js`

- [ ] **Step 1: Check retired terms are gone**

Run: `rg "workflow|entryWorkflow|declaredPermissions|script_execute|schedule_emit_js|http_request" plugin-packages/yangtzeu-eams-js-v1`

Expected: no matches in active plugin files.

- [ ] **Step 2: Check retained optional data**

Run: `node -e "const fs=require('fs'); for (const f of ['plugin-packages/yangtzeu-eams-js-v1/ui/schedule.json','plugin-packages/yangtzeu-eams-js-v1/datapack/timing.json']) { JSON.parse(fs.readFileSync(f,'utf8')); } console.log('optional data ok')"`

Expected: `optional data ok`

- [ ] **Step 3: Review git diff**

Run: `git diff -- plugin-packages/yangtzeu-eams-js-v1 docs/plans/2026-05-16-yangtzeu-eams-js-v1-rewrite-design.md`

Expected: manifest is on apiVersion 2, main entry exists, package metadata exists, old workflow file is deleted, optional UI/timing data is unchanged.

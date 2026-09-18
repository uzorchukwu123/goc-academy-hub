# Resource deletion + "GOC Materials" tab (server.js, api.js, app.js, index.html, css/styles.css)

## 1. Clearing the orphaned resource

I don't have network access or your Appwrite credentials from this sandbox,
so I can't reach into your live project and delete the record myself. What
I've built instead is the durable fix: a real "Delete" button in the admin
console's Resources panel (see part 2). Once you deploy this, open Resources
in the console, find that leftover entry, **unpublish it if it's still
published**, then hit **Delete** — that removes both the database record and
(best-effort) whatever file pointer it had, so a record whose file is
already gone from storage gets cleaned up too.

## 2. Delete function for unpublished resources

- **`server/server.js`** — new route, `DELETE /api/admin/resources/:id`:
  - Refuses if the resource is still `published` (400, "Unpublish this
    resource before deleting it.") — a live, student-facing resource can
    never be deleted by accident, only after a deliberate unpublish first.
  - Looks the document up first; if it's already gone (404), treats that as
    success rather than an error, since the end state the admin wants
    (no more stale row) is already true.
  - Deletes the Appwrite Storage file if a `storageFileId` is present,
    logging and continuing if that fails (covers exactly the "file's gone
    but the record's still there" case), then deletes the database
    document.
- **`js/api.js`** — added `deleteResource(id)` to both the `mock` driver
  (returns a clear "not available in demo mode" failure — there's no real
  storage to delete from there) and the `http` driver (`DELETE
  /admin/resources/:id`), plus the public `GOC.api.deleteResource` forwarder.
  `test/test-driver-parity.js` passes, so both drivers stay in lock-step.
- **`js/app.js`** — `admRenderResources()` now renders a red **Delete**
  button next to **Publish** for any resource that's currently a draft
  (published ones only show **Unpublish**, matching the server-side rule).
  It confirms first via the same `confirm()` pattern already used for
  deactivating a student, then calls `admDeleteResource()`, which hits the
  new API method and reloads the list.
- **`css/styles.css`** — added `.ad-btn.danger` (solid red, distinct from
  the existing `.pri`/`.warn` variants) with its own hover/press feedback,
  scoped the same way every other `.ad-btn` variant already is.

## 3. "GOC Materials" tab

Added as a genuine sixth tab alongside the existing ones — not a relabel of
an existing option — in both places:

- **Admin console, Resources panel (`subjSeg()` in `js/app.js`)** — a new
  segment button after the five real subjects, styled distinctly
  (`.seg-brand`, a warm gold outline with the G.O.C spark mark, filling red
  when active) since it isn't a real subject. Selecting it works exactly
  like selecting any other segment: `admSetSubj('GOC Materials')` filters
  the uploaded-resources list to that "subject" and is what gets sent as
  `subject` on the next upload — so an admin files a general resource
  (a template, a study-skill guide, anything not tied to one subject) by
  picking this tab before uploading, precisely how the other five work.
- **Student Resources screen (`#resFilters` in `index.html`)** — a new
  chip, styled to match (`.fchip.brand`), after Syllabus. It performs the
  same job the other chips do (filter the list via `setResFilter`), just
  against `subject === "GOC Materials"` instead of the usual category, so
  it always shows exactly what the admin filed under that tab.
- **Why a resource filed this way reaches every student regardless of
  subject combination:** `studiesSubject()` already falls back to `true`
  for any subject name it doesn't recognise as one of the five real
  subjects (`SUBJECT_META`) — "GOC Materials" isn't one, so the existing
  per-subject visibility gate never hides it. No change was needed there;
  it was already the right behaviour for exactly this kind of resource.
- **`js/app.js`, `renderResources()`** — added the one small filter branch
  needed: when `resFilter === 'materials'`, match on `r.subj` instead of
  `r.cat`; every other chip's behaviour is untouched.

## Cache version

`sw.js`: `goc-v23` → `goc-v24` (on top of the viewer fix's v22→v23) — a new
round of `js/app.js`, `js/api.js`, `css/styles.css`, `index.html` and
`server/server.js` changes.

## Verification

- `node -c js/app.js`, `node -c js/api.js`, `node -c server/server.js` — all
  syntax-clean.
- `node test/run.js` — same 13/15 as the prior fix (`test-server.js` /
  `test-security.js` fail only for the pre-existing offline/no-`busboy`
  reason — confirmed by re-running `test-security.js` directly and seeing
  the same `Cannot find module 'busboy'` error, unrelated to this change).
  `test-driver-parity.js` passes, confirming `deleteResource` is in step on
  both drivers.

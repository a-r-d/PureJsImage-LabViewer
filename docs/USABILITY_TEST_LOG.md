# Usability testing log

Living record of hands-on workbench use. Automated e2e coverage is listed only as context;
this file is for **actual product use** (agent or human sitting in the UI).

How to continue: add a new **Session** at the bottom. Do not rewrite old sessions. Update the
coverage matrix when a gap is closed or a new hole appears.

Related: `docs/USABILITY_TEST_PROTOCOL.md` (moderated scientist protocol), `prompts/13-ux-validation-world-class-polish.md`.

## Session template

```text
### Session N — YYYY-MM-DD
- Tester: …
- App: commit … · http://127.0.0.1:5173 · theme … · viewport …
- Goal: …

| # | Workflow (prompt) | Steps taken | Outcome | Friction / bugs |
|---|-------------------|-------------|---------|-----------------|

Notes:
Next:
```

## Coverage vs the build prompts

Status key: **used** = exercised end-to-end in this log; **thin** = e2e or a partial pass only;
**gap** = we have not actually used it like a scientist; **n/a** = not shipped or intentionally
disabled.

| Prompt | What it asked a user to do | Hands-on status | Notes |
| --- | --- | --- | --- |
| 01 Shell / design system | Empty state, rails, panels, themes, keyboard chrome | thin | Theme/chrome polished earlier; light theme and 200% zoom not re-walked this month |
| 02 Viewer | Open large file, pan/zoom, first tile, pixel readout, scale bar | used | Generated GSF and JPEG tiles work; remote HTTPS range open is a gap |
| 03 Workspace / history | Undo/redo, save/reopen project, rebind missing file, history drawer | used | Undo, export/import, rebind prompt, and rebind-with-original-file (session 7) all used. Save still means IndexedDB |
| 04 Materials analysis slice | Threshold preview/commit, CC, ROI measure | thin | ROI stats + particle path used; legacy threshold preview barely touched |
| 07 Everyday toolbox | Operation browser, crop/rotate/flip, Gaussian/median, invert, calibration-from-line | thin | Invert Apply from the operation browser works (session 5). Crop/rotate/calibration-from-line unused |
| 08 Particle workflow | Otsu, watershed, morphology, filters, linked table↔overlay | used / thin | Isolated-disk count works (10) if no leftover ROI. Watershed checkbox defaults on for the touching example; leftover ROI made the count 1 |
| 09 FFT / AFM / stack / batch | FFT workspace, AFM leveling, stack projection/align, batch files | used / thin | Notch FFT used. Batch picked two local GSFs (session 7); Invert recipe refused as not valid for those files. Stack still needs a multi-plane dataset |
| 10 Script Studio | Write/edit/dry-run/test/install a script or recipe | used | Session 5: New draft + API explorer + Typecheck + Run; Install locally; hostile `while(true)` cancel. Run output lives in Console, below the fold |
| 11 Example library | Open each enabled example, Run workflow vs Open, attribution | used | All four real examples opened in session 3. Run workflow opens Script Studio. |
| 12 Corpus e2e | Scenario oracles, license/integrity | n/a as UX | Automated; not a user workflow |
| 13 UX polish | Protocol tasks 1–8, a11y, 200% zoom, reduced motion | used / thin | Tasks 2–8 used. 200% page zoom is scrollable and inspector tabs click (session 7) |
| 14–15 Agent | Propose actions, approvals, fake-model CI, live evals | used (disabled path) | Rail is `disabled`. Inspector tab states no model/network. Live evals unused |

### Prompt 13 protocol tasks

| # | Task | Status |
| --- | --- | --- |
| 1 | Open example, find calibration and its source | thin — seen in chrome chip, not narrated as a first-use path |
| 2 | Draw ROI, report mean intensity and units | used — Statistics now above the fold; mean headline + labeled scalars |
| 3 | Count particles with edge-exclude | **used** — 10 particles on calibrated field (commit `998c733`) |
| 4 | Select a result row and find the object in the overlay | used — Select label toggles aria-pressed |
| 5 | Inspect/edit the recipe without history spam | used — Select/edit opens Analysis; invert Apply commits one pipeline revision. Tab switches no longer appear in history (session 6) |
| 6 | Write a short custom script via API explorer | **used** — New draft already calls `lab.workspace.getSummary`; API search hits it; Typecheck + approved Run |
| 7 | Cancel or fail analysis and recover | used — particle Cancel run (session 4); Script Studio Cancel on a `while(true)` draft (session 5). Revision unchanged |
| 8 | Agent: recognize disabled, no network | used — inspector: “No model or network request has been made.” |

## Prior informal work (not a numbered session)

Work from the 2026-08-16 implementation thread. Useful, but not a protocol pass.

- JPEG S. aureus example qualified; codec plane cache for origin-only codecs.
- Particle defaults: watershed off, min 64 px; ROI-targeted count; edge-include when an area ROI is selected.
- FFT: leftover 0–255 mapping crushed spectra; DC-excluded auto-range; d-spacing labels; line profile after multi-output analysis.
- AFM: plan summary humanized; profile defaulted to plane size; Rq/Ra/Rz headline.
- Gallery card vs pixels: calibrated and batch examples were 1-pixel speckles; then Otsu split the strong wave and edge-exclude counted 0. Fixed to ten disks + weak illumination.

## Highest-priority gaps still open

1. **Stack/registration** still needs a multi-plane dataset (no generated volume yet).
2. Batch can pick local files, but a committed Invert recipe is refused on other GSF files (`Recipe is not valid for this dataset`).
3. Live agent evals.
4. 200% page zoom is scrollable and inspector tabs are clickable; the example gallery is still cramped.

## Sessions

### Session 1 — 2026-08-16

- Tester: implementation agent (Playwright, thinking like a first-time user)
- App: commit `998c733` · http://127.0.0.1:5173 · dark · 1440×900
- Goal: walk the Prompt 13 protocol plus the biggest unused prompt surfaces
- Evidence: `/tmp/usability-session1/*.png`

| # | Workflow (prompt) | Steps taken | Outcome | Friction / bugs |
|---|-------------------|-------------|---------|-----------------|
| 1 | Empty state (01, 13) | Load `/` | Completed | Local-first start offers files, examples, URL, saved project. Fine. |
| 2 | Calibration (13.1, 02) | Open Calibrated particle field | Completed | Viewport chip `0.42 nm/px`. Info tab also shows calibration. |
| 3 | ROI mean intensity (13.2) | Draw rectangle on specimen | **Blocked** | Geometry (area / perimeter / centroid) appears on the ROI card. **Statistics / Histogram / Line profile were below the calibration editor, off-screen.** Playwright reported Statistics disabled; the real issue is discoverability. **Fixed in-tree:** measure buttons now sit under the draw tools. Mean-intensity result not yet verified. |
| 4 | Particle count (13.3, 08) | Dry-run + run with that rectangle still selected | Completed, wrong scope | **2 particles counted** — the leftover measure ROI silently scoped the official 10-disk field. Easy to think counting is broken again. |
| 5 | Linked overlay (13.4) | Click first Select label | Completed | `aria-pressed=true`. Did not independently confirm the viewport highlight. |
| 6 | Undo (03) | Undo after analysis | Completed | Undo enabled and applied. |
| 7 | Touching + watershed (08, 11) | Open Touching-particle example | Partial | Watershed checkbox **on** (good). The **previous file’s rectangle ROI was still in the project** and sat on the overlapping disks. Count = **1**. Pipeline listed “Separate touching particles”. |
| 8 | Operation browser (07) | Expand toolbox, search gaussian | Partial | Preview and Apply enabled. Did not confirm the viewport changed. |
| 9 | Script Studio (10) | Open Script Studio | Partial | Sandbox / QuickJS copy is clear. Did not pick a script or dry-run. |
| 10 | Command palette (01) | Ctrl+K | Completed | Palette opened. |
| 11 | Agent (14, 13.8) | Click Agent | Friction | Control is **not** `disabled`; force-click did not show a clear “no model / no network” explanation in the sampled text. |
| 12 | E. coli analyzed (11) | Open E. coli from gallery | **Failed** | `waitForWorkbenchSettled` timed out at 60 s. Need a retry; possible analysis-on-open hang. |
| 13 | Save / cancel (03, 13.7) | — | Not reached | Session stopped on E. coli. |

Notes:

- Camera/fit sometimes leaves the 2048×1536 field as a small square in a black stage (also seen in earlier FFT/AFM checks). Makes ROIs and overlays harder to judge.
- Opening a second example does **not** clear ROIs. That is the highest-confidence new product bug from this session.
- Particle analysis targeting the selected area ROI is correct for “count inside this box,” but there is no loud “counting inside rectangle ROI” banner, so a leftover box looks like a failed census.

Next: retry ROI Statistics now that the buttons are visible; open examples with no leftover ROI; retry E. coli; Script Studio dry-run; save/reopen.

### Session 2 — 2026-08-16

- Tester: implementation agent
- App: working tree after leftover-ROI and Dataset-changed fixes · http://127.0.0.1:5173 · dark · 1440×900
- Goal: unblock session 1 failures and continue unused workflows
- Evidence: `/tmp/usability-session2/*.png`

| # | Workflow (prompt) | Steps taken | Outcome | Friction / bugs |
|---|-------------------|-------------|---------|-----------------|
| 1 | ROI Statistics (13.2) | Draw rectangle, click Statistics (now under draw tools) | Completed | Headline was still raw JSON. **Fixed in-tree:** `mean …` + labeled scalar grid. |
| 2 | Leftover ROI (11) | Draw box on particles, open Touching-particle | Completed | ROI list is **No ROIs yet.** Opening a new source now drops prior ROIs. |
| 3 | Touching + watershed (08) | Whole-plane count, watershed on | Completed | **3 particles counted** (isolated disk + split pair). |
| 4 | Clean isolated count (13.3) | Open Calibrated particle field, run | Completed | **10 particles counted.** |
| 5 | Script Studio (10) | Open Studio, Watershed script | Partial | Sandbox copy clear. **Test** was disabled (no fixture selected). Did not complete dry-run. |
| 6 | Save (03) | Click Save | Partial | No download. Toolbar Save writes IndexedDB (“Saved locally”); **Save as** is the file export. |
| 7 | E. coli analyzed (11) | Open analyzed example | Completed on retry | First attempt left the gallery open with **Dataset changed** (dataset-switch aborted the new analysis). **Fixed in-tree:** abort only the previous controller; retry preset. Retry: gallery closed, breadcrumb `e-coli-sem.gsf`, **152 particles counted**. Color JPEG card vs grayscale GSF is expected. |

Notes:

- Viewport still sometimes fits the 2048 field as a small island in a black stage.
- E. coli 152 objects is the reviewed threshold starting point, not a cell census (card already says so).
- Statistics export still offers CSV/JSON of the collection; the on-screen path is now readable.

Next: Staph / HeLa / HHV-6; Script Studio Test with a fixture; Save as + reopen; cancel; stack/batch.

### Session 3 — 2026-08-16

- Tester: implementation agent
- App: working tree after session 2 fixes · http://127.0.0.1:5173 · dark · 1440×900
- Goal: remaining real examples, Script Studio Test, save, cancel, stack/batch, Agent, 200% zoom
- Evidence: `/tmp/usability-session3/*.png`

| # | Workflow (prompt) | Steps taken | Outcome | Friction / bugs |
|---|-------------------|-------------|---------|-----------------|
| 1 | Staph JPEG (11) | Open analyzed S. aureus | Completed | Original JPEG, uncalibrated chip, **502 particles**, colored overlay. Matches the reviewed starting point, not a cell census. |
| 2 | HeLa (11) | Open Dividing HeLa cells | Completed | Grayscale GSF derivative. No auto-analysis (inspection-only). Looks like the card, minus color. |
| 3 | HHV-6 (11, 07) | Open analyzed HHV-6 | Completed | Real TEM with labeled inset. Histogram ran (187 ms) but Results show a **coarse 16-bin bar preview + JSON**. Histogram tab stayed unselected; that tab is display LUT, not this result. |
| 4 | Run workflow (11, 10) | Periodic lattice → Run workflow | Completed | Closes gallery, opens Script Studio on the FFT radial-profile script. Does **not** execute the FFT. Easy to misread as “run the science now.” |
| 5 | Script Studio Test (10) | Watershed script → Typecheck → Test | Partial | Typecheck completed. Test was clicked; screenshot does not show a pass banner (status may have scrolled away). Install unused. |
| 6 | Save as (03) | Save as, open Projects | Completed | Status **Saved locally**, title becomes “… copy”. Projects dialog opened. |
| 7 | Cancel (13.7) | Dry-run + Run, look for Cancel | **Blocked** | Particle panel only had **Cancel preview**. No Cancel on the run row. **Fixed in-tree:** **Cancel run** next to Run. Not re-clicked yet. |
| 8 | Stack (09) | Expand stack workspace | Completed | Honest empty: “This dataset has no non-display axis with multiple planes.” Plan disabled. Need a stack fixture to go further. |
| 9 | Batch (09) | Expand batch | Completed | Local-file picker copy is clear. Did not select files. |
| 10 | Agent (14, 13.8) | Show agent readiness | Completed | Mode-rail Agent is disabled. Inspector: connect a key when wanted; **No model or network request has been made.** Review plan disabled. |
| 11 | 200% zoom (13) | `documentElement.style.zoom = 2` | Partial | No extra document scrollWidth. Not a real browser 200% text zoom. |

Notes:

- Real examples now all have at least one successful open.
- “Run workflow” = open Script Studio, not run the analysis graph.
- Particle cancel was a missing affordance, not a failed abort.

Next: click the new Cancel run; Export/import project; FFT notch; light theme; true 200% zoom.

### Session 4 — 2026-08-16

- Tester: implementation agent
- App: working tree after Cancel run · http://127.0.0.1:5173 · started dark, toggled light · 1440×900
- Goal: leftover protocol holes — light theme, line profile, cancel run, export, FFT notch, histogram
- Evidence: `/tmp/usability-session4/*.png`

| # | Workflow (prompt) | Steps taken | Outcome | Friction / bugs |
|---|-------------------|-------------|---------|-----------------|
| 1 | Light theme (13, 01) | Use light theme | Completed | Chrome/inspector/empty card go light. Viewport stage stays a dark grid. Usable; specimen canvas is still dark-first. |
| 2 | Line profile (13.2, 07) | Draw line, Line profile | Completed | Switches to Line Profile tab. 360-point polyline, Y in a.u., length 358 px / 150 nm. |
| 3 | Cancel run (13.7) | Dry-run, Run, Cancel run | Completed | Button enables during the run. Message: **Particle analysis cancelled. The committed project is unchanged.** |
| 4 | Export project (03) | Export (exact) | Completed | Downloads `untitled-microscopy-project.pji-lab.json`. Import not tried. |
| 5 | FFT notch (09) | Lattice, Mask kind = notch, Plan | Completed (plan) | First locator missed “Plan admitted” (it sits below the details). Retry: **Plan admitted · 112.0 MiB · 52 ms**. Run not clicked. |
| 6 | HHV-6 histogram (11) | Re-open analyzed HHV-6 | Completed | Headline **Intensity histogram**. First pass plotted binMin vs binMax (diagonal). After series-export + bar plot: **64 bins · count vs intensity**. Matches a bright TEM background. |

Notes:

- Light theme empty-state card is strong; the specimen well remains black.
- Export is the app-bar icon, not the Results “Export JSON” buttons (five Export* matches).
- FFT plan summary lives outside the FFT `<details>` — easy to miss if you only watch the expanded block.

Next: import the exported project; run notch FFT; Script Studio install; a stack fixture if we add one.

### Session 5 — 2026-08-16

- Tester: implementation agent
- App: working tree after sessions 2–4, plus the FFT quantitative auto-range fix · http://127.0.0.1:5173 · dark · 1440×900
- Goal: the remaining high-value unused paths — export/import, rebind prompt, notch FFT execute, recipe edit, custom Studio script, install locally, hostile cancel
- Evidence: `/tmp/usability-session5/*.png`, `/tmp/usability-session5b/*.png`, `/tmp/usability-session5c/*.png`

| # | Workflow (prompt) | Steps taken | Outcome | Friction / bugs |
|---|-------------------|-------------|---------|-----------------|
| 1 | Export then import (03) | Open calibrated field, Export, New, import the `.pji-lab.json` | Completed | Generated sample rematerializes (`sample-sem.gsf / Surface`, 0.42 nm/px). First script pass raced `waitSettled` during “Opening source…”. After waiting for that dialog to close, the disks are back. No rebind needed for a sample locator. |
| 2 | Rebind prompt (03) | Rewrite export to a missing local `missing-local.tif`, import | Completed | Banner: “sample-sem.gsf must be rebound… identity will be checked before replay.” **Choose source files** is visible. Navigator says `rebind required`. Empty-state card still says “Start with an original file” even though a project is open — competing copy. Did not complete the file-pick success path. |
| 3 | Notch FFT run (09) | Lattice → Mask kind = notch → Plan → **Run** | Completed after fix | First run: 5 peaks and d-spacing overlays, but the canvas was **pitch black** (mean 0). Leftover source 0–255 mapping was locked from the first analysis tile’s display range. **Fixed in-tree:** auto-range now locks from quantitative tile values and resets mapping when the analysis plane appears. Retry: visible spectrum, cross + lattice spots, mean 30, 72% non-black, 5 peaks. Notch itself is a mask output; magnitude still shows the full log1p spectrum. |
| 4 | Recipe edit (13.5, 07) | Pipeline **Select / edit** → operation browser → Invert → Apply | Partial | Select/edit switches to Analysis (good). Invert Apply enabled and wrote “Updated analysis pipeline (1 steps)”. A symmetric lattice looks similar inverted. History also records several **Changed project workspace view** entries for tab switches — protocol 5 history spam is still there. |
| 5 | Custom script (13.6, 10) | Script Studio → New → search `workspace` → Typecheck → Run → approve | Completed | Default New draft already calls `lab.workspace.getSummary`. API explorer lists it. Typecheck and approved Run succeed. The bounded result lives under **Console · output**, below the API list — easy to miss; the footer notice is also easy to crop. |
| 6 | Install locally (10) | Watershed particle script → Install locally → Approve exact snapshot | Completed | Library row becomes **Sandboxed script · installed**. Notice: “Installed this exact local content snapshot.” |
| 7 | Hostile cancel (10, 13.7) | New draft, `while (true) {}`, Save, Run, approve, Cancel | Completed | Review shows a line diff of the hostile replacement. Cancel enables after approve. Notice: “Cancelled active language and sandbox Workers.” Project revision unchanged (7→7, then 1→1 on the retry). |

Notes:

- Opening an example after import **adds** the new source; the imported `sample-sem.gsf` stays in the navigator. Session 2 cleared leftover ROIs, not leftover sources.
- Script Studio toolbar **Cancel** is always visible and disabled until a run starts. The capability review’s **Cancel review** is the control that is live while the infinite loop has not started yet.
- FFT plan summary still sits outside the FFT `<details>`.

Next: true 200% browser zoom; a stack fixture; finish rebind with a real file; stop recording tab changes as undo history.

### Session 6 — 2026-08-16

- Tester: implementation agent
- App: working tree after session 5 FFT fix plus this session’s UX patches · http://127.0.0.1:5173 · dark · 1440×900
- Goal: close the remaining high-confidence UX issues from sessions 1–5
- Evidence: `/tmp/usability-session6/*.png`

| # | Workflow (prompt) | Steps taken | Outcome | Friction / bugs |
|---|-------------------|-------------|---------|-----------------|
| 1 | History spam (13.5) | Open particles, click Analysis / Results / History | Completed | History is only **Added source sample-sem.gsf**. No “Changed project workspace view.” Tabs persist on Save/Export without a revision. |
| 2 | Leftover sources (11) | Open Periodic lattice after particles | Completed | Navigator shows only `periodic-lattice.gsf`. Previous source is removed. |
| 3 | First-open fit (02) | Inspect viewport after open | Completed | Specimen fills the stage (48 tiles on particles, ~59% non-black). Not the old 256-px island. A few corner tiles can still lag after a source switch. |
| 4 | Rebind empty card (03) | Import a project with a missing local locator | Completed | Center card is **periodic-lattice.gsf must be rebound** with **Choose source files**. The first-run “Start with an original file” card is gone. Banner still repeats the same message. |
| 5 | Recent names (03) | New after import | Completed | Recent names say **recent**, not “rebind required.” |
| 6 | Script Studio footer (10) | Open Script Studio | Completed | Status **Local drafts ready.** sits on the dialog footer (was clipped when the review row was absent). |

Notes:

- Opening a new file now also drops the previous analysis graph so a leftover invert/FFT recipe cannot silently attach to the next example.
- File-pick success for rebind is still unused.

Next: true 200% browser zoom; a stack fixture; finish rebind with a real file.

### Session 7 — 2026-08-16

- Tester: implementation agent
- App: working tree after session 6 plus tile-remount, rebind, zoom, and New-cleanup patches · http://127.0.0.1:5173 · dark · 1440×900
- Goal: close the remaining known issues — rebind file-pick, corner tiles, 200% zoom, batch local files
- Evidence: `/tmp/usability-session7/*.png`, `/tmp/usability-session7b/*.png`, `/tmp/usability-session7c/*.png`

| # | Workflow (prompt) | Steps taken | Outcome | Friction / bugs |
|---|-------------------|-------------|---------|-----------------|
| 1 | Rebind with original file (03) | Open local `rebind-specimen.gsf`, Export, New, Import, Choose source files with the same GSF | Completed | Breadcrumb `rebind-specimen.gsf / Surface`, navigator **local file**, 0.5 nm/px, disk visible, revision 2. Identity matched. No mismatch dialog. |
| 2 | Corner tiles after source switch (02) | Particles → Periodic lattice | Completed | Full lattice, **16 bounded tiles**, 51% fit. The L-shaped missing corners are gone. Auto-range no longer remounts the viewport. |
| 3 | Batch local files (09) | Invert Apply, then Choose batch files (`batch-a.gsf`, `batch-b.gsf`) | Partial | Batch runs in isolated Workers and reports per-row status. Both files **failed**: “Recipe is not valid for this dataset.” Invert committed on one 64×48 GSF does not dry-run on the next. Error column is visible; issues from dry-run are now appended when present. |
| 4 | 200% page zoom (13) | CDP `setPageScaleFactor(2)` | Completed after fix | First pass: Analysis tab and gallery Open were covered by the canvas / leftover results. **Fixed in-tree:** root overflow is `auto`; inspector/navigator sit above the viewport; New clears leftover results. Retry: vertical scroll 806 px, Analysis `aria-selected=true`. Empty-state card still needs a pan to read fully. |
| 5 | New leftover results (03) | Invert, then New | Completed | `result-json` count is 0. First-run empty card returns. |

Notes:

- Rebind success path is now used end-to-end with a real local GSF, not only the missing-file prompt.
- Stack/registration still has no multi-plane generated fixture. Enabled corpus stacks are EMPIAR candidates, not local examples.
- Invert is a bad default batch recipe. The intended path is a saved particle/count recipe; that is still unused.

Next: a generated stack volume; a portable batch recipe (particle count) on two local files.

<!-- New sessions go below. -->

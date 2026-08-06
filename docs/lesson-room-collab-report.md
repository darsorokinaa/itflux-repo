# Lesson room collaboration — final report

## 1. Causes of previous instability

- Client dropped student navigation/draw unless `collaborative`, while server allowed independent browse.
- Client and server applied ops with different reducers (flat vs per-user answers).
- PDF iframe remounted on every page change (`key` included page).
- Boards/variants discovered only via 2.5s HTTP poll.
- Local `operation_id` not pre-registered → echo re-applied.
- Mode UI unclear (“рисование вместе” checkbox).

## 2. New architecture

- Evolve `MeetingMaterialSession` (not greenfield).
- Modes: **Follow teacher** (default) + **Collaborative** (teacher-only, graded permissions).
- Shared frontend reducer `applyMaterialOperation` mirrors backend adapters.
- Present board/variant pushed over meeting WS (`resource.presented` / `resource.cleared`); poll = 10s fallback.
- HTML lessons: postMessage SDK (`/lesson-material-sdk/lesson-material-sdk.js`).
- Spreadsheet: cell ops in session state; source file untouched.
- Boards remain nested Excalidraw WS.

## 3. Changed files (high level)

- Backend: `material_adapters.py`, `meeting_material_models.py`, `meeting_material_session.py`, `meeting_consumers.py`, `video_meeting_api.py`, migration `0061_…`, `tests_meeting_material.py`
- Frontend: `materials/collab/*`, `meetingMaterialCollab.js`, `SyncedMaterialWorkspace.jsx`, `MaterialCollabBar.jsx`, `VideoMeetingPage.jsx`, `SpreadsheetMaterialView.jsx`, `LiveMaterialAnswersTable.jsx`, `VideoLessonMaterialsPanel.jsx`, `video-meeting.css`, SDK, tests
- Docs: `docs/lesson-room-collab-audit.md`, this report

## 4. Models / migrations

- `MeetingMaterialSession.collaboration_permission`: `answers_only | annotate | edit_content | full`
- Migration: `Cabinet/migrations/0061_meeting_material_collab_permission.py`

## 5. WebSocket protocol (compatible + new)

Existing: `material.*` ops, sync_state, presence, cursors.  
New: `material.follow_status`, `resource.presented`, `resource.cleared`, sync payload includes `presented` + `server_revision`.  
Client pre-registers `operation_id`; throttles pointer/scroll/zoom; answer debounce 200ms.

## 6. Capabilities by format

| Kind | Follow | Annotate | Answers | Cell ops |
|------|--------|----------|---------|----------|
| pdf / presentation / image | yes | yes | — | — |
| interactive / test / cards | yes | optional | yes | — |
| embed / HTML SDK | yes | yes | via SDK | — |
| spreadsheet | yes | yes | — | yes |
| board | nested WS | nested | — | — |

## 7. Permissions

- Teacher: open/close, mode, permissions, force follow, transfer control, save work.
- Student follow: answers + temporary local browse + return.
- Student collab: limited by `collaboration_permission` (backend enforced).

## 8–9. Tests

- Backend: collab permission, idempotency, spreadsheet cells, answer isolation.
- Frontend: reducer, permissions, HTML event map, remote guard.
- Contract stub: `frontend/e2e/lesson-room-collab.contract.test.js`

## 10. Manual checks

Teacher + student two sessions: PDF follow, browse-away banner, collab permissions modal, live answers panel, present board via WS.

## 11. Remaining limits

- No native Office/PPTX structure editing.
- HTML sync requires SDK integration in lesson HTML.
- Board scene stays on board WS.
- Annotation→PDF export not implemented.

## 12. Deploy

```bash
python manage.py migrate Cabinet 0061_meeting_material_collab_permission
# rebuild frontend as usual for this project
```

## 13. Rollback

```bash
python manage.py migrate Cabinet 0060_seasonal_themes
# redeploy previous frontend build
```

## 14. Production checklist

- [ ] Migrate applied
- [ ] Redis channel layer healthy
- [ ] Teacher opens PDF → student follows within ~100ms
- [ ] Student browse-away + return
- [ ] Collab enable with annotate (not full by default)
- [ ] Answers appear live for teacher
- [ ] Present board arrives without waiting for poll
- [ ] Mobile: workspace height / safe-area OK
- [ ] Staff-only diagnostics button works

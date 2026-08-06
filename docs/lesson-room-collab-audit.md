# Audit: Lesson Room Material Sync & Collaboration

## Summary

Three parallel sync paths exist today. Backend `MeetingMaterialSession` + adapters are solid;
instability comes mainly from client/server reducer divergence, wrong client permission gates,
PDF iframe remounts, and present-via-HTTP-poll for boards/variants.

## Paths

| Path | Transport | State |
|------|-----------|-------|
| Material session (PDF, image, interactive, embed…) | WS `ws/video-meetings/<uuid>/` | `MeetingMaterialSession` |
| Present (board, variant) | REST + poll 2.5s | `VideoMeeting.presented_*` |
| Board collab | WS `ws/interactive-boards/<id>/` | Board scene + Redis viewport |

## Root causes

1. Client drops student `onStatePatch` unless collaborative — breaks independent browse.
2. Remote op apply uses flat answers while server stores per-user buckets.
3. PDF `key={url|page}` remounts iframe each page change.
4. Present path has no WS push (2.5s lag).
5. Local `operation_id` not pre-registered → echo re-applied.
6. Separate follow UX for materials vs boards.
7. Excel/Office/HTML lack typed sync (iframe-only).

## Preserve

- `MeetingMaterialSession`, backend adapters, consumer auth, board WS, REST APIs, tests.

## Rework direction

Evolve session into Follow / Collab modes with shared apply-reducer, revision protocol,
typed frontend adapters, present-over-WS, HTML postMessage SDK. Boards stay nested WS.

# Accessibility Manual Release Sign-Off

**Status:** NOT SIGNED

Use this record for the exact release candidate that will be distributed. Automated Axe, keyboard, forced-colors, reduced-motion, zoom, and layout results are prerequisites, not substitutes for this human evaluation.

## Candidate Identity

| Field | Required value |
| --- | --- |
| Product version | |
| Git commit and tag | |
| macOS artifact name and SHA-256 | |
| Windows artifact name and SHA-256 | |
| Test data/fixture revision | |
| Automated accessibility run URL | |
| Test window and locales | |

A row is valid only when it identifies the operating-system build, assistive-technology version, tester, date, result, and evidence. Use `Pass`, `Fail`, or `N/A - approved rationale`; blank is incomplete.

## Required Human Matrix

| ID | Platform and assistive technology | Tester / date / exact versions | Result | Evidence and issue links |
| --- | --- | --- | --- | --- |
| A11Y-H01 | Supported macOS, VoiceOver | | | |
| A11Y-H02 | Supported Windows, NVDA | | | |
| A11Y-H03 | Supported Windows, JAWS, when it is a declared customer/support target; otherwise owner-approved rationale | | | |
| A11Y-H04 | Supported macOS, Voice Control | | | |
| A11Y-H05 | Supported Windows, Voice Access | | | |
| A11Y-H06 | Keyboard-only, both platforms | | | |
| A11Y-H07 | macOS Zoom and Windows Magnifier at 400% equivalent | | | |
| A11Y-H08 | Reviewer with a disability, where practical; record recruitment limits honestly | | | |

## Task Script

Run every applicable task in each required screen-reader, voice-control, and keyboard row. Record a timestamped note, screenshot/video, or issue for each failure.

| ID | Required task | Result | Evidence / issues |
| --- | --- | --- | --- |
| T01 | Launch, startup recovery, and reach every primary route without a pointer | | |
| T02 | Select/authorize a folder, import media, understand progress, and recover from a validation error | | |
| T03 | Navigate the photo grid, change view/filter/sort, search, open a result, and return with context preserved | | |
| T04 | Add a person, start a scan, inspect a candidate, and accept/reject/mark unsure through the consent and confirmation flows | | |
| T05 | Open a still, enter Edit, change a control, compare/apply/undo, and exit without losing focus or state | | |
| T06 | Open a video, play/pause/seek, toggle captions, navigate transcript timestamps, and identify sound-event cues | | |
| T07 | Create/edit a story or slideshow, reorder content, use playback controls, and close the surface | | |
| T08 | Complete Settings, diagnostics, model setup, update, and error/retry flows | | |
| T09 | Use the MCP review surface to inspect details, select rows, approve/reject, and dismiss its modal or host surface | | |
| T10 | At 400% equivalent, repeat T03, T05, and T06 with no lost content, two-dimensional page scrolling, or obscured controls | | |

For each task, explicitly check accessible names, role/state/value, reading and focus order, visible focus, status/error announcements, modal focus containment and return, pointer-independent operation, voice-label discoverability, and the absence of keyboard traps.

## Caption and Sound-Cue Review

Define the acceptance policy before viewing results. Use licensed clips representative of supported languages, accents, quiet/noisy speech, overlapping speakers, music, silence, and meaningful non-speech events. Do not use private customer media without written authorization.

| Field | Required value |
| --- | --- |
| Predeclared sample set and size | |
| Languages/accent/noise coverage | |
| Critical-error definition | |
| Accuracy/usefulness acceptance threshold | |
| Reviewer names and dates | |
| Aggregate result | |
| Per-clip evidence location | |

Record omissions, substitutions, timing errors, speaker ambiguity, false sound cues, and any error that changes the meaning or prevents task completion. Generated text must remain identifiable as generated and editable by the user.

## Defects and Waivers

| Issue | Severity | Affected task/AT | Resolution or approved waiver | Owner / date |
| --- | --- | --- | --- | --- |
| | | | | |

- **Blocker:** a required task cannot be completed, private data is exposed, or the user cannot escape/recover.
- **Major:** materially wrong name/state/order/announcement, inaccessible core control, or caption error that changes meaning.
- **Minor:** friction that does not prevent or materially misrepresent the task.

No blocker or major issue may be waived without product, accessibility, and release-owner approval plus a dated remediation target. A waiver is not a pass.

## Release Decision

All required rows and tasks must be complete, the caption policy must pass, and unresolved issues/waivers must be listed before signing.

| Role | Name | Decision | Date | Signature/evidence |
| --- | --- | --- | --- | --- |
| Accessibility tester | | | | |
| QA/release owner | | | | |
| Product owner | | | | |
| User-with-disability reviewer, when available | | | | |

This record is release evidence for FRONTIER-04. It is not, by itself, a claim of universal accessibility or legal conformance.

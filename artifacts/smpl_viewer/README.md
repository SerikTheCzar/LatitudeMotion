# SMPL Skeleton Viewer

This folder contains a small standalone browser viewer for inspecting a post-rendered SMPL skeleton stream.

The current entry page is:

- `4f7de4.html`
- `three_smpl_viewer.html`

The canvas fallback is `4f7de4.html`. The premium PT-style ThreeJS viewport is `three_smpl_viewer.html`.

Both pages are intentionally standalone enough to run from the artifact server without a repo build step. The ThreeJS viewer loads ThreeJS from a CDN through an import map.

## What It Visualizes

The viewer now prefers the per-session `review_package.json` for workout, rep, ROM, and video references, then falls back to the older per-run analysis artifact for legacy sessions. It still reads the final downstream skeleton data from:

- `pose_debug.smpl.jsonl`

Each JSONL row is expected to contain:

- `frame_idx`
- `t`
- `pose_frame.joints3d`
- `pose_frame.joint_conf`
- `pose_frame.fit_error`
- optional `extra.instance_label`

The viewer also reads optional context artifacts:

- `session_meta.json`
- `review_package.json`
- `workout_demo_analysis.run-motion_embedding-20260422-023324-1d7016.json` as a compatibility fallback
- `preview/training-smpl.mp4`

The 3D skeleton canvas is driven by `pose_debug.smpl.jsonl`. The rendered video is only a reference panel.

## How To Open

Preferred local-service URL:

```text
http://127.0.0.1:8080/artifacts/smpl_viewer/4f7de4.html
```

Preferred ThreeJS viewport URL:

```text
http://127.0.0.1:8080/artifacts/smpl_viewer/three_smpl_viewer.html
```

Direct file URL also works for the default nearby artifact layout:

```text
file:///C:/Users/serik/OneDrive/Documents/Playground/artifacts/smpl_viewer/4f7de4.html
```

For the ThreeJS viewer, prefer the local-service URL because it relies on browser ES modules and CDN imports.

To inspect another session with the same artifact names:

```text
http://127.0.0.1:8080/artifacts/smpl_viewer/4f7de4.html?session=train-SESSION_ID
```

```text
http://127.0.0.1:8080/artifacts/smpl_viewer/three_smpl_viewer.html?session=train-SESSION_ID
```

## Coordinate Handling

The raw session data is never modified. The viewer applies display-space transforms only.

The default `Upright: on` mode computes a clip-level body frame from the shoulders and hips:

- torso vector defines visual up
- shoulder and hip width define left/right
- knees and ankles estimate the floor plane

This makes the subject stand on a flat visual floor while preserving the underlying `joints3d` values.

`Upright: off` shows the raw coordinate orientation from the artifact.

## Rendering Pieces

Important JavaScript sections inside `4f7de4.html`:

- Data URLs: `SESSION_ID`, `ROOT`, `POSE_URL`, `META_URL`, `ANALYSIS_URL`, `VIDEO_URL`
- Skeleton topology: `EDGES`
- Anatomical labels: `SCIENTIFIC_JOINT_NAMES`
- Goniometer routing: `ACTIVE_JOINT_RULES`
- Side-specific joint chains: `SIDE_JOINTS`
- Body-frame normalization: `computeUprightFrame`, `transformPoint`, `computeBounds`
- Camera projection: `projectAligned`, `project`
- Renderer: `drawAtmosphere`, `drawGrid`, `drawSkeleton`
- Goniometer overlay: `activeGoniometer`, `drawGoniometer`

Important JavaScript sections inside `three_smpl_viewer.html`:

- ThreeJS imports: import map plus `three`, `OrbitControls`, `CSS2DRenderer`
- Data URLs: `SESSION_ID`, `RUN_ID`, `ROOT`, `POSE_URL`, `META_URL`, `ANALYSIS_URL`, `VIDEO_URL`
- Skeleton topology: `EDGES`
- Anatomical labels: `SCIENTIFIC_JOINT_NAMES`
- Goniometer routing: `ACTIVE_JOINT_RULES`
- Scene setup: `scene`, `camera`, `renderer`, `labelRenderer`, `controls`
- Geometry pools: `boneMeshes`, `jointMeshes`, `jointLabels`
- Body-frame normalization: `computeUprightFrame`, `transformPoint`, `computeBounds`, `toWorld`
- Renderer update loop: `updateSkeleton`, `updateGoniometer`, `updateTrail`, `animate`
- Stats and timeline: `renderStats`, `renderTimeline`, `renderWorkouts`
- Goniometry lab: `renderGoniometryPanel`, `drawAngleHistory`, `renderComplementaryAngles`
- Therapist annotations: `loadAnnotations`, `saveAnnotations`, `renderAnnotations`, `angleStatsForRange`
- First-class review dock: `renderTimeline`, `drawTimelineCharts`, `scrubTimelineFromEvent`
- Review controls and shortcuts: `setDraftStart`, `setDraftEnd`, `saveAnnotation`, `saveCurrentPoint`, `saveCurrentRep`, `stepFrames`, `togglePlayback`
- Viewport annotation pins: `activeAnnotationAtTime`, `updateAnnotationPin`

## Goniometer Rules

The active joint overlay is intentionally simple and dictionary-driven.

Current rules:

- `bicep_curl`: elbow flexion angle
- `elbow_flexion`: elbow flexion angle
- `lateral_raise`: shoulder abduction angle
- `front_raise`: shoulder flexion angle
- `shoulder_press`: elbow extension angle

For a new primitive, add an entry to `ACTIVE_JOINT_RULES` and ensure the needed joint chain exists in `SIDE_JOINTS`.

The analysis JSON may provide `rep.dominant_side`; the viewer uses that when present. If it is missing, the current fallback is right side for curls and left side for lateral raise.

## Goniometry Timeline Annotations

`three_smpl_viewer.html` includes a first-class clinical review dock under the 3D viewport plus a right-side goniometry lab for history/detail review.

It shows:

- the current active goniometer angle
- a multi-track review timeline under the viewport
- workout/rep ranges
- active goniometry curve
- pose quality bars
- therapist annotation spans and point marks
- a clip-level active-angle history plot in the side panel
- complementary joint readings for both elbows and shoulders
- a range annotation form
- saved annotated timeline ranges

The review dock supports:

- drag on the timeline to scrub
- mouse wheel over the timeline for coarse frame stepping
- `Shift` + mouse wheel for fine frame stepping
- `Space` to play/pause
- `J` to reverse
- `K` to pause
- `L` to play forward
- left/right arrows to step one frame
- `Shift` + left/right arrows to step ten frames
- `[` to set range start
- `]` to set range end
- `M` to mark the current frame as an issue
- `Enter` to save the current range

Problematic movement can be marked as:

- current-frame point issue
- current rep issue
- manual time range issue

The issue chips currently include:

- ROM limited
- excessive ROM
- asymmetry
- compensation
- instability
- tracking uncertainty

Annotations are stored in browser `localStorage` under a per-session/per-run key:

```text
latitude:smpl-viewer:goniometry:<SESSION_ID>:<RUN_ID>
```

Each saved annotation captures:

- kind (`point`, `rep`, or `range`)
- issue type
- note text
- start/end seconds
- workout label
- goniometer label
- side
- min angle
- max angle
- mean angle
- range of motion
- sample count

Saved ranges render back onto the main timeline as amber translucent spans. Clicking a saved range or its timeline span jumps the viewport to the start of that splice.

When the playhead is inside a saved annotation, the ThreeJS viewport shows a floating annotation pin anchored near the active goniometer joint. This keeps the mark physically connected to the body, not only buried in the side panel.

This is intentionally local-only for now. If annotations become canonical clinical/session artifacts later, the next step is to add a backend save/export endpoint and migrate the same payload shape out of `localStorage`.

## Notes For Future Agents

- Do not treat this as canonical model input. It is an inspection viewer only.
- Do not rewrite or normalize `pose_debug.smpl.jsonl`; normalize only in display space.
- Keep the viewer dependency-free unless there is a strong reason to introduce a package.
- `three_smpl_viewer.html` is allowed to use ThreeJS CDN imports because it is a visualization artifact, not a production model dependency.
- Goniometry annotations are browser-local review notes. Do not treat them as model labels until an explicit export/commit path exists.
- `artifacts/` is ignored by default in Git. If changes in this folder should be committed, stage the intended files explicitly with `git add -f`.
- Avoid committing large session artifacts, videos, JSONL streams, or private model files from this folder.

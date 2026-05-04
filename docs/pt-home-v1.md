# PT Home V1

This repo serves the authenticated Latitude Clinic PT shell on Cloudflare Pages. Cognito remains the login source, while Juno CRM DynamoDB tables are the canonical ledger for PT identity, clinic membership, assigned sessions, artifacts, notes, feedback, and session events.

## Runtime Flow

1. Cloudflare Pages middleware redirects unauthenticated page requests to Cognito Hosted UI.
2. Cognito returns to `/auth/callback`, which verifies PKCE state and stores the Cognito ID token in the `latitude_session` HTTP-only cookie.
3. `/` loads the PT home dashboard and calls `/api/juno/me`, `/api/juno/sessions`, and `/api/juno/health`.
4. `/viewer.html?session=<juno_session_id>` calls `/api/juno/sessions/:id/viewer-manifest`.
5. The manifest returns short-lived S3 presigned URLs only after the current Cognito subject resolves to an active Juno PT user and the session is assigned to that PT.

## Cloudflare Secrets

Set these on the Cloudflare Pages project:

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_REGION=us-east-1`
- `JUNO_TABLE_PREFIX=juno-crm`
- `CLINIC_ARTIFACT_BUCKET=latitude-clinic-artifacts-557690582398-us-east-1`

`AWS_SESSION_TOKEN` is optional and only needed if temporary AWS credentials are used.

## Canonical Data

- Users: `juno-crm-users`
- Sites: `juno-crm-sites`
- Memberships: `juno-crm-memberships`
- Sessions: `juno-crm-juno_sessions`
- Artifacts: `juno-crm-session_artifact_links`
- Notes: `juno-crm-session_notes`
- Feedback: `juno-crm-session_feedback`
- Events: `juno-crm-session_events`

The seeded pilot site is `site_latitude_clinic_pilot`. The six pilot sessions are assigned two per PT. Client identities are anonymized with `client_label` only.

## Artifact Policy

Real session artifacts are not committed to git. The private S3 bucket stores only the curated viewer subset:

- `pose_debug.smpl.jsonl`
- `session_meta.json`
- `workout_demo_analysis.run-motion_embedding-20260422-023324-1d7016.json`
- `review_package.json`

Raw videos and preview videos are intentionally excluded from this v1 upload.

## API Contract

- `GET /api/juno/me`
- `GET /api/juno/health`
- `GET /api/juno/sessions`
- `GET /api/juno/sessions/:id`
- `GET /api/juno/sessions/:id/viewer-manifest`
- `GET /api/juno/sessions/:id/notes`
- `POST /api/juno/sessions/:id/notes`
- `GET /api/juno/sessions/:id/feedback`
- `POST /api/juno/sessions/:id/feedback`

All Juno APIs return `401` for missing auth, `403` for a PT trying to access another PT's session, and `404` for unknown sessions.

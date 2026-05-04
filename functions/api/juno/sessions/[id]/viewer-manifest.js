import { presignS3Get, scanRecords } from "../../../../_shared/aws.js";
import { assignedSession, currentJunoContext, json, publicSession } from "../../../../_shared/juno.js";

const artifactNames = {
  pose_debug_smpl: "pose_debug_smpl",
  session_meta: "session_meta",
  workout_analysis: "workout_analysis",
  review_package: "review_package",
};

export async function onRequestGet({ env, params, request }) {
  const context = await currentJunoContext(env, request);
  if (context.error) return context.error;
  const lookup = await assignedSession(env, context.user, params.id);
  if (lookup.error) return lookup.error;
  const links = (await scanRecords(env, "session_artifact_links")).filter((link) => link.juno_session_id === lookup.session.id);
  const artifacts = {};
  for (const [manifestName, kind] of Object.entries(artifactNames)) {
    const link = links.find((candidate) => candidate.artifact_kind === kind);
    if (link?.s3_key) {
      artifacts[manifestName] = {
        kind,
        s3_key: link.s3_key,
        url: await presignS3Get(env, link.s3_key, 900),
      };
    }
  }
  if (!artifacts.pose_debug_smpl || !artifacts.session_meta || !artifacts.workout_analysis || !artifacts.review_package) {
    return json({ detail: "Session viewer artifacts are incomplete." }, { status: 500 });
  }
  return json({
    session: publicSession(lookup.session),
    existing_session_id: lookup.session.existing_session_id,
    run_id: lookup.session.run_id,
    expires_in: 900,
    artifacts,
  });
}

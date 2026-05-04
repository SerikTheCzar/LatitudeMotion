import { currentJunoContext, json } from "../../_shared/juno.js";

export async function onRequestGet({ env, request }) {
  const context = await currentJunoContext(env, request);
  if (context.error) return context.error;
  return json({
    user: {
      id: context.user.id,
      email: context.user.email,
      display_name: context.user.display_name,
      user_type: context.user.user_type,
    },
    memberships: context.memberships,
    sites: context.sites,
    feature_flags: {
      pt_home: true,
      notes: true,
      feedback: true,
      live_capture: false,
      admin_portal: false,
    },
  });
}

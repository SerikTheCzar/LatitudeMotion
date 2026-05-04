import { currentJunoContext, json, listAssignedSessions, publicSession } from "../../../_shared/juno.js";

export async function onRequestGet({ env, request }) {
  const context = await currentJunoContext(env, request);
  if (context.error) return context.error;
  const sessions = await listAssignedSessions(env, context.user);
  return json({ sessions: sessions.map(publicSession) });
}

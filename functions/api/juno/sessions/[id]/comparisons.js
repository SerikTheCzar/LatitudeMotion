import { presignS3Get, scanRecords } from "../../../../_shared/aws.js";
import { assignedSession, currentJunoContext, json, listAssignedSessions, publicSession } from "../../../../_shared/juno.js";

const RUN_ID = "run-motion_embedding-20260422-023324-1d7016";

function keyForWorkout(workout = {}) {
  return String(workout.label || workout.display_label || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function displayLabel(workout = {}) {
  return workout.display_label || workout.label || "Movement";
}

function values(items, getter) {
  return (items || []).map(getter).map(Number).filter(Number.isFinite);
}

function mean(nums) {
  return nums.length ? nums.reduce((sum, value) => sum + value, 0) / nums.length : null;
}

function stdev(nums) {
  if (nums.length < 2) return null;
  const avg = mean(nums);
  return Math.sqrt(nums.reduce((sum, value) => sum + (value - avg) ** 2, 0) / nums.length);
}

function rounded(value, digits = 1) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function workoutMetrics(workout = {}) {
  const reps = Array.isArray(workout.reps) ? workout.reps : [];
  const amplitudes = values(reps, (rep) => rep.amplitude);
  const durations = values(reps, (rep) => rep.duration_sec);
  const qualities = values(reps, (rep) => rep.quality);
  return {
    rep_count: Number(workout.rep_count || reps.length || 0),
    confidence: rounded(Number(workout.confidence), 2),
    pose_confidence: rounded(Number(workout.pose_confidence), 2),
    avg_amplitude: rounded(mean(amplitudes), 1),
    amplitude_consistency: rounded(stdev(amplitudes), 1),
    avg_rep_duration_sec: rounded(mean(durations), 2),
    duration_consistency_sec: rounded(stdev(durations), 2),
    avg_quality: rounded(mean(qualities), 2),
  };
}

function delta(current, reference, key, digits = 1) {
  if (!Number.isFinite(current?.[key]) || !Number.isFinite(reference?.[key])) return null;
  return rounded(current[key] - reference[key], digits);
}

function confidenceFor(current, reference) {
  const scores = [current.confidence, current.pose_confidence, reference.confidence, reference.pose_confidence]
    .map(Number)
    .filter(Number.isFinite);
  if (!scores.length) return { level: "moderate", reason: "Workout segmentation was available, but confidence metadata was limited." };
  const avg = mean(scores);
  if (avg >= 0.75) return { level: "high", reason: "Both matching workout segments had strong model confidence." };
  if (avg >= 0.45) return { level: "moderate", reason: "Comparable workout segments were found, with moderate pose or segmentation confidence." };
  return { level: "needs review", reason: "Comparable segments were found, but model confidence was low enough for PT review." };
}

function finding(kind, label, message, metric, change = null) {
  return { kind, label, message, metric, change };
}

function buildFindings(label, current, reference) {
  const findings = [];
  const amplitudeDelta = delta(current, reference, "avg_amplitude", 1);
  if (amplitudeDelta !== null) {
    if (Math.abs(amplitudeDelta) < 3) {
      findings.push(finding("stable", "ROM / depth", `${label} depth was broadly similar to the matched session.`, "avg_amplitude", amplitudeDelta));
    } else if (amplitudeDelta > 0) {
      findings.push(finding("improved", "ROM / depth", `${label} depth increased by ${Math.abs(amplitudeDelta)} deg on average.`, "avg_amplitude", amplitudeDelta));
    } else {
      findings.push(finding("watch", "ROM / depth", `${label} depth decreased by ${Math.abs(amplitudeDelta)} deg on average.`, "avg_amplitude", amplitudeDelta));
    }
  }

  const consistencyDelta = delta(current, reference, "amplitude_consistency", 1);
  if (consistencyDelta !== null) {
    if (Math.abs(consistencyDelta) < 2) {
      findings.push(finding("stable", "Rep consistency", "Rep-to-rep ROM consistency was similar.", "amplitude_consistency", consistencyDelta));
    } else if (consistencyDelta < 0) {
      findings.push(finding("improved", "Rep consistency", `Rep-to-rep ROM varied ${Math.abs(consistencyDelta)} deg less than the matched session.`, "amplitude_consistency", consistencyDelta));
    } else {
      findings.push(finding("watch", "Rep consistency", `Rep-to-rep ROM varied ${Math.abs(consistencyDelta)} deg more than the matched session.`, "amplitude_consistency", consistencyDelta));
    }
  }

  const durationDelta = delta(current, reference, "avg_rep_duration_sec", 2);
  if (durationDelta !== null) {
    if (Math.abs(durationDelta) < 0.15) {
      findings.push(finding("stable", "Tempo", "Average rep tempo was similar.", "avg_rep_duration_sec", durationDelta));
    } else if (durationDelta > 0) {
      findings.push(finding("watch", "Tempo", `Average reps were ${Math.abs(durationDelta)}s slower. Check whether this reflects control or fatigue.`, "avg_rep_duration_sec", durationDelta));
    } else {
      findings.push(finding("watch", "Tempo", `Average reps were ${Math.abs(durationDelta)}s faster. Check whether speed reduced control.`, "avg_rep_duration_sec", durationDelta));
    }
  }

  const qualityDelta = delta(current, reference, "avg_quality", 2);
  if (qualityDelta !== null && Math.abs(qualityDelta) >= 0.04) {
    findings.push(finding(qualityDelta > 0 ? "improved" : "watch", "Rep quality", `Rep quality score ${qualityDelta > 0 ? "increased" : "decreased"} by ${Math.abs(qualityDelta)}.`, "avg_quality", qualityDelta));
  }

  return findings.slice(0, 3);
}

function headline(label, findings) {
  const improved = findings.filter((item) => item.kind === "improved").length;
  const watch = findings.filter((item) => item.kind === "watch").length;
  if (improved && !watch) return `${label} looks improved against the closest match.`;
  if (improved && watch) return `${label} has a mixed change worth reviewing.`;
  if (watch) return `${label} has a watch item against the closest match.`;
  return `${label} is broadly similar to the closest match.`;
}

function documentationDraft(label, findings, current, referenceSession) {
  const primary = findings[0]?.message || `${label} was comparable to the matched prior session.`;
  return `Compared with ${referenceSession.client_label || "the matched session"} (${referenceSession.existing_session_id || referenceSession.id}), ${primary} Current set: ${current.rep_count} reps.`;
}

async function analysisForSession(env, session, links) {
  const link = links.find((item) => item.juno_session_id === session.id && item.artifact_kind === "workout_analysis");
  if (!link?.s3_key) return null;
  const url = await presignS3Get(env, link.s3_key, 120);
  const response = await fetch(url);
  if (!response.ok) return null;
  return response.json();
}

function chooseReference(currentSession, candidates) {
  const currentTime = new Date(currentSession.started_at || currentSession.created_at || 0).valueOf();
  const earlier = candidates
    .filter((candidate) => new Date(candidate.session.started_at || candidate.session.created_at || 0).valueOf() <= currentTime)
    .sort((a, b) => new Date(b.session.started_at || b.session.created_at || 0) - new Date(a.session.started_at || a.session.created_at || 0));
  if (earlier[0]) return earlier[0];
  return candidates.sort((a, b) => Math.abs(new Date(a.session.started_at || 0) - currentTime) - Math.abs(new Date(b.session.started_at || 0) - currentTime))[0];
}

export async function onRequestGet({ env, params, request }) {
  const context = await currentJunoContext(env, request);
  if (context.error) return context.error;
  const lookup = await assignedSession(env, context.user, params.id);
  if (lookup.error) return lookup.error;

  const sessions = await listAssignedSessions(env, context.user);
  const links = await scanRecords(env, "session_artifact_links");
  const currentAnalysis = await analysisForSession(env, lookup.session, links);
  if (!currentAnalysis?.workouts?.length) return json({ session: publicSession(lookup.session), comparisons: [] });

  const candidateAnalyses = [];
  for (const session of sessions.filter((item) => item.id !== lookup.session.id)) {
    const analysis = await analysisForSession(env, session, links);
    if (analysis?.workouts?.length) candidateAnalyses.push({ session, analysis });
  }

  const comparisons = [];
  for (const currentWorkout of currentAnalysis.workouts || []) {
    const workoutKey = keyForWorkout(currentWorkout);
    const candidates = candidateAnalyses
      .map((candidate) => ({
        ...candidate,
        workout: (candidate.analysis.workouts || []).find((workout) => keyForWorkout(workout) === workoutKey),
      }))
      .filter((candidate) => candidate.workout);
    const reference = chooseReference(lookup.session, candidates);
    if (!reference) continue;
    const currentMetrics = workoutMetrics(currentWorkout);
    const referenceMetrics = workoutMetrics(reference.workout);
    const label = displayLabel(currentWorkout);
    const findings = buildFindings(label, currentMetrics, referenceMetrics);
    comparisons.push({
      id: `cmp_${lookup.session.id}_${reference.session.id}_${workoutKey}`,
      comparison_type: "closest_matching_workout",
      workout_key: workoutKey,
      workout_label: label,
      reference_session: publicSession(reference.session),
      current: { workout: currentWorkout, metrics: currentMetrics },
      reference: { workout: reference.workout, metrics: referenceMetrics },
      headline: headline(label, findings),
      findings,
      documentation_draft: documentationDraft(label, findings, currentMetrics, reference.session),
      confidence: confidenceFor(currentMetrics, referenceMetrics),
      run_id: lookup.session.run_id || RUN_ID,
    });
  }

  return json({ session: publicSession(lookup.session), comparisons });
}

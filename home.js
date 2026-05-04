(function () {
  const state = {
    me: null,
    sessions: [],
    selectedSessionId: null,
  };

  const els = {};

  function byId(id) {
    return document.getElementById(id);
  }

  function formatDate(value) {
    if (!value) return "No date";
    const date = new Date(value);
    if (Number.isNaN(date.valueOf())) return String(value);
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
  }

  function formatDuration(seconds) {
    const total = Number(seconds || 0);
    if (!total) return "0 sec";
    const minutes = Math.floor(total / 60);
    const secs = Math.round(total % 60);
    return minutes ? `${minutes}m ${secs}s` : `${secs}s`;
  }

  function workoutText(session) {
    const labels = Array.isArray(session.workout_labels) ? session.workout_labels.filter(Boolean) : [];
    return labels.length ? labels.join(", ") : "Movement review";
  }

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.hidden = false;
    window.clearTimeout(showToast.timeout);
    showToast.timeout = window.setTimeout(() => {
      els.toast.hidden = true;
    }, 3200);
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      cache: "no-store",
      headers: {
        ...(options.body ? { "content-type": "application/json" } : {}),
        ...(options.headers || {}),
      },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body.detail || `Request failed: ${response.status}`);
    }
    return body;
  }

  function renderShell() {
    const user = state.me?.user || {};
    const site = state.me?.sites?.[0] || {};
    const membership = state.me?.memberships?.[0] || {};
    const display = user.display_name || user.email || "PT";
    els.authWelcome.textContent = `Welcome ${display}`;
    els.siteLine.textContent = `${site.name || "Latitude Clinic Pilot"}${membership.role ? ` • ${membership.role}` : ""}`;
    els.siteName.textContent = site.name || "Latitude Clinic Pilot";
    els.readyCount.textContent = String(state.sessions.filter((session) => session.state === "ready").length);
  }

  function renderSessions() {
    if (!state.sessions.length) {
      els.sessionList.innerHTML = '<div class="empty-copy">No assigned sessions were returned for this PT.</div>';
      return;
    }

    els.sessionList.innerHTML = "";
    for (const session of state.sessions) {
      const card = document.createElement("article");
      card.className = `session-card${session.id === state.selectedSessionId ? " active" : ""}`;
      card.dataset.sessionId = session.id;
      card.innerHTML = `
        <div class="session-main">
          <p class="eyebrow">${session.client_label || "Client"}</p>
          <h3>${session.title || workoutText(session)}</h3>
          <div class="session-meta">
            <span>${session.existing_session_id || session.id}</span>
            <span>${formatDate(session.started_at)}</span>
          </div>
          <div class="session-stats">
            <span class="state-pill">${session.state || "ready"}</span>
            <span>${formatDuration(session.duration_sec)}</span>
            <span>${Number(session.total_rep_count || 0)} reps</span>
            <span>${Number(session.workout_count || 0)} workouts</span>
            <span>${workoutText(session)}</span>
          </div>
        </div>
        <div class="session-actions">
          <a class="primary-action" href="/viewer.html?session=${encodeURIComponent(session.id)}">Open Review</a>
          <button class="ghost-action" type="button" data-select="${session.id}">Details</button>
        </div>
      `;
      els.sessionList.appendChild(card);
    }
  }

  function renderActivity(container, items, emptyText) {
    container.innerHTML = "";
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "empty-copy";
      empty.textContent = emptyText;
      container.appendChild(empty);
      return;
    }
    for (const item of items) {
      const row = document.createElement("article");
      row.className = "activity-item";
      const time = item.created_at ? formatDate(item.created_at) : "Just now";
      row.innerHTML = `<time>${time}</time><p></p>`;
      row.querySelector("p").textContent = item.body || "";
      container.appendChild(row);
    }
  }

  async function selectSession(sessionId) {
    const session = state.sessions.find((item) => item.id === sessionId);
    if (!session) return;
    state.selectedSessionId = sessionId;
    renderSessions();
    els.detailEmpty.hidden = true;
    els.detailContent.hidden = false;
    els.detailKicker.textContent = session.client_label || "Session";
    els.detailTitle.textContent = session.title || workoutText(session);
    els.detailMeta.textContent = `${session.existing_session_id || session.id} • ${formatDuration(session.duration_sec)} • ${Number(session.total_rep_count || 0)} reps`;
    els.viewerLink.href = `/viewer.html?session=${encodeURIComponent(session.id)}`;
    els.notesList.innerHTML = '<div class="empty-copy">Loading notes.</div>';
    els.feedbackList.innerHTML = '<div class="empty-copy">Loading feedback.</div>';

    try {
      const [notesBody, feedbackBody] = await Promise.all([
        api(`/api/juno/sessions/${encodeURIComponent(session.id)}/notes`),
        api(`/api/juno/sessions/${encodeURIComponent(session.id)}/feedback`),
      ]);
      renderActivity(els.notesList, notesBody.notes || [], "No notes yet.");
      renderActivity(els.feedbackList, feedbackBody.feedback || [], "No feedback yet.");
    } catch (error) {
      els.notesList.innerHTML = `<div class="error-copy">${error.message}</div>`;
      els.feedbackList.innerHTML = "";
    }
  }

  async function loadAll() {
    els.sessionList.innerHTML = '<div class="empty-copy">Loading assigned sessions.</div>';
    try {
      const [me, sessions, health] = await Promise.all([
        api("/api/juno/me"),
        api("/api/juno/sessions"),
        api("/api/juno/health").catch((error) => ({ ok: false, detail: error.message })),
      ]);
      state.me = me;
      state.sessions = sessions.sessions || [];
      els.healthState.textContent = health.ok ? "Ready" : "Check config";
      renderShell();
      renderSessions();
      if (!state.selectedSessionId && state.sessions[0]) {
        await selectSession(state.sessions[0].id);
      }
    } catch (error) {
      els.sessionList.innerHTML = `<div class="error-copy">${error.message}</div>`;
      els.healthState.textContent = "Error";
    }
  }

  async function submitEntry(kind, textarea) {
    if (!state.selectedSessionId) return;
    const body = textarea.value.trim();
    if (!body) {
      showToast("Add text before saving.");
      return;
    }
    const path = `/api/juno/sessions/${encodeURIComponent(state.selectedSessionId)}/${kind}`;
    const payload = kind === "notes" ? { body, note_type: "pt" } : { body, feedback_type: "pt" };
    await api(path, { method: "POST", body: JSON.stringify(payload) });
    textarea.value = "";
    showToast(kind === "notes" ? "Note saved." : "Feedback saved.");
    await selectSession(state.selectedSessionId);
  }

  async function boot() {
    Object.assign(els, {
      authWelcome: byId("authWelcome"),
      authSignOut: byId("authSignOut"),
      siteLine: byId("siteLine"),
      readyCount: byId("readyCount"),
      siteName: byId("siteName"),
      healthState: byId("healthState"),
      sessionList: byId("sessionList"),
      refreshBtn: byId("refreshBtn"),
      detailEmpty: byId("detailEmpty"),
      detailContent: byId("detailContent"),
      detailKicker: byId("detailKicker"),
      detailTitle: byId("detailTitle"),
      detailMeta: byId("detailMeta"),
      viewerLink: byId("viewerLink"),
      noteForm: byId("noteForm"),
      feedbackForm: byId("feedbackForm"),
      noteBody: byId("noteBody"),
      feedbackBody: byId("feedbackBody"),
      notesList: byId("notesList"),
      feedbackList: byId("feedbackList"),
      toast: byId("toast"),
    });

    await window.latitudeAuth?.ready;
    await loadAll();

    els.refreshBtn.addEventListener("click", loadAll);
    els.sessionList.addEventListener("click", (event) => {
      const trigger = event.target.closest("[data-select]");
      if (trigger) selectSession(trigger.dataset.select);
    });
    els.noteForm.addEventListener("submit", (event) => {
      event.preventDefault();
      submitEntry("notes", els.noteBody).catch((error) => showToast(error.message));
    });
    els.feedbackForm.addEventListener("submit", (event) => {
      event.preventDefault();
      submitEntry("feedback", els.feedbackBody).catch((error) => showToast(error.message));
    });
  }

  boot().catch((error) => {
    document.body.innerHTML = `<main class="shell"><div class="error-copy">${error.message}</div></main>`;
  });
})();

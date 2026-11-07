// ClipClap wizard frontend. Plain JS, no build step: a stripped-down sibling
// of Studio's VariablesPanel (the type→widget mapping), not a replacement.

const views = {
  setup: document.getElementById("setup-view"),
  gallery: document.getElementById("gallery"),
  form: document.getElementById("form-view"),
  progress: document.getElementById("progress-view"),
  done: document.getElementById("done-view"),
};

/** Show one view and move focus to it — otherwise focus is stranded on <body>. */
function showView(name) {
  for (const [key, el] of Object.entries(views)) el.hidden = key !== name;
  views[name]?.focus();
}

function setProgress(trackEl, fillEl, percent) {
  const clamped = Math.max(0, Math.min(100, Math.round(percent || 0)));
  fillEl.style.width = `${clamped}%`;
  trackEl?.setAttribute("aria-valuenow", String(clamped));
}

function formatBytes(bytes) {
  if (!bytes) return "0 MB";
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

let templates = [];
let selectedTemplate = null;
let pollTimer = null;
let activeJobId = null;

// ── Setup gate ─────────────────────────────────────────────────────────────
// The render engine's browser downloads on first run. Until it lands, a render
// would sit at 0% with nothing to show for it, so we hold the UI here.

const setupTrack = document.querySelector("#setup-view .progress-track");
const setupFill = document.getElementById("setup-fill");
const setupMessage = document.getElementById("setup-message");
const setupError = document.getElementById("setup-error");

async function waitForSetup() {
  showView("setup");

  for (;;) {
    let status;
    try {
      const res = await fetch("/api/setup");
      status = await res.json();
    } catch {
      setupMessage.textContent = "Waiting for the app…";
      await sleep(1000);
      continue;
    }

    if (status.state === "ready") return true;

    if (status.state === "error") {
      setupError.hidden = false;
      setupError.textContent = `Could not set up video components: ${status.error ?? "unknown error"}`;
      setupMessage.textContent = "Setup stopped.";
      return false;
    }

    if (status.state === "downloading" && status.totalBytes > 0) {
      const pct = (status.downloadedBytes / status.totalBytes) * 100;
      setProgress(setupTrack, setupFill, pct);
      setupMessage.textContent = `Downloading video components — ${formatBytes(status.downloadedBytes)} / ${formatBytes(status.totalBytes)}`;
    } else {
      setupMessage.textContent = "Checking components…";
    }

    await sleep(500);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Gallery ────────────────────────────────────────────────────────────────

const galleryGrid = document.getElementById("gallery-grid");
const galleryLoading = document.getElementById("gallery-loading");
const galleryEmpty = document.getElementById("gallery-empty");
const galleryError = document.getElementById("gallery-error");
const galleryErrorText = document.getElementById("gallery-error-text");
const templateSearch = document.getElementById("template-search");
const templateCount = document.getElementById("template-count");

async function loadTemplates() {
  galleryLoading.hidden = false;
  galleryGrid.hidden = true;
  galleryEmpty.hidden = true;
  galleryError.hidden = true;

  try {
    const res = await fetch("/api/templates");
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    const data = await res.json();
    templates = Array.isArray(data.templates) ? data.templates : [];
    galleryLoading.hidden = true;
    renderGallery();
  } catch (err) {
    // Without this the page just stayed blank forever on any fetch hiccup.
    galleryLoading.hidden = true;
    galleryError.hidden = false;
    galleryErrorText.textContent = `Could not load templates: ${err.message}`;
  }
}

function renderGallery() {
  const query = templateSearch.value.trim().toLowerCase();
  const visible = query
    ? templates.filter((t) => `${t.title} ${t.description}`.toLowerCase().includes(query))
    : templates;

  galleryGrid.innerHTML = "";
  for (const template of visible) {
    galleryGrid.appendChild(buildCard(template));
  }

  galleryGrid.hidden = visible.length === 0;
  galleryEmpty.hidden = visible.length !== 0;
  galleryEmpty.textContent = query
    ? `No templates match "${templateSearch.value.trim()}".`
    : "No templates are available yet.";
  templateCount.textContent = templates.length
    ? `${visible.length} of ${templates.length} templates`
    : "";
}

function buildCard(template) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "card";
  card.innerHTML = `<h3></h3><p></p><div class="meta"></div>`;
  card.querySelector("h3").textContent = template.title;
  card.querySelector("p").textContent = template.description;

  const meta = card.querySelector(".meta");
  const labels = [
    `${template.duration}s`,
    aspectLabel(template.width, template.height),
    `${template.variables.length} settings`,
  ];
  // Loop-safe templates are authored so their last frame cuts invisibly
  // back to the first — worth calling out since most templates aren't.
  if (template.loop) labels.push("↻ Seamless loop");
  for (const label of labels) {
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = label;
    meta.appendChild(badge);
  }

  card.addEventListener("click", () => openForm(template));
  return card;
}

function aspectLabel(width, height) {
  if (width === height) return "Square";
  return width > height ? "Landscape" : "Portrait";
}

// ── Form ───────────────────────────────────────────────────────────────────

const variableForm = document.getElementById("variable-form");
const formEmpty = document.getElementById("form-empty");
const formError = document.getElementById("form-error");
const renderBtn = document.getElementById("render-btn");
const orientationSelect = document.getElementById("orientation-select");
const orientationHint = document.getElementById("orientation-hint");
const resolutionSelect = document.getElementById("resolution-select");

const ORIENTATION_LABELS = {
  landscape: "Landscape 16:9 — YouTube, presentations",
  portrait: "Portrait 9:16 — TikTok, Reels, Shorts",
  square: "Square 1:1 — Instagram feed",
};

const motionOptions = document.getElementById("motion-options");
const motionPrompt = document.getElementById("motion-prompt");
const motionKey = document.getElementById("motion-key");
const motionGenerate = document.getElementById("motion-generate");
const motionStatus = document.getElementById("motion-status");
const motionCodeEl = document.getElementById("motion-code");

// The key stays in this browser profile. It is sent per request and the
// server neither stores nor logs it.
const MOTION_KEY_STORAGE = "clipclap.motionApiKey";
let generatedMotionCode = null;

function openForm(template) {
  selectedTemplate = template;
  document.getElementById("form-title").textContent = template.title;
  document.getElementById("form-description").textContent = template.description;

  variableForm.innerHTML = "";
  for (const variable of template.variables) {
    variableForm.appendChild(buildField(variable));
  }
  formEmpty.hidden = template.variables.length > 0;
  formError.hidden = true;
  renderBtn.disabled = false;
  renderBtn.textContent = "Make Video";

  populateOrientations(template);
  resolutionSelect.value = "1080";
  resetMotionPanel(template);
  showView("form");
}

function resetMotionPanel(template) {
  generatedMotionCode = null;
  motionOptions.hidden = !template.aiMotion;
  if (!template.aiMotion) return;

  motionPrompt.value = "";
  motionStatus.textContent = "";
  motionStatus.classList.remove("is-error");
  motionCodeEl.hidden = true;
  motionCodeEl.textContent = "";
  motionGenerate.disabled = false;
  motionGenerate.textContent = "Generate motion";
  try {
    motionKey.value = localStorage.getItem(MOTION_KEY_STORAGE) ?? "";
  } catch {
    // Private mode or storage disabled — the field just starts empty.
  }
}

async function generateMotion() {
  const prompt = motionPrompt.value.trim();
  const apiKey = motionKey.value.trim();
  motionStatus.classList.remove("is-error");

  if (!prompt) {
    motionStatus.classList.add("is-error");
    motionStatus.textContent = "Describe the motion you want first.";
    return;
  }
  if (!apiKey) {
    motionStatus.classList.add("is-error");
    motionStatus.textContent = "Enter your API key first.";
    return;
  }

  try {
    localStorage.setItem(MOTION_KEY_STORAGE, apiKey);
  } catch {
    // Not fatal — the key is still used for this request.
  }

  motionGenerate.disabled = true;
  motionGenerate.textContent = "Generating…";
  motionStatus.textContent = "Requesting motion from the model…";
  motionCodeEl.hidden = true;

  try {
    const res = await fetch("/api/motion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, apiKey }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? `Server returned ${res.status}`);

    generatedMotionCode = data.code;
    motionCodeEl.hidden = false;
    motionCodeEl.textContent = data.code;
    motionStatus.textContent = "Motion is ready. Click Make Video to use it.";
  } catch (err) {
    generatedMotionCode = null;
    motionStatus.classList.add("is-error");
    motionStatus.textContent = err.message;
  } finally {
    motionGenerate.disabled = false;
    motionGenerate.textContent = "Generate motion";
  }
}

/**
 * Only offer the shapes a template's layout actually holds up in — the server
 * enforces the same list, so a stale UI can't request a broken frame.
 */
function populateOrientations(template) {
  const available = template.orientations?.length
    ? template.orientations
    : [template.width >= template.height ? "landscape" : "portrait"];

  orientationSelect.innerHTML = "";
  for (const id of available) {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = ORIENTATION_LABELS[id] ?? id;
    orientationSelect.appendChild(option);
  }

  const locked = available.length === 1;
  orientationSelect.disabled = locked;
  orientationHint.textContent = locked
    ? "This template supports one orientation."
    : "The template adapts to your chosen format.";
}

function buildField(variable) {
  const wrap = document.createElement("div");
  wrap.className = `field field-${variable.type}`;

  const label = document.createElement("label");
  label.textContent = variable.label;
  label.setAttribute("for", `field-${variable.id}`);
  wrap.appendChild(label);

  let input;
  switch (variable.type) {
    case "color":
      input = document.createElement("input");
      input.type = "color";
      input.value = variable.default;
      break;
    case "number":
      input = document.createElement("input");
      input.type = "number";
      input.value = String(variable.default);
      if (variable.min != null) input.min = String(variable.min);
      if (variable.max != null) input.max = String(variable.max);
      if (variable.step != null) input.step = String(variable.step);
      break;
    case "boolean":
      input = document.createElement("input");
      input.type = "checkbox";
      input.checked = Boolean(variable.default);
      break;
    case "enum":
      input = document.createElement("select");
      for (const option of variable.options ?? []) {
        const opt = document.createElement("option");
        opt.value = option.value;
        opt.textContent = option.label;
        if (option.value === variable.default) opt.selected = true;
        input.appendChild(opt);
      }
      break;
    case "image":
      input = buildImageField(variable, wrap);
      break;
    // "font" falls back to a plain text field in this proof-of-concept —
    // no font picker yet, just a font-family name.
    case "font":
    case "string":
    default:
      input = document.createElement("input");
      input.type = "text";
      input.value = String(variable.default ?? "");
      if (variable.maxLength) input.maxLength = variable.maxLength;
      break;
  }
  input.id = `field-${variable.id}`;
  input.dataset.varId = variable.id;
  input.dataset.varType = variable.type;
  if (variable.type !== "image") wrap.appendChild(input);

  if (variable.description) {
    const hint = document.createElement("div");
    hint.className = "hint";
    hint.textContent = variable.description;
    wrap.appendChild(hint);
  }

  return wrap;
}

/**
 * Image fields upload on selection and stash the returned `upload:<id>` marker
 * on the input's dataset — collectVariableValues() reads that marker, or omits
 * the key entirely (falling back to the template's own declared default asset)
 * if the user never picked a file.
 */
function buildImageField(variable, wrap) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";

  const preview = document.createElement("img");
  preview.className = "image-preview";
  preview.alt = "";
  preview.hidden = true;

  const status = document.createElement("div");
  status.className = "hint";
  status.textContent = "Keep the template image or upload your own.";

  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;

    status.classList.remove("is-error");
    status.textContent = "Uploading…";
    delete input.dataset.uploadMarker;

    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Server returned ${res.status}`);

      input.dataset.uploadMarker = `upload:${data.uploadId}`;
      preview.src = data.previewUrl;
      preview.hidden = false;
      status.textContent = file.name;
    } catch (err) {
      preview.hidden = true;
      status.classList.add("is-error");
      status.textContent = `Upload failed: ${err.message}`;
    }
  });

  wrap.appendChild(input);
  wrap.appendChild(preview);
  wrap.appendChild(status);
  return input;
}

function collectVariableValues() {
  const values = {};
  for (const input of variableForm.querySelectorAll("[data-var-id]")) {
    const id = input.dataset.varId;
    const type = input.dataset.varType;
    if (type === "image") {
      // No upload → omit the key so the template's own declared default
      // asset (copied alongside it into the render's temp project dir) wins.
      if (input.dataset.uploadMarker) values[id] = input.dataset.uploadMarker;
    } else if (type === "boolean") {
      values[id] = input.checked;
    } else if (type === "number") {
      // An empty number field yields NaN, which JSON.stringify turns into
      // null and the producer rejects — fall back to the declared default.
      const parsed = Number(input.value);
      if (Number.isFinite(parsed)) values[id] = parsed;
    } else {
      values[id] = input.value;
    }
  }
  return values;
}

async function submitRender(event) {
  event.preventDefault();
  if (renderBtn.disabled) return;

  renderBtn.disabled = true;
  renderBtn.textContent = "Starting…";
  formError.hidden = true;

  try {
    const res = await fetch("/api/render", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        templateId: selectedTemplate.id,
        variables: collectVariableValues(),
        orientation: orientationSelect.value,
        resolution: resolutionSelect.value,
        ...(generatedMotionCode ? { motionCode: generatedMotionCode } : {}),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? `Server returned ${res.status}`);

    startProgress(data.jobId);
  } catch (err) {
    formError.hidden = false;
    formError.textContent = err.message;
    renderBtn.disabled = false;
    renderBtn.textContent = "Make Video";
  }
}

// ── Progress ───────────────────────────────────────────────────────────────

const progressTrack = document.querySelector("#progress-view .progress-track");
const progressFill = document.getElementById("progress-fill");
const progressMessage = document.getElementById("progress-message");
const cancelBtn = document.getElementById("cancel-btn");

function stopPolling() {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function startProgress(jobId) {
  activeJobId = jobId;
  setProgress(progressTrack, progressFill, 0);
  progressMessage.textContent = "Preparing…";
  cancelBtn.disabled = false;
  cancelBtn.textContent = "Cancel";
  showView("progress");
  pollJob(jobId);
}

function pollJob(jobId) {
  stopPolling();
  let consecutiveFailures = 0;

  pollTimer = setInterval(async () => {
    let job;
    try {
      const res = await fetch(`/api/render/${jobId}`);
      if (res.status === 404) {
        // The job store is in memory; a server restart loses it. Without this
        // the UI polls a dead id forever, stuck at 0%.
        stopPolling();
        showDone(null, "Proses render hilang — aplikasi mungkin dimulai ulang. Try again.");
        return;
      }
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      job = await res.json();
      consecutiveFailures = 0;
    } catch (err) {
      // A single hiccup shouldn't kill the render view, but an endpoint that
      // stays unreachable must surface instead of spinning silently.
      consecutiveFailures += 1;
      if (consecutiveFailures >= 5) {
        stopPolling();
        showDone(null, `Lost connection to the app: ${err.message}`);
      }
      return;
    }

    setProgress(progressTrack, progressFill, job.progress ?? 0);
    progressMessage.textContent = job.message ?? "";

    if (job.status === "done") {
      stopPolling();
      showDone(jobId, null);
    } else if (job.status === "cancelled") {
      stopPolling();
      showView("gallery");
    } else if (job.status === "error") {
      stopPolling();
      showDone(null, job.error ?? "Render failed.");
    }
  }, 1000);
}

async function cancelRender() {
  if (!activeJobId) return;
  cancelBtn.disabled = true;
  cancelBtn.textContent = "Cancelling…";
  try {
    await fetch(`/api/render/${activeJobId}/cancel`, { method: "POST" });
  } catch {
    // The poll loop reports the outcome either way.
  }
}

// ── Done ───────────────────────────────────────────────────────────────────

function showDone(jobId, error) {
  const title = document.getElementById("done-title");
  const errorEl = document.getElementById("done-error");
  const link = document.getElementById("download-link");
  const video = document.getElementById("result-video");

  if (error) {
    title.textContent = "Render failed";
    errorEl.hidden = false;
    errorEl.textContent = error;
    link.hidden = true;
    video.hidden = true;
    video.removeAttribute("src");
  } else {
    title.textContent = "Your video is ready!";
    errorEl.hidden = true;
    link.hidden = false;
    link.href = `/output/${jobId}`;
    link.setAttribute("download", `${selectedTemplate.id}.mp4`);
    video.hidden = false;
    video.src = `/preview/${jobId}`;
  }
  showView("done");
}

function backToGallery() {
  stopPolling();
  showView("gallery");
}

document.getElementById("back-btn").addEventListener("click", backToGallery);
document.getElementById("restart-btn").addEventListener("click", backToGallery);
document.getElementById("gallery-retry").addEventListener("click", loadTemplates);
cancelBtn.addEventListener("click", cancelRender);
motionGenerate.addEventListener("click", generateMotion);
variableForm.addEventListener("submit", submitRender);
templateSearch.addEventListener("input", renderGallery);

// Escape backs out of the form, matching the visible "choose another template".
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !views.form.hidden) backToGallery();
});

(async function start() {
  const ready = await waitForSetup();
  if (!ready) return;
  showView("gallery");
  await loadTemplates();
})();

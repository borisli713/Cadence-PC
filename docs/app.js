/* global document, fetch */
const GITHUB_REPO = "borisli713/Cadence-PC";
const GITHUB_RELEASES_API = `https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=30`;

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(2)} MB`;
  const kb = bytes / 1024;
  return `${Math.round(kb)} KB`;
}

function formatDate(isoString) {
  if (!isoString) return "";
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function parseSemver(tag) {
  const match = String(tag || "")
    .trim()
    .match(/^(?:windows-v?|win-v?|v)?(\d+)\.(\d+)\.(\d+)$/i);
  if (!match) return [0, 0, 0];
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareSemverDesc(a, b) {
  const va = parseSemver(a.tagName || a.version);
  const vb = parseSemver(b.tagName || b.version);
  for (let i = 0; i < 3; i += 1) {
    if (vb[i] !== va[i]) return vb[i] - va[i];
  }
  return String(b.publishedAt || "").localeCompare(String(a.publishedAt || ""));
}

function classifyAsset(name) {
  const lower = String(name || "").toLowerCase();
  if (lower.endsWith("-setup.exe")) {
    return { kind: "setup", label: "Windows Installer (.exe)", shortLabel: "Setup .exe", rank: 0 };
  }
  if (lower.endsWith(".msi")) {
    return { kind: "msi", label: "MSI Package (.msi)", shortLabel: "MSI", rank: 1 };
  }
  if (lower.endsWith("-portable.exe")) {
    return { kind: "portable", label: "Portable App (.exe)", shortLabel: "Portable .exe", rank: 2 };
  }
  if (lower.endsWith(".exe")) {
    return { kind: "exe", label: "Windows Executable (.exe)", shortLabel: ".exe", rank: 3 };
  }
  return { kind: "other", label: name, shortLabel: name, rank: 4 };
}

function extractChangelogLines(body) {
  const lines = String(body || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const inChangedSection = [];
  let collecting = false;
  for (const line of lines) {
    if (/^#{1,4}\s*what's changed/i.test(line)) {
      collecting = true;
      continue;
    }
    if (/^#{1,4}\s+/i.test(line) && collecting) {
      break;
    }
    if (collecting && /^[-*]\s+/.test(line)) {
      inChangedSection.push(line.replace(/^[-*]\s+/, "").trim());
    }
  }

  if (inChangedSection.length > 0) {
    return inChangedSection;
  }

  return lines
    .filter((line) => /^[-*]\s+/.test(line) && !/windows-x64/i.test(line))
    .map((line) => line.replace(/^[-*]\s+/, "").trim());
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeGithubReleases(rawReleases) {
  const list = [];
  for (const rel of rawReleases || []) {
    if (rel.draft || rel.prerelease) continue;
    const assets = (rel.assets || [])
      .filter((a) => /\.(exe|msi)$/i.test(a.name || ""))
      .map((a) => {
        const meta = classifyAsset(a.name);
        return {
          name: a.name,
          kind: meta.kind,
          label: meta.label,
          shortLabel: meta.shortLabel,
          rank: meta.rank,
          sizeBytes: a.size || 0,
          url: a.browser_download_url,
          githubUrl: a.browser_download_url,
        };
      })
      .sort((a, b) => a.rank - b.rank);

    if (assets.length === 0) continue;
    const sem = parseSemver(rel.tag_name);
    const version = sem[0] + sem[1] + sem[2] > 0 ? sem.join(".") : rel.tag_name;
    list.push({
      tagName: rel.tag_name,
      version,
      name: rel.name || `Cadence Windows v${version}`,
      publishedAt: rel.published_at || "",
      body: rel.body || "",
      releasePageUrl: rel.html_url || `https://github.com/${GITHUB_REPO}/releases/tag/${rel.tag_name}`,
      assets,
    });
  }
  return list.sort(compareSemverDesc);
}

function normalizeManifestReleases(manifest) {
  const releases = (manifest?.releases || []).map((rel) => ({
    ...rel,
    assets: (rel.assets || [])
      .map((a) => {
        const meta = classifyAsset(a.name);
        return {
          ...a,
          kind: a.kind || meta.kind,
          label: a.label || meta.label,
          shortLabel: meta.shortLabel,
          rank: meta.rank,
        };
      })
      .sort((a, b) => a.rank - b.rank),
  }));
  return releases.sort(compareSemverDesc);
}

function mergeReleases(primaryList, liveList) {
  const byTag = new Map();
  for (const rel of liveList) {
    byTag.set(rel.tagName, rel);
  }
  for (const rel of primaryList) {
    // Prefer CI-generated manifest entries when present so site-hosted ./downloads/ paths win.
    byTag.set(rel.tagName, rel);
  }
  return Array.from(byTag.values()).sort(compareSemverDesc);
}

function pickPrimaryAsset(release) {
  if (!release || !release.assets?.length) return null;
  return (
    release.assets.find((a) => a.kind === "setup") ||
    release.assets.find((a) => a.kind === "msi") ||
    release.assets[0]
  );
}

function renderHero(latest) {
  if (!latest) return;
  const primary = pickPrimaryAsset(latest);
  const heroBtn = document.getElementById("hero-primary-download");
  const navBtn = document.getElementById("nav-download-cta");
  const ctaLabel = document.getElementById("hero-cta-label");
  const metaLine = document.getElementById("hero-meta-line");
  const captionVer = document.getElementById("hero-caption-version");

  if (primary && heroBtn) {
    heroBtn.href = primary.url;
    heroBtn.setAttribute("download", primary.name);
  }
  if (primary && navBtn) {
    navBtn.href = primary.url;
    navBtn.setAttribute("download", primary.name);
    navBtn.textContent = `Download v${latest.version}`;
  }
  if (ctaLabel) {
    ctaLabel.textContent = `Download v${latest.version} Setup`;
  }
  if (captionVer) {
    captionVer.textContent = `v${latest.version} · x64`;
  }
  if (metaLine) {
    const sizeText = primary?.sizeBytes ? `Installer ${formatBytes(primary.sizeBytes)}` : "Windows x64";
    const dateText = formatDate(latest.publishedAt);
    metaLine.innerHTML = [
      `<span>Latest v${escapeHtml(latest.version)}</span>`,
      dateText ? `<span aria-hidden="true">·</span><span>${escapeHtml(dateText)}</span>` : "",
      `<span aria-hidden="true">·</span><span>Windows 10 &amp; 11</span>`,
      `<span aria-hidden="true">·</span><span>${escapeHtml(sizeText)}</span>`,
    ]
      .filter(Boolean)
      .join("");
  }
}

function renderLatest(latest) {
  const container = document.getElementById("latest-release-panel");
  if (!container) return;

  if (!latest) {
    container.innerHTML = `
      <div class="latest-loading">
        No Windows release packages found yet. Visit
        <a href="https://github.com/${GITHUB_REPO}/releases" target="_blank" rel="noopener noreferrer">GitHub Releases</a>.
      </div>
    `;
    return;
  }

  const notes = extractChangelogLines(latest.body);
  const dateText = formatDate(latest.publishedAt);

  const assetRowsHtml = latest.assets
    .map((asset, index) => {
      const isPrimary = index === 0 || asset.kind === "setup";
      const sizeStr = formatBytes(asset.sizeBytes);
      return `
        <div class="installer-row ${isPrimary ? "installer-row-primary" : ""}">
          <div class="installer-info">
            <div class="installer-name">${escapeHtml(asset.label)}</div>
            <div class="installer-meta">${escapeHtml(asset.name)}${sizeStr ? ` · ${escapeHtml(sizeStr)}` : ""}</div>
          </div>
          <a
            href="${escapeHtml(asset.url)}"
            download="${escapeHtml(asset.name)}"
            class="btn ${isPrimary ? "btn-primary" : "btn-secondary"} btn-sm"
          >
            Download
          </a>
        </div>
      `;
    })
    .join("");

  const notesHtml =
    notes.length > 0
      ? `<ul class="changelog-list">${notes.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`
      : `<p class="changelog-empty">Windows Rust + Tauri desktop build and maintenance updates.</p>`;

  container.innerHTML = `
    <div class="latest-head">
      <div class="latest-title-group">
        <div class="latest-title-row">
          <h3>${escapeHtml(latest.name || `Cadence Windows v${latest.version}`)}</h3>
          <span class="latest-tag">${escapeHtml(latest.tagName)}</span>
        </div>
        <div class="latest-meta-row">
          <span>Current Release</span>
          ${dateText ? `<span aria-hidden="true">·</span><span>Published ${escapeHtml(dateText)}</span>` : ""}
          <span aria-hidden="true">·</span>
          <span>${latest.assets.length} Windows packages</span>
        </div>
      </div>
      <a
        href="${escapeHtml(latest.releasePageUrl)}"
        target="_blank"
        rel="noopener noreferrer"
        class="github-release-link"
      >
        View release on GitHub
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M7 17 17 7" />
          <path d="M8 7h9v9" />
        </svg>
      </a>
    </div>
    <div class="latest-body">
      <div class="installers-col">
        <div class="col-label">INSTALLER PACKAGES</div>
        ${assetRowsHtml}
      </div>
      <div class="notes-col">
        <div class="col-label">WHAT'S CHANGED</div>
        ${notesHtml}
      </div>
    </div>
  `;
}

function renderArchive(pastReleases, filterText = "") {
  const container = document.getElementById("past-releases-list");
  if (!container) return;

  const query = filterText.trim().toLowerCase();
  const filtered = pastReleases.filter((rel) => {
    if (!query) return true;
    const haystack = [rel.version, rel.tagName, rel.name, rel.body].join(" ").toLowerCase();
    return haystack.includes(query);
  });

  if (pastReleases.length === 0) {
    container.innerHTML = `
      <div class="latest-loading">
        Only the latest release is published so far. Future updates will archive prior builds here automatically.
      </div>
    `;
    return;
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="latest-loading">
        No past releases match "${escapeHtml(filterText)}".
      </div>
    `;
    return;
  }

  container.innerHTML = filtered
    .map((rel, idx) => {
      const notes = extractChangelogLines(rel.body);
      const summary =
        notes[0] || "Windows Rust + Tauri desktop build and maintenance updates.";
      const dateStr = formatDate(rel.publishedAt);
      const detailsId = `archive-notes-${idx}`;

      const chipsHtml = rel.assets
        .map((asset) => {
          const sizeStr = formatBytes(asset.sizeBytes);
          return `
            <a
              href="${escapeHtml(asset.url)}"
              download="${escapeHtml(asset.name)}"
              class="asset-chip-link"
              title="${escapeHtml(asset.name)}"
            >
              <span>${escapeHtml(asset.shortLabel)}</span>
              ${sizeStr ? `<span>· ${escapeHtml(sizeStr)}</span>` : ""}
            </a>
          `;
        })
        .join("");

      const fullNotesHtml =
        notes.length > 0
          ? `<ul class="changelog-list">${notes.map((n) => `<li>${escapeHtml(n)}</li>`).join("")}</ul>`
          : `<p class="changelog-empty">${escapeHtml(summary)}</p>`;

      return `
        <article class="archive-item">
          <div class="archive-row">
            <div class="archive-ver-col">
              <div class="archive-version">v${escapeHtml(rel.version)}</div>
              <div class="archive-date">${escapeHtml(dateStr || rel.tagName)}</div>
            </div>
            <div class="archive-summary-col">
              <p class="archive-notes-preview">${escapeHtml(summary)}</p>
              <button
                type="button"
                class="archive-details-toggle"
                data-target="${detailsId}"
                aria-expanded="false"
              >
                Release notes (${notes.length || 1})
              </button>
            </div>
            <div class="archive-downloads-col">
              ${chipsHtml}
            </div>
          </div>
          <div id="${detailsId}" class="archive-expanded" hidden>
            <div class="archive-expanded-box">
              ${fullNotesHtml}
            </div>
          </div>
        </article>
      `;
    })
    .join("");

  container.querySelectorAll(".archive-details-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.getAttribute("data-target");
      const panel = targetId ? document.getElementById(targetId) : null;
      if (!panel) return;
      const expanded = btn.getAttribute("aria-expanded") === "true";
      btn.setAttribute("aria-expanded", String(!expanded));
      panel.hidden = expanded;
    });
  });
}

function setupNavigation() {
  const toggle = document.getElementById("mobile-menu-toggle");
  const drawer = document.getElementById("mobile-nav");
  if (!toggle || !drawer) return;

  toggle.addEventListener("click", () => {
    const isOpen = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", String(!isOpen));
    drawer.hidden = isOpen;
  });

  drawer.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      toggle.setAttribute("aria-expanded", "false");
      drawer.hidden = true;
    });
  });
}

async function initReleases() {
  let allReleases = [];
  const statusEl = document.getElementById("release-sync-status");

  try {
    const res = await fetch("./releases.json", { cache: "no-store" });
    if (res.ok) {
      const manifest = await res.json();
      allReleases = normalizeManifestReleases(manifest);
    }
  } catch {
    // Fallback to live GitHub Releases API below
  }

  const applyRender = (releases, searchValue = "") => {
    const [latest, ...past] = releases;
    renderHero(latest);
    renderLatest(latest);
    renderArchive(past, searchValue);
  };

  const searchInput = document.getElementById("release-search");
  if (allReleases.length > 0) {
    applyRender(allReleases, searchInput?.value || "");
  }

  // Refresh in background from live GitHub Releases API so newly tagged builds show immediately.
  try {
    const apiRes = await fetch(GITHUB_RELEASES_API, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (apiRes.ok) {
      const raw = await apiRes.json();
      const liveReleases = normalizeGithubReleases(raw);
      if (liveReleases.length > 0) {
        allReleases = mergeReleases(allReleases, liveReleases);
        applyRender(allReleases, searchInput?.value || "");
        if (statusEl) {
          statusEl.textContent = `${allReleases.length} Windows releases indexed · Latest v${allReleases[0].version}`;
        }
      }
    }
  } catch {
    if (statusEl && allReleases.length > 0) {
      statusEl.textContent = `${allReleases.length} Windows releases available · Latest v${allReleases[0].version}`;
    }
  }

  if (searchInput) {
    searchInput.addEventListener("input", () => {
      const [, ...past] = allReleases;
      renderArchive(past, searchInput.value);
    });
  }
}

setupNavigation();
initReleases();

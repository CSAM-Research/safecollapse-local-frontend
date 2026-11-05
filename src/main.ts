import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-500.css";
import "@fontsource/ibm-plex-sans/latin-600.css";
import "@fontsource/ibm-plex-sans/latin-700.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "./styles/main.css";
import { fetchCatalogue, fetchDashboard } from "./lib/api";
import type { Catalogue } from "./lib/types";
import { renderAnalyticsPage } from "./pages/analytics";
import {
  parseCheckpointRoute,
  renderCheckpointsPage,
  type CheckpointRoute,
} from "./pages/checkpoints";
import { renderJudgesPage } from "./pages/judges";
import { renderLabelsPage } from "./pages/labels";
import { renderOverviewShell } from "./pages/overview";
import { parseTraceRoute, renderTracesPage, type TraceRoute } from "./pages/traces";

const THEME_KEY = "safecollapse-theme";

type Route =
  | { kind: "overview"; study: string }
  | { kind: "traces"; trace: TraceRoute }
  | { kind: "checkpoints"; checkpoint: CheckpointRoute }
  | { kind: "compare" }
  | { kind: "judges" }
  | { kind: "labels" };

function applyTheme(theme: "light" | "dark"): void {
  if (theme === "light") document.documentElement.dataset.theme = "light";
  else delete document.documentElement.dataset.theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* ignore */
  }
}

function initTheme(): "light" | "dark" {
  let theme: "light" | "dark" = "dark";
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "dark" || stored === "light") theme = stored;
  } catch {
    /* ignore */
  }
  applyTheme(theme);
  return theme;
}

function parseRoute(catalogue: Catalogue): Route {
  const raw = location.hash.replace(/^#\/?/, "");
  if (raw === "compare" || raw.startsWith("compare/")) {
    return { kind: "compare" };
  }
  if (raw === "judges" || raw.startsWith("judges/")) {
    return { kind: "judges" };
  }
  if (raw === "labels" || raw.startsWith("labels/")) {
    return { kind: "labels" };
  }

  const checkpoint = parseCheckpointRoute(location.hash);
  if (checkpoint && catalogue.studies.some((s) => s.id === checkpoint.study)) {
    return { kind: "checkpoints", checkpoint };
  }

  const trace = parseTraceRoute(location.hash);
  if (trace && catalogue.studies.some((s) => s.id === trace.study)) {
    return { kind: "traces", trace };
  }

  const study = raw.split("/")[0];
  if (study && catalogue.studies.some((s) => s.id === study)) {
    return { kind: "overview", study };
  }
  if (catalogue.studies.some((s) => s.id === "main")) {
    return { kind: "overview", study: "main" };
  }
  const primary = catalogue.studies.find((s) => s.primary && !s.invalid);
  return { kind: "overview", study: primary?.id || catalogue.studies[0]?.id || "main" };
}

function activeStudy(route: Route): string | null {
  if (route.kind === "overview") return route.study;
  if (route.kind === "traces") return route.trace.study;
  if (route.kind === "checkpoints") return route.checkpoint.study;
  return null;
}

function renderShell(app: HTMLElement, catalogue: Catalogue, study: string | null): HTMLElement {
  const primary = catalogue.studies.filter((s) => s.primary && !s.invalid);
  const secondary = catalogue.studies.filter((s) => !s.primary || s.invalid);

  app.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand">
          <div class="brand-name">safecollapse</div>
          <div class="brand-sub">local results viewer</div>
        </div>
        <div class="nav-section">
          <div class="nav-label">Studies</div>
          <ul class="nav-list" id="nav-primary"></ul>
        </div>
        <div class="nav-section">
          <div class="nav-label">Other</div>
          <ul class="nav-list" id="nav-secondary"></ul>
        </div>
        <div class="nav-section">
          <div class="nav-label">In study</div>
          <ul class="nav-list">
            <li><button type="button" class="nav-item" data-go="overview">Overview</button></li>
            <li><button type="button" class="nav-item" data-go="checkpoints">Checkpoints</button></li>
            <li><button type="button" class="nav-item" data-go="traces">Traces</button></li>
          </ul>
        </div>
        <div class="nav-section">
          <div class="nav-label">Analysis</div>
          <ul class="nav-list">
            <li><button type="button" class="nav-item" data-go="labels">Labels</button></li>
            <li><button type="button" class="nav-item" data-go="compare">Compare</button></li>
            <li><button type="button" class="nav-item" data-go="judges">Judges</button></li>
          </ul>
        </div>
        <div class="sidebar-foot">
          <button type="button" class="theme-toggle" id="theme-toggle">Theme</button>
          <div class="brand-sub">${catalogue.n_nodes_total} nodes indexed</div>
        </div>
      </aside>
      <main class="main" id="main"></main>
    </div>
  `;

  const fill = (el: HTMLElement, studies: typeof catalogue.studies) => {
    el.innerHTML = studies
      .map((s) => {
        const cls = [
          "nav-item",
          s.id === study ? "active" : "",
          s.invalid ? "invalid" : "",
        ]
          .filter(Boolean)
          .join(" ");
        const genNote =
          s.max_generation && s.max_generation > 5 ? ` · g${s.max_generation}` : "";
        return `<li><button type="button" class="${cls}" data-study="${s.id}">${
          s.title || s.id
        }${genNote ? `<span class="nav-meta">${genNote}</span>` : ""}</button></li>`;
      })
      .join("");
  };

  fill(app.querySelector("#nav-primary")!, primary);
  fill(app.querySelector("#nav-secondary")!, secondary);
  return app.querySelector("#main")!;
}

function syncSubnav(app: HTMLElement, route: Route): void {
  app.querySelectorAll<HTMLButtonElement>("[data-go]").forEach((btn) => {
    const go = btn.dataset.go;
    const active =
      (go === "overview" && route.kind === "overview") ||
      (go === "traces" && route.kind === "traces") ||
      (go === "checkpoints" && route.kind === "checkpoints") ||
      (go === "compare" && route.kind === "compare") ||
      (go === "judges" && route.kind === "judges") ||
      (go === "labels" && route.kind === "labels");
    btn.classList.toggle("active", Boolean(active));
  });
}

async function renderRoute(
  main: HTMLElement,
  catalogue: Catalogue,
  route: Route,
): Promise<void> {
  if (route.kind === "overview") {
    main.innerHTML = `<div class="status">Loading ${route.study}…</div>`;
    try {
      const dash = await fetchDashboard(route.study);
      renderOverviewShell(main, catalogue, dash);
    } catch (err) {
      main.innerHTML = `<div class="status error">${
        err instanceof Error ? err.message : String(err)
      }</div>`;
    }
    return;
  }
  if (route.kind === "traces") {
    await renderTracesPage(main, catalogue, route.trace);
    return;
  }
  if (route.kind === "checkpoints") {
    await renderCheckpointsPage(main, catalogue, route.checkpoint);
    return;
  }
  if (route.kind === "compare") {
    await renderAnalyticsPage(main, catalogue);
    return;
  }
  if (route.kind === "labels") {
    renderLabelsPage(main, catalogue);
    return;
  }
  await renderJudgesPage(main, catalogue);
}

async function boot(): Promise<void> {
  const app = document.querySelector<HTMLElement>("#app");
  if (!app) return;

  let theme = initTheme();
  app.innerHTML = `<div class="status">Loading catalogue…</div>`;

  let catalogue: Catalogue;
  try {
    catalogue = await fetchCatalogue();
  } catch (err) {
    app.innerHTML = `<div class="status error">Could not load catalogue. Is the index built?<br/>${
      err instanceof Error ? err.message : String(err)
    }</div>`;
    return;
  }

  let route = parseRoute(catalogue);
  const main = renderShell(app, catalogue, activeStudy(route));

  const themeBtn = app.querySelector<HTMLButtonElement>("#theme-toggle")!;
  const syncThemeLabel = () => {
    themeBtn.textContent = theme === "dark" ? "Light theme" : "Dark theme";
  };
  syncThemeLabel();
  themeBtn.addEventListener("click", () => {
    theme = theme === "light" ? "dark" : "light";
    applyTheme(theme);
    syncThemeLabel();
    void renderRoute(main, catalogue, route);
  });

  const navigate = async (next: Route) => {
    route = next;
    const study = activeStudy(route);
    app.querySelectorAll<HTMLElement>("[data-study]").forEach((el) => {
      el.classList.toggle("active", Boolean(study) && el.dataset.study === study);
    });
    syncSubnav(app, route);
    await renderRoute(main, catalogue, route);
  };

  app.querySelectorAll<HTMLButtonElement>("[data-study]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const study = btn.dataset.study;
      if (!study) return;
      location.hash = `#/${study}`;
    });
  });

  app.querySelectorAll<HTMLButtonElement>("[data-go]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const study = activeStudy(route) || "main";
      const go = btn.dataset.go;
      if (go === "traces") {
        location.hash = `#/${study}/traces?job=harmbench_test&label=G1&seed=0`;
      } else if (go === "checkpoints") {
        location.hash = `#/${study}/checkpoints`;
      } else if (go === "compare") {
        location.hash = `#/compare`;
      } else if (go === "judges") {
        location.hash = `#/judges`;
      } else if (go === "labels") {
        location.hash = `#/labels`;
      } else {
        location.hash = `#/${study}`;
      }
    });
  });

  window.addEventListener("hashchange", () => {
    void navigate(parseRoute(catalogue));
  });

  if (!location.hash) location.hash = `#/${activeStudy(route) || "main"}`;
  syncSubnav(app, route);
  await renderRoute(main, catalogue, route);
}

void boot();

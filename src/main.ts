import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-500.css";
import "@fontsource/ibm-plex-sans/latin-600.css";
import "@fontsource/ibm-plex-sans/latin-700.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "./styles/main.css";
import { fetchCatalogue, fetchDashboard } from "./lib/api";
import type { Catalogue } from "./lib/types";
import { renderOverviewShell } from "./pages/overview";
import { parseTraceRoute, renderTracesPage, type TraceRoute } from "./pages/traces";

const THEME_KEY = "safecollapse-theme";

type Route =
  | { kind: "overview"; study: string }
  | { kind: "traces"; trace: TraceRoute };

function applyTheme(theme: "light" | "dark"): void {
  // Dark is the default :root palette; light opts in via data-theme="light".
  if (theme === "light") document.documentElement.dataset.theme = "light";
  else delete document.documentElement.dataset.theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* ignore */
  }
}

function initTheme(): "light" | "dark" {
  // Dark is the default look (RunPod-inspired). Light remains available.
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
  const trace = parseTraceRoute(location.hash);
  if (trace && catalogue.studies.some((s) => s.id === trace.study)) {
    return { kind: "traces", trace };
  }
  const raw = location.hash.replace(/^#\/?/, "");
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

function activeStudy(route: Route): string {
  return route.kind === "overview" ? route.study : route.trace.study;
}

function renderShell(app: HTMLElement, catalogue: Catalogue, study: string): HTMLElement {
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
            <li><button type="button" class="nav-item" data-go="traces">Traces</button></li>
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
        return `<li><button type="button" class="${cls}" data-study="${s.id}">${
          s.title || s.id
        }</button></li>`;
      })
      .join("");
  };

  fill(app.querySelector("#nav-primary")!, primary);
  fill(app.querySelector("#nav-secondary")!, secondary);
  return app.querySelector("#main")!;
}

function syncSubnav(app: HTMLElement, route: Route): void {
  const overview = route.kind === "overview";
  app.querySelectorAll<HTMLButtonElement>("[data-go]").forEach((btn) => {
    const go = btn.dataset.go;
    btn.classList.toggle(
      "active",
      (go === "overview" && overview) || (go === "traces" && !overview),
    );
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
  await renderTracesPage(main, catalogue, route.trace);
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
      el.classList.toggle("active", el.dataset.study === study);
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
      const study = activeStudy(route);
      if (btn.dataset.go === "traces") {
        location.hash = `#/${study}/traces?job=harmbench_test&label=G1&seed=0`;
      } else {
        location.hash = `#/${study}`;
      }
    });
  });

  window.addEventListener("hashchange", () => {
    void navigate(parseRoute(catalogue));
  });

  if (!location.hash) location.hash = `#/${activeStudy(route)}`;
  syncSubnav(app, route);
  await renderRoute(main, catalogue, route);
}

void boot();

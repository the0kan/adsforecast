/** Shared, dependency-free interaction layer for responsive navigation. */
const MOBILE_BREAKPOINT = 900;

function makeIconButton(className, label) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.setAttribute("aria-label", label);
  button.setAttribute("aria-expanded", "false");
  button.innerHTML = '<span aria-hidden="true"></span>';
  return button;
}

function setupMarketingNavigation() {
  const header = document.querySelector(".site-header__inner");
  const nav = document.querySelector(".site-nav");
  if (!header || !nav) return;

  nav.id ||= "site-navigation";
  const toggle = makeIconButton("mobile-nav-toggle", "Open navigation");
  toggle.setAttribute("aria-controls", nav.id);
  header.insertBefore(toggle, nav);

  const syncNavigationA11y = () => {
    const closedOnMobile = window.innerWidth <= MOBILE_BREAKPOINT && !document.body.classList.contains("site-nav-open");
    nav.toggleAttribute("inert", closedOnMobile);
    nav.setAttribute("aria-hidden", String(closedOnMobile));
  };

  const close = (restoreFocus = false) => {
    const wasOpen = document.body.classList.contains("site-nav-open");
    document.body.classList.remove("site-nav-open");
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "Open navigation");
    syncNavigationA11y();
    if (restoreFocus && wasOpen) toggle.focus();
  };

  toggle.addEventListener("click", () => {
    const open = !document.body.classList.contains("site-nav-open");
    document.body.classList.toggle("site-nav-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
    syncNavigationA11y();
  });
  nav.addEventListener("click", (event) => {
    if (event.target.closest("a")) close();
  });
  window.addEventListener("resize", () => {
    if (window.innerWidth > MOBILE_BREAKPOINT) close();
    else syncNavigationA11y();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close(true);
  });
  syncNavigationA11y();
}

function setupDashboardNavigation() {
  const sidebar = document.querySelector(".dashboard-sidebar");
  const topbar = document.querySelector(".dashboard-topbar");
  if (!sidebar || !topbar) return;

  const currentParams = new URLSearchParams(window.location.search);
  if (currentParams.get("demo") === "1" || currentParams.get("dev") === "1") {
    document.querySelectorAll('a[href$=".html"], a[href*=".html?"]').forEach((link) => {
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (!url.searchParams.has("demo") && !url.searchParams.has("dev")) {
        url.searchParams.set("demo", "1");
        link.href = `${url.pathname.split("/").pop()}${url.search}${url.hash}`;
      }
    });
  }

  sidebar.id ||= "dashboard-navigation";
  const toggle = makeIconButton("dashboard-menu-toggle", "Open main navigation");
  toggle.setAttribute("aria-controls", sidebar.id);
  topbar.prepend(toggle);

  const backdrop = document.createElement("button");
  backdrop.type = "button";
  backdrop.className = "dashboard-sidebar-backdrop";
  backdrop.setAttribute("aria-label", "Close main navigation");
  document.body.append(backdrop);

  const syncSidebarA11y = () => {
    const closedOnMobile = window.innerWidth <= MOBILE_BREAKPOINT && !document.body.classList.contains("dashboard-nav-open");
    sidebar.toggleAttribute("inert", closedOnMobile);
    sidebar.setAttribute("aria-hidden", String(closedOnMobile));
  };

  const close = (restoreFocus = false) => {
    const wasOpen = document.body.classList.contains("dashboard-nav-open");
    document.body.classList.remove("dashboard-nav-open");
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "Open main navigation");
    syncSidebarA11y();
    if (restoreFocus && wasOpen) toggle.focus();
  };
  const open = () => {
    document.body.classList.add("dashboard-nav-open");
    toggle.setAttribute("aria-expanded", "true");
    toggle.setAttribute("aria-label", "Close main navigation");
    syncSidebarA11y();
    sidebar.querySelector("a")?.focus();
  };

  toggle.addEventListener("click", () => {
    document.body.classList.contains("dashboard-nav-open") ? close(true) : open();
  });
  backdrop.addEventListener("click", () => close(true));
  sidebar.addEventListener("click", (event) => {
    if (event.target.closest("a") && window.innerWidth <= MOBILE_BREAKPOINT) close();
  });
  window.addEventListener("resize", () => {
    if (window.innerWidth > MOBILE_BREAKPOINT) close();
    else syncSidebarA11y();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close(true);
  });
  syncSidebarA11y();
}

function setupPasswordToggles() {
  document.querySelectorAll("[data-password-toggle]").forEach((control) => {
    if (!(control instanceof HTMLButtonElement)) return;
    const targetId = control.getAttribute("data-password-toggle");
    const input = targetId ? document.getElementById(targetId) : null;
    if (!(input instanceof HTMLInputElement)) return;
    control.addEventListener("click", () => {
      const reveal = input.type === "password";
      input.type = reveal ? "text" : "password";
      control.textContent = reveal ? "Hide" : "Show";
      control.setAttribute("aria-label", reveal ? "Hide password" : "Show password");
      input.focus({ preventScroll: true });
    });
  });
}

setupMarketingNavigation();
setupDashboardNavigation();
setupPasswordToggles();

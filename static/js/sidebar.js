function renderChannelList(guild, container, openChannel) {
  channelTooltip.hide();
  container.replaceChildren();
  function channelButton(channel) {
    const button = element("button", "channel-button");
    button.type = "button";
    button.dataset.channel = channel.id;
    button.dataset.name = channel.name;
    if (channel.topic?.trim()) {
      button.addEventListener("pointerenter", () => channelTooltip.show(button, channel.topic));
      button.addEventListener("pointerleave", () => channelTooltip.deferHide());
      button.addEventListener("focus", () => channelTooltip.show(button, channel.topic));
      button.addEventListener("blur", () => channelTooltip.hide());
      button.addEventListener("click", () => channelTooltip.hide());
    }
    button.append(channelIcon(channel.type), element("span", "channel-label", channel.name));
    button.addEventListener("click", () => openChannel(guild, channel));
    return button;
  }
  const categories = guild.categories ?? [];
  document.getElementById("collapse-categories").disabled = !categories.length;
  document.getElementById("expand-categories").disabled = !categories.length;
  const groups = new Map(categories.map(category => [category.id, []]));
  for (const channel of guild.channels) {
    const group = groups.get(String(channel.parent_id));
    if (group) group.push(channel);
    else container.append(channelButton(channel));
  }
  for (const category of categories) {
    const section = element("details", "channel-category");
    const storageKey = `fakecord.category.${guild.id}.${category.id}`;
    section.dataset.storageKey = storageKey;
    section.open = true;
    try { section.open = localStorage.getItem(storageKey) !== "collapsed"; } catch { /* Optional storage. */ }
    const summary = element("summary", "category-heading");
    const arrow = element("span", "category-arrow", "›");
    arrow.setAttribute("aria-hidden", "true");
    summary.append(arrow, element("span", "category-name", category.name));
    section.append(summary);
    for (const channel of groups.get(category.id)) section.append(channelButton(channel));
    section.addEventListener("toggle", () => {
      try { localStorage.setItem(storageKey, section.open ? "expanded" : "collapsed"); } catch { /* Optional storage. */ }
    });
    container.append(section);
  }
  if (!guild.channels.length && !categories.length) container.append(element("p", "sidebar-status", "No channels"));
}

// Keep sidebar resizing independent of channel loading and workspace layout mode.
(() => {
  const app = document.querySelector(".app");
  const sidebar = document.getElementById("channel-sidebar");
  const divider = document.getElementById("sidebar-resizer");
  const storageKey = "fakecord.sidebar.width";
  let drag = null;
  function bounds() {
    const rail = document.querySelector(".guild-rail").getBoundingClientRect().width;
    const available = app.clientWidth - rail;
    const min = 80;
    return { min, max: Math.max(min, Math.min(480, available - 200)) };
  }
  function setWidth(width) {
    const { min, max } = bounds();
    const value = Math.round(Math.min(max, Math.max(min, width)));
    app.style.setProperty("--sidebar-width", `${value}px`);
    divider.setAttribute("aria-valuemin", String(Math.round(min)));
    divider.setAttribute("aria-valuemax", String(Math.round(max)));
    divider.setAttribute("aria-valuenow", String(value));
    divider.setAttribute("aria-valuetext", `${value} pixels`);
    return value;
  }
  function saveWidth() {
    try { localStorage.setItem(storageKey, String(Math.round(sidebar.getBoundingClientRect().width))); } catch { /* Optional storage. */ }
  }
  let initialWidth = sidebar.getBoundingClientRect().width;
  try {
    const saved = Number(localStorage.getItem(storageKey));
    if (Number.isFinite(saved) && saved > 0) initialWidth = saved;
  } catch { /* Optional storage. */ }
  setWidth(initialWidth);
  divider.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;
    event.preventDefault();
    drag = { x: event.clientX, width: sidebar.getBoundingClientRect().width, pointerId: event.pointerId };
    divider.setPointerCapture(event.pointerId);
    app.classList.add("resizing-sidebar");
  });
  divider.addEventListener("pointermove", event => {
    if (drag && event.pointerId === drag.pointerId) setWidth(drag.width + event.clientX - drag.x);
  });
  function finish(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (divider.hasPointerCapture(event.pointerId)) divider.releasePointerCapture(event.pointerId);
    drag = null;
    app.classList.remove("resizing-sidebar");
    saveWidth();
  }
  divider.addEventListener("pointerup", finish);
  divider.addEventListener("pointercancel", finish);
  divider.addEventListener("lostpointercapture", event => {
    if (drag && event.pointerId === drag.pointerId) { drag = null; app.classList.remove("resizing-sidebar"); saveWidth(); }
  });
  divider.addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const { min, max } = bounds();
    const width = sidebar.getBoundingClientRect().width;
    setWidth(event.key === "Home" ? min : event.key === "End" ? max : width + (event.key === "ArrowLeft" ? -20 : 20));
    saveWidth();
  });
  window.addEventListener("resize", () => setWidth(sidebar.getBoundingClientRect().width));
})();

function setAllCategories(open) {
  channelTooltip.hide();
  for (const section of document.querySelectorAll("#channel-list .channel-category")) {
    section.open = open;
    try { localStorage.setItem(section.dataset.storageKey, open ? "expanded" : "collapsed"); } catch { /* Optional storage. */ }
  }
}
document.getElementById("collapse-categories").addEventListener("click", () => setAllCategories(false));
document.getElementById("expand-categories").addEventListener("click", () => setAllCategories(true));

const channelTooltip = (() => {
  const tooltip = document.createElement("div");
  tooltip.id = "channel-description-tooltip";
  tooltip.className = "channel-tooltip";
  tooltip.setAttribute("role", "tooltip");
  tooltip.hidden = true;
  document.body.append(tooltip);
  let anchor = null;
  let timer;
  function hide() {
    clearTimeout(timer);
    anchor?.removeAttribute("aria-describedby");
    anchor = null;
    tooltip.hidden = true;
  }
  function show(button, description) {
    hide();
    anchor = button;
    tooltip.textContent = description;
    tooltip.hidden = false;
    button.setAttribute("aria-describedby", tooltip.id);
    const box = button.getBoundingClientRect();
    const size = tooltip.getBoundingClientRect();
    let left = box.right + 10;
    if (left + size.width > window.innerWidth - 8) left = box.left - size.width - 10;
    tooltip.style.left = `${Math.max(8, Math.min(left, window.innerWidth - size.width - 8))}px`;
    tooltip.style.top = `${Math.max(8, Math.min(box.top + (box.height - size.height) / 2, window.innerHeight - size.height - 8))}px`;
  }
  function deferHide() { clearTimeout(timer); timer = setTimeout(hide, 120); }
  tooltip.addEventListener("pointerenter", () => clearTimeout(timer));
  tooltip.addEventListener("pointerleave", hide);
  window.addEventListener("scroll", event => {
    if (event.target === document || event.target?.contains?.(anchor)) hide();
  }, true);
  window.addEventListener("resize", hide);
  document.addEventListener("keydown", event => { if (event.key === "Escape") hide(); });
  document.getElementById("sidebar-resizer").addEventListener("pointerdown", hide);
  return { show, hide, deferHide };
})();

function refreshTooltipText(button) {
  if (!["refresh-guilds", "refresh-dms"].includes(button.id)) return button.dataset.tooltip;
  const timestamp = Number(button.dataset.updated);
  const updated = timestamp > 0 ? new Date(timestamp * 1000).toLocaleString() : "Not updated yet";
  return `${button.dataset.tooltip}\nLast updated: ${updated}`;
}
for (const button of document.querySelectorAll("[data-tooltip]")) {
  button.addEventListener("pointerenter", () => channelTooltip.show(button, refreshTooltipText(button)));
  button.addEventListener("pointerleave", () => channelTooltip.deferHide());
  button.addEventListener("focus", () => channelTooltip.show(button, refreshTooltipText(button)));
  button.addEventListener("blur", () => channelTooltip.hide());
  button.addEventListener("click", () => channelTooltip.hide());
}


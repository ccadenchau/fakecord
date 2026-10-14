/* Shared channel windows: GridStack tiles and independent freeform placement. */
class ChannelWorkspace {
  constructor(onChange) {
    this.element = document.getElementById("workspace");
    this.viewport = document.getElementById("workspace-viewport");
    this.windows = new Map();
    this.layouts = { grid: {}, freeform: {} };
    this.mode = "grid";
    this.onChange = onChange;
    this.maximized = null;
    this.zIndex = 1;
    this.suspended = false;
    this.freeform = new FreeformLayout(this);
    this.grid = GridStack.init({
      column: 48, cellHeight: 20, margin: 6, mode: "top", animate: true,
      draggable: { handle: ".window-titlebar", cancel: "button,input" },
      resizable: { handles: "se" }, alwaysShowResizeHandle: true,
    }, this.element);
    this.grid.on("change dragstop resizestop", () => {
      if (!this.suspended) { this.snapshot(); this.save(); }
    });
    this.grid.on("dragstart resizestart", (_, item) => this.focus(item.gridstackNode.id));
    for (const button of document.querySelectorAll("[data-layout]")) {
      button.addEventListener("click", () => this.setMode(button.dataset.layout));
    }
    this.refresh();
  }
  geometry(item) {
    const { x, y, w, h } = this.mode === "freeform" ? item.freeformRect : item.gridstackNode;
    return { x, y, w, h };
  }
  snapshot() {
    for (const [key, item] of this.windows) this.layouts[this.mode][key] = this.geometry(item);
  }
  save() {
    try {
      localStorage.setItem("fakecord.workspace.v3", JSON.stringify({
        mode: this.mode, gridResolution: 4, layouts: this.layouts, channels: [...this.windows.keys()],
      }));
    } catch { /* Storage is optional. */ }
  }
  readSaved() {
    try {
      const saved = JSON.parse(localStorage.getItem("fakecord.workspace.v3"));
      if (saved && ["grid", "freeform"].includes(saved.mode) && Array.isArray(saved.channels)) {
        this.layouts = this.normalizeLayouts(saved.layouts, saved.gridResolution);
        this.setMode(saved.mode, false);
        return saved.channels;
      }
      const previous = JSON.parse(localStorage.getItem("fakecord.workspace.v2"));
      if (previous && ["grid", "freeform"].includes(previous.mode) && Array.isArray(previous.channels)) {
        this.layouts.grid = this.normalizeLayouts(previous.layouts, previous.gridResolution).grid;
        const cellWidth = Math.max(1, this.viewport.clientWidth - 12) / 48;
        for (const [key, rect] of Object.entries(previous.layouts?.freeform ?? {})) {
          if (rect && ["x", "y", "w", "h"].every(prop => Number.isFinite(rect[prop]))) {
            this.layouts.freeform[key] = { x: rect.x * cellWidth, y: rect.y * 12, w: rect.w * cellWidth, h: rect.h * 12 };
          }
        }
        this.setMode(previous.mode, false);
        return previous.channels;
      }
      // Keep the open channels from the previous workspace implementation.
      const old = JSON.parse(localStorage.getItem("fakecord.workspace.v1"));
      if (Array.isArray(old?.windows)) {
        this.setMode(old.layout === "floating" ? "freeform" : "grid", false);
        return old.windows.map(item => `${item.guild}/${item.channel}`);
      }
    } catch { /* Ignore invalid storage. */ }
    return null;
  }
  normalizeLayouts(layouts, resolution = 1) {
    const result = JSON.parse(JSON.stringify({grid:layouts?.grid ?? {},freeform:layouts?.freeform ?? {}}));
    const scale = resolution === 4 ? 1 : 4;
    for (const rect of Object.values(result.grid)) {
      for (const property of ['x','y','w','h']) rect[property] *= scale;
    }
    return result;
  }
  options(key, index) {
    const freeform = this.mode === "freeform";
    const saved = this.layouts[this.mode][key];
    const valid = saved && ["x", "y", "w", "h"].every(prop => Number.isFinite(saved[prop]) && saved[prop] >= 0) && saved.w > 0 && saved.h > 0;
    return {
      id: key, minW: 12, minH: 12,
      ...(valid ? saved : freeform ? { x: 16 + index % 6 * 28, y: 16 + index % 6 * 28, w: 460, h: 420 } : { x: index % 2 * 24, y: Math.floor(index / 2) * 20, w: 24, h: 20 }),
    };
  }
  setMode(mode, persist = true) {
    if (!["grid", "freeform"].includes(mode)) return;
    this.freeform.cancel();
    this.restore();
    this.snapshot();
    this.suspended = true;
    this.mode = mode;
    const items = [...this.windows.entries()];
    // Re-register the same DOM nodes so drafts and message scroll positions survive.
    this.grid.removeAll(false, false);
    this.element.classList.toggle("freeform", mode === "freeform");
    this.viewport.classList.toggle("freeform-viewport", mode === "freeform");
    this.grid.batchUpdate();
    items.forEach(([key, item], index) => this.placeWindow(key, item, index));
    this.grid.batchUpdate(false);
    this.suspended = false;
    this.refresh();
    if (persist) { this.snapshot(); this.save(); }
  }
  placeWindow(key, item, index) {
    if (this.mode === "freeform") {
      this.freeform.place(item, this.options(key, index));
    } else {
      for (const prop of ["left", "top", "width", "height"]) item.style[prop] = "";
      this.grid.makeWidget(item, this.options(key, index));
    }
  }
  keyboardArrange(event, item, resize = event.shiftKey) {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key) || this.maximized) return;
    event.preventDefault();
    const rect = this.geometry(item);
    const horizontal = ["ArrowLeft", "ArrowRight"].includes(event.key);
    const property = resize ? (horizontal ? "w" : "h") : (horizontal ? "x" : "y");
    const step = (["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1) * (this.mode === "freeform" ? 20 : 1);
    rect[property] = Math.max(property === "w" || property === "h" ? 1 : 0, rect[property] + step);
    if (this.mode === "freeform") this.freeform.place(item, rect);
    else this.grid.update(item, rect);
    this.snapshot(); this.save();
  }
  add(key, content) {
    if (this.windows.has(key)) { this.focus(key, true); return; }
    this.restore();
    const item = document.createElement("div");
    item.className = "grid-stack-item";
    content.classList.add("grid-stack-item-content");
    item.append(content);
    this.element.append(item);
    this.windows.set(key, item);
    this.placeWindow(key, item, this.windows.size - 1);
    this.freeform.attach(item, key);
    item.addEventListener("pointerdown", () => this.focus(key));
    item.addEventListener("focusin", () => this.focus(key));
    const title = content.querySelector(".window-titlebar");
    title.addEventListener("keydown", event => {
      if (event.target === title) this.keyboardArrange(event, item);
    });
    this.focus(key);
    this.refresh();
    this.snapshot(); this.save();
  }
  focus(key, input = false) {
    const item = this.windows.get(key);
    if (!item) return;
    if (this.maximized && this.maximized !== key) this.restore();
    this.focused = key;
    for (const [id, window] of this.windows) window.classList.toggle("focused", id === key);
    item.style.zIndex = String(++this.zIndex);
    if (input) { item.querySelector("input")?.focus(); item.scrollIntoView({ block: "nearest" }); }
    this.onChange?.();
  }
  close(key) {
    this.restore();
    const item = this.windows.get(key);
    if (!item) return;
    this.windows.delete(key);
    delete this.layouts.grid[key]; delete this.layouts.freeform[key];
    this.freeform.cancel();
    if (this.mode === "grid") this.grid.removeWidget(item);
    else item.remove();
    if (this.focused === key) {
      this.focused = null;
      const next = [...this.windows.keys()].at(-1);
      if (next) this.focus(next, true);
    }
    this.refresh(); this.snapshot(); this.save();
  }
  maximize(key) {
    if (this.maximized === key) { this.restore(); return; }
    this.restore();
    this.focus(key);
    this.maximized = key;
    this.freeform.cancel();
    if (this.mode === "grid") this.grid.disable();
    this.viewport.classList.add("has-maximized");
    this.viewport.scrollTop = 0;
    for (const [id, item] of this.windows) {
      item.classList.toggle("maximized", id === key);
      item.hidden = id !== key;
    }
    this.updateMaximizeButtons();
  }
  restore() {
    if (!this.maximized) return;
    this.maximized = null;
    this.viewport.classList.remove("has-maximized");
    for (const item of this.windows.values()) { item.hidden = false; item.classList.remove("maximized"); }
    if (this.mode === "grid") this.grid.enable();
    this.updateMaximizeButtons();
  }
  updateMaximizeButtons() {
    for (const [key, item] of this.windows) {
      const button = item.querySelector(".maximize-window");
      button.textContent = this.maximized === key ? "❐" : "□";
      button.setAttribute("aria-label", this.maximized === key ? "Restore window" : "Maximize window");
    }
  }
  refresh() {
    document.getElementById("empty-workspace").hidden = this.windows.size > 0;
    for (const button of document.querySelectorAll("[data-layout]")) button.setAttribute("aria-pressed", String(button.dataset.layout === this.mode));
    this.onChange?.();
  }
}

/* Pixel-based window placement with no snapping, packing, or collision handling. */
class FreeformLayout {
  constructor(workspace) {
    this.workspace = workspace;
    this.gesture = null;
    window.addEventListener("pointermove", event => this.move(event));
    window.addEventListener("pointerup", event => this.finish(event));
    window.addEventListener("pointercancel", event => this.finish(event));
    new ResizeObserver(() => {
      if (workspace.mode !== "freeform" || workspace.maximized) return;
      for (const item of workspace.windows.values()) this.place(item, item.freeformRect);
      workspace.snapshot(); workspace.save();
    }).observe(workspace.viewport);
  }
  attach(item, key) {
    const title = item.querySelector(".window-titlebar");
    title.addEventListener("pointerdown", event => {
      if (!event.target.closest("button")) this.start(event, item, key, false);
    });
    const handle = document.createElement("button");
    handle.type = "button";
    handle.className = "freeform-resize";
    handle.setAttribute("aria-label", "Resize window");
    handle.addEventListener("pointerdown", event => this.start(event, item, key, true));
    handle.addEventListener("keydown", event => this.workspace.keyboardArrange(event, item, true));
    item.append(handle);
  }
  place(item, rect) {
    const width = Math.max(1, this.workspace.viewport.clientWidth - 12);
    const height = Math.max(1, this.workspace.viewport.clientHeight - 12);
    const w = Math.min(width, Math.max(Math.min(280, width), rect.w));
    const h = Math.min(height, Math.max(Math.min(220, height), rect.h));
    item.freeformRect = { x: Math.max(0, Math.min(rect.x, width - w)), y: Math.max(0, Math.min(rect.y, height - h)), w, h };
    const placed = item.freeformRect;
    Object.assign(item.style, { left: `${placed.x}px`, top: `${placed.y}px`, width: `${placed.w}px`, height: `${placed.h}px` });
  }
  start(event, item, key, resize) {
    if (event.button !== 0 || this.workspace.mode !== "freeform" || this.workspace.maximized) return;
    event.preventDefault();
    this.workspace.focus(key);
    this.gesture = { item, resize, x: event.clientX, y: event.clientY, rect: { ...item.freeformRect }, target: event.currentTarget, pointerId: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
    item.classList.add(resize ? "freeform-resizing" : "freeform-dragging");
  }
  move(event) {
    const gesture = this.gesture;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const rect = { ...gesture.rect };
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    if (gesture.resize) { rect.w += dx; rect.h += dy; }
    else { rect.x += dx; rect.y += dy; }
    this.place(gesture.item, rect);
  }
  finish(event) {
    if (!this.gesture || event.pointerId !== this.gesture.pointerId) return;
    this.cancel();
    this.workspace.snapshot(); this.workspace.save();
  }
  cancel() {
    if (!this.gesture) return;
    const { target, pointerId, item } = this.gesture;
    if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
    item.classList.remove("freeform-dragging", "freeform-resizing");
    this.gesture = null;
  }
}

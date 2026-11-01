/**
 * 将面板尺寸限制在当前真实可用空间内。
 * Args:
 *   value (number): 期望尺寸，单位为 CSS 像素。
 *   minimum (number): 当前最小尺寸。
 *   maximum (number): 当前最大尺寸。
 * Returns:
 *   number: 可使用的面板尺寸。
 */
function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

/** 管理当前页面的三条阅读分隔边界，不接触分析、图布局或源码状态。 */
class PaneLayout {
  /**
   * 连接已有面板、分隔条及尺寸观察。
   * Args:
   *   workspace (HTMLElement): 包含导航、阅读和详情的工作区。
   * Returns:
   *   PaneLayout: 仅管理页面尺寸和原生指针交互的对象。
   */
  constructor(workspace) {
    // workspace 承载页内尺寸变量，reading/canvas 用来计算上下区的真实可用高度。
    this.workspace = workspace;
    this.reading = workspace.querySelector("#reading-area");
    this.canvas = this.reading.querySelector(".canvas-area");
    // panes 记录受控面板、分隔条、尺寸变量、轴及边界移动与尺寸增减的方向。
    this.panes = [
      {key: "sidebar", element: workspace.querySelector("#navigation-panel"),
        handle: workspace.querySelector("#sidebar-resizer"), variable: "--sidebar-width", axis: "x", direction: 1},
      {key: "details", element: workspace.querySelector("#details"),
        handle: workspace.querySelector("#details-resizer"), variable: "--details-width", axis: "x", direction: -1},
      {key: "source", element: workspace.querySelector("#source-panel"),
        handle: workspace.querySelector("#source-resizer"), variable: "--source-height", axis: "y", direction: -1},
    ];
    // fixedBars 只包含读取区已有的固定工具栏；隐藏控制栏的实际高度自然为零。
    this.fixedBars = [this.reading.querySelector(".reading-toolbar"),
      this.reading.querySelector("#graph-controls"), this.reading.querySelector("#logic-controls"),
      this.reading.querySelector(".graph-footer")];
    // drag 保存一次指针操作的起点，frame 合并同一帧内的尺寸观察通知。
    this.drag = null;
    this.frame = 0;
    for (const pane of this.panes) {
      pane.handle.addEventListener("pointerdown", this.start.bind(this, pane));
      pane.handle.addEventListener("pointermove", this.move.bind(this));
      pane.handle.addEventListener("pointerup", this.end.bind(this));
      pane.handle.addEventListener("pointercancel", this.end.bind(this));
      pane.handle.addEventListener("lostpointercapture", this.end.bind(this));
      pane.handle.addEventListener("keydown", this.key.bind(this, pane));
    }
    // observer 只处理容器及固定栏的尺寸变化，不观察文档内容或重新创建阅读组件。
    this.observer = new ResizeObserver(this.schedule.bind(this));
    this.observer.observe(workspace);
    this.observer.observe(this.reading);
    for (const bar of this.fixedBars) this.observer.observe(bar);
    this.update();
  }

  /**
   * 读取面板在当前布局中的实际宽度或高度。
   * Args:
   *   pane (object): 受控面板描述。
   * Returns:
   *   number: 沿受控轴的 CSS 像素尺寸。
   */
  size(pane) {
    const box = pane.element.getBoundingClientRect();
    return pane.axis === "x" ? box.width : box.height;
  }

  /**
   * 仅在尺寸确实改变时设置页面变量，避免尺寸观察反馈重复写入。
   * Args:
   *   pane (object): 受控面板描述。
   *   value (number): 已按边界限制的目标尺寸。
   * Returns:
   *   void: 更新当前页面的 CSS 变量，不写入持久化配置。
   */
  write(pane, value) {
    if (Math.abs(this.size(pane) - value) > 0.1) {
      this.workspace.style.setProperty(pane.variable, value + "px");
    }
  }

  /**
   * 取得两侧面板可以共享的宽度，始终为中央保留既有最小宽度。
   * Args:
   *   无。
   * Returns:
   *   number: 扣除中央350像素及两条分隔边界后的宽度。
   */
  sideSpace() {
    return this.workspace.clientWidth - 350 -
      this.panes[0].handle.getBoundingClientRect().width -
      this.panes[1].handle.getBoundingClientRect().width;
  }

  /**
   * 根据现有可见工具栏和上下区最小高度计算源码高度边界。
   * Args:
   *   无。
   * Returns:
   *   object: minimum/maximum；极短窗口保留最小高度并由阅读区整体滚动。
   */
  sourceLimits() {
    const source = this.panes[2];
    const minimum = parseFloat(getComputedStyle(source.element).minHeight);
    const canvasMinimum = parseFloat(getComputedStyle(this.canvas).minHeight);
    let fixedHeight = source.handle.getBoundingClientRect().height;
    for (const bar of this.fixedBars) fixedHeight += bar.getBoundingClientRect().height;
    return {minimum, maximum: Math.max(minimum, this.reading.clientHeight - fixedHeight - canvasMinimum)};
  }

  /**
   * 取得一个面板的当前边界，不把另一侧已占用的空间重复分配。
   * Args:
   *   pane (object): 受控面板描述。
   * Returns:
   *   object: 当前 minimum/maximum 尺寸。
   */
  limits(pane) {
    if (pane.key === "source") return this.sourceLimits();
    const sidebar = pane.key === "sidebar";
    const minimum = sidebar ? 160 : 240;
    const other = this.panes[sidebar ? 1 : 0];
    return {minimum, maximum: Math.max(minimum, this.sideSpace() - this.size(other))};
  }

  /**
   * 在窗口、提示或工具栏变化后统一约束三块尺寸并更新可访问数值。
   * Args:
   *   无。
   * Returns:
   *   void: 保留组件身份与内容，仅调整超出可用空间的尺寸。
   */
  update() {
    // 两侧先共享同一份空间，再计算受到控制栏换行影响的中央可用高度。
    const available = this.sideSpace();
    const sidebar = this.panes[0], details = this.panes[1];
    const left = clamp(this.size(sidebar), 160, Math.max(160, available - 240));
    this.write(sidebar, left);
    const right = clamp(this.size(details), 240, Math.max(240, available - left));
    this.write(details, right);
    const source = this.panes[2], sourceBounds = this.sourceLimits();
    this.write(source, clamp(this.size(source), sourceBounds.minimum, sourceBounds.maximum));
    for (const pane of this.panes) {
      const bounds = this.limits(pane);
      pane.handle.setAttribute("aria-valuemin", String(Math.round(bounds.minimum)));
      pane.handle.setAttribute("aria-valuemax", String(Math.round(bounds.maximum)));
      pane.handle.setAttribute("aria-valuenow", String(Math.round(this.size(pane))));
    }
  }

  /**
   * 合并同一帧内由固定栏、工作区引起的尺寸通知。
   * Args:
   *   无。
   * Returns:
   *   void: 安排下一次布局尺寸核对。
   */
  schedule() {
    if (!this.frame) this.frame = requestAnimationFrame(this.onFrame.bind(this));
  }

  /**
   * 在浏览器下一帧更新约束，避免观察回调中形成同步尺寸循环。
   * Args:
   *   无。
   * Returns:
   *   void: 清除帧标识并核对尺寸。
   */
  onFrame() {
    this.frame = 0;
    this.update();
  }

  /**
   * 从真实分隔条开始一次主指针拖动。
   * Args:
   *   pane (object): 本次调整的面板。
   *   event (PointerEvent): 按下事件。
   * Returns:
   *   void: 保存起点、捕获指针并临时关闭文本选择。
   */
  start(pane, event) {
    if (event.button !== 0 || !event.isPrimary || this.drag) return;
    event.preventDefault();
    this.drag = {pane, pointerId: event.pointerId, size: this.size(pane),
      coordinate: pane.axis === "x" ? event.clientX : event.clientY};
    pane.handle.setPointerCapture(event.pointerId);
    pane.handle.focus({preventScroll: true});
    pane.handle.classList.add("is-dragging");
    document.documentElement.classList.add("is-resizing",
      pane.axis === "x" ? "is-resizing-columns" : "is-resizing-rows");
  }

  /**
   * 按初始坐标调整尺寸，移出窄分隔条后仍由原生指针捕获继续操作。
   * Args:
   *   event (PointerEvent): 当前指针移动事件。
   * Returns:
   *   void: 更新目标面板及其实际尺寸边界。
   */
  move(event) {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    const {pane, coordinate, size} = this.drag;
    const point = pane.axis === "x" ? event.clientX : event.clientY;
    const bounds = this.limits(pane);
    this.write(pane, clamp(size + (point - coordinate) * pane.direction, bounds.minimum, bounds.maximum));
    this.update();
  }

  /**
   * 在释放、取消或失去捕获时结束拖动，保留最后一次有效尺寸。
   * Args:
   *   event (PointerEvent): 指针操作结束事件。
   * Returns:
   *   void: 清除捕获、拖动标记和临时文本选择限制。
   */
  end(event) {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    const {pane, pointerId} = this.drag;
    this.drag = null;
    pane.handle.classList.remove("is-dragging");
    document.documentElement.classList.remove("is-resizing", "is-resizing-columns", "is-resizing-rows");
    if (pane.handle.hasPointerCapture(pointerId)) pane.handle.releasePointerCapture(pointerId);
    this.update();
  }

  /**
   * 用对应轴的方向键按10像素移动边界，与鼠标拖动使用同一尺寸约束。
   * Args:
   *   pane (object): 当前获得键盘焦点的面板边界。
   *   event (KeyboardEvent): 键盘操作。
   * Returns:
   *   void: 阻止页面方向键滚动并调整面板。
   */
  key(pane, event) {
    const positive = pane.axis === "x" ? "ArrowRight" : "ArrowDown";
    const negative = pane.axis === "x" ? "ArrowLeft" : "ArrowUp";
    if (event.key !== positive && event.key !== negative) return;
    event.preventDefault();
    const step = (event.key === positive ? 10 : -10) * pane.direction;
    const bounds = this.limits(pane);
    this.write(pane, clamp(this.size(pane) + step, bounds.minimum, bounds.maximum));
    this.update();
  }
}

/**
 * 为当前页面已有的三条分隔边界连接原生交互。
 * Args:
 *   workspace (HTMLElement): 固定设计中的工作区根元素。
 * Returns:
 *   void: 初始化页面尺寸控制，不返回应用状态或增加测试入口。
 */
export function initLayout(workspace) {
  new PaneLayout(workspace);
}
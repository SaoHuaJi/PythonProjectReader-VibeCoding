import {edgeLabel, formatMessage, t} from "./i18n";
import {createCallLayout} from "./call-layout";
import cytoscape from "cytoscape";
import dagre from "cytoscape-dagre";

cytoscape.use(dagre);

/** 关系图封装：根据真实调用关系及包含结构绘图，保存可恢复的阅读位置。 */
export class RelationGraph {
  /**
   * 创建关系图及统一的节点、边和视角交互入口。
   * Args:
   *   container (HTMLElement): 绘图区域。
   *   handlers (object): 节点、边和视角变化回调。
   * Returns:
   *   RelationGraph: 支持文件容器和原有文件关系的绘图对象。
   */
  constructor(container, handlers) {
    // handlers 转交阅读动作，kind 区分调用容器图，fileContainers 按文件定位标题。
    this.handlers = handlers;
    this.kind = "";
    this.fileContainers = new Map();
    // textContext 只测量工具标题，防止长路径挤入成员行；不改变项目原始记录。
    this.textContext = document.createElement("canvas").getContext("2d");
    this.textContext.font = "12px system-ui";
    // cy 保存原生节点、真实调用边和当前视角。
    this.cy = cytoscape({
      container, elements: [], minZoom: 0.12, maxZoom: 2.8,
      // 继续使用库默认滚轮灵敏度及鼠标位置锚点。
      wheelSensitivity: 1,
      style: [
        {selector: "node", style: {
          "shape": "round-rectangle", "background-color": "#fff",
          "border-width": 1.5, "border-color": "#b7c8dc",
          "label": "data(label)", "color": "#24364c", "font-size": 12,
          "text-wrap": "wrap", "text-max-width": 190,
          "text-valign": "center", "text-halign": "center",
          "width": 210, "height": 66, "padding": 10,
        }},
        {selector: "node[kind = 'module']", style: {
          "background-color": "#eef5ff", "border-color": "#7c9fca",
        }},
        {selector: "node[kind = 'class']", style: {
          "background-color": "#f4efff", "border-color": "#aa91c6",
        }},
        {selector: "node[external]", style: {
          "border-style": "dashed", "background-color": "#f8f6f1",
        }},
        {selector: "node.call-row", style: {
          "width": "data(block_width)", "height": 28, "padding": 0,
          "font-family": "system-ui, sans-serif", "font-size": 12,
          "text-halign": "left-inside", "text-margin-x": 10,
          "text-wrap": "ellipsis", "text-max-width": "data(label_width)",
          "border-width": 1, "border-position": "inside", "background-color": "#fff",
        }},
        {selector: "node.call-container", style: {
          "width": "data(block_width)", "height": "data(block_height)",
          "min-width": "data(block_width)", "min-height": "data(block_height)",
          "min-height-bias-top": "100%", "min-height-bias-bottom": "0%",
          // 选中边框向内绘制，避免高亮改变父容器边界或阅读坐标。
          "padding": 14, "border-position": "inside", "compound-sizing-wrt-labels": "exclude",
          "font-family": "system-ui, sans-serif", "font-weight": 600,
          "text-halign": "center", "text-valign": "top-inside",
          "text-justification": "center", "text-wrap": "wrap",
          "text-max-width": "data(label_width)", "background-color": "#f1f5fb",
          "border-width": 1.5, "border-color": "#aebfd3",
        }},
        {selector: "node.scope-box", style: {
          "background-color": "#f5f2fa", "border-color": "#c8badc",
          "font-weight": 500,
        }},
        {selector: "node.scope-box[scope_kind = 'function'], node.scope-box[scope_kind = 'method']", style: {
          "background-color": "#eff6f4", "border-color": "#bed2cb",
        }},
        {selector: "node.boundary-box", style: {
          "background-color": "#f8f6f1", "border-color": "#cbbfa7", "border-style": "dashed",
        }},
        {selector: "node.relation-muted", style: {"opacity": 0.32}},
        {selector: "node.call-row.relation-related", style: {
          "border-color": "#5c9a94",
        }},
        {selector: "node:selected", style: {
          "border-width": 3, "border-color": "#287a76",
          "background-color": "#e9f5f2",
        }},
        // 成员类型保留各自底色，相关/选中状态只通过边框与箭头突出。
        {selector: "node.call-row[kind = 'function'], node.call-row[kind = 'lambda']", style: {
          "background-color": "#edf7ee",
        }},
        {selector: "node.call-row[kind = 'method']", style: {
          "background-color": "#fff7df",
        }},
        {selector: "node.call-row[kind = 'class']", style: {
          "background-color": "#eeeafb",
        }},
        {selector: "node.call-row[kind = 'module']", style: {
          "background-color": "#eff1f4",
        }},
        {selector: "node.call-row[external]", style: {
          "background-color": "#f8f6f1", "border-style": "dashed",
        }},
        {selector: "edge", style: {
          "width": 1.5, "line-color": "#a7b6c7",
          "target-arrow-color": "#a7b6c7", "target-arrow-shape": "triangle",
          "curve-style": "bezier", "label": "data(label)", "font-size": 10,
          "color": "#687b90", "text-background-color": "#f7f9fc",
          "text-background-opacity": 0.9, "text-background-padding": 3,
        }},
        {selector: "edge.call-link", style: {
          "curve-style": "unbundled-bezier", "control-point-weights": 0.5,
          "control-point-distances": "data(curve_distance)", "edge-distances": "endpoints",
          "source-endpoint": "data(source_endpoint)", "target-endpoint": "data(target_endpoint)",
        }},
        {selector: "edge.recursive-link", style: {
          "loop-direction": "90deg", "loop-sweep": "50deg", "control-point-distances": 56,
        }},
        {selector: "edge.relation-muted", style: {"opacity": 0.15}},
        {selector: "edge.relation-related, edge:selected", style: {
          "line-color": "#287a76", "target-arrow-color": "#287a76", "color": "#287a76",
        }},
        {selector: "edge:selected", style: {"width": 3}},
      ],
    });
    this.cy.on("tap", "node", this.handleNode.bind(this));
    this.cy.on("tap", "edge", this.handleEdge.bind(this));
    this.cy.on("pan zoom", this.handleViewport.bind(this));
    this.cy.on("dragfree", "node", this.handleNodeDrag.bind(this));
    // observer 只适配面板大小，不重排成员或文件。
    this.observer = new ResizeObserver(this.handleResize.bind(this));
    this.observer.observe(container);
  }

  /**
   * 转交原始事实节点或明确的容器节点。
   * Args:
   *   event (object): 绘图库的节点点击事件。
   * Returns:
   *   void: 由页面选择详情，不在绘图层改变范围。
   */
  handleNode(event) { this.handlers.node(event.target.data()); }

  /**
   * 转交保留原始调用位置的关系边。
   * Args:
   *   event (object): 绘图库的边点击事件。
   * Returns:
   *   void: 交给已有调用详情链路。
   */
  handleEdge(event) { this.handlers.edge(event.target.data()); }

  /**
   * 保存当前原生缩放和平移。
   * Args:
   *   无。
   * Returns:
   *   void: 通知页面更新阅读位置。
   */
  handleViewport() { this.handlers.viewport({zoom: this.cy.zoom(), pan: {...this.cy.pan()}}); }

  /**
   * 适配绘图区域大小。
   * Args:
   *   无。
   * Returns:
   *   void: 刷新画布，不重新布局。
   */
  handleResize() { this.cy.resize(); }

  /**
   * 文件整体拖动结束后更新连线的出入侧。
   * Args:
   *   无。
   * Returns:
   *   void: 保持成员坐标与真实调用端点。
   */
  handleNodeDrag() { if (this.kind === "call") this.updateCallRoutes(); }

  /**
   * 在固定标题宽度内省略过长文本，完整原文仍保留在节点数据与详情中。
   * Args:
   *   value (string): 文件名、路径或工具标题原值。
   *   width (number): 当前标题可使用的模型像素宽度。
   * Returns:
   *   string: 单行可见文本。
   */
  titleLine(value, width) {
    const text = String(value || "");
    if (this.textContext.measureText(text).width <= width) return text;
    const characters = Array.from(text);
    let low = 0, high = characters.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (this.textContext.measureText(characters.slice(0, middle).join("") + "…").width <= width) low = middle;
      else high = middle - 1;
    }
    return characters.slice(0, low).join("") + "…";
  }

  /**
   * 生成调用图工具标题，仅对显式机器码和计数进行翻译。
   * Args:
   *   node (object): 保留 raw_label、路径和计数的节点副本。
   * Returns:
   *   string: 当前界面的标题，项目名称和表达式不翻译。
   */
  callLabel(node) {
    const raw = node.raw_label || node.name || node.id;
    if (node.kind === "file_container") {
      let members = t("graph.membersShown", {shown: node.member_shown, total: node.member_total});
      if (node.remaining_members) members += " · " + t("graph.partialMembers", {count: node.remaining_members});
      return this.titleLine(raw, node.label_width) + "\n" +
        this.titleLine(node.relative_path || node.module || raw, node.label_width) + "\n" +
        this.titleLine(members, node.label_width);
    }
    if (node.kind === "boundary_container") return this.titleLine(formatMessage(node, raw), node.label_width);
    if (node.kind === "scope_container") return this.titleLine(raw, node.label_width);
    if (node.kind === "module" && node.scope === "project") return t("graph.moduleBody");
    return node.name || raw;
  }

  /**
   * 从后端事实和容器生成可恢复的调用图，其他关系继续沿用原布局。
   * Args:
   *   data (object): 不可变的图事实、边和可选 containers。
   *   viewport (object|null): 需要恢复的缩放和平移。
   *   layout (object|null): 历史保存的非容器节点坐标。
   * Returns:
   *   void: 更新绘图，不修改后端数据。
   */
  render(data, viewport = null, layout = null) {
    this.kind = data.kind || "";
    this.fileContainers.clear();
    const elements = [];
    const known = new Set();
    let positions = layout?.positions;
    if (this.kind === "call") {
      const calculated = createCallLayout(data, layout);
      positions = calculated.positions;
      // 独立的表现容器不会替代事实节点或进入调用边端点。
      for (const original of [...(data.containers || []), ...(data.nodes || [])]) {
        const dimensions = calculated.dimensions[original.id];
        const container = original.kind.endsWith("_container");
        const node = {...original, raw_label: original.label || original.name || original.id,
          is_container: container, block_width: dimensions.width, block_height: dimensions.height,
          label_width: dimensions.labelWidth,
          external: original.scope && original.scope !== "project" ? true : undefined};
        node.label = this.callLabel(node);
        if (node.kind === "file_container") this.fileContainers.set(node.file_id, node.id);
        let classes = container ? "call-container" : "call-row";
        if (node.kind === "scope_container") classes += " scope-box";
        if (node.kind === "boundary_container") classes += " boundary-box";
        // 只允许拖动最外层文件/边界块，避免把文件内成员拖散。
        elements.push({data: node, classes, grabbable: !node.parent});
        known.add(node.id);
      }
    } else {
      for (const original of data.nodes || []) {
        const label = original.label || original.name || original.id;
        const module = original.module && original.module !== label ? "\n" + original.module : "";
        elements.push({data: {...original, label: label + module,
          external: original.scope && original.scope !== "project" ? true : undefined}});
        known.add(original.id);
      }
    }
    for (const original of data.edges || []) {
      if (known.has(original.source) && known.has(original.target)) {
        const classes = this.kind === "call" ? "call-link" +
          (original.source === original.target ? " recursive-link" : "") : "";
        elements.push({data: {...original, label: edgeLabel(original), curve_distance: 24,
          source_endpoint: "50% 0%", target_endpoint: "-50% 0%"}, classes});
      }
    }
    this.cy.batch(this.replaceElements.bind(this, elements));
    if (positions) this.cy.layout({name: "preset", positions, animate: false, fit: false}).run();
    else this.cy.layout({name: "dagre", rankDir: "LR", nodeSep: 35, rankSep: 75,
      animate: false, fit: false, padding: 45}).run();
    if (this.kind === "call") this.updateCallRoutes();
    if (viewport) this.cy.viewport(viewport);
    else this.cy.fit(undefined, 45);
  }

  /**
   * 一次替换当前绘图元素。
   * Args:
   *   elements (Array<object>): 已复制的节点、容器与真实关系边。
   * Returns:
   *   void: 在批处理中替换元素。
   */
  replaceElements(elements) {
    this.cy.elements().remove();
    this.cy.add(elements);
  }

  /**
   * 为文件内调用选择侧向曲线，跨文件调用从真实行的相向边缘连接。
   * Args:
   *   无。
   * Returns:
   *   void: 更新曲线样式数据，不修改调用端点或节点位置。
   */
  updateCallRoutes() {
    let lane = 0;
    for (const edge of this.cy.edges()) {
      const source = edge.source(), target = edge.target();
      const from = source.position(), to = target.position();
      const sameFile = source.data("file_id") && source.data("file_id") === target.data("file_id");
      let sourceEndpoint = "50% 0%", targetEndpoint = "-50% 0%", distance = 24;
      if (source.same(target)) targetEndpoint = sourceEndpoint;
      else if (sameFile) {
        // 同一文件的行纵向排列，曲线经右侧通道，不从其他函数行中间穿过。
        targetEndpoint = sourceEndpoint;
        const file = this.cy.getElementById(this.fileContainers.get(source.data("file_id")));
        const right = file.position("x") + file.outerWidth() / 2;
        const fromX = from.x + source.outerWidth() / 2, toX = to.x + target.outerWidth() / 2;
        const length = Math.hypot(toX - fromX, to.y - from.y);
        const normalX = -(to.y - from.y) / length;
        distance = 2 * (right + 24 + lane % 4 * 12 - (fromX + toX) / 2) / normalX;
      } else if (to.x < from.x) {
        sourceEndpoint = "-50% 0%";
        targetEndpoint = "50% 0%";
        distance = -24;
      }
      edge.data({source_endpoint: sourceEndpoint, target_endpoint: targetEndpoint, curve_distance: distance});
      lane += 1;
    }
  }

  /**
   * 保存原生事实行坐标，空容器的独立坐标也保留。
   * Args:
   *   无。
   * Returns:
   *   object: 不含源码的 positions 快照。
   */
  snapshot() {
    const positions = {};
    for (const node of this.cy.nodes()) {
      if (!node.isParent()) positions[node.id()] = {...node.position()};
    }
    return {positions};
  }

  /**
   * 调整缩放或适应全部已加载节点。
   * Args:
   *   action (string): in、out 或 fit。
   * Returns:
   *   void: 更新原生图视角。
   */
  zoom(action) {
    if (action === "fit") this.cy.fit(undefined, 45);
    else this.cy.zoom({
      level: this.cy.zoom() * (action === "in" ? 1.6 : 1 / 1.6),
      renderedPosition: {x: this.cy.width() / 2, y: this.cy.height() / 2},
    });
  }

  /**
   * 在已有图中更新工具文字，不改变节点尺寸、坐标或视角。
   * Args:
   *   无。
   * Returns:
   *   void: 更新标题、模块执行行与边计数。
   */
  localize() {
    if (this.kind === "call") {
      for (const node of this.cy.nodes()) node.data("label", this.callLabel(node.data()));
    }
    for (const edge of this.cy.edges()) edge.data("label", edgeLabel(edge.data()));
  }

  /**
   * 将实体、文件或容器标识映射为当前已加载的原生节点。
   * Args:
   *   id (string): 实体、文件或表现容器标识。
   * Returns:
   *   object: Cytoscape 节点集合；不存在时为空集合。
   */
  findNode(id) {
    return this.cy.getElementById(this.fileContainers.get(id) || id || "");
  }

  /**
   * 判断实体、文件或容器是否已在当前图中。
   * Args:
   *   id (string): 待检查的稳定标识。
   * Returns:
   *   boolean: 已有节点是否存在。
   */
  has(id) { return Boolean(id && this.findNode(id).length); }

  /**
   * 选择已有节点并突出限定深度的调用关系，绝不重新布局。
   * Args:
   *   id (string): 文件、实体或容器标识。
   *   direction (string): both、incoming 或 outgoing。
   *   depth (number): 在已加载关系中追踪的调用深度。
   * Returns:
   *   void: 更新选中、相关和淡化样式。
   */
  select(id, direction = "both", depth = 1) {
    this.cy.elements().removeClass("relation-muted relation-related").unselect();
    const selected = this.findNode(id);
    if (!selected.length) return;
    selected.select();
    if (this.kind !== "call") return;
    const active = new Set();
    if (selected.data("is_container")) {
      for (const child of selected.descendants()) if (!child.data("is_container")) active.add(child.id());
    } else active.add(selected.id());
    let frontier = new Set(active);
    const activeEdges = new Set();
    // 只沿已加载的真实调用边追踪；容器包含关系不当成调用步数。
    for (let step = 0; step < depth && frontier.size; step += 1) {
      const next = new Set();
      for (const edge of this.cy.edges()) {
        const source = edge.data("source"), target = edge.data("target");
        if (direction !== "incoming" && frontier.has(source)) {
          activeEdges.add(edge.id());
          if (!active.has(target)) next.add(target);
        }
        if (direction !== "outgoing" && frontier.has(target)) {
          activeEdges.add(edge.id());
          if (!active.has(source)) next.add(source);
        }
      }
      for (const nodeId of next) active.add(nodeId);
      frontier = next;
    }
    active.add(selected.id());
    // 相关行的所有祖先保持可见，避免父容器透明度连带淡化已突出行。
    const visible = new Set(active);
    for (const nodeId of active) {
      for (const parent of this.cy.getElementById(nodeId).parents()) visible.add(parent.id());
    }
    for (const node of this.cy.nodes()) {
      node.addClass(visible.has(node.id()) ? "relation-related" : "relation-muted");
    }
    for (const edge of this.cy.edges()) {
      edge.addClass(activeEdges.has(edge.id()) ? "relation-related" : "relation-muted");
    }
  }
}
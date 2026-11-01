import {t, formatMessage, enumLabel, edgeLabel} from "./i18n";
/** 详情组件始终以纯文本呈现目标项目内容。 */
let lastDetails = null;

/**
 * 创建一个使用纯文本的元素。
 * Args:
 *   tag (string): HTML 标签名。
 *   className (string): 样式类。
 *   text (unknown): 可选文字。
 * Returns:
 *   HTMLElement: 新元素。
 */
export function el(tag, className = "", text = null) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== null && text !== undefined) node.textContent = String(text);
  return node;
}

/**
 * 将原注释或结构化值转换为可阅读文字。
 * Args:
 *   value (unknown): 服务提供的原文或记录。
 * Returns:
 *   string: 不生成额外解释的文本。
 */
export function textOf(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const parts = [];
    for (const item of value) parts.push(textOf(item));
    return parts.filter(Boolean).join("\n");
  }
  return value.text || value.expression || value.label || JSON.stringify(value);
}

/**
 * 创建操作按钮。
 * Args:
 *   text (string): 按钮文字。
 *   handler (Function): 点击回调。
 *   className (string): 额外样式。
 * Returns:
 *   HTMLButtonElement: 可访问按钮。
 */
export function button(text, handler, className = "") {
  const node = el("button", "button " + className, text);
  node.type = "button";
  node.addEventListener("click", handler);
  return node;
}

/**
 * 创建可折叠详情段。
 * Args:
 *   title (string): 段标题。
 *   open (boolean): 默认是否展开。
 * Returns:
 *   HTMLElement: 包含标题的详情容器。
 */
function section(title, open = true) {
  const node = el("details", "detail-section");
  node.open = open;
  node.dataset.sectionKey = title;
  node.append(el("summary", "", t(title)));
  return node;
}

/**
 * 添加一个标签值对。
 * Args:
 *   parent (HTMLElement): 父容器。
 *   label (string): 字段说明。
 *   value (unknown): 字段内容。
 * Returns:
 *   void: 添加字段。
 */
function fact(parent, label, value) {
  const row = el("div", "fact-row");
  row.append(el("span", "fact-label", label), el("span", "fact-value", textOf(value) || t("detail.unspecified")));
  parent.append(row);
}

/**
 * 显示原有说明及附近注释。
 * Args:
 *   parent (HTMLElement): 父容器。
 *   record (object): 文件或实体。
 * Returns:
 *   void: 添加说明段。
 */
function description(parent, record) {
  const block = section("section.description");
  block.append(el("pre", "docstring", record.docstring || t("detail.noDoc")));
  const comments = textOf(record.comments);
  if (comments) {
    block.append(el("div", "subtle-label", t("detail.nearbyComments")));
    block.append(el("pre", "comment-text", comments));
  }
  parent.append(block);
}

/**
 * 创建导航实体按钮。
 * Args:
 *   record (object): 实体记录。
 *   dispatch (Function): 页面操作入口。
 * Returns:
 *   HTMLElement: 含模块与种类的实体链接。
 */
function entityLink(record, dispatch) {
  const row = el("div", "entity-row");
  const link = button(record.name || record.qualname || record.id,
    dispatch.bind(null, "entity", record.id), "link-button");
  const suffix = enumLabel("kind", record.kind);
  row.append(link, el("span", "tag", suffix));
  if (record.annotation || record.value) {
    row.append(el("code", "entity-value", record.annotation || record.value));
  }
  return row;
}

/**
 * 说明符号引用索引已处理的范围，避免把未处理当作没有引用。
 * Args:
 *   index (object): 后端记录的项目或文件索引状态。
 *   fileId (string): 可选当前文件标识。
 * Returns:
 *   string: 对用户可见的完成范围说明。
 */
export function referenceSummary(index = {}, fileId = "") {
  const project = index.project;
  if (project?.status === "ready") return t("references.project", project);
  const current = fileId ? index[fileId] : null;
  if (current?.status === "ready") return t("references.file", current);
  let completed = 0;
  for (const item of Object.values(index)) if (item?.status === "ready") completed += 1;
  return completed ? t("references.partial", {count: completed}) : t("references.pending");
}
/**
 * 显示定义候选。
 * Args:
 *   parent (HTMLElement): 目标容器。
 *   targets (Array<object>): 查询候选。
 *   dispatch (Function): 页面操作入口。
 * Returns:
 *   void: 创建候选链接。
 */
export function renderTargets(parent, targets, dispatch) {
  if (!targets?.length) {
    parent.append(el("p", "muted", t("detail.noTargets")));
    return;
  }
  for (const target of targets) {
    const row = el("div", "target-row");
    const name = target.qualname || target.name || target.id;
    row.append(button(name, dispatch.bind(null, "target", target), "target-link"));
    row.append(el("span", "tag", target.scope === "project" ? t("detail.project") : t("detail.external")));
    const location = [target.module || target.path, target.line ? t("line", {line: target.line}) : ""];
    row.append(el("small", "target-location", location.filter(Boolean).join(" · ")));
    parent.append(row);
  }
}

/**
 * 显示一次定义查询结果。
 * Args:
 *   container (HTMLElement): 详情容器。
 *   result (object): 定义候选与原因。
 *   mode (string): 查询种类。
 *   dispatch (Function): 操作入口。
 * Returns:
 *   void: 更新详情。
 */
export function renderDefinition(container, result, mode, dispatch) {
  lastDetails = {renderer: renderDefinition, container, args: [container, result, mode, dispatch]};
  container.replaceChildren();
  container.append(el("div", "eyebrow", t("detail.definitionNavigation")));
  container.append(el("h2", "", mode === "binding" ? t("source.binding") : t("source.type")));
  container.append(el("p", "muted",
    mode === "binding" ? t("detail.bindingHint") : t("detail.typeHint")));
  if (result.reason || result.message_code) container.append(el("p", "notice", formatMessage(result, result.reason)));
  renderTargets(container, result.targets || [], dispatch);
}

/**
 * 渲染文件详情、成员及导入。
 * Args:
 *   container (HTMLElement): 详情容器。
 *   file (object): 文件详情。
 *   dispatch (Function): 页面操作入口。
 * Returns:
 *   void: 替换文件详情。
 */
export function renderFile(container, file, dispatch) {
  lastDetails = {renderer: renderFile, container, args: [container, file, dispatch]};
  container.replaceChildren();
  container.append(el("div", "eyebrow", t("detail.file")));
  container.append(el("h2", "", file.module || file.relative_path));
  container.append(el("p", "path-label", file.relative_path || file.path));
  fact(container, t("detail.parseStatus"), enumLabel("status", file.parse_status));
  description(container, file);

  const members = section("section.members");
  const records = file.members_detail || [];
  if (!records.length) members.append(el("p", "muted", t("detail.noMembers")));
  for (const member of records) members.append(entityLink(member, dispatch));
  container.append(members);

  const imports = section("section.imports");
  if (!file.imports?.length) imports.append(el("p", "muted", t("detail.noImports")));
  for (const item of file.imports || []) {
    const row = el("div", "import-row");
    row.append(button(item.expression || item.module || t("detail.import"),
      dispatch.bind(null, "range", {fileId: file.id, range: item.range}), "code-button"));
    if (item.targets?.length) renderTargets(row, item.targets, dispatch);
    else row.append(el("small", "muted", formatMessage(item, item.reason || t("detail.importPending"))));
    imports.append(row);
  }
  imports.append(el("p", "notice", referenceSummary(file.reference_index || {}, file.id)));
  if (file.references?.length) {
    imports.append(el("p", "subtle-label", t("detail.references")));
    for (const reference of file.references) {
      imports.append(button(reference.expression || reference.name || t("detail.reference"),
        dispatch.bind(null, "range", {fileId: file.id, range: reference.range}), "code-button"));
      const status = reference.status || "pending";
      if (status === "pending") {
        imports.append(el("small", "muted", t("detail.referencePending")));
      } else {
        const labels = {resolved: t("status.resolved"), ambiguous: t("status.ambiguous"), unresolved: t("status.unresolved"), error: t("status.error"), interrupted: t("status.interrupted")};
        imports.append(el("small", "muted", (labels[status] || status) + (reference.reason || reference.message_code ? " · " + formatMessage(reference, reference.reason) : "")));
        renderTargets(imports, reference.targets || [], dispatch);
      }
    }
  }
  if (file.incoming_references?.length) {
    imports.append(el("p", "subtle-label", t("detail.incomingReferences")));
    for (const reference of file.incoming_references) {
      imports.append(button(reference.expression || reference.name || t("detail.referenceLocation"),
        dispatch.bind(null, "range", {fileId: reference.file_id, range: reference.range}), "code-button"));
    }
  }
  if (file.incoming_imports?.length) {
    imports.append(el("p", "subtle-label", t("detail.incomingImports")));
    for (const item of file.incoming_imports) {
      imports.append(button(item.source_relative_path || item.source_module || item.expression || t("detail.importLocation"),
        dispatch.bind(null, "range", {fileId: item.source_file_id || item.file_id, range: item.range}), "code-button"));
    }
  }
  container.append(imports);
}

/**
 * 显示函数的参数和返回表达式。
 * Args:
 *   parent (HTMLElement): 父容器。
 *   entity (object): 函数或方法记录。
 *   dispatch (Function): 页面操作入口。
 * Returns:
 *   void: 添加输入输出。
 */
function inputOutput(parent, entity, dispatch) {
  const block = section("section.io");
  block.append(el("pre", "signature", entity.signature || entity.name));
  if (!entity.params?.length) block.append(el("p", "muted", t("detail.noParams")));
  for (const param of entity.params || []) {
    const row = el("div", "parameter-row");
    row.append(button(param.name, dispatch.bind(null, "range",
      {fileId: entity.file_id, range: param.range}), "link-button"));
    row.append(el("code", "", param.annotation || t("detail.noAnnotation")));
    if (param.default !== null && param.default !== undefined && param.default !== "") {
      row.append(el("code", "muted", "= " + param.default));
    }
    row.append(el("small", "muted", enumLabel("param", param.kind)));
    block.append(row);
  }
  fact(block, t("detail.returnAnnotation"), entity.return_annotation || t("detail.unspecified"));
  if (!entity.returns?.length) block.append(el("p", "muted", t("detail.noReturns")));
  for (const item of entity.returns || []) {
    const prefix = item.kind === "yield" || item.kind === "yield_from" || item.kind === "yieldfrom" ? t("detail.yield") : t("detail.return");
    block.append(button(prefix + " · " + (item.expression || "None"),
      dispatch.bind(null, "range", {fileId: entity.file_id, range: item.range}), "code-button"));
  }
  block.append(el("p", "microcopy", t("detail.expressionHint")));
  parent.append(block);
}

/**
 * 展示调用位置集合。
 * Args:
 *   parent (HTMLElement): 父容器。
 *   title (string): 段标题。
 *   calls (Array<object>): 调用记录。
 *   dispatch (Function): 页面操作入口。
 * Returns:
 *   void: 添加调用列表。
 */
function callList(parent, title, calls, dispatch) {
  const block = section(title);
  if (!calls?.length) block.append(el("p", "muted", t("detail.noCalls")));
  for (const call of calls || []) {
    const row = el("div", "call-row");
    row.append(button(call.expression || call.callee || call.id,
      dispatch.bind(null, "call", call.id), "code-button"));
    const module = call.module || call.owner_module || "";
    const line = call.range?.line || call.line;
    row.append(el("small", "muted", [module, line ? t("line", {line}) : ""].filter(Boolean).join(" · ")));
    if (call.status !== "resolved") row.append(el("span", "tag uncertain", formatMessage(call, call.reason || t("detail.targetUnknown"))));
    block.append(row);
  }
  parent.append(block);
}

/**
 * 渲染函数、类或变量详情。
 * Args:
 *   container (HTMLElement): 详情容器。
 *   entity (object): 完整实体详情。
 *   dispatch (Function): 操作入口。
 *   indexing (boolean): 调用索引是否未完成。
 * Returns:
 *   void: 替换当前详情。
 */
export function renderEntity(container, entity, dispatch, indexing = false) {
  lastDetails = {renderer: renderEntity, container, args: [container, entity, dispatch, indexing]};
  container.replaceChildren();
  container.append(el("div", "eyebrow", enumLabel("kind", entity.kind)));
  container.append(el("h2", "", entity.qualname || entity.name));
  const location = [entity.relative_path, entity.module].filter(Boolean);
  container.append(el("p", "path-label", location.join(" · ") || entity.file_id));
  const actions = el("div", "action-row");
  actions.append(button(t("source.locate"), dispatch.bind(null, "range",
    {fileId: entity.file_id, range: entity.range})));
  if (["function", "method", "lambda"].includes(entity.kind)) {
    actions.append(button(t("detail.openLogic"), dispatch.bind(null, "logic", entity.id), "primary-soft"));
  }
  container.append(actions);
  description(container, entity);
  if (["function", "method", "lambda"].includes(entity.kind)) inputOutput(container, entity, dispatch);

  if (entity.kind === "class") {
    fact(container, t("detail.bases"), (entity.bases || []).join(", ") || t("detail.noBases"));
  }
  if (entity.value || entity.annotation) {
    fact(container, t("detail.annotation"), entity.annotation);
    fact(container, t("detail.assignment"), entity.value);
  }

  const objects = entity.kind === "class" ? entity.members_detail : entity.locals_detail;
  if (objects?.length) {
    const block = section(entity.kind === "class" ? "section.classMembers" : "section.objects");
    for (const object of objects) {
      block.append(entityLink(object, dispatch));
      const row = el("div", "object-actions");
      row.append(button(t("detail.bindingLocation"), dispatch.bind(null, "range",
        {fileId: object.file_id, range: object.name_range || object.range}), "quiet"));
      row.append(button(t("detail.objectType"), dispatch.bind(null, "definition",
        {fileId: object.file_id, offset: object.name_range?.from ?? object.range?.from ?? 0, mode: "type"}), "quiet"));
      block.append(row);
    }
    container.append(block);
  }
  if (indexing) container.append(el("p", "notice", t("detail.callIndexing")));
  callList(container, "section.outgoing", entity.outgoing || [], dispatch);
  callList(container, "section.incoming", entity.incoming || [], dispatch);
}

/**
 * 渲染一次调用及实参和签名对照。
 * Args:
 *   container (HTMLElement): 详情容器。
 *   call (object): 调用记录。
 *   dispatch (Function): 操作入口。
 *   targetEntity (object|null): 单一目标的函数详情。
 * Returns:
 *   void: 显示调用详情。
 */
export function renderCall(container, call, dispatch, targetEntity = null) {
  lastDetails = {renderer: renderCall, container, args: [container, call, dispatch, targetEntity]};
  container.replaceChildren();
  container.append(el("div", "eyebrow", t("call.site")));
  container.append(el("h2", "", call.callee || t("call.title")));
  container.append(el("pre", "signature", call.expression));
  const actions = el("div", "action-row");
  actions.append(button(t("call.locate"), dispatch.bind(null, "range",
    {fileId: call.file_id, range: call.range})));
  if (call.owner_id) actions.append(button(t("call.caller"),
    dispatch.bind(null, "entity", call.owner_id)));
  container.append(actions);

  const inputs = section("section.arguments");
  if (targetEntity?.signature) inputs.append(el("pre", "signature", targetEntity.signature));
  let position = 0;
  for (const arg of call.args || []) {
    const row = el("div", "argument-row");
    position += 1;
    const label = arg.name ? t("call.keyword", {name: arg.name}) : t("call.position", {number: position});
    row.append(el("span", "fact-label", label));
    row.append(button(arg.expression || t("call.emptyExpression"), dispatch.bind(null, "range",
      {fileId: call.file_id, range: arg.range}), "code-button"));
    for (const binding of call.argument_bindings || []) {
      const argument = binding.argument || {};
      if (argument.range?.from === arg.range?.from &&
          argument.range?.to === arg.range?.to) {
        row.append(el("small", "muted", t("call.parameter", {name: binding.parameter_name || binding.parameter?.name || ""})));
      }
    }
    inputs.append(row);
  }
  if (!call.args?.length) inputs.append(el("p", "muted", t("call.noArguments")));
  inputs.append(el("p", "microcopy", t("call.argumentsHint")));
  container.append(inputs);

  const outputs = section("section.receiver");
  outputs.append(el("pre", "code-text", textOf(call.receiver) || t("call.noReceiver")));
  container.append(outputs);
  fact(container, t("call.context"), contextText(call));
  if (call.status !== "resolved" || call.reason) {
    container.append(el("p", "notice", formatMessage(call, call.reason || t("call.unresolved"))));
  }
  const targets = section("section.targets");
  renderTargets(targets, call.targets || [], dispatch);
  container.append(targets);
}

/**
 * 显示图连线包含的调用位置。
 * Args:
 *   container (HTMLElement): 详情容器。
 *   edge (object): 图连线记录。
 *   calls (Array<object>): 完整调用位置。
 *   dispatch (Function): 操作入口。
 * Returns:
 *   void: 创建调用位置列表。
 */
export function renderEdge(container, edge, calls, dispatch) {
  lastDetails = {renderer: renderEdge, container, args: [container, edge, calls, dispatch]};
  container.replaceChildren();
  container.append(el("div", "eyebrow", t("call.relationship")));
  container.append(el("h2", "", calls.length ? t("call.sites") : t("call.moduleRelationship")));
  if (edge.label || edge.kind) container.append(el("p", "muted", edgeLabel(edge)));
  if (calls.length) callList(container, "section.edgeCalls", calls, dispatch);
  else {
    const refs = edge.references || edge.imports || [];
    for (const item of refs) {
      container.append(button(item.expression || item.module || t("detail.referenceLocation"),
        dispatch.bind(null, "range", {fileId: item.file_id, range: item.range}), "code-button"));
    }
    container.append(el("p", "muted", refs.length ? t("call.referenceJump") : t("call.selectEndpoints")));
  }
}

/**
 * 显示调用上下文中的明确工具说明，源码参数保持原样。
 * Args:
 *   call (object): 调用记录及 context_messages。
 * Returns:
 *   string: 已本地化的逻辑上下文或原文。
 */
function contextText(call) {
  if (!call.context_messages?.length) return textOf(call.context) || t("call.seeLogic");
  const values = [];
  for (const context of call.context_messages) values.push(formatMessage(context, context.text || ""));
  return values.filter(Boolean).join(" › ");
}

/**
 * 只刷新工具文字，保留详情的稳定展开状态与滚动。
 * Args:
 *   无。
 * Returns:
 *   void: 重绘已有记录，不发起名称查询或分析。
 */
export function refreshDetails() {
  if (!lastDetails) return;
  const current = lastDetails;
  const expanded = new Set();
  for (const section of current.container.querySelectorAll("details[data-section-key][open]")) {
    expanded.add(section.dataset.sectionKey);
  }
  const scroll = current.container.scrollTop;
  current.renderer(...current.args);
  for (const section of current.container.querySelectorAll("details[data-section-key]")) {
    section.open = expanded.has(section.dataset.sectionKey);
  }
  current.container.scrollTop = scroll;
}

/**
 * 展示外部定义，区别工具说明与原始定义名称。
 * Args:
 *   container (HTMLElement): 详情面板。
 *   target (object): 外部候选。
 * Returns:
 *   void: 更新详情。
 */
export function renderExternal(container, target) {
  lastDetails = {renderer: renderExternal, container, args: [container, target]};
  container.replaceChildren(
    el("div", "eyebrow", t("detail.externalDefinition")),
    el("h2", "", target.qualname || target.name),
    el("p", "path-label", target.path || target.module || ""),
    el("p", "notice", target.preview ? t("detail.externalPreview") :
      formatMessage(target, target.preview_reason || t("detail.externalNoSource"))),
  );
}

/**
 * 展示不可直接跳转的关系节点及工具生成说明。
 * Args:
 *   container (HTMLElement): 详情面板。
 *   node (object): 图节点。
 * Returns:
 *   void: 更新详情，不改变节点原名称。
 */
export function renderBoundary(container, node) {
  lastDetails = {renderer: renderBoundary, container, args: [container, node]};
  container.replaceChildren(
    el("div", "eyebrow", t("graph.externalBoundary")),
    el("h2", "", node.label),
    el("p", "muted", formatMessage(node, node.reason || node.description || t("graph.notNavigable"))),
  );
}

/**
 * 新项目开始时清除上一项目的详情缓存。
 * Args:
 *   无。
 * Returns:
 *   void: 防止语言切换恢复已经离开的项目记录。
 */
export function resetDetails() { lastDetails = null; }
import {t, formatMessage, enumLabel} from "./i18n";
import {el, button} from "./details";

let lastLogic = null;

/**
 * 读取内部结构种类的工具标签。
 * Args:
 *   kind (string): 后端结构种类。
 * Returns:
 *   string: 所选语言的结构标签。
 */
function logicName(kind) {
  const aliases = {asyncfor: "async_for", asyncwith: "async_with", trystar: "try_star", yieldfrom: "yield_from"};
  return enumLabel("logic.kind", aliases[kind] || kind, t("logic.kind.statement"));
}

/**
 * 构造一个语句或结构区块。
 * Args:
 *   node (object): 后端逻辑节点。
 *   depth (number): 当前嵌套深度。
 *   options (object): 展开状态、调用记录和操作回调。
 * Returns:
 *   HTMLElement: 对应结构的可操作区块。
 */
function logicBlock(node, depth, options) {
  const block = el("details", "logic-block kind-" + node.kind);
  block.dataset.logicId = node.id;
  block.open = options.expanded === null ? depth < 2 : options.expanded.includes(node.id);
  const summary = el("summary", "logic-summary");
  summary.append(el("span", "logic-kind", logicName(node.kind)));
  summary.append(el("code", "logic-label", node.label || node.kind));
  if (node.range?.line) summary.append(el("span", "line-number", "L" + node.range.line));
  block.append(summary);
  const body = el("div", "logic-content");
  const actions = el("div", "logic-actions");
  actions.append(button(t("logic.source"), options.dispatch.bind(null, "range",
    {fileId: options.fileId, range: node.range}), "quiet"));
  for (const reference of node.calls || []) {
    const id = typeof reference === "string" ? reference : reference.id;
    const call = options.calls.get(id);
    actions.append(button(call?.expression || call?.callee || t("logic.call"),
      options.dispatch.bind(null, "call", id), "call-chip"));
  }
  body.append(actions);
  if (node.transfer) {
    const transfer = node.transfer;
    const name = logicName(transfer.kind);
    body.append(el("p", "transfer-note", t("logic.transfer", {kind: name})));
    if (transfer.target) {
      body.append(button(t("logic.loopTarget"), options.dispatch.bind(null, "range",
        {fileId: options.fileId, range: transfer.target}), "quiet"));
    }
    for (const finalRange of transfer.finally || []) {
      body.append(button(t("logic.finally"), options.dispatch.bind(null, "range",
        {fileId: options.fileId, range: finalRange}), "quiet"));
    }
  }
  if (node.kind === "try" || node.kind === "try_star") {
    body.append(el("p", "microcopy", t("logic.exceptionHint")));
  }
  for (const child of node.children || []) {
    body.append(logicBlock(child, depth + 1, options));
  }
  for (const branch of node.branches || []) {
    const branchElement = el("div", "logic-branch");
    branchElement.append(el("div", "branch-title", formatMessage(branch, branch.label || t("logic.block"))));
    const nodes = branch.nodes || branch.children || [];
    for (const child of nodes) branchElement.append(logicBlock(child, depth + 1, options));
    if (!nodes.length) branchElement.append(el("p", "muted", t("logic.emptyBlock")));
    body.append(branchElement);
  }
  block.append(body);
  block.addEventListener("toggle", options.onToggle);
  return block;
}

/**
 * 渲染一个函数的内部源码结构。
 * Args:
 *   container (HTMLElement): 流程容器。
 *   entity (object): 当前函数。
 *   nodes (Array<object>): 顺序语句和嵌套结构。
 *   options (object): 事件和展开状态。
 * Returns:
 *   void: 更新内部逻辑。
 */
export function renderLogic(container, entity, nodes, options) {
  lastLogic = {container, entity, nodes, options};
  container.replaceChildren();
  const heading = el("div", "logic-heading");
  heading.append(el("div", "eyebrow", t("logic.heading")));
  heading.append(el("h2", "", entity.qualname || entity.name));
  heading.append(el("p", "muted", t("logic.intro")));
  container.append(heading);
  const calls = new Map();
  for (const call of entity.outgoing || []) calls.set(call.id, call);
  const config = {...options, calls, fileId: entity.file_id};
  for (const node of nodes || []) container.append(logicBlock(node, 0, config));
  if (!nodes?.length) container.append(el("div", "empty-inline", t("logic.noBody")));
}

/**
 * 读取目前所有展开的区块。
 * Args:
 *   container (HTMLElement): 逻辑容器。
 * Returns:
 *   Array<string>: 展开节点标识。
 */
export function expandedNodes(container) {
  const result = [];
  for (const item of container.querySelectorAll("details[data-logic-id][open]")) {
    result.push(item.dataset.logicId);
  }
  return result;
}

/**
 * 展开或收起逻辑区块。
 * Args:
 *   container (HTMLElement): 逻辑容器。
 *   open (boolean): 目标展开状态。
 * Returns:
 *   void: 更新所有区块。
 */
export function setExpanded(container, open) {
  for (const item of container.querySelectorAll("details[data-logic-id]")) item.open = open;
}

/**
 * 切换语言时重用既有结构，保留展开与滚动。
 * Args:
 *   无。
 * Returns:
 *   void: 不发起分析或接口查询。
 */
export function refreshLogic() {
  if (!lastLogic) return;
  const current = lastLogic;
  const scroll = current.container.scrollTop;
  const expanded = expandedNodes(current.container);
  renderLogic(current.container, current.entity, current.nodes, {...current.options, expanded});
  current.container.scrollTop = scroll;
}

/**
 * 新项目开始时清除上一项目的内部结构缓存。
 * Args:
 *   无。
 * Returns:
 *   void: 清除旧结构，不修改新项目数据。
 */
export function resetLogic() { lastLogic = null; }
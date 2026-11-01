import {t, formatMessage, enumLabel, getLanguage, setLanguage, applyTranslations} from "./i18n";
import "./styles.css";
import {request, setAnalysis, definitions} from "./api";
import {createState, navigate, moveHistory} from "./state";
import {RelationGraph} from "./graph";
import {SourceView} from "./source-view";
import {initLayout} from "./layout";
import {renderLogic, expandedNodes, setExpanded, refreshLogic, resetLogic} from "./logic-view";
import {el, button, textOf, renderFile, renderEntity, renderCall, renderEdge, renderDefinition, referenceSummary, refreshDetails, resetDetails, renderExternal, renderBoundary} from "./details";

const state = createState();
const entityCache = new Map();
const callCache = new Map();
let pollTimer, searchTimer;
let navigationToken = 0;
let actionSerial = 0;
let loadedFiles = false;
let referencePending = false;
let lastNotice = {value: "", error: false, sourceKey: "", dismissed: false};
// 仅记住本次分析内用户已关闭的自动状态提示；明确的新操作仍可报告同类错误。
const dismissedStatusNotices = new Set();
let runtimeConfig = null;
let lastSearchData = null;
let activeGraphData = null;
let sourcePosition = {offset: 0, line: 1, column: 0};

// 此处只有固定页面外壳；所有项目内容均用纯文本节点显示。
document.querySelector("#app").innerHTML = [
  '<header class="app-header"><div class="brand"><span class="brand-mark"><svg viewBox="0 0 32 32" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="13" cy="13" r="9"></circle><path d="M20 20l8 8"></path><path d="M10 18V8h4a3.5 3.5 0 0 1 0 7h-4" stroke-width="1.8"></path></svg></span><div><strong>PythonProjectReader</strong><span data-i18n="app.subtitle">本地 Python 项目代码阅读</span></div></div><div class="runtime-badge"><span class="status-dot"></span><span id="runtime" data-i18n="app.offline">本地离线分析</span></div><label class="language-picker"><span data-i18n="app.language">界面语言</span><select id="language-select" data-testid="language-select" data-i18n-aria-label="app.language" aria-label="界面语言"><option value="zh">中文</option><option value="en">English</option></select></label></header>',
  '<section class="project-bar"><form id="project-form" class="project-form"><label class="path-input"><span data-i18n="project.path">项目目录</span><input id="project-path" data-testid="project-path" data-i18n-aria-label="project.path" aria-label="项目目录" data-i18n-placeholder="project.placeholder" placeholder="输入本地 Python 项目根目录" required autocomplete="off"></label><button class="button primary" id="analyze-button" data-testid="analyze-button" type="submit" data-i18n="project.analyze">分析项目</button><button class="button" id="cancel-button" type="button" disabled data-i18n="project.cancel">取消分析</button>',
  '<details class="project-settings"><summary data-i18n="project.settings">分析设置</summary><div class="settings-popover"><label><span data-i18n="project.sourceRoots">源码根目录（每行一个，留空使用项目根）</span><textarea id="source-roots" rows="2"></textarea></label><label><span data-i18n="project.dependencies">依赖源码或类型存根目录（只读，每行一个）</span><textarea id="dependency-paths" rows="2"></textarea></label><label><span data-i18n="project.exclusions">排除目录名（每行一个，留空使用默认范围）</span><textarea id="exclude-dirs" rows="2" placeholder=".git&#10;.venv&#10;__pycache__"></textarea></label><div class="settings-bottom"><label class="checkbox"><input type="checkbox" id="include-stubs"><span data-i18n="project.stubs">包含 .pyi 存根</span></label><label><span data-i18n="project.timeout">单次查询超时（秒）</span><input id="query-timeout" type="number" min="1" value="30"></label></div><p class="microcopy" data-i18n="project.readOnly">只读解析源码，不运行目标项目、不自动安装目标依赖。</p></div></details></form>',
  '<div class="analysis-status"><span id="status-text" data-testid="status-text" data-i18n="project.choose">选择一个项目开始阅读</span><span id="progress-text"></span><button id="diagnostics-button" class="text-button" type="button">诊断 0</button></div><div id="message" class="message" role="status" hidden><span id="message-text"></span><button id="close-message" type="button" class="icon-button message-close" data-i18n-aria-label="action.closeMessage" aria-label="关闭提示" data-i18n-title="action.closeMessage" title="关闭提示">×</button></div></section>',
  '<main class="workspace"><aside id="navigation-panel" class="sidebar"><div class="sidebar-heading"><span class="eyebrow" data-i18n="navigation.project">项目导航</span><span id="file-count" class="count-badge">0</span></div><label class="search-field"><span data-i18n="navigation.search">搜索</span><input id="symbol-search" data-i18n-aria-label="navigation.searchAria" aria-label="搜索文件或符号" data-i18n-placeholder="navigation.searchPlaceholder" placeholder="文件 / 函数 / 类" autocomplete="off"></label><div id="search-results" class="search-results" hidden></div><div id="file-list" data-testid="file-list" class="file-tree"><p class="muted sidebar-empty" data-i18n="navigation.filePending">分析后显示文件与入口。</p></div><div id="entrypoints" class="entrypoints"></div><div class="sidebar-footnote"><span data-i18n="navigation.sourceReadOnly">源码只读 · 无需 LLM</span><br><span data-i18n="navigation.unknownKept">动态关系保留候选与未知状态</span></div></aside>',
  '<div id="sidebar-resizer" class="pane-resizer vertical-resizer" role="separator" tabindex="0" aria-orientation="vertical" aria-controls="navigation-panel" data-i18n-aria-label="layout.resizeNavigation" aria-label="调整项目导航宽度" data-i18n-title="layout.resizeNavigation" title="调整项目导航宽度"></div><section id="reading-area" class="reading-area"><div class="reading-toolbar"><div class="history-controls"><button id="history-back" class="icon-button" data-i18n-aria-label="navigation.back" aria-label="返回" data-i18n-title="navigation.back" title="返回" disabled>←</button><button id="history-forward" class="icon-button" data-i18n-aria-label="navigation.forward" aria-label="前进" data-i18n-title="navigation.forward" title="前进" disabled>→</button></div><div class="view-tabs" role="tablist" data-i18n-aria-label="navigation.mode" aria-label="阅读模式"><button id="show-module" role="tab" aria-selected="true" data-view="module" data-i18n="navigation.module">文件关系</button><button id="show-call" role="tab" aria-selected="false" data-view="call" data-i18n="navigation.call">函数调用</button><button id="show-logic" role="tab" aria-selected="false" data-view="logic" data-i18n="navigation.logic">内部逻辑</button></div><span id="selection-label" class="selection-label">尚未选择</span></div>',
  '<div id="graph-controls" class="graph-controls"><select id="relation-kind" data-i18n-aria-label="graph.relationKind" aria-label="文件关系种类"><option value="module" data-i18n="graph.imports">导入关系</option><option value="reference" data-i18n="graph.references">符号引用</option></select><select id="graph-direction" data-i18n-aria-label="graph.direction" aria-label="关系方向"><option value="both" data-i18n="graph.both">上下游</option><option value="outgoing" data-i18n="graph.outgoing">下游</option><option value="incoming" data-i18n="graph.incoming">上游</option></select><label class="depth-control"><span data-i18n="graph.depth">深度</span> <input id="graph-depth" type="number" min="1" max="12" value="1"></label><label class="checkbox"><input id="internal-only" type="checkbox"><span data-i18n="graph.internalOnly">仅项目内</span></label><button id="index-references" class="button small" hidden data-i18n="graph.indexReferences">建立引用索引</button><button id="focus-selection" class="button small primary-soft" disabled data-i18n="graph.focusSelection">以此为中心</button><button id="clear-focus" class="button small" data-i18n="graph.whole">项目全图</button><div class="zoom-controls"><button id="zoom-out" class="icon-button" data-i18n-aria-label="graph.zoomOut" aria-label="缩小">−</button><button id="zoom-fit" class="button small" data-i18n="graph.fit">适应</button><button id="zoom-in" class="icon-button" data-i18n-aria-label="graph.zoomIn" aria-label="放大">+</button></div></div>',
  '<div id="logic-controls" class="graph-controls" hidden><button id="logic-expand" class="button small" data-i18n="logic.expand">全部展开</button><button id="logic-collapse" class="button small" data-i18n="logic.collapse">全部收起</button><span class="microcopy" data-i18n="logic.hint">条件与表达式保留原文，点击调用继续阅读</span></div><div class="canvas-area"><div id="graph" data-testid="graph"></div><div id="logic-view" class="logic-view" data-testid="logic-view" hidden></div><div id="canvas-empty" class="canvas-empty"><div class="empty-symbol">⌘</div><h1 data-i18n="empty.title">沿着代码关系，理解项目实现</h1><p><span data-i18n="empty.intro">选择本地项目，浏览文件、函数和对象。</span><br><span data-i18n="empty.evidence">每一条关系都能回到源码。</span></p></div></div><div class="graph-footer"><span id="graph-summary" data-i18n="graph.hint">关系图支持拖动、缩放和按需展开</span><button id="load-more" class="text-button" hidden data-i18n="graph.loadMore">继续加载</button></div>',
  '<div id="source-resizer" class="pane-resizer horizontal-resizer" role="separator" tabindex="0" aria-orientation="horizontal" aria-controls="source-panel" data-i18n-aria-label="layout.resizeSource" aria-label="调整源码区域高度" data-i18n-title="layout.resizeSource" title="调整源码区域高度"></div><section id="source-panel" class="source-panel"><div class="source-toolbar"><span class="eyebrow" data-i18n="source.heading">原始源码</span><span id="source-path" data-testid="source-path" class="source-path">选择定义或调用位置查看</span><span id="source-position" class="source-position"></span><button id="definition-binding" class="button small" disabled data-i18n="source.binding">绑定定义</button><button id="definition-type" class="button small" disabled data-i18n="source.type">所属类 / 最终定义</button></div><div id="source-view" data-testid="source-view" class="source-view"></div></section></section>',
  '<div id="details-resizer" class="pane-resizer vertical-resizer" role="separator" tabindex="0" aria-orientation="vertical" aria-controls="details" data-i18n-aria-label="layout.resizeDetails" aria-label="调整阅读详情宽度" data-i18n-title="layout.resizeDetails" title="调整阅读详情宽度"></div><aside id="details" data-testid="details" class="details-panel"><div class="detail-empty"><span class="eyebrow" data-i18n="detail.heading">阅读详情</span><h2 data-i18n="detail.start">从文件开始</h2><p data-i18n="detail.intro">选择文件查看说明和成员，选择函数查看输入输出、对象和调用逻辑。</p></div></aside></main><dialog id="diagnostics-dialog"><div class="dialog-heading"><h2 data-i18n="status.diagnostic">分析诊断</h2><button id="close-diagnostics" class="icon-button" data-i18n-aria-label="action.closeDiagnostics" aria-label="关闭诊断">×</button></div><div id="diagnostics-list"></div></dialog>',
].join("");

const refs = {};
for (const node of document.querySelectorAll("[id]")) refs[node.id] = node;
const graph = new RelationGraph(refs.graph, {node: onGraphNode, edge: onGraphEdge, viewport: onViewport});
const source = new SourceView(refs["source-view"], onSourcePosition);
initLayout(document.querySelector(".workspace"));

/**
 * 根据现有提示状态重绘文本、错误颜色及占位，不创建新的提示事件。
 * Args:
 *   无；读取 lastNotice 中保留的原始内容和关闭状态。
 * Returns:
 *   void: 更新提示文本与整条区域的可见性。
 */
function renderNotice() {
  const {value, error, dismissed} = lastNotice;
  const raw = value && typeof value === "object"
    ? value.raw ?? value.message ?? value.reason ?? String(value) : value || "";
  const text = formatMessage(value, raw);
  refs["message-text"].textContent = text;
  refs.message.hidden = dismissed || !text;
  refs.message.classList.toggle("error", error);
}

/**
 * 发布新的操作提示，或同步当前分析的一条自动状态提示。
 * Args:
 *   value (object|string|Error): 原始原因及可选的工具翻译机器码。
 *   error (boolean): 是否使用错误颜色。
 *   sourceKey (string): 自动状态的稳定来源；为空表示明确的新操作提示。
 * Returns:
 *   void: 展示新提示，或保留用户对同一自动来源的关闭选择。
 */
function message(value, error = false, sourceKey = "") {
  // 新分析在提交前清空提示；下一个分析仍可报告相同原因。
  if (!value) dismissedStatusNotices.clear();
  if (sourceKey && dismissedStatusNotices.has(sourceKey)) return;
  lastNotice = {value, error, sourceKey, dismissed: false};
  renderNotice();
}

/**
 * 收起当前提示并释放其高度，保留分析状态和诊断信息。
 * Args:
 *   无；由提示条的关闭按钮触发。
 * Returns:
 *   void: 隐藏整条提示并记住当前自动来源的关闭状态。
 */
function closeMessage() {
  if (lastNotice.sourceKey) dismissedStatusNotices.add(lastNotice.sourceKey);
  lastNotice.dismissed = true;
  renderNotice();
}
/** 展示异步操作异常。
 * Args: error (Error): 异常。
 * Returns: void: 显示失败原因。 */
function report(error) { message(error, true); }
/** 读取多行配置。
 * Args: id (string): 输入元素标识。
 * Returns: Array<string>: 非空配置项。 */
function lines(id) {
  const result = [];
  for (const value of refs[id].value.split(/\r?\n/)) if (value.trim()) result.push(value.trim());
  return result;
}
/**
 * 保存原生源码状态、图坐标和详情展开位置。
 * Args: 无。
 * Returns: void: 更新阅读快照，不复制源码。
 */
function saveReadingPosition() {
  state.sourceScroll = source.scrollPosition();
  if (source.fileId && source.fileId === state.fileId) {
    state.sourceEditorState = source.view.state;
    state.sourceNativeScroll = source.view.scrollSnapshot();
  }
  if (state.view !== "logic" && activeGraphData === state.graphData) state.graphLayout = graph.snapshot();
  if (state.view === "logic") state.logicExpanded = expandedNodes(refs["logic-view"]);
  state.detailExpanded = [];
  for (const detail of refs.details.querySelectorAll("details[open]")) {
    if (detail.dataset.sectionKey) state.detailExpanded.push(detail.dataset.sectionKey);
  }
}
/** 更新返回前进按钮。
 * Args: 无。
 * Returns: void: 更新可用状态。 */
function historyButtons() {
  refs["history-back"].disabled = state.historyCursor <= 0;
  refs["history-forward"].disabled = state.historyCursor >= state.history.length - 1;
}
/** 读取并缓存实体。
 * Args: id (string): 实体标识。
 * Returns: Promise<object>: 详情数据。 */
async function getEntity(id) {
  if (!entityCache.has(id)) {
    const entity = await request("/api/entities/" + encodeURIComponent(id));
    entityCache.set(id, entity);
    for (const call of [...(entity.outgoing || []), ...(entity.incoming || [])]) callCache.set(call.id, call);
  }
  return entityCache.get(id);
}
/** 读取调用位置。
 * Args: id (string): 调用标识。
 * Returns: Promise<object>: 调用数据。 */
async function getCall(id) {
  if (!callCache.has(id)) callCache.set(id, await request("/api/calls/" + encodeURIComponent(id)));
  return callCache.get(id);
}
/**
 * 显示分析原文，历史恢复采用组件原生状态与滚动快照。
 * Args:
 *   fileId (string): 文件标识。
 *   range (object|null): 原文范围。
 *   token (number): 导航序号。
 *   restore (boolean): 是否恢复历史。
 * Returns:
 *   Promise<void>: 完成原文与位置更新。
 */
async function showSource(fileId, range, token, restore = false) {
  const data = await request("/api/files/" + encodeURIComponent(fileId) + "/source");
  if (token !== navigationToken) return;
  const offset = state.sourceOffset;
  const editorState = state.sourceEditorState;
  const nativeScroll = state.sourceNativeScroll;
  source.show(data, range, restore ? state.sourceScroll : null);
  if (restore && editorState) {
    source.view.setState(editorState);
    source.localize();
    if (nativeScroll) source.view.dispatch({effects: nativeScroll});
  }
  refs["source-path"].textContent = data.path || data.relative_path || fileId;
  refs["definition-binding"].disabled = false;
  refs["definition-type"].disabled = false;
  if (restore) onSourcePosition(source.position(offset));
  else if (range) onSourcePosition(source.position(range.from || 0));
  if (data.stale) message({message_code: "source.stale"});
}
/** 同步阅读模式与筛选。
 * Args: 无。
 * Returns: void: 更新画布与控件。 */
function syncView() {
  for (const tab of document.querySelectorAll("[data-view]")) tab.setAttribute("aria-selected", String(tab.dataset.view === state.view));
  const logic = state.view === "logic";
  refs.graph.hidden = logic;
  refs["logic-view"].hidden = !logic;
  refs["graph-controls"].hidden = logic;
  refs["logic-controls"].hidden = !logic;
  refs["relation-kind"].hidden = state.view !== "module";
  refs["focus-selection"].disabled = !state.analysisId || !state.focusTarget;
  refs["index-references"].hidden = state.view !== "module" || state.relation !== "reference";
  refs["graph-direction"].value = state.direction;
  refs["graph-depth"].value = state.depth;
  refs["internal-only"].checked = state.internalOnly;
  refs["relation-kind"].value = state.relation;
  refs["canvas-empty"].hidden = Boolean(state.analysisId);
  graph.handleResize();
  historyButtons();
}
/**
 * 取得明确选择的图范围，不用阅读选择代替焦点。
 * Args: 无。
 * Returns: object: 关系查询参数。
 */
function graphRange() {
  return {
    kind: state.view === "call" ? "call" : state.relation,
    focus: state.focus, direction: state.direction,
    depth: state.depth, internal_only: state.internalOnly,
  };
}

/**
 * 更新已加载图中的高亮和数量，不重新布局。
 * Args: 无。
 * Returns: void: 更新阅读选择。
 */
function selectInGraph() {
  graph.select(state.focusTarget, state.direction, state.depth);
  refs["focus-selection"].disabled = !state.analysisId || !state.focusTarget;
  refs["load-more"].hidden = !state.graphData?.remaining;
  if (state.graphData) refs["graph-summary"].textContent = graphSummary(state.graphData, state.graphData.kind);
}

/**
 * 加载显式范围或继续当前分页，采用后端累计图。
 * Args: append (boolean): 是否继续下一批成员。
 * Returns: Promise<void>: 更新新的图范围及坐标快照。
 */
async function loadGraph(append = false) {
  if (!state.analysisId || state.view === "logic") return;
  const token = navigationToken;
  const range = graphRange();
  const data = await request("/api/graph", {params: {
    ...range, limit: 150, offset: append ? state.graphNextOffset || 0 : 0,
  }});
  if (token !== navigationToken) return;
  state.graphData = data;
  state.graphScope = JSON.stringify(range);
  state.graphNextOffset = data.next_offset ?? null;
  graph.render(data);
  activeGraphData = data;
  state.graphLayout = graph.snapshot();
  selectInGraph();
}

/**
 * 复用当前图，或用原生坐标恢复历史。
 * Args: restore (boolean): 是否恢复历史布局。
 * Returns: Promise<void>: 仅在范围变化时请求新图。
 */
async function showGraph(restore = false) {
  if (state.view === "logic") return;
  if (!state.graphData || state.graphScope !== JSON.stringify(graphRange())) return loadGraph();
  if (restore || activeGraphData !== state.graphData) {
    graph.render(state.graphData, state.viewport, state.graphLayout);
    activeGraphData = state.graphData;
  }
  selectInGraph();
}

/**
 * 呈现当前阅读选择，图内阅读不重新选择图范围。
 * Args: restore (boolean): 是否恢复历史。
 * Returns: Promise<void>: 更新详情、源码和必要的图显示。
 */
async function renderCurrent(restore = false) {
  const token = ++navigationToken;
  syncView();
  if (!state.fileId && !state.entityId && !state.callId && !state.edgeData) return showGraph(restore);
  if (state.edgeData) {
    state.current = state.edgeData;
    renderEdge(refs.details, state.edgeData, state.edgeCalls, dispatch);
    refs["selection-label"].textContent = state.edgeCalls.length ? t("call.sites") : t("call.moduleRelationship");
    if (state.fileId) await showSource(state.fileId, state.sourceRange, token, restore);
  } else if (state.callId) {
    const call = await getCall(state.callId);
    let target = null;
    if (call.targets?.length === 1 && call.targets[0].entity_id) target = await getEntity(call.targets[0].entity_id);
    if (token !== navigationToken) return;
    state.current = call;
    renderCall(refs.details, call, dispatch, target);
    refs["selection-label"].textContent = call.callee || t("call.sites");
    await showSource(call.file_id, state.sourceRange || call.range, token, restore);
  } else if (state.entityId) {
    const entity = await getEntity(state.entityId);
    if (token !== navigationToken) return;
    state.current = entity;
    renderEntity(refs.details, entity, dispatch, !state.status?.ready);
    refs["selection-label"].textContent = entity.qualname || entity.name;
    if (state.view === "logic") {
      const data = await request("/api/entities/" + encodeURIComponent(entity.id) + "/logic");
      if (token !== navigationToken) return;
      renderLogic(refs["logic-view"], entity, data.nodes || entity.logic || [], {
        expanded: state.logicInitialized ? state.logicExpanded : null, dispatch, onToggle: onLogicToggle,
      });
      refs["graph-summary"].textContent = t("logic.summary");
      refs["load-more"].hidden = true;
    }
    await showSource(entity.file_id, state.sourceRange || entity.range, token, restore);
  } else {
    const file = await request("/api/files/" + encodeURIComponent(state.fileId));
    if (token !== navigationToken) return;
    state.current = file;
    renderFile(refs.details, file, dispatch);
    refs["selection-label"].textContent = file.relative_path || file.module;
    await showSource(file.id, state.sourceRange, token, restore);
  }
  if (token !== navigationToken) return;
  if (restore) {
    for (const detail of refs.details.querySelectorAll("details")) detail.open = state.detailExpanded.includes(detail.dataset.sectionKey);
  }
  await showGraph(restore);
  updateTreeSelection();
  historyButtons();
}
/** 统一分派详情、图和逻辑视图的动作。
 * Args: action (string): 操作；payload (unknown): 参数。
 * Returns: void: 启动实际导航并报告异常。 */
function dispatch(action, payload) { performAction(action, payload, ++actionSerial).catch(report); }
/**
 * 判断定义是否为调用图真实端点。
 * Args: entity (object): 定义详情。
 * Returns: boolean: 是否为模块、类或可调用定义。
 */
function callGraphEntity(entity) {
  return ["module", "class", "function", "method", "lambda"].includes(entity.kind);
}

/**
 * 建立新源码选择，避免复用上一个位置的原生快照。
 * Args: range (object|null): 原文范围。
 * Returns: object: 原文选择状态。
 */
function sourceSelection(range) {
  return {
    sourceRange: range, sourceScroll: 0, sourceOffset: range?.from || 0,
    sourceEditorState: null, sourceNativeScroll: null,
  };
}

/**
 * 建立待加载的新图范围。
 * Args: focus (string): 新文件或实体焦点。
 * Returns: object: 清除旧范围数据和坐标的状态变化。
 */
function newGraphRange(focus) {
  return {
    focus, graphData: null, graphLayout: null, graphScope: "",
    graphNextOffset: null, viewport: null,
  };
}

/**
 * 区分图内阅读与明确的范围切换。
 * Args:
 *   action (string): 文件、定义、调用或源码动作。
 *   payload (unknown): 标识或记录。
 *   serial (number): 当前异步动作序号。
 * Returns:
 *   Promise<void>: 完成阅读导航。
 */
async function performAction(action, payload, serial) {
  if (action === "target") {
    if (payload.entity_id) return performAction("entity", payload.entity_id, serial);
    if (payload.file_id) {
      await performAction("file", payload.file_id, serial);
      if (serial === actionSerial) return performAction("range", {fileId: payload.file_id, range: payload.range}, serial);
      return;
    }
    renderExternal(refs.details, payload);
    state.focusTarget = "";
    refs["focus-selection"].disabled = true;
    if (payload.preview) {
      source.show({id: "", ...payload.preview}, payload.preview.range || payload.range);
      refs["source-path"].textContent = payload.preview.path || payload.path;
      refs["definition-binding"].disabled = true;
      refs["definition-type"].disabled = true;
    }
    return;
  }
  if (action === "definition") {
    if (!payload.fileId) return;
    message({message_code: "detail.querying"});
    const result = await definitions(payload.fileId, payload.offset, payload.mode);
    if (serial !== actionSerial) return;
    renderDefinition(refs.details, result, payload.mode, dispatch);
    message({...result, raw: result.reason || ""});
    return;
  }
  saveReadingPosition();
  if (action === "range") {
    const fileId = payload.fileId || state.fileId;
    const changedFile = fileId !== state.fileId;
    const patch = {fileId, ...sourceSelection(payload.range)};
    if (changedFile) {
      Object.assign(patch, {
        entityId: "", callId: "", edgeData: null, edgeCalls: [],
        focusTarget: fileId, view: state.view === "call" ? "call" : "module",
      });
      if (state.view !== "call" || !graph.has(fileId)) Object.assign(patch, newGraphRange(fileId));
    }
    navigate(state, patch);
    if (changedFile) await renderCurrent();
    else {
      await showSource(state.fileId, state.sourceRange, ++navigationToken);
      historyButtons();
    }
    return;
  }
  if (action === "file" || action === "graph-file") {
    const inCall = state.view === "call";
    const preserve = inCall && (action === "graph-file" || payload === state.fileId);
    navigate(state, {
      fileId: payload, entityId: "", callId: "", edgeData: null, edgeCalls: [],
      view: inCall ? "call" : "module", focusTarget: payload,
      ...sourceSelection(null), detailExpanded: [],
      ...(preserve ? {} : newGraphRange(payload)),
    });
  }
  if (["entity", "graph-entity", "search-entity", "logic"].includes(action)) {
    const entity = await getEntity(payload);
    if (serial !== actionSerial) return;
    const target = callGraphEntity(entity) ? payload : entity.file_id;
    const nextView = action === "logic" || state.view === "logic" ? "logic" : "call";
    const preserve = state.graphData?.kind === "call" &&
      (action === "graph-entity" || (graph.has(target) &&
        (action !== "search-entity" || entity.file_id === state.fileId)));
    navigate(state, {
      entityId: payload, fileId: entity.file_id, callId: "", edgeData: null, edgeCalls: [],
      view: nextView, focusTarget: target,
      ...sourceSelection(entity.range),
      logicExpanded: [], logicInitialized: false, detailExpanded: [],
      ...(preserve ? {} : newGraphRange(target)),
    });
  }
  if (action === "call") {
    const call = await getCall(payload);
    if (serial !== actionSerial) return;
    const preserve = state.view !== "call" || graph.has(call.owner_id);
    navigate(state, {
      callId: payload, edgeData: null, edgeCalls: [],
      fileId: call.file_id, focusTarget: call.owner_id,
      ...sourceSelection(call.range),
      ...(preserve ? {} : newGraphRange(call.owner_id)),
    });
  }
  await renderCurrent();
}
/** 保存图视角。
 * Args: viewport (object): 缩放和平移。
 * Returns: void: 更新阅读位置。 */
function onViewport(viewport) { state.viewport = viewport; }
/**
 * 响应图内定义行或容器标题，仅联动阅读内容。
 * Args: node (object): 原始事实或容器。
 * Returns: void: 保持图范围、坐标和视角。
 */
function onGraphNode(node) {
  if (node.entity_id) dispatch("graph-entity", node.entity_id);
  else if (node.file_id) dispatch("graph-file", node.file_id);
  else if (node.call_id) dispatch("call", node.call_id);
  else if (node.target) dispatch("target", node.target);
  else {
    state.focusTarget = "";
    refs["focus-selection"].disabled = true;
    renderBoundary(refs.details, node);
  }
}

/**
 * 读取图边的真实调用或引用位置，保留当前图范围。
 * Args:
 *   edge (object): 真实关系边。
 *   serial (number): 当前异步动作序号。
 * Returns:
 *   Promise<void>: 显示详情及首个位置的原文。
 */
async function showEdge(edge, serial) {
  const calls = [];
  for (const id of edge.call_ids || []) calls.push(await getCall(id));
  let selected = edge;
  if (!calls.length && ((edge.import_ids?.length || 0) + (edge.reference_ids?.length || 0))) {
    const file = await request("/api/files/" + encodeURIComponent(edge.source));
    const imports = [], references = [];
    for (const item of file.imports || []) {
      if (edge.import_ids?.includes(item.id)) imports.push({...item, file_id: file.id});
    }
    for (const item of file.references || []) {
      if (edge.reference_ids?.includes(item.id)) references.push(item);
    }
    selected = {...edge, imports, references: references.length ? references : undefined};
  }
  if (serial !== actionSerial) return;
  saveReadingPosition();
  const location = calls[0] || selected.references?.[0] || selected.imports?.[0];
  navigate(state, {
    edgeData: selected, edgeCalls: calls, entityId: "", callId: "",
    fileId: location?.file_id || state.fileId,
    focusTarget: calls[0]?.owner_id || edge.source,
    ...sourceSelection(location?.range || state.sourceRange),
    detailExpanded: [],
  });
  await renderCurrent();
}

/**
 * 响应图连线点击。
 * Args: edge (object): 保留原始端点和位置标识的边。
 * Returns: void: 启动阅读，不重新布局。
 */
function onGraphEdge(edge) { showEdge(edge, ++actionSerial).catch(report); }

/** 保存源码点击位置。
 * Args: position (object): 偏移与行列。
 * Returns: void: 更新名称查询位置。 */
function onSourcePosition(position) {
  sourcePosition = position; state.sourceOffset = position.offset;
  refs["source-position"].textContent = "L" + position.line + " : " + (position.column + 1);
}
/** 保存逻辑展开状态。
 * Args: 无。
 * Returns: void: 更新展开集合。 */
function onLogicToggle() { state.logicExpanded = expandedNodes(refs["logic-view"]); state.logicInitialized = true; }
/** 高亮当前文件。
 * Args: 无。
 * Returns: void: 更新树节点样式。 */
function updateTreeSelection() {
  for (const item of refs["file-list"].querySelectorAll("[data-file-id]")) item.classList.toggle("selected", item.dataset.fileId === state.fileId);
}

/** 显示目录层次和入口候选。
 * Args: data (object): 文件与入口列表。
 * Returns: void: 更新左侧导航。 */
function renderFiles(data) {
  state.files = data.files || []; state.entrypoints = data.entrypoints || [];
  refs["file-list"].replaceChildren(); refs["file-count"].textContent = state.files.length;
  const folders = new Map([["", refs["file-list"]]]);
  for (const file of state.files) {
    const path = (file.relative_path || file.path).replaceAll("\\", "/");
    const parts = path.split("/");
    let parent = refs["file-list"], prefix = "";
    for (let index = 0; index < parts.length - 1; index += 1) {
      prefix = prefix ? prefix + "/" + parts[index] : parts[index];
      if (!folders.has(prefix)) {
        const folder = el("details", "folder");
        folder.open = true; folder.append(el("summary", "", parts[index]));
        const children = el("div", "folder-children");
        folder.append(children); parent.append(folder); folders.set(prefix, children);
      }
      parent = folders.get(prefix);
    }
    const row = button(parts[parts.length - 1], dispatch.bind(null, "file", file.id), "file-row");
    row.dataset.fileId = file.id; row.title = path;
    if (!["ok", "parsed", "success"].includes(file.parse_status)) row.classList.add("file-diagnostic");
    parent.append(row);
  }
  if (!state.files.length) refs["file-list"].append(el("p", "muted sidebar-empty", t("project.noFiles")));
  renderEntryPoints();
  updateTreeSelection();
}
/**
 * 展示分析阶段与诊断数量，并按需发布自动状态提示。
 * Args:
 *   status (object): 后端实际分析状态。
 *   settleReference (boolean): 是否处理引用索引完成后的阅读刷新。
 *   publishNotices (boolean): 是否发布状态提示；语言重绘时只更新已有提示。
 * Returns:
 *   void: 更新状态栏与诊断入口，按原流程处理引用进度。
 */
function renderStatus(status, settleReference = true, publishNotices = true) {
  const stages = {scanning: t("status.scanning"), extracting: t("status.extracting"), indexing: t("status.indexing"),
    ready: t("status.ready"), failed: t("status.failed"), cancelled: t("status.cancelled"), idle: t("status.idle")};
  refs["status-text"].textContent = stages[status.stage] || status.stage || t("status.analyzing");
  refs["progress-text"].textContent = t("status.progress", {
    files: status.files_processed ?? status.files_total ?? 0, filesTotal: status.files_total || 0,
    calls: status.calls_processed || 0, callsTotal: status.calls_total || 0,
  });
  refs["diagnostics-button"].textContent = t("status.diagnostics", {count: status.diagnostics?.length || 0});
  const working = !["ready", "failed", "cancelled"].includes(status.stage);
  refs["cancel-button"].disabled = !working;
  refs["analyze-button"].textContent = state.analysisId ? t("project.reanalyze") : t("project.analyze");
  refs["status-text"].classList.toggle("working", working);
  if (publishNotices) {
    if (status.stage === "failed") {
      // 失败原因优先于源码过期；关闭失败提示后不回退成同一状态里的低优先提示。
      const key = JSON.stringify([state.analysisId, "failed", status.message_code || "",
        status.params || {}, status.error || status.message || ""]);
      message({...status, raw: status.error || status.message || t("status.failedHint")}, true, key);
    } else if (status.stale) {
      message({message_code: "source.projectStale"}, false,
        JSON.stringify([state.analysisId, "stale"]));
    }
  }
  const reference = status.reference_status;
  const referenceStage = typeof reference === "object" ? reference?.stage : reference;
  if (settleReference && referencePending && ["ready", "complete", "completed", "indexed", "failed", "error"].includes(referenceStage)) {
    referencePending = false; refs["index-references"].disabled = false;
    refs["index-references"].textContent = t("graph.reindexReferences");
    saveReadingPosition();
    if (state.view === "module" && state.relation === "reference") Object.assign(state, newGraphRange(state.focus));
    renderCurrent(true).catch(report);
  } else if (referencePending) refs["index-references"].textContent = t("graph.indexingReferences");
}
/** 轮询进度，结构就绪即可浏览，调用索引完成后刷新。
 * Args: 无。
 * Returns: Promise<void>: 完成一次状态刷新。 */
async function pollAnalysis() {
  if (!state.analysisId) return;
  const id = state.analysisId;
  try {
    const status = await request("/api/analyses/" + encodeURIComponent(id), {analysis: false});
    if (id !== state.analysisId) return;
    const wasReady = state.status?.ready;
    state.status = status; renderStatus(status);
    if (!loadedFiles && (status.structure_ready || status.ready)) {
      renderFiles(await request("/api/files"));
      loadedFiles = true; syncView(); await loadGraph();
      if (state.historyCursor < 0) navigate(state, {}, true);
    }
    if (status.ready && !wasReady) {
      saveReadingPosition();
      entityCache.clear(); callCache.clear(); renderFiles(await request("/api/files"));
      Object.assign(state, newGraphRange(state.focus));
      if (state.fileId || state.entityId || state.callId || state.edgeData) await renderCurrent(true);
      else await showGraph();
    }
    if (!["ready", "failed", "cancelled"].includes(status.stage) || referencePending) pollTimer = setTimeout(pollAnalysis, 650);
  } catch (error) { report(error); }
}
/** 根据表单开始新的分析。
 * Args: event (SubmitEvent): 表单提交。
 * Returns: Promise<void>: 完成任务启动。 */
async function startAnalysis(event) {
  event.preventDefault(); clearTimeout(pollTimer); message(""); actionSerial += 1;
  refs["analyze-button"].disabled = true;
  try {
    const root = refs["project-path"].value.trim();
    const body = {root, source_roots: lines("source-roots"), dependency_paths: lines("dependency-paths"),
      include_stubs: refs["include-stubs"].checked, query_timeout: Number(refs["query-timeout"].value) || 30};
    const excluded = lines("exclude-dirs");
    if (excluded.length) body.exclude_dirs = excluded;
    const result = await request("/api/analyses", {method: "POST", body, analysis: false});
    Object.assign(state, createState(), {analysisId: result.id || result.analysis_id, root});
    setAnalysis(state.analysisId);
    entityCache.clear(); callCache.clear(); lastSearchData = null; refs["search-results"].hidden = true; loadedFiles = false; referencePending = false; navigationToken += 1;
    refs["file-list"].replaceChildren(el("p", "muted sidebar-empty", t("project.waiting")));
    resetDetails();
    resetLogic();
    const waiting = el("div", "detail-empty", t("project.structureReady"));
    waiting.dataset.i18n = "project.structureReady";
    refs.details.replaceChildren(waiting);
    source.show({id: "", source: "", path: ""}); graph.render({nodes: [], edges: [], containers: []});
    activeGraphData = null;
    refs["source-path"].textContent = t("source.waiting");
    refs["definition-binding"].disabled = true; refs["definition-type"].disabled = true;
    syncView(); await pollAnalysis();
  } finally { refs["analyze-button"].disabled = false; }
}
/** 响应分析提交。
 * Args: event (SubmitEvent): 提交事件。
 * Returns: void: 启动异步分析。 */
function onAnalyze(event) { startAnalysis(event).catch(report); }
/** 取消本工具分析，不触及目标项目进程。
 * Args: 无。
 * Returns: Promise<void>: 更新取消状态。 */
async function cancelAnalysis() {
  if (!state.analysisId) return;
  await request("/api/analyses/" + encodeURIComponent(state.analysisId), {method: "DELETE", analysis: false});
  clearTimeout(pollTimer); await pollAnalysis();
}
/**
 * 切换模式，内部逻辑返回现有调用图时保留原范围。
 * Args: event (MouseEvent): 模式选择事件。
 * Returns: void: 显示所选阅读模式。
 */
function changeView(event) {
  actionSerial += 1;
  const mode = event.currentTarget.dataset.view;
  if (mode === "logic" && !state.entityId) return message({message_code: "logic.chooseFunction"});
  saveReadingPosition();
  const kind = mode === "call" ? "call" : state.relation;
  const preserve = mode === "logic" || state.graphData?.kind === kind;
  const focus = mode === "call" ? state.focusTarget || state.fileId : state.fileId;
  navigate(state, {
    view: mode, callId: "", edgeData: null, edgeCalls: [],
    ...(preserve ? {} : newGraphRange(focus)),
  });
  renderCurrent(true).catch(report);
}

/**
 * 明确改变方向、深度和过滤范围。
 * Args: 无。
 * Returns: void: 保存原图并加载新范围。
 */
function changeGraphOptions() {
  saveReadingPosition();
  actionSerial += 1;
  navigate(state, {
    direction: refs["graph-direction"].value,
    depth: Math.max(1, Math.min(12, Number(refs["graph-depth"].value) || 1)),
    internalOnly: refs["internal-only"].checked,
    relation: refs["relation-kind"].value,
    ...newGraphRange(state.focus),
  });
  renderCurrent(true).catch(report);
}
/** 恢复导航历史。
 * Args: delta (number): -1 返回、1 前进。
 * Returns: void: 恢复阅读内容。 */
function historyStep(delta) {
  actionSerial += 1;
  saveReadingPosition();
  if (moveHistory(state, delta)) renderCurrent(true).catch(report);
}
/** 为当前文件或项目请求建立引用索引。
 * Args: 无。
 * Returns: Promise<void>: 启动引用索引。 */
async function indexReferences() {
  if (!state.analysisId) return;
  referencePending = true; refs["index-references"].disabled = true;
  refs["index-references"].textContent = t("graph.indexingReferences");
  try {
    await request("/api/references/index", {method: "POST", body: {analysis_id: state.analysisId, file_id: state.fileId || null}});
    clearTimeout(pollTimer); await pollAnalysis();
  } catch (error) { referencePending = false; refs["index-references"].disabled = false; throw error; }
}
/** 查询文件和符号。
 * Args: 无。
 * Returns: Promise<void>: 更新搜索结果。 */
async function runSearch() {
  const query = refs["symbol-search"].value.trim();
  if (!query || !state.analysisId) { refs["search-results"].hidden = true; return; }
  const data = await request("/api/search", {params: {q: query}});
  if (query !== refs["symbol-search"].value.trim()) return;
  lastSearchData = data;
  renderSearchResults(data);
}
/** 延迟合并搜索输入。
 * Args: 无。
 * Returns: void: 安排搜索。 */
function onSearchInput() { clearTimeout(searchTimer); searchTimer = setTimeout(searchSafely, 180); }
/** 安全执行搜索。
 * Args: 无。
 * Returns: void: 展示搜索异常。 */
function searchSafely() { runSearch().catch(report); }
/** 打开文件与分析诊断。
 * Args: 无。
 * Returns: void: 显示原始错误原因。 */
function openDiagnostics() {
  renderDiagnostics();
  refs["diagnostics-dialog"].showModal();
}
/** 查询当前点击名称。
 * Args: mode (string): 绑定或类型查询。
 * Returns: void: 发起查询。 */
function querySourceDefinition(mode) { dispatch("definition", {fileId: source.fileId, offset: sourcePosition.offset, mode}); }
/**
 * 明确以所选文件或定义重选图范围。
 * Args: 无。
 * Returns: void: 保存原图并加载新的中心范围。
 */
function focusSelection() {
  if (!state.focusTarget || !state.analysisId) return;
  saveReadingPosition();
  actionSerial += 1;
  navigate(state, newGraphRange(state.focusTarget));
  renderCurrent(true).catch(report);
}

/**
 * 明确切换到项目全图。
 * Args: 无。
 * Returns: void: 保存原范围并显示全图。
 */
function showWholeGraph() {
  saveReadingPosition();
  actionSerial += 1;
  navigate(state, newGraphRange(""));
  renderCurrent(true).catch(report);
}

/**
 * 继续加载当前范围的成员并保留上一批历史。
 * Args: 无。
 * Returns: void: 加载后端累计图。
 */
function loadMore() {
  saveReadingPosition();
  actionSerial += 1;
  const next = state.graphNextOffset;
  navigate(state, {
    ...newGraphRange(state.focus), graphNextOffset: next,
  });
  loadGraph(true).catch(report);
}
/** 安全取消分析。
 * Args: 无。
 * Returns: void: 展示取消错误。 */
function cancelSafely() { cancelAnalysis().catch(report); }
/** 安全建立引用索引。
 * Args: 无。
 * Returns: void: 展示索引错误。 */
function indexSafely() { indexReferences().catch(report); }
/** 关闭诊断。
 * Args: 无。
 * Returns: void: 关闭窗口。 */
function closeDiagnostics() { refs["diagnostics-dialog"].close(); }
/** 读取工具环境和默认路径。
 * Args: 无。
 * Returns: Promise<void>: 初始化工具说明。 */
async function initialize() {
  const config = await request("/api/config", {analysis: false});
  if (config.default_root) refs["project-path"].value = config.default_root;
  runtimeConfig = config;
  refs.runtime.textContent = t("app.runtime", {version: config.python_version || "3"});
  if (config.supported) refs.runtime.title = formatMessage(config, textOf(config.supported));
}

// 所有入口均连接真实接口；后台分析期间仍可浏览已发布的结构。
refs["project-form"].addEventListener("submit", onAnalyze);
refs["cancel-button"].addEventListener("click", cancelSafely);
for (const tab of document.querySelectorAll("[data-view]")) tab.addEventListener("click", changeView);
for (const id of ["graph-direction", "graph-depth", "internal-only", "relation-kind"]) refs[id].addEventListener("change", changeGraphOptions);
refs["history-back"].addEventListener("click", historyStep.bind(null, -1));
refs["history-forward"].addEventListener("click", historyStep.bind(null, 1));
refs["zoom-in"].addEventListener("click", graph.zoom.bind(graph, "in"));
refs["zoom-out"].addEventListener("click", graph.zoom.bind(graph, "out"));
refs["zoom-fit"].addEventListener("click", graph.zoom.bind(graph, "fit"));
refs["focus-selection"].addEventListener("click", focusSelection);
refs["clear-focus"].addEventListener("click", showWholeGraph);
refs["load-more"].addEventListener("click", loadMore);
refs["logic-expand"].addEventListener("click", setExpanded.bind(null, refs["logic-view"], true));
refs["logic-collapse"].addEventListener("click", setExpanded.bind(null, refs["logic-view"], false));
refs["index-references"].addEventListener("click", indexSafely);
refs["symbol-search"].addEventListener("input", onSearchInput);
refs["diagnostics-button"].addEventListener("click", openDiagnostics);
refs["close-diagnostics"].addEventListener("click", closeDiagnostics);
refs["definition-binding"].addEventListener("click", querySourceDefinition.bind(null, "binding"));
refs["definition-type"].addEventListener("click", querySourceDefinition.bind(null, "type"));
initialize().catch(report);

/**
 * 刷新入口候选的工具说明，路径和符号保持原文。
 * Args:
 *   无。
 * Returns:
 *   void: 更新入口导航，不改变文件树展开。
 */
function renderEntryPoints() {
  refs.entrypoints.replaceChildren();
  if (state.entrypoints.length) refs.entrypoints.append(el("div", "eyebrow", t("navigation.entrypoints")));
  for (const entry of state.entrypoints) {
    const action = entry.entity_id ? "entity" : "file";
    const id = entry.entity_id || entry.file_id;
    if (id) {
      refs.entrypoints.append(button(entry.label || entry.name || formatMessage(entry, entry.reason || t("navigation.entry")),
        dispatch.bind(null, action, id), "entry-link"));
    } else {
      refs.entrypoints.append(el("p", "muted", (entry.label || entry.name || t("navigation.entrypoints")) +
        " · " + (formatMessage(entry, entry.reason || t("navigation.unresolvedEntry")))));
    }
  }

}

/**
 * 格式化图摘要，仅处理工具计数和范围。
 * Args:
 *   data (object): 已获取的关系图。
 *   kind (string): 文件、调用或引用关系种类。
 * Returns:
 *   string: 所选语言的图摘要。
 */
function graphSummary(data, kind) {
  if (!data.nodes?.length) {
    return kind === "reference" ? referenceSummary(data.reference_index || {}, state.fileId) : t("graph.empty");
  }
  let result = t("graph.summary", {nodes: data.nodes.length, edges: data.edges?.length || 0});
  if (data.remaining) result += t("graph.remaining", {count: data.remaining});
  if (kind === "reference") result += " · " + referenceSummary(data.reference_index || {}, state.fileId);
  if (kind === "call" && data.hidden_edges) result += " · " + t("graph.hiddenEdges", {count: data.hidden_edges});
  if (kind === "call") result += " · " + t("graph.callStructureHint");
  return result;
}

/**
 * 重新显示既有搜索结果，不重新执行查询。
 * Args:
 *   data (object): 已查询的文件和符号。
 * Returns:
 *   void: 更新工具种类标签，名称仍为原文。
 */
function renderSearchResults(data) {
  const container = refs["search-results"];
  const scroll = container.scrollTop;
  container.replaceChildren();
  for (const item of data.results || data.items || []) {
    const isFile = item.type === "file" || (!item.entity_id && item.relative_path);
    const id = isFile ? item.file_id || item.id : item.entity_id || item.id;
    const row = button(item.label || item.qualname || item.name || item.relative_path,
      dispatch.bind(null, isFile ? "file" : "search-entity", id), "search-result");
    row.append(el("small", "muted", item.module || enumLabel("kind", item.kind, t("kind.file"))));
    container.append(row);
  }
  if (!container.childElementCount) container.append(el("p", "muted", t("search.none")));
  if (data.remaining) container.append(el("p", "microcopy", t("search.remaining", {count: data.remaining})));
  container.hidden = false;
  container.scrollTop = scroll;
}

/**
 * 刷新当前诊断的工具说明，异常证据和路径保留原文。
 * Args:
 *   无。
 * Returns:
 *   void: 更新诊断列表而不打开或关闭窗口。
 */
function renderDiagnostics() {
  const container = refs["diagnostics-list"];
  const scroll = container.scrollTop;
  container.replaceChildren();
  for (const item of state.status?.diagnostics || []) {
    const row = el("div", "diagnostic-item");
    row.append(
      el("strong", "", item.path || item.file || item.file_id || item.kind || t("status.diagnostic")),
      el("p", "", formatMessage(item, item.message || item.reason || textOf(item))),
    );
    if (item.line) row.append(el("small", "muted", t("line", {line: item.line})));
    container.append(row);
  }
  if (!container.childElementCount) container.append(el("p", "muted", t("status.noDiagnostics")));
  container.scrollTop = scroll;
}

/**
 * 切换工具界面语言，不改变分析、历史、原文或图布局。
 * Args:
 *   event (Event): 语言选择事件。
 * Returns:
 *   void: 仅更新已知工具文字。
 */
function changeLanguage(event) {
  saveReadingPosition();
  setLanguage(event.currentTarget.value);
  applyTranslations();
  refreshDetails();
  if (state.view === "logic") refreshLogic();
  graph.localize();
  source.localize();
  if (state.status) renderStatus(state.status, false, false);
  else refs["diagnostics-button"].textContent = t("status.diagnostics", {count: 0});
  if (runtimeConfig) {
    refs.runtime.textContent = t("app.runtime", {version: runtimeConfig.python_version || "3"});
    refs.runtime.title = formatMessage(runtimeConfig, textOf(runtimeConfig.supported));
  }
  if (!state.files.length && state.analysisId) {
    refs["file-list"].replaceChildren(el("p", "muted sidebar-empty",
      loadedFiles ? t("project.noFiles") : t("project.waiting")));
  }
  renderEntryPoints();
  if (lastSearchData && !refs["search-results"].hidden) renderSearchResults(lastSearchData);
  if (refs["diagnostics-dialog"].open) renderDiagnostics();
  if (!state.current) refs["selection-label"].textContent = t("navigation.none");
  if (!source.originalText) refs["source-path"].textContent = state.analysisId ? t("source.waiting") : t("source.choose");
  if (state.view === "logic" && state.entityId) refs["graph-summary"].textContent = t("logic.summary");
  else if (state.graphData) refs["graph-summary"].textContent = graphSummary(state.graphData, state.view === "call" ? "call" : state.relation);
  renderNotice();
}

refs["close-message"].addEventListener("click", closeMessage);
refs["language-select"].addEventListener("change", changeLanguage);
setLanguage("zh");
applyTranslations();
refs["language-select"].value = getLanguage();
refs["diagnostics-button"].textContent = t("status.diagnostics", {count: 0});
refs["selection-label"].textContent = t("navigation.none");
refs["source-path"].textContent = t("source.choose");


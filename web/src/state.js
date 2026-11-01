/** 阅读状态只在当前页面保存，图数据与编辑器快照按原生引用共享。 */

/**
 * 创建页面唯一的阅读状态。
 * Args:
 *   无。
 * Returns:
 *   object: 项目、图范围、选择、源码位置及历史。
 */
export function createState() {
  return {
    analysisId: "", root: "", files: [], entrypoints: [],
    fileId: "", entityId: "", callId: "", edgeData: null, edgeCalls: [],
    view: "module", relation: "module", focus: "", focusTarget: "",
    direction: "both", depth: 1, internalOnly: false,
    graphNextOffset: null, graphData: null, graphLayout: null,
    graphScope: "", viewport: null,
    sourceRange: null, sourceOffset: 0, sourceScroll: 0,
    sourceEditorState: null, sourceNativeScroll: null,
    logicExpanded: [], logicInitialized: false, detailExpanded: [],
    history: [], historyCursor: -1, current: null, status: null,
  };
}

/**
 * 取得可恢复的阅读状态，不复制项目源码或不可变图数据。
 * Args:
 *   state (object): 当前状态或已保存的阅读位置。
 * Returns:
 *   object: 坐标和展开状态的副本，以及原生数据引用。
 */
export function capture(state) {
  return {
    fileId: state.fileId, entityId: state.entityId, callId: state.callId,
    edgeData: state.edgeData, edgeCalls: state.edgeCalls,
    view: state.view, relation: state.relation,
    focus: state.focus, focusTarget: state.focusTarget,
    direction: state.direction, depth: state.depth,
    internalOnly: state.internalOnly,
    graphData: state.graphData, graphNextOffset: state.graphNextOffset,
    graphScope: state.graphScope,
    graphLayout: state.graphLayout ? structuredClone(state.graphLayout) : null,
    viewport: state.viewport ? structuredClone(state.viewport) : null,
    sourceRange: state.sourceRange ? {...state.sourceRange} : null,
    sourceOffset: state.sourceOffset, sourceScroll: state.sourceScroll,
    sourceEditorState: state.sourceEditorState,
    sourceNativeScroll: state.sourceNativeScroll,
    logicExpanded: [...state.logicExpanded],
    logicInitialized: state.logicInitialized,
    detailExpanded: [...state.detailExpanded],
  };
}

/**
 * 保存当前阅读位置并进入下一项。
 * Args:
 *   state (object): 页面状态。
 *   patch (object): 本次选择或范围变化。
 *   replace (boolean): 是否替换当前历史项。
 * Returns:
 *   void: 更新状态和导航历史。
 */
export function navigate(state, patch, replace = false) {
  if (state.historyCursor >= 0) {
    state.history[state.historyCursor] = capture(state);
  }
  Object.assign(state, patch);
  const next = capture(state);
  if (replace && state.historyCursor >= 0) {
    state.history[state.historyCursor] = next;
  } else {
    state.history = state.history.slice(0, state.historyCursor + 1);
    state.history.push(next);
    state.historyCursor = state.history.length - 1;
  }
}

/**
 * 恢复历史中的图、坐标、视角及原生源码阅读快照。
 * Args:
 *   state (object): 页面状态。
 *   delta (number): -1 返回，1 前进。
 * Returns:
 *   boolean: 是否已恢复目标历史项。
 */
export function moveHistory(state, delta) {
  const next = state.historyCursor + delta;
  if (next < 0 || next >= state.history.length) return false;
  state.history[state.historyCursor] = capture(state);
  state.historyCursor = next;
  Object.assign(state, capture(state.history[next]));
  return true;
}

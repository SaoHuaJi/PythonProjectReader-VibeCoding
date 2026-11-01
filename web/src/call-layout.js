import dagre from "dagre";

// 这些尺寸只控制调用图的行与容器，不随语言改变，历史坐标因此可以直接恢复。
const ROW_WIDTH = 300;
const ROW_HEIGHT = 28;
const ROW_GAP = 8;
const CONTAINER_PADDING = 14;
const FILE_HEADER = 80;
const SCOPE_HEADER = 40;

/**
 * 按真实源码位置排列同一容器中的块，自身定义行始终位于首行。
 * Args:
 *   left (object): 左侧待比较的布局块。
 *   right (object): 右侧待比较的布局块。
 * Returns:
 *   number: 排序先后关系。
 */
function compareBlocks(left, right) {
  if (left.ownerFirst !== right.ownerFirst) return left.ownerFirst ? -1 : 1;
  const leftOffset = left.record.range?.from ?? Number.MAX_SAFE_INTEGER;
  const rightOffset = right.record.range?.from ?? Number.MAX_SAFE_INTEGER;
  if (leftOffset !== rightOffset) return leftOffset - rightOffset;
  return left.record.id < right.record.id ? -1 : left.record.id > right.record.id ? 1 : 0;
}

/**
 * 为外层文件和边界块提供稳定的初始排列顺序。
 * Args:
 *   left (object): 左侧文件或边界块。
 *   right (object): 右侧文件或边界块。
 * Returns:
 *   number: 路径、模块或原名的排序结果。
 */
function compareRoots(left, right) {
  const first = left.record.relative_path || left.record.module || left.record.label || left.record.id;
  const second = right.record.relative_path || right.record.module || right.record.label || right.record.id;
  return first < second ? -1 : first > second ? 1 : compareBlocks(left, right);
}

/**
 * 从内向外计算成员行及作用域容器所需的固定尺寸。
 * Args:
 *   block (object): 带有真实子块的布局块。
 * Returns:
 *   void: 在布局块上记录宽高，不修改后端记录。
 */
function measureBlock(block) {
  if (!block.container) {
    block.width = ROW_WIDTH;
    block.height = ROW_HEIGHT;
    return;
  }
  block.children.sort(compareBlocks);
  let bodyHeight = 0;
  let bodyWidth = ROW_WIDTH;
  for (const child of block.children) {
    measureBlock(child);
    bodyHeight += child.height;
    bodyWidth = Math.max(bodyWidth, child.width);
  }
  bodyHeight += Math.max(0, block.children.length - 1) * ROW_GAP;
  block.header = block.record.kind === "file_container" ? FILE_HEADER : SCOPE_HEADER;
  const minimumWidth = block.record.kind === "file_container" ? 380 : 328;
  block.width = Math.max(minimumWidth, bodyWidth + CONTAINER_PADDING * 2);
  block.height = block.header + CONTAINER_PADDING * 2 + Math.max(ROW_HEIGHT, bodyHeight);
}

/**
 * 将块内的纵向行位置平移到外层文件的实际位置。
 * Args:
 *   block (object): 当前文件、作用域或事实行。
 *   left (number): 当前块左边界的模型坐标。
 *   top (number): 当前块上边界的模型坐标。
 *   width (number): 父块分配的完整宽度。
 *   rootId (string): 最外层文件或边界块的标识。
 *   result (object): 收集位置、尺寸及最外层归属的结果。
 * Returns:
 *   void: 只写入新生成的布局结果。
 */
function placeBlock(block, left, top, width, rootId, result) {
  result.roots[block.record.id] = rootId;
  result.dimensions[block.record.id] = {
    width: block.container ? width - CONTAINER_PADDING * 2 : width,
    height: block.container ? block.height - CONTAINER_PADDING * 2 : ROW_HEIGHT,
    labelWidth: Math.max(100, width - CONTAINER_PADDING * 4),
  };
  if (!block.container || !block.children.length) {
    result.positions[block.record.id] = {x: left + width / 2, y: top + block.height / 2};
  }
  if (block.container) {
    let childTop = top + CONTAINER_PADDING + block.header;
    for (const child of block.children) {
      placeBlock(child, left + CONTAINER_PADDING, childTop,
        width - CONTAINER_PADDING * 2, rootId, result);
      childTop += child.height + ROW_GAP;
    }
  }
}

/**
 * 收集事实节点所在的最外层文件或边界容器。
 * Args:
 *   block (object): 当前布局块。
 *   rootId (string): 最外层块标识。
 *   roots (Map): 节点标识到最外层块标识的映射。
 * Returns:
 *   void: 填充外层布局使用的归属信息。
 */
function collectRoots(block, rootId, roots) {
  roots.set(block.record.id, rootId);
  for (const child of block.children) collectRoots(child, rootId, roots);
}

/**
 * 计算文件之间的分层位置，文件内部保持源码顺序和紧凑纵向行。
 * Args:
 *   data (object): 包含事实节点、独立容器与原始调用边的图数据。
 *   snapshot (object|null): 历史保存的原生节点位置。
 * Returns:
 *   object: 新建的 positions、dimensions 和 roots，均不修改原图数据。
 */
export function createCallLayout(data, snapshot = null) {
  const blocks = new Map();
  const rootBlocks = [];
  for (const record of data.containers || []) {
    blocks.set(record.id, {record, container: true, children: [], ownerFirst: false});
  }
  for (const record of data.nodes || []) {
    blocks.set(record.id, {record, container: false, children: [], ownerFirst: false});
  }
  // parent 是后端的真实包含关系；不从限定名称拆分或猜测所属类。
  for (const block of blocks.values()) {
    if (block.record.parent) {
      const parent = blocks.get(block.record.parent);
      block.ownerFirst = !block.container && parent.record.entity_id === block.record.entity_id;
      parent.children.push(block);
    } else rootBlocks.push(block);
  }
  rootBlocks.sort(compareRoots);
  const rootById = new Map();
  for (const block of rootBlocks) {
    measureBlock(block);
    collectRoots(block, block.record.id, rootById);
  }
  const result = {positions: {}, dimensions: {}, roots: {}};
  let completeSnapshot = Boolean(snapshot?.positions);
  for (const block of blocks.values()) {
    if (!block.children.length && !snapshot?.positions?.[block.record.id]) completeSnapshot = false;
  }
  // 历史恢复只复算行尺寸，不再次运行文件分层算法或改变保存的阅读位置。
  if (completeSnapshot) {
    for (const block of rootBlocks) placeBlock(block, 0, 0, block.width, block.record.id, result);
    for (const id of Object.keys(result.positions)) result.positions[id] = {...snapshot.positions[id]};
    return result;
  }
  if (!rootBlocks.length) return result;

  // Dagre 只处理文件/边界块之间的辅助关系；真实调用边及端点不会被替换。
  const outer = new dagre.graphlib.Graph();
  outer.setGraph({rankdir: "LR", nodesep: 70, ranksep: 140, marginx: 40, marginy: 40, acyclicer: "greedy"});
  for (const block of rootBlocks) outer.setNode(block.record.id, {width: block.width, height: block.height});
  for (const edge of data.edges || []) {
    const source = rootById.get(edge.source), target = rootById.get(edge.target);
    if (source && target && source !== target) {
      const previous = outer.edge(source, target);
      outer.setEdge(source, target, {weight: (previous?.weight || 0) + (edge.call_ids?.length || 1)});
    }
  }
  dagre.layout(outer);
  for (const block of rootBlocks) {
    const position = outer.node(block.record.id);
    placeBlock(block, position.x - block.width / 2, position.y - block.height / 2,
      block.width, block.record.id, result);
  }
  return result;
}
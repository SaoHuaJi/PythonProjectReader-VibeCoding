import {test, expect} from "@playwright/test";
import {fileURLToPath} from "node:url";
import path from "node:path";
import fs from "node:fs/promises";

const projectRoot = fileURLToPath(new URL("../../../", import.meta.url));
const sampleRoot = path.join(projectRoot, "tests", "fixtures", "sample");

/**
 * 阻止并记录非本地请求，收集真实页面异常。
 * Args:
 *   page (Page): 浏览器页面。
 * Returns:
 *   Promise<object>: 外网尝试及页面异常。
 */
async function offlineAudit(page) {
  const audit = {external: [], errors: []};
  /**
   * 仅允许本地服务请求通过。
   * Args:
   *   route (Route): 实际浏览器请求。
   * Returns:
   *   Promise<void>: 继续本地请求或阻止外网。
   */
  async function guardRequest(route) {
    const url = new URL(route.request().url());
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
      audit.external.push(url.toString());
      await route.abort();
    } else await route.continue();
  }
  /**
   * 收集页面未处理错误。
   * Args:
   *   error (Error): 浏览器错误。
   * Returns:
   *   void: 写入本次验收记录。
   */
  function collectError(error) { audit.errors.push(error.message); }
  await page.route("**/*", guardRequest);
  page.on("pageerror", collectError);
  return audit;
}

/**
 * 通过实际表单分析给定目录。
 * Args:
 *   page (Page): 页面。
 *   root (string): 本地项目目录。
 * Returns:
 *   Promise<void>: 等待真实调用索引完成。
 */
async function analyzeProject(page, root) {
  await page.getByTestId("project-path").fill(root);
  await page.getByTestId("analyze-button").click();
  await expect(page.getByTestId("status-text")).toHaveText("分析完成", {timeout: 120000});
  await expect(page.locator("#message.error")).toBeHidden();
}

/**
 * 选择文件树中的真实文件。
 * Args:
 *   page (Page): 页面。
 *   name (string): 文件名。
 * Returns:
 *   Promise<void>: 等待源码切换。
 */
async function openFile(page, name) {
  await page.locator("#file-list .file-row").filter({hasText: name}).click();
  await expect(page.getByTestId("source-path")).toContainText(name);
}

/**
 * 验收从文件到函数、调用、对象和原文的连续阅读。
 * Args:
 *   context (object): Playwright 提供的真实页面。
 * Returns:
 *   Promise<void>: 阅读操作全部满足时完成。
 */
async function readCompleteProject({page}) {
  const audit = await offlineAudit(page);
  await page.goto("/");
  await expect(page.getByRole("heading", {name: "沿着代码关系，理解项目实现"})).toBeVisible();
  await analyzeProject(page, sampleRoot);

  // 从文件说明与全局成员进入函数，不直接调用分析接口替代用户操作。
  await openFile(page, "main.py");
  await expect(page.locator("#details")).toContainText("示例入口：调用处理模块读取文本并整理结果。");
  await expect(page.locator("#details .entity-row").getByRole("button", {name: "DEFAULT_INPUT", exact: true})).toBeVisible();
  await page.locator("#details .entity-row").getByRole("button", {name: "main", exact: true}).click();
  await expect(page.locator("#details h2")).toHaveText("main");
  await expect(page.locator("#details")).toContainText("从输入文件生成处理结果。");
  await expect(page.locator("#details .signature")).toContainText("DEFAULT_INPUT");

  await openFile(page, "pipeline.py");
  await expect(page.locator("#details")).toContainText("将读取、筛选、转换和汇总组成可阅读的处理流程。");
  await page.locator("#details .entity-row").getByRole("button", {name: "process", exact: true}).click();
  await expect(page.locator("#details h2")).toHaveText("process");
  await expect(page.locator("#details")).toContainText("输入与输出");
  await expect(page.locator("#details")).toContainText("summary");
  await expect(page.locator("#details .parameter-row")).toContainText("path");

  // 查看循环中的调用与循环 else，调用详情必须保留参数和接收语句。
  await page.locator("#details").getByRole("button", {name: "查看内部逻辑", exact: true}).click();
  await page.getByRole("button", {name: "全部展开", exact: true}).click();
  await expect(page.getByTestId("logic-view")).toContainText("for row in rows");
  await expect(page.getByTestId("logic-view")).toContainText("if not valid(row)");
  await expect(page.getByTestId("logic-view").locator(".kind-for .branch-title")).toContainText(["循环体", "自然结束（未 break）"]);
  await page.getByTestId("logic-view").getByRole("button", {name: "reader.load(path)", exact: true}).click();
  await expect(page.locator("#details h2")).toHaveText("reader.load");
  await expect(page.locator("#details")).toContainText("调用实参与目标签名");
  await expect(page.locator("#details")).toContainText("返回结果的直接接收");
  await expect(page.locator("#details .code-text")).toContainText("rows");
  await page.locator("#details .target-link").filter({hasText: "Reader.load"}).click();
  await expect(page.locator("#details h2")).toHaveText("Reader.load");
  await expect(page.locator("#details")).toContainText("从文本文件中读取非空记录。");
  await expect(page.getByTestId("source-path")).toContainText("models.py");

  // 返回两次后恢复 process 的内部逻辑和详情。
  await page.getByRole("button", {name: "返回", exact: true}).click();
  await expect(page.locator("#details h2")).toHaveText("reader.load");
  await page.getByRole("button", {name: "返回", exact: true}).click();
  await expect(page.locator("#details h2")).toHaveText("process");
  await expect(page.getByTestId("logic-view")).toBeVisible();
  await expect(page.getByTestId("source-path")).toContainText("pipeline.py");

  // 从局部对象查询所属类，区别变量绑定与类定义。
  const reader = page.locator("#details .entity-row").filter({
    has: page.getByRole("button", {name: "reader", exact: true}),
  });
  await reader.locator("xpath=following-sibling::div[contains(@class,'object-actions')][1]")
    .getByRole("button", {name: "查看所属类 / 定义", exact: true}).click();
  await expect(page.locator("#details h2")).toHaveText("所属类 / 最终定义");
  await page.locator("#details .target-link").filter({hasText: /Reader$/}).click();
  await expect(page.locator("#details h2")).toHaveText("Reader");
  await expect(page.locator("#details")).toContainText("表示携带分隔符配置的文本读取对象。");
  await expect(page.locator("#details")).toContainText("方法与属性");
  await expect(page.getByTestId("source-path")).toContainText("models.py");

  // 在真实源码中点击类名，再由工具栏发起绑定定义查询。
  const definitionLine = page.locator("#source-view .cm-line").filter({hasText: "class Reader:"});
  await definitionLine.click({position: {x: 78, y: 8}});
  await page.getByRole("button", {name: "绑定定义", exact: true}).click();
  await expect(page.locator("#details h2")).toHaveText("绑定定义");
  await expect(page.locator("#details .target-link")).toContainText("Reader");

  expect(audit.external, "离线阅读不得尝试访问外部资源").toEqual([]);
  expect(audit.errors, "页面不得出现未处理异常").toEqual([]);
}
test("断外网完成文件、函数、对象、调用和内部逻辑阅读", readCompleteProject);

/**
 * 验收不存在目录的中文错误反馈。
 * Args:
 *   context (object): 真实页面。
 * Returns:
 *   Promise<void>: 错误可见且页面仍可操作。
 */
async function invalidProject({page}) {
  const audit = await offlineAudit(page);
  await page.goto("/");
  await page.getByTestId("project-path").fill(path.join(projectRoot, "__目录不存在__"));
  await page.getByTestId("analyze-button").click();
  await expect(page.locator("#message.error")).toBeVisible();
  await expect(page.locator("#message-text")).toContainText(/目录|路径|不存在/);
  await expect(page.locator("#close-message")).toHaveAccessibleName(/关闭/);
  await expect(page.getByTestId("analyze-button")).toBeEnabled();

  // 真正的后端错误可关闭，整条提示隐藏后释放工作区高度。
  const notice = await page.locator("#message").boundingBox();
  const before = await page.evaluate(workspaceGeometry);
  await page.locator("#close-message").click();
  await expect(page.locator("#message")).toBeHidden();
  const closed = await page.evaluate(workspaceGeometry);
  expect(before.workspace.top - closed.workspace.top).toBeGreaterThanOrEqual(notice.height - 1);
  expect(closed.workspace.height - before.workspace.height).toBeGreaterThanOrEqual(notice.height - 1);
  await page.getByTestId("language-select").selectOption("en");
  await expect(page.locator("#message")).toBeHidden();
  await page.getByTestId("language-select").selectOption("zh");
  await expect(page.locator("#message")).toBeHidden();

  // 新的手动请求即使产生同一错误，也必须重新告知用户。
  await page.getByTestId("analyze-button").click();
  await expect(page.locator("#message.error")).toBeVisible();
  await expect(page.locator("#message-text")).toContainText(/目录|路径|不存在/);
  await page.getByTestId("language-select").selectOption("en");
  await expect(page.locator("#message-text")).toContainText("Project directory does not exist");
  await expect(page.locator("#close-message")).toHaveAccessibleName(/close|dismiss/i);
  await page.locator("#close-message").click();
  await expect(page.locator("#message")).toBeHidden();
  expect(audit.errors).toEqual([]);
  expect(audit.external).toEqual([]);
}
test("错误目录提示关闭释放高度且新手动同错再次显示", invalidProject);

/**
 * 验收动态未知保留和目标顶层代码不执行。
 * Args:
 *   context (object): 真实页面。
 * Returns:
 *   Promise<void>: 未解析可见、源码未变且副作用未发生。
 */
async function unknownAndNonExecution({page}) {
  const runtime = path.join(projectRoot, "work", "runtime", "e2e-targets");
  await fs.mkdir(runtime, {recursive: true});
  const target = await fs.mkdtemp(path.join(runtime, "unknown-"));
  const sourcePath = path.join(target, "dynamic.py");
  const marker = path.join(target, "SHOULD_NOT_EXIST.txt");
  const code = [
    '"""动态目标无法确定时仍保留原调用与源码。📖"""',
    "from pathlib import Path",
    'Path(__file__).with_name("SHOULD_NOT_EXIST.txt").write_text("不应运行")',
    "",
    "def dispatch(callback):",
    '    """调用由参数提供的回调。',
    "",
    "    Args:",
    "        callback (Callable): 由外部提供的函数对象。",
    "",
    "    Returns:",
    "        object: 回调原样返回的对象。",
    '    """',
    "    return callback()",
    "",
  ].join("\r\n");
  await fs.writeFile(sourcePath, code, "utf8");
  const audit = await offlineAudit(page);
  await page.goto("/");
  await analyzeProject(page, target);
  await openFile(page, "dynamic.py");
  await page.locator("#details .entity-row").getByRole("button", {name: "dispatch", exact: true}).click();
  await expect(page.locator("#details .uncertain").first()).toBeVisible();
  await page.locator("#details").getByRole("button", {name: "callback()", exact: true}).click();
  await expect(page.locator("#details h2")).toHaveText("callback");
  await expect(page.locator("#details .notice")).toBeVisible();
  await expect(page.locator("#details .signature")).toHaveText("callback()");
  expect((await page.locator("#source-view .source-highlight").allTextContents()).join("")).toBe("callback()");
  expect(await fs.readFile(sourcePath, "utf8")).toBe(code);
  expect(await fs.readdir(target)).toEqual(["dynamic.py"]);
  await expect(fs.access(marker)).rejects.toThrow();
  expect(audit.external).toEqual([]);
  expect(audit.errors).toEqual([]);

  // 仅在验收成功后清理本测试创建的目录，先核对绝对路径范围。
  const resolved = path.resolve(target);
  const allowed = path.resolve(runtime) + path.sep;
  if (!resolved.startsWith(allowed)) throw new Error("临时目标目录超出验收工作区，拒绝清理。");
  await fs.rm(resolved, {recursive: true});
}
test("动态调用保留未知且分析不触发目标副作用", unknownAndNonExecution);

/**
 * 定向验收包目录导入导航和原生缩放交互。
 * Args:
 *   context (object): Playwright 提供的真实浏览器页面。
 * Returns:
 *   Promise<void>: 导入上下游、反向详情及缩放均满足时完成。
 */
async function packageImportsAndZoom({page}) {
  test.setTimeout(150000);
  const runtime = path.join(projectRoot, "work", "runtime", "e2e-targets");
  await fs.mkdir(runtime, {recursive: true});
  const container = await fs.mkdtemp(path.join(runtime, "package-import-"));
  const target = path.join(container, "reader_pkg");
  await fs.mkdir(target);
  // 扫描根就是包本身，绝对导入仍保留包名前缀，复现实际工作区的问题。
  const sources = {
    "__init__.py": '"""导入导航回归的小型包。"""\n',
    "__main__.py": '"""从包入口引用接口模块。"""\nfrom reader_pkg.api import create_app\n',
    "api.py": [
      '"""接口模块组合索引与工作对象。"""',
      "from reader_pkg.index import search",
      "from reader_pkg.worker import Worker",
      "",
      "def create_app():",
      '    """返回接口使用的定义，不执行它们。',
      "",
      "    Args:",
      "        无。",
      "",
      "    Returns:",
      "        tuple: 索引函数与工作对象类型。",
      '    """',
      "    return search, Worker",
      "",
    ].join("\n"),
    "index.py": [
      '"""提供静态查询入口。"""', "",
      "def search():",
      '    """返回空查询结果。',
      "",
      "    Args:",
      "        无。",
      "",
      "    Returns:",
      "        list: 当前空结果。",
      '    """',
      "    return []", "",
    ].join("\n"),
    "worker.py": '"""定义工作对象。"""\n\nclass Worker:\n    """表示供接口引用的工作对象类型。"""\n',
  };
  for (const [name, content] of Object.entries(sources)) {
    await fs.writeFile(path.join(target, name), content, "utf8");
  }
  const audit = await offlineAudit(page);
  await page.goto("/");
  await analyzeProject(page, target);
  await openFile(page, "api.py");
  await expect(page.locator("#details")).toContainText("接口模块组合索引与工作对象。");
  await expect(page.locator("#details")).toContainText("导入本模块的文件");
  await expect(page.locator("#details").getByRole("button", {name: "__main__.py", exact: true})).toBeVisible();

  /**
   * 只读取得库原生实例中的图和视角数据。
   * Args:
   *   anchor (object|null): 需要检查的画布内像素锚点。
   * Returns:
   *   object: 原生图关系、倍率、边界和锚点对应的模型坐标。
   */
  function inspectGraph(anchor = null) {
    const cy = document.querySelector("#graph")?._cyreg?.cy;
    if (!cy) return {ready: false, relations: []};
    const relations = [];
    for (const edge of cy.edges()) {
      const from = edge.source().data("description") || edge.source().data("label");
      const to = edge.target().data("description") || edge.target().data("label");
      relations.push(from + "→" + to);
    }
    const zoom = cy.zoom(), pan = cy.pan();
    const center = {x: cy.width() / 2, y: cy.height() / 2};
    const point = anchor || center;
    return {
      ready: true, relations, zoom, pan: {...pan},
      min: cy.minZoom(), max: cy.maxZoom(),
      sensitivity: cy.json().wheelSensitivity,
      width: cy.width(), height: cy.height(),
      centerModel: {x: (center.x - pan.x) / zoom, y: (center.y - pan.y) / zoom},
      anchorModel: {x: (point.x - pan.x) / zoom, y: (point.y - pan.y) / zoom},
      bounds: cy.elements().renderedBoundingBox(),
    };
  }

  /**
   * 给交互验证设置确定的起始倍率，不改滚轮配置或关系数据。
   * Args:
   *   value (number): 位于支持范围内的起始倍率。
   * Returns:
   *   void: 仅重置原生视角。
   */
  function resetViewport(value) {
    const cy = document.querySelector("#graph")._cyreg.cy;
    cy.zoom(value);
    cy.pan({x: 0, y: 0});
  }

  // 从界面切换方向，检查实际可见图，不能只验证后端返回关系。
  await expect(page.locator("#graph-direction")).toHaveValue("both");
  await expect.poll(page.evaluate.bind(page, inspectGraph)).toMatchObject({
    relations: expect.arrayContaining(["__main__.py→api.py"]),
  });
  await page.locator("#graph-direction").selectOption("incoming");
  await expect.poll(page.evaluate.bind(page, inspectGraph)).toMatchObject({
    relations: expect.arrayContaining(["__main__.py→api.py"]),
  });
  await page.locator("#graph-direction").selectOption("outgoing");
  await expect.poll(page.evaluate.bind(page, inspectGraph)).toMatchObject({
    relations: expect.arrayContaining(["api.py→index.py", "api.py→worker.py"]),
  });
  const outgoing = await page.evaluate(inspectGraph);
  expect(outgoing.relations).not.toContain("__main__.py→api.py");
  expect(outgoing.sensitivity).toBe(1);
  expect(outgoing.min).toBe(0.12);
  expect(outgoing.max).toBe(2.8);

  // 使用真实按钮验证更快的互逆步长，以及画布中心对应的模型位置。
  await page.evaluate(resetViewport, 1);
  const initial = await page.evaluate(inspectGraph);
  await page.locator("#zoom-in").click();
  const enlarged = await page.evaluate(inspectGraph);
  expect(enlarged.zoom).toBeCloseTo(1.6, 10);
  expect(enlarged.centerModel.x).toBeCloseTo(initial.centerModel.x, 8);
  expect(enlarged.centerModel.y).toBeCloseTo(initial.centerModel.y, 8);
  await page.locator("#zoom-out").click();
  const restored = await page.evaluate(inspectGraph);
  expect(restored.zoom).toBeCloseTo(1, 10);
  expect(restored.centerModel.x).toBeCloseTo(initial.centerModel.x, 8);
  expect(restored.centerModel.y).toBeCloseTo(initial.centerModel.y, 8);
  await page.locator("#zoom-out").click();
  expect((await page.evaluate(inspectGraph)).zoom).toBeCloseTo(1 / 1.6, 10);
  await page.locator("#zoom-in").click();
  expect((await page.evaluate(inspectGraph)).zoom).toBeCloseTo(1, 10);

  // 小于库粗滚轮采样阈值的实际像素事件，使预期直接来自原生公式。
  // 不修改库内部灵敏度，也不注入自定义滚轮事件或应用测试入口。
  const box = await page.locator("#graph").boundingBox();
  // 鼠标事件使用整数客户端像素；预期锚点必须对应同一实际坐标。
  const clientX = Math.round(box.x + box.width * 0.37);
  const clientY = Math.round(box.y + box.height * 0.41);
  const anchor = {x: clientX - box.x, y: clientY - box.y};
  await page.evaluate(resetViewport, 1);
  await page.mouse.move(clientX, clientY);
  const beforeWheel = await page.evaluate(inspectGraph, anchor);
  await page.mouse.wheel(0, -4);

  /**
   * 读取真实滚轮事件完成后的倍率。
   * Args:
   *   无。
   * Returns:
   *   Promise<number>: 原生当前倍率。
   */
  async function readZoom() {
    return (await page.evaluate(inspectGraph)).zoom;
  }
  await expect.poll(readZoom).toBeGreaterThan(1.03);
  const afterWheel = await page.evaluate(inspectGraph, anchor);
  expect(Math.log10(afterWheel.zoom / beforeWheel.zoom)).toBeCloseTo(4 / 250, 5);
  expect(afterWheel.anchorModel.x).toBeCloseTo(beforeWheel.anchorModel.x, 7);
  expect(afterWheel.anchorModel.y).toBeCloseTo(beforeWheel.anchorModel.y, 7);
  await page.mouse.wheel(0, 4);
  await expect.poll(readZoom).toBeCloseTo(1, 5);

  // 边界仍由库处理，最后通过真实“适应”按钮恢复全部节点。
  await page.evaluate(resetViewport, 2.7);
  await page.locator("#zoom-in").click();
  expect((await page.evaluate(inspectGraph)).zoom).toBe(2.8);
  await page.evaluate(resetViewport, 0.13);
  await page.locator("#zoom-out").click();
  expect((await page.evaluate(inspectGraph)).zoom).toBe(0.12);
  await page.locator("#zoom-fit").click();
  const fitted = await page.evaluate(inspectGraph);
  expect(fitted.zoom).toBeGreaterThanOrEqual(0.12);
  expect(fitted.zoom).toBeLessThanOrEqual(2.8);
  expect(fitted.bounds.x1).toBeGreaterThanOrEqual(-1);
  expect(fitted.bounds.y1).toBeGreaterThanOrEqual(-1);
  expect(fitted.bounds.x2).toBeLessThanOrEqual(fitted.width + 1);
  expect(fitted.bounds.y2).toBeLessThanOrEqual(fitted.height + 1);
  expect(audit.external).toEqual([]);
  expect(audit.errors).toEqual([]);

  // 仅在本条验收成功后清理自行创建的包；先核对绝对目标路径。
  const resolved = path.resolve(container);
  if (!resolved.startsWith(path.resolve(runtime) + path.sep)) {
    throw new Error("临时包不在验收工作区内，拒绝清理。");
  }
  await fs.rm(resolved, {recursive: true});
}
test("包目录导入与缩放定向回归", packageImportsAndZoom);

/**
 * 验收界面语言切换、原文保留和当前阅读上下文。
 * Args:
 *   context (object): Playwright 提供的真实浏览器页面。
 * Returns:
 *   Promise<void>: 中英文工具文字与阅读状态都满足时完成。
 */
async function interfaceLanguagePreservesReading({page}) {
  test.setTimeout(180000);
  const audit = await offlineAudit(page);
  let analysisRequests = 0;
  /**
   * 记录实际分析启动请求，区分语言切换与重新分析。
   * Args:
   *   request (Request): 浏览器发出的真实请求。
   * Returns:
   *   void: 仅累计分析启动次数。
   */
  function countAnalysis(request) {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/analyses") analysisRequests += 1;
  }
  page.on("request", countAnalysis);

  /**
   * 读取库原生图和完整编辑器状态，不增加应用测试接口。
   * Args:
   *   无。
   * Returns:
   *   object: 阅读状态的可核对快照。
   */
  function readingContext() {
    const cy = document.querySelector("#graph")._cyreg.cy;
    const nodes = [], edges = [];
    // 容器标题是工具文案，会随语言变化；这里核对事实节点的原始名称。
    for (const node of cy.nodes()) {
      if ((node.data("kind") || "").endsWith("_container")) continue;
      nodes.push({id: node.id(), label: node.data("name") || node.data("qualname") || node.data("label")});
    }
    for (const edge of cy.edges()) edges.push(edge.data("label"));
    const expanded = [];
    for (const block of document.querySelectorAll("#logic-view details[open]")) expanded.push(block.dataset.logicId);
    const scroller = document.querySelector("#source-view .cm-scroller");
    const content = document.querySelector("#source-view .cm-content");
    const editor = content.cmTile.root.view;
    const highlights = [], folds = [];
    /**
     * 收集原生状态中的高亮与折叠范围，不读取虚拟化渲染片段。
     * Args:
     *   from (number): 文档范围起点。
     *   to (number): 文档范围终点。
     *   value (Decoration): 组件状态中的装饰。
     * Returns:
     *   void: 记录实际高亮和折叠范围。
     */
    function collectDecoration(from, to, value) {
      if (value.spec.class === "source-highlight") highlights.push({from, to});
      // 当前编辑器配置中，替换型 widget 来自原生 foldState。
      if (value.isReplace && value.spec.widget) folds.push({from, to});
    }
    for (const decoration of editor.state.facet(editor.constructor.decorations)) {
      const ranges = typeof decoration === "function" ? decoration(editor) : decoration;
      ranges.between(0, editor.state.doc.length, collectDecoration);
    }
    /**
     * 读取与真实源码视口相交的首行，排除离屏渲染节点。
     * Args:
     *   view (EditorView): 库原生编辑器实例。
     *   scrollDOM (HTMLElement): 原生滚动视口。
     * Returns:
     *   object: 首行文档起点、行号及相对视口顶部的像素偏移。
     */
    function visibleSourceAnchor(view, scrollDOM) {
      const box = scrollDOM.getBoundingClientRect();
      const top = box.top + scrollDOM.clientTop;
      const left = box.left + scrollDOM.clientLeft;
      const bottom = top + scrollDOM.clientHeight;
      const right = left + scrollDOM.clientWidth;
      let first = null, firstBox = null;
      for (const line of view.contentDOM.querySelectorAll(".cm-line")) {
        const rect = line.getBoundingClientRect();
        if (rect.bottom <= top || rect.top >= bottom || rect.right <= left || rect.left >= right) continue;
        if (!firstBox || rect.top < firstBox.top) {
          first = line;
          firstBox = rect;
        }
      }
      if (!first) throw new Error("源码视口中没有实际可见行，无法确认阅读位置。");
      const line = view.state.doc.lineAt(view.posAtDOM(first, 0));
      return {from: line.from, line: line.number, topOffset: firstBox.top - top};
    }
    const visibleAnchor = visibleSourceAnchor(editor, scroller);
    return {
      zoom: cy.zoom(), pan: {...cy.pan()}, nodes, edges, expanded,
      source: editor.state.doc.toString(),
      selection: editor.state.selection.toJSON(), folds,
      scroll: scroller.scrollTop, highlights, visibleAnchor,
      path: document.querySelector("#source-path").textContent,
    };
  }

  /**
   * 核对语言切换未重建原始源码显示节点。
   * Args:
   *   element (HTMLElement): 切换前源码内容节点。
   * Returns:
   *   boolean: 是否仍为当前节点。
   */
  function sameSourceNode(element) {
    return element === document.querySelector("#source-view .cm-content");
  }

  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page.getByTestId("language-select")).toHaveValue("zh");
  await analyzeProject(page, sampleRoot);
  await openFile(page, "pipeline.py");
  await page.locator("#details .entity-row").getByRole("button", {name: "process", exact: true}).click();
  await expect(page.locator("#details h2")).toHaveText("process");
  await expect(page.locator("#details [data-section-key='section.io'] > summary")).toHaveText("输入与输出");
  await page.locator("#zoom-in").click();
  await page.locator("#details [data-section-key='section.description'] > summary").click();

  // 用组件原生折叠栏产生真实折叠，再检查语言切换不丢折叠。
  await page.locator("#source-view .cm-foldGutter span[title='折叠行']:visible").first().click();
  await expect(page.locator("#source-view .cm-foldPlaceholder").first()).toHaveAttribute("title", "展开");
  const sourceNode = await page.locator("#source-view .cm-content").elementHandle();
  const before = await page.evaluate(readingContext);
  // 独立磁盘原文只按编辑器的通用换行规则归一，不从被测界面生成预期。
  const expectedSource = (await fs.readFile(path.join(sampleRoot, "pipeline.py"), "utf8")).replace(/\r\n?/g, "\n");
  expect(before.source).toBe(expectedSource);
  expect(before.folds.length).toBeGreaterThan(0);
  const requestCount = analysisRequests;
  await page.getByTestId("language-select").selectOption("en");

  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByTestId("status-text")).toHaveText("Analysis complete");
  await expect(page.locator("#show-call")).toHaveText("Function calls");
  await expect(page.locator("#details [data-section-key='section.io'] > summary")).toHaveText("Inputs and outputs");
  await expect(page.locator("#details [data-section-key='section.objects'] > summary")).toHaveText("Local objects and definitions");
  await expect(page.locator("#details")).toContainText("读取、筛选、转换并汇总文本记录。");
  await expect(page.locator("#details h2")).toHaveText("process");
  await expect(page.locator("#details [data-section-key='section.description']")).not.toHaveAttribute("open", "");
  await expect(page.locator("#source-view .cm-foldPlaceholder").first()).toHaveAttribute("title", "unfold");
  await expect(page.locator("#source-view .cm-foldPlaceholder").first()).toHaveAttribute("aria-label", "folded code");
  const after = await page.evaluate(readingContext);
  expect(analysisRequests).toBe(requestCount);
  expect(after.zoom).toBe(before.zoom);
  expect(after.pan).toEqual(before.pan);
  expect(after.nodes).toEqual(before.nodes);
  expect(after.edges.length).toBeGreaterThan(0);
  for (const label of after.edges) expect(label).toMatch(/ calls$/);
  expect(after.source).toBe(before.source);
  expect(after.source).toBe(expectedSource);
  expect(after.selection).toEqual(before.selection);
  expect(after.folds).toEqual(before.folds);
  expect(after.scroll).toBe(before.scroll);
  expect(after.visibleAnchor.from).toBe(before.visibleAnchor.from);
  expect(after.visibleAnchor.topOffset).toBeCloseTo(before.visibleAnchor.topOffset, 5);
  expect(after.highlights).toEqual(before.highlights);
  expect(after.path).toBe(before.path);
  expect(await sourceNode.evaluate(sameSourceNode)).toBe(true);
  await page.getByTestId("language-select").selectOption("zh");
  await expect(page.locator("#source-view .cm-foldPlaceholder").first()).toHaveAttribute("title", "展开");
  const chineseAgain = await page.evaluate(readingContext);
  expect(chineseAgain.visibleAnchor.from).toBe(before.visibleAnchor.from);
  expect(chineseAgain.visibleAnchor.topOffset).toBeCloseTo(before.visibleAnchor.topOffset, 5);
  expect(chineseAgain.scroll).toBe(before.scroll);
  expect(await sourceNode.evaluate(sameSourceNode)).toBe(true);
  await page.getByTestId("language-select").selectOption("en");
  await expect(page.locator("#source-view .cm-foldPlaceholder").first()).toHaveAttribute("title", "unfold");
  expect(analysisRequests).toBe(requestCount);
  await fs.mkdir(path.join(projectRoot, "work", "runtime"), {recursive: true});
  await page.screenshot({path: path.join(projectRoot, "work", "runtime", "language-en.png"), fullPage: true});

  // 英文结构说明来自明确机器码，条件、调用和函数名称仍为原文。
  await page.locator("#details").getByRole("button", {name: "View internal logic", exact: true}).click();
  await page.locator("#logic-expand").click();
  await expect(page.locator("#logic-view")).toContainText("for row in rows");
  await expect(page.locator("#logic-view .branch-title")).toContainText(["Loop body", "Condition true", "Normal completion (without break)"]);
  await page.locator("#details [data-section-key='section.io'] > summary").click();
  await page.locator("#logic-view").getByRole("button", {name: "reader.load(path)", exact: true}).click();
  await expect(page.locator("#details [data-section-key='section.arguments'] > summary")).toHaveText("Call arguments and target signature");
  await expect(page.locator("#details")).toContainText("Function body");
  await page.locator("#history-back").click();
  await expect(page.locator("#details h2")).toHaveText("process");
  await expect(page.locator("#details [data-section-key='section.io']")).not.toHaveAttribute("open", "");
  const logicBefore = await page.evaluate(readingContext);
  const countBeforeChinese = analysisRequests;
  await page.getByTestId("language-select").selectOption("zh");
  await expect(page.locator("#logic-view .branch-title")).toContainText(["循环体", "条件成立", "自然结束（未 break）"]);
  await expect(page.locator("#details [data-section-key='section.io'] > summary")).toHaveText("输入与输出");
  const logicAfter = await page.evaluate(readingContext);
  expect(logicAfter.expanded).toEqual(logicBefore.expanded);
  expect(logicAfter.path).toBe(logicBefore.path);
  expect(logicAfter.source).toBe(logicBefore.source);
  expect(logicAfter.scroll).toBe(logicBefore.scroll);
  expect(logicAfter.visibleAnchor.from).toBe(logicBefore.visibleAnchor.from);
  expect(logicAfter.visibleAnchor.topOffset).toBeCloseTo(logicBefore.visibleAnchor.topOffset, 5);
  expect(analysisRequests).toBe(countBeforeChinese);

  // 原始 API 错误由机器码翻译，切换错误提示不重新提交分析。
  await page.getByTestId("language-select").selectOption("en");
  await page.getByTestId("project-path").fill(path.join(projectRoot, "__不存在的语言验收目录__"));
  await page.getByTestId("analyze-button").click();
  await expect(page.locator("#message.error")).toContainText("Project directory does not exist");
  const failedCount = analysisRequests;
  await page.getByTestId("language-select").selectOption("zh");
  await expect(page.locator("#message.error")).toContainText("项目目录不存在");
  expect(analysisRequests).toBe(failedCount);
  await expect(page.locator("#details h2")).toHaveText("process");

  // 使用恰好与工具词相同的真实标识符和说明，证明没有自动翻译项目内容。
  const runtime = path.join(projectRoot, "work", "runtime", "e2e-targets");
  await fs.mkdir(runtime, {recursive: true});
  const target = await fs.mkdtemp(path.join(runtime, "language-"));
  const rawSource = [
    '"""输入与输出"""', "",
    'def 返回(参数: str = "分析完成") -> str:',
    '    """输入与输出"""',
    "    return 参数", "",
  ].join("\n");
  await fs.writeFile(path.join(target, "函数调用.py"), rawSource, "utf8");
  await fs.writeFile(path.join(target, "invalid.py"), "def broken(:\n", "utf8");
  await page.getByTestId("language-select").selectOption("en");
  await page.getByTestId("project-path").fill(target);
  await page.getByTestId("analyze-button").click();
  await expect(page.getByTestId("status-text")).toHaveText("Analysis complete", {timeout: 120000});
  await openFile(page, "函数调用.py");
  await page.locator("#details .entity-row").getByRole("button", {name: "返回", exact: true}).click();
  await expect(page.locator("#details h2")).toHaveText("返回");
  await expect(page.locator("#details .docstring")).toHaveText("输入与输出");
  await expect(page.locator("#details .signature")).toContainText('"分析完成"');
  await expect(page.locator("#details [data-section-key='section.io'] > summary")).toHaveText("Inputs and outputs");
  await page.locator("#diagnostics-button").click();
  await expect(page.locator("#diagnostics-dialog h2")).toHaveText("Analysis diagnostics");
  await expect(page.locator("#diagnostics-list")).toContainText("Cannot parse with this Python syntax");
  const finalCount = analysisRequests;
  await page.locator("#close-diagnostics").click();
  await page.getByTestId("language-select").selectOption("zh");
  await page.locator("#diagnostics-button").click();
  await expect(page.locator("#diagnostics-dialog h2")).toHaveText("分析诊断");
  await expect(page.locator("#diagnostics-list")).toContainText("当前 Python 语法无法解析");
  await expect(page.locator("#details h2")).toHaveText("返回");
  await expect(page.locator("#details .docstring")).toHaveText("输入与输出");
  expect(analysisRequests).toBe(finalCount);
  await page.locator("#close-diagnostics").click();
  expect(await fs.readFile(path.join(target, "函数调用.py"), "utf8")).toBe(rawSource);
  expect(audit.external).toEqual([]);
  expect(audit.errors).toEqual([]);

  const resolved = path.resolve(target);
  if (!resolved.startsWith(path.resolve(runtime) + path.sep)) throw new Error("拒绝清理验收范围外目录。");
  await fs.rm(resolved, {recursive: true});
}
test("界面语言切换保留原文和阅读上下文", interfaceLanguagePreservesReading);

/**
 * 验收文件、类、函数行与真实跨模块调用的连续阅读。
 * Args:
 *   context (object): 测试器提供的真实浏览器页面。
 * Returns:
 *   Promise<void>: 结构、端点、交互和边界均满足时完成。
 */
async function containerCallGraphReading({page}) {
  const runtime = path.join(projectRoot, "work", "runtime", "e2e-targets");
  await fs.mkdir(runtime, {recursive: true});
  const target = await fs.mkdtemp(path.join(runtime, "call-containers-"));
  await fs.mkdir(path.join(target, "pkg"), {recursive: true});
  const sources = {
    "main.py": [
      '"""入口模块保持原有中文说明。"""',
      "from pkg.worker import Worker",
      "from pkg.helpers import normalize", "",
      "def helper(value: str) -> str:",
      '    """整理输入。',
      "    Args:", "        value (str): 原始输入。",
      "    Returns:", "        str: 整理后的输入。", '    """',
      "    return normalize(value)", "",
      "def unused_entry() -> str:",
      '    """定义未被调用但应可见的成员。',
      "    Args:", "        无。",
      "    Returns:", "        str: 固定文本。", '    """',
      '    return "未调用成员"', "",
      "def main(value: str) -> str:",
      '    """创建对象并处理输入。',
      "    Args:", "        value (str): 要处理的输入。",
      "    Returns:", "        str: 处理结果。", '    """',
      "    worker = Worker()",
      "    return worker.run(helper(value))", "",
      "def uncertain(callback, value: str):",
      '    """保留运行时回调边界。',
      "    Args:", "        callback (Callable): 外部提供的回调。",
      "        value (str): 输入。",
      "    Returns:", "        object: 未运行的回调表达式。", '    """',
      "    return callback(value), len(value)", "",
    ].join("\n"),
    "pkg/__init__.py": '"""示例包。"""\n',
    "pkg/worker.py": [
      '"""工作对象定义模块。"""',
      "from .helpers import normalize", "",
      "class Worker:",
      '    """表示提供处理与清理方法的工作对象。"""',
      "    def run(self, value: str) -> str:",
      '        """处理输入。',
      "        Args:", "            value (str): 输入。",
      "        Returns:", "            str: 清理结果。", '        """',
      "        return self.clean(value)", "",
      "    def clean(self, value: str) -> str:",
      '        """调用跨文件整理函数。',
      "        Args:", "            value (str): 输入。",
      "        Returns:", "            str: 整理结果。", '        """',
      "        return normalize(value)", "",
      "def unused_worker() -> str:",
      '    """定义供按需查看的未调用函数。',
      "    Args:", "        无。",
      "    Returns:", "        str: 固定文本。", '    """',
      '    return "其他成员"', "",
    ].join("\n"),
    "pkg/helpers.py": [
      '"""纯函数工具模块。"""', "",
      "def normalize(value: str) -> str:",
      '    """去除首尾空白。',
      "    Args:", "        value (str): 原始文本。",
      "    Returns:", "        str: 去除空白后的文本。", '    """',
      "    return value.strip()", "",
      "def unused_helper() -> str:",
      '    """提供未被调用的工具。',
      "    Args:", "        无。",
      "    Returns:", "        str: 固定文本。", '    """',
      '    return "工具"', "",
    ].join("\n"),
  };
  for (const [name, source] of Object.entries(sources)) {
    await fs.writeFile(path.join(target, name), source, "utf8");
  }
  const audit = await offlineAudit(page);

  /**
   * 读取原生绘图状态，按事实节点区分容器和函数。
   * Args:
   *   无。
   * Returns:
   *   object: 坐标、包含关系、原始调用端点及视角。
   */
  function inspectContainers() {
    const cy = document.querySelector("#graph")._cyreg.cy;
    const nodes = [], containers = [], edges = [], positions = {};
    for (const node of cy.nodes()) {
      const data = node.data();
      const parent = node.parent();
      const item = {
        id: node.id(), name: data.name, kind: data.kind,
        qualname: data.qualname, file: data.relative_path,
        entity: data.entity_id, fileId: data.file_id,
        parent: parent.length ? parent.id() : null,
        x: node.position("x"), y: node.position("y"),
        selected: node.selected(), scope: data.scope,
        related: node.hasClass("relation-related"), muted: node.hasClass("relation-muted"),
        memberTotal: data.member_total, memberShown: data.member_shown,
      };
      if ((data.kind || "").endsWith("_container")) containers.push(item);
      else {
        nodes.push(item);
        positions[item.id] = {x: item.x, y: item.y};
      }
    }
    for (const edge of cy.edges()) {
      edges.push({id: edge.id(), source: edge.source().id(), target: edge.target().id(), callIds: edge.data("call_ids")});
    }
    return {nodes, containers, edges, positions, zoom: cy.zoom(), pan: {...cy.pan()}};
  }

  /**
   * 定位真实画布中的函数行、文件标题或调用曲线。
   * Args:
   *   spec (object): 元素类别、定义名称和相对文件路径。
   * Returns:
   *   object: 画布内可点击的实际像素位置。
   */
  function canvasPoint(spec) {
    const cy = document.querySelector("#graph")._cyreg.cy;
    /**
     * 以源码事实定位唯一图节点。
     * Args:
     *   name (string): 原始定义名称。
     *   relative (string): 相对文件路径。
     *   kind (string): 节点种类。
     * Returns:
     *   Node: 唯一的真实绘图节点。
     */
    function findNode(name, relative, kind) {
      const found = [];
      for (const node of cy.nodes()) {
        const data = node.data();
        if (data.kind !== kind) continue;
        const file = (data.relative_path || "").replaceAll("\\", "/");
        if (file !== relative || (name && data.name !== name)) continue;
        found.push(node);
      }
      if (found.length !== 1) throw new Error("画布节点定位不唯一：" + relative + " " + name + " " + kind);
      return found[0];
    }
    if (spec.type === "scope") {
      const node = findNode(spec.name, spec.file, "class").parent();
      const box = node.renderedBoundingBox({includeLabels: false});
      return {x: (box.x1 + box.x2) / 2, y: box.y1 + 20 * cy.zoom()};
    }
    if (spec.type === "file") {
      const node = findNode("", spec.file, "file_container");
      const box = node.renderedBoundingBox({includeLabels: false});
      return {x: (box.x1 + box.x2) / 2, y: box.y1 + 45 * cy.zoom()};
    }
    if (spec.type === "edge") {
      const source = findNode(spec.name, spec.file, spec.kind || "function");
      const targetNode = findNode(spec.targetName, spec.targetFile, spec.targetKind || "function");
      for (const edge of cy.edges()) {
        if (edge.source().id() === source.id() && edge.target().id() === targetNode.id()) return edge.renderedMidpoint();
      }
      throw new Error("没有找到预期的真实调用连线。");
    }
    return findNode(spec.name, spec.file, spec.kind || "function").renderedPosition();
  }

  /**
   * 用真实鼠标操作绘图元素，不调用应用内部导航或合成图事件。
   * Args:
   *   spec (object): 需要点击的元素源码身份。
   * Returns:
   *   Promise<void>: 完成鼠标点击。
   */
  async function clickCanvas(spec) {
    const point = await page.evaluate(canvasPoint, spec);
    const box = await page.locator("#graph").boundingBox();
    expect(point.x).toBeGreaterThanOrEqual(0);
    expect(point.y).toBeGreaterThanOrEqual(0);
    expect(point.x).toBeLessThanOrEqual(box.width);
    expect(point.y).toBeLessThanOrEqual(box.height);
    await page.mouse.click(box.x + point.x, box.y + point.y);
  }

  /**
   * 按真实源码名称取得图快照中的单个事实节点。
   * Args:
   *   snapshot (object): 原生图快照。
   *   name (string): 源码定义名称。
   *   file (string): 相对路径。
   * Returns:
   *   object: 唯一匹配的事实节点。
   */
  function fact(snapshot, name, file) {
    const found = [];
    for (const node of snapshot.nodes) {
      if (["function", "method", "class", "lambda"].includes(node.kind) &&
          node.name === name && node.file === file) found.push(node);
    }
    expect(found).toHaveLength(1);
    return found[0];
  }

  /**
   * 核对选择阅读没有改变图的事实范围、坐标和视角。
   * Args:
   *   before (object): 点击前的原生图快照。
   *   after (object): 点击后的原生图快照。
   * Returns:
   *   void: 所有布局与范围断言通过时完成。
   */
  function sameLayout(before, after) {
    expect(after.positions).toEqual(before.positions);
    expect(after.zoom).toBe(before.zoom);
    expect(after.pan).toEqual(before.pan);
  }

  await page.goto("/");
  await analyzeProject(page, target);
  await openFile(page, "main.py");
  await page.locator("#details .entity-row").getByRole("button", {name: "main", exact: true}).click();
  await expect(page.locator("#show-call")).toHaveAttribute("aria-selected", "true");
  await page.locator("#graph-depth").fill("2");
  await page.locator("#graph-depth").press("Tab");
  /**
   * 等待包含所需跨文件方法的真实图就绪。
   * Args:
   *   无。
   * Returns:
   *   Promise<boolean>: Worker.clean 是否已显示。
   */
  async function crossFileReady() {
    const snapshot = await page.evaluate(inspectContainers);
    for (const node of snapshot.nodes) if (node.name === "clean" && node.file === "pkg/worker.py") return true;
    return false;
  }
  await expect.poll(crossFileReady).toBe(true);
  await page.locator("#zoom-fit").click();
  const before = await page.evaluate(inspectContainers);
  const main = fact(before, "main", "main.py");
  const helper = fact(before, "helper", "main.py");
  const unused = fact(before, "unused_entry", "main.py");
  const run = fact(before, "run", "pkg/worker.py");
  const clean = fact(before, "clean", "pkg/worker.py");
  const normalize = fact(before, "normalize", "pkg/helpers.py");
  let mainBox, workerBox, workerClass;
  const workerDefinition = fact(before, "Worker", "pkg/worker.py");
  for (const container of before.containers) {
    if (container.kind === "file_container" && container.file === "main.py") mainBox = container;
    if (container.kind === "file_container" && container.file === "pkg/worker.py") workerBox = container;
    if (container.kind === "scope_container" && container.entity === workerDefinition.id) workerClass = container;
  }
  expect(main.parent).toBe(mainBox.id);
  expect(helper.parent).toBe(mainBox.id);
  expect(unused.parent).toBe(mainBox.id);
  expect(helper.y).toBeLessThan(unused.y);
  expect(unused.y).toBeLessThan(main.y);
  expect(run.parent).toBe(workerClass.id);
  expect(clean.parent).toBe(workerClass.id);
  expect(workerClass.parent).toBe(workerBox.id);
  expect(run.y).toBeLessThan(clean.y);
  expect(workerBox.memberShown).toBeLessThan(workerBox.memberTotal);
  expect(before.edges).toEqual(expect.arrayContaining([
    expect.objectContaining({source: main.id, target: helper.id}),
    expect.objectContaining({source: main.id, target: run.id}),
    expect.objectContaining({source: helper.id, target: normalize.id}),
  ]));
  for (const edge of before.edges) {
    expect(edge.source.startsWith("container:")).toBe(false);
    expect(edge.target.startsWith("container:")).toBe(false);
    expect(edge.callIds.length).toBeGreaterThan(0);
  }

  // 图内选择只更新阅读内容，不能重新聚焦后丢掉未调用成员。
  await clickCanvas({name: "helper", file: "main.py"});
  await expect(page.locator("#details h2")).toHaveText("helper");
  await expect(page.locator("#details")).toContainText("整理输入。");
  await expect(page.getByTestId("source-path")).toContainText("main.py");
  const afterHelper = await page.evaluate(inspectContainers);
  sameLayout(before, afterHelper);
  expect(fact(afterHelper, "helper", "main.py").selected).toBe(true);
  expect(fact(afterHelper, "normalize", "pkg/helpers.py").related).toBe(true);
  expect(fact(afterHelper, "unused_entry", "main.py").muted).toBe(true);

  await clickCanvas({name: "run", file: "pkg/worker.py", kind: "method"});
  await expect(page.locator("#details h2")).toHaveText("Worker.run");
  await expect(page.getByTestId("source-path")).toContainText("worker.py");
  sameLayout(before, await page.evaluate(inspectContainers));
  await clickCanvas({type: "scope", name: "Worker", file: "pkg/worker.py"});
  await expect(page.locator("#details h2")).toHaveText("Worker");
  await expect(page.locator("#details")).toContainText("表示提供处理与清理方法的工作对象。");
  sameLayout(before, await page.evaluate(inspectContainers));
  await clickCanvas({type: "file", file: "pkg/worker.py"});
  await expect(page.locator("#details h2")).toHaveText("pkg.worker");
  await expect(page.locator("#details")).toContainText("工作对象定义模块。");
  await expect(page.getByTestId("source-path")).toContainText("worker.py");
  await expect(page.locator("#show-call")).toHaveAttribute("aria-selected", "true");
  sameLayout(before, await page.evaluate(inspectContainers));
  await page.locator("#focus-selection").click();
  /**
   * 等待显式聚焦加载之前未展示的文件成员。
   * Args:
   *   无。
   * Returns:
   *   Promise<boolean>: 未调用函数是否已在图中。
   */
  async function unusedWorkerShown() {
    const snapshot = await page.evaluate(inspectContainers);
    for (const node of snapshot.nodes) if (node.name === "unused_worker" && node.file === "pkg/worker.py") return true;
    return false;
  }
  await expect.poll(unusedWorkerShown).toBe(true);
  await page.locator("#history-back").click();
  await expect(page.locator("#details h2")).toHaveText("pkg.worker");
  sameLayout(before, await page.evaluate(inspectContainers));

  await clickCanvas({name: "helper", file: "main.py"});
  await expect(page.locator("#details h2")).toHaveText("helper");
  await clickCanvas({type: "edge", name: "helper", file: "main.py", targetName: "normalize", targetFile: "pkg/helpers.py"});
  await expect(page.locator("#details h2")).toHaveText("调用位置");
  await page.locator("#details .call-row").getByRole("button", {name: "normalize(value)", exact: true}).click();
  await expect(page.locator("#details h2")).toHaveText("normalize");
  await expect(page.locator("#details")).toContainText("调用实参与目标签名");
  await expect(page.locator("#details")).toContainText("value");
  sameLayout(before, await page.evaluate(inspectContainers));
  await page.locator("#history-back").click();
  await expect(page.locator("#details h2")).toHaveText("调用位置");
  sameLayout(before, await page.evaluate(inspectContainers));
  await page.locator("#history-back").click();
  await expect(page.locator("#details h2")).toHaveText("helper");
  sameLayout(before, await page.evaluate(inspectContainers));

  await page.getByTestId("language-select").selectOption("en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("#details h2")).toHaveText("helper");
  sameLayout(before, await page.evaluate(inspectContainers));
  await page.screenshot({path: path.join(projectRoot, "work", "runtime", "call-containers-en.png"), fullPage: true});
  await page.getByTestId("language-select").selectOption("zh");
  sameLayout(before, await page.evaluate(inspectContainers));

  // 未解析回调和内置函数有独立边界，保留各自真实分类与文件外归属。
  await clickCanvas({name: "uncertain", file: "main.py"});
  await expect(page.locator("#details h2")).toHaveText("uncertain");
  await page.locator("#focus-selection").click();
  /**
   * 等待不确定调用和外部函数的真实边界。
   * Args:
   *   无。
   * Returns:
   *   Promise<boolean>: 两类边界是否同时显示。
   */
  async function boundariesShown() {
    const snapshot = await page.evaluate(inspectContainers);
    let unresolved = false, builtin = false;
    for (const node of snapshot.nodes) {
      if (node.kind === "unresolved" && node.name === "callback" && node.scope === "unresolved" &&
          node.parent === "container:boundary:unresolved") unresolved = true;
      if (node.name === "len" && node.scope === "builtin" &&
          node.parent === "container:boundary:external") builtin = true;
    }
    return unresolved && builtin;
  }
  await expect.poll(boundariesShown).toBe(true);
  await page.locator("#internal-only").check();
  /**
   * 等待明确筛选移除外部边界，保留项目成员。
   * Args:
   *   无。
   * Returns:
   *   Promise<boolean>: 当前所有事实节点是否属于项目。
   */
  async function onlyProject() {
    const snapshot = await page.evaluate(inspectContainers);
    if (!snapshot.nodes.length) return false;
    for (const node of snapshot.nodes) if (node.scope !== "project") return false;
    return true;
  }
  await expect.poll(onlyProject).toBe(true);
  await expect(page.locator("#message.error")).toBeHidden();
  expect(audit.external).toEqual([]);
  expect(audit.errors).toEqual([]);
  for (const [name, source] of Object.entries(sources)) {
    expect(await fs.readFile(path.join(target, name), "utf8")).toBe(source);
  }
  const resolved = path.resolve(target);
  if (!resolved.startsWith(path.resolve(runtime) + path.sep)) throw new Error("拒绝清理测试工作区之外的目录。");
  await fs.rm(resolved, {recursive: true});
}
test("文件容器调用图保留函数端点与连续阅读位置", containerCallGraphReading);

/**
 * 验收长目录、搜索与入口候选的顺序布局及本地图标。
 * Args:
 *   context (object): Playwright 提供的真实浏览器页面。
 * Returns:
 *   Promise<void>: 展开、折叠、双语、小窗口及空目录均满足时完成。
 */
async function sidebarFlowAndBrand({page}) {
  const runtime = path.join(projectRoot, "work", "runtime", "e2e-targets");
  await fs.mkdir(runtime, {recursive: true});
  const target = await fs.mkdtemp(path.join(runtime, "sidebar-"));
  const empty = path.join(target, "empty");
  const plain = path.join(target, "without_entry");
  await fs.mkdir(empty);
  await fs.mkdir(plain);
  await fs.writeFile(path.join(plain, "data.py"), '"""没有入口的普通模块。"""\nVALUE = 1\n', "utf8");

  // 通过真实目录构造足以超过侧栏高度的嵌套树，而不是直接注入页面节点。
  const deep = path.join(target, "package_with_a_long_name", "nested", "deeper", "leaf");
  await fs.mkdir(deep, {recursive: true});
  for (let index = 0; index < 32; index += 1) {
    await fs.writeFile(path.join(deep, "module_" + String(index).padStart(2, "0") + ".py"),
      '"""侧栏展开高度验证模块。"""\nVALUE = 1\n', "utf8");
  }
  await fs.writeFile(path.join(deep, "__main__.py"), '"""嵌套包入口。"""\nVALUE = 1\n', "utf8");
  await fs.writeFile(path.join(target, "cli.py"),
    '"""普通脚本入口。"""\nif __name__ == "__main__":\n    pass\n', "utf8");

  /**
   * 读取内容坐标，避免滚动位置变化影响高度和先后关系比较。
   * Args:
   *   无；读取当前真实侧栏。
   * Returns:
   *   object: 各内容块边界和实际可见目录后代边界。
   */
  function sidebarGeometry() {
    const sidebar = document.querySelector(".sidebar");
    const tree = document.querySelector("#file-list");
    const entries = document.querySelector("#entrypoints");
    const search = document.querySelector("#search-results");
    const foot = document.querySelector(".sidebar-footnote");
    const origin = sidebar.getBoundingClientRect().top - sidebar.scrollTop;
    const treeBox = tree.getBoundingClientRect();
    // 原生 details 收起后，隐藏后代仍可能保留布局矩形，需按浏览器实际可见性筛选。
    const visible = Array.from(tree.querySelectorAll("summary, .file-row"))
      .filter(element => element.checkVisibility());
    return {
      treeTop: treeBox.top - origin,
      treeBottom: treeBox.bottom - origin,
      treeHeight: treeBox.height,
      lastRowBottom: Math.max(treeBox.top, ...visible.map(element => element.getBoundingClientRect().bottom)) - origin,
      entriesTop: entries.getBoundingClientRect().top - origin,
      entriesBottom: entries.getBoundingClientRect().bottom - origin,
      footTop: foot.getBoundingClientRect().top - origin,
      searchBottom: search.hidden ? null : search.getBoundingClientRect().bottom - origin,
      clientHeight: sidebar.clientHeight,
      scrollHeight: sidebar.scrollHeight,
    };
  }

  /**
   * 核对内容边界未重叠，不以显示层级或元素存在替代布局效果。
   * Args:
   *   geometry (object): 页面实际内容坐标。
   * Returns:
   *   void: 所有相邻区域保持正常顺序时完成。
   */
  function expectOrdered(geometry) {
    expect(geometry.lastRowBottom).toBeLessThanOrEqual(geometry.treeBottom + 1);
    expect(geometry.entriesTop).toBeGreaterThanOrEqual(geometry.treeBottom - 1);
    expect(geometry.footTop).toBeGreaterThanOrEqual(geometry.entriesBottom - 1);
    if (geometry.searchBottom !== null) {
      expect(geometry.treeTop).toBeGreaterThanOrEqual(geometry.searchBottom - 1);
    }
  }

  const audit = await offlineAudit(page);
  await page.goto("/");
  await expect(page.locator(".brand strong")).toHaveText("PythonProjectReader");
  await expect(page.locator(".brand [data-i18n='app.subtitle']")).toHaveText("本地 Python 项目代码阅读");
  await expect(page.locator(".brand-mark svg")).toBeVisible();
  await expect(page.locator(".brand-mark svg")).toHaveAttribute("aria-hidden", "true");
  await analyzeProject(page, target);
  await expect(page.locator("#entrypoints .entry-link")).toHaveCount(2);
  const expanded = await page.evaluate(sidebarGeometry);
  expectOrdered(expanded);
  expect(expanded.treeHeight).toBeGreaterThan(expanded.clientHeight);
  expect(expanded.scrollHeight).toBeGreaterThan(expanded.clientHeight);
  await page.screenshot({path: path.join(projectRoot, "work", "runtime", "sidebar-expanded.png")});

  // 用目录的原生 summary 实际折叠与展开，入口位置必须随树内容高度改变。
  const folder = page.locator("#file-list > .folder").first();
  await folder.locator(":scope > summary").click();
  await expect(folder).not.toHaveAttribute("open", "");
  const collapsed = await page.evaluate(sidebarGeometry);
  expectOrdered(collapsed);
  expect(collapsed.treeHeight).toBeLessThan(expanded.treeHeight - 300);
  expect(collapsed.entriesTop).toBeLessThan(expanded.entriesTop - 300);
  await page.screenshot({path: path.join(projectRoot, "work", "runtime", "sidebar-collapsed.png")});
  await folder.locator(":scope > summary").click();
  await expect(folder).toHaveAttribute("open", "");
  await expect.poll(async () => (await page.evaluate(sidebarGeometry)).treeHeight).toBe(expanded.treeHeight);

  // 搜索结果出现后保持同级排列；切换语言不缩回树内容区域。
  await page.locator("#symbol-search").fill("module");
  await expect(page.locator("#search-results")).toBeVisible();
  await expect(page.locator("#search-results .search-result").first()).toBeVisible();
  expectOrdered(await page.evaluate(sidebarGeometry));
  await page.getByTestId("language-select").selectOption("en");
  await expect(page.locator(".brand [data-i18n='app.subtitle']")).toHaveText("Local Python project code reader");
  expectOrdered(await page.evaluate(sidebarGeometry));

  // 小高度窗口仍可滚动到末尾，长入口可点击并定位到真实源码。
  await page.setViewportSize({width: 1050, height: 650});
  await page.locator("#symbol-search").fill("");
  await expect(page.locator("#search-results")).toBeHidden();
  const small = await page.evaluate(sidebarGeometry);
  expectOrdered(small);
  expect(small.scrollHeight).toBeGreaterThan(small.clientHeight);
  const longEntry = page.locator("#entrypoints .entry-link").filter({hasText: "__main__.py"});
  await longEntry.click();
  await expect(page.getByTestId("source-path")).toContainText("__main__.py");
  await page.locator(".sidebar-footnote").scrollIntoViewIfNeeded();
  await expect(page.locator(".sidebar-footnote")).toBeInViewport();
  expectOrdered(await page.evaluate(sidebarGeometry));
  await page.getByTestId("language-select").selectOption("zh");

  // 无入口和没有 Python 文件时同样按正常顺序显示，允许继续选择项目。
  await analyzeProject(page, plain);
  await expect(page.locator("#entrypoints .entry-link")).toHaveCount(0);
  expectOrdered(await page.evaluate(sidebarGeometry));
  await analyzeProject(page, empty);
  await expect(page.locator("#file-list .sidebar-empty")).toBeVisible();
  await expect(page.locator("#file-list .file-row")).toHaveCount(0);
  await expect(page.locator("#entrypoints .entry-link")).toHaveCount(0);
  expectOrdered(await page.evaluate(sidebarGeometry));
  expect(audit.external).toEqual([]);
  expect(audit.errors).toEqual([]);

  const resolved = path.resolve(target);
  if (!resolved.startsWith(path.resolve(runtime) + path.sep)) throw new Error("拒绝清理测试工作区之外的目录。");
  await fs.rm(resolved, {recursive: true});
}

test("侧栏展开推动入口并保持放大镜品牌与双语操作", sidebarFlowAndBrand);

/**
 * 读取面板真实矩形和可滚动范围，不以样式变量代替最终布局。
 * Args:
 *   无。
 * Returns:
 *   object: 各面板与分隔条的像素边界及中央固定栏高度。
 */
function workspaceGeometry() {
  const result = {};
  const selectors = {
    workspace: ".workspace", sidebar: "#navigation-panel",
    reading: "#reading-area", details: "#details", source: "#source-panel",
    canvas: ".canvas-area", sidebarBar: "#sidebar-resizer",
    detailsBar: "#details-resizer", sourceBar: "#source-resizer",
  };
  for (const [name, selector] of Object.entries(selectors)) {
    result[name] = document.querySelector(selector).getBoundingClientRect().toJSON();
  }
  let fixedHeight = 0;
  for (const selector of [".reading-toolbar", "#graph-controls", "#logic-controls", ".graph-footer"]) {
    const element = document.querySelector(selector);
    if (getComputedStyle(element).display !== "none") fixedHeight += element.getBoundingClientRect().height;
  }
  const reading = document.querySelector("#reading-area");
  result.fixedHeight = fixedHeight;
  result.scrollHeight = reading.scrollHeight;
  result.clientHeight = reading.clientHeight;
  result.overflowY = getComputedStyle(reading).overflowY;
  return result;
}

/**
 * 读取原生图坐标、完整只读源码、选区和折叠等阅读状态。
 * Args:
 *   无。
 * Returns:
 *   object: 与面板尺寸无关的阅读状态，排除会自然夹紧的滚动像素。
 */
function layoutReadingContext() {
  const cy = document.querySelector("#graph")._cyreg.cy;
  const editor = document.querySelector("#source-view .cm-content").cmTile.root.view;
  const positions = {}, folds = [], highlights = [], logic = [], details = [];
  for (const node of cy.nodes()) positions[node.id()] = {...node.position()};
  /**
   * 收集原生编辑器中的折叠和原文高亮范围。
   * Args:
   *   from (number): 显示文档起点。
   *   to (number): 显示文档终点。
   *   value (Decoration): 原生装饰。
   * Returns:
   *   void: 保留实际状态范围。
   */
  function collectRange(from, to, value) {
    if (value.isReplace && value.spec.widget) folds.push({from, to});
    if (value.spec.class === "source-highlight") highlights.push({from, to});
  }
  for (const decoration of editor.state.facet(editor.constructor.decorations)) {
    const ranges = typeof decoration === "function" ? decoration(editor) : decoration;
    ranges.between(0, editor.state.doc.length, collectRange);
  }
  for (const element of document.querySelectorAll("#logic-view details[data-logic-id][open]")) logic.push(element.dataset.logicId);
  for (const element of document.querySelectorAll("#details details[data-section-key][open]")) details.push(element.dataset.sectionKey);
  return {
    positions, folds, highlights, logic, details, zoom: cy.zoom(), pan: {...cy.pan()},
    source: editor.state.doc.toString(), selection: editor.state.selection.toJSON(),
    sourcePath: document.querySelector("#source-path").textContent,
    heading: document.querySelector("#details h2").textContent,
  };
}

/**
 * 确认调整布局时没有重建当前源码内容节点。
 * Args:
 *   element (HTMLElement): 调整前保留的真实内容节点。
 * Returns:
 *   boolean: 该节点是否仍是当前编辑器内容节点。
 */
function sameLayoutSource(element) {
  return element === document.querySelector("#source-view .cm-content");
}

/**
 * 等待真实鼠标拖动建立原生指针捕获，取得实际指针编号。
 * Args:
 *   element (HTMLElement): 即将拖动的真实分隔条。
 * Returns:
 *   Promise<number>: 浏览器实际产生的指针编号。
 */
function capturedLayoutPointer(element) {
  return new Promise(registerCapture);
  /**
   * 登记一次真实捕获事件。
   * Args:
   *   resolve (Function): 将实际编号交回测试的完成函数。
   * Returns:
   *   void: 不更改产品状态或增加测试入口。
   */
  function registerCapture(resolve) {
    element.addEventListener("gotpointercapture", recordCapture, {once: true});
    /**
     * 读取浏览器原生捕获事件中的编号。
     * Args:
     *   event (PointerEvent): 真实鼠标拖动产生的事件。
     * Returns:
     *   void: 完成当前编号查询。
     */
    function recordCapture(event) { resolve(event.pointerId); }
  }
}

/**
 * 使用原生接口释放真实捕获，触发捕获丢失的取消流程。
 * Args:
 *   element (HTMLElement): 正在拖动的分隔条。
 *   pointerId (number): 真实事件中的编号。
 * Returns:
 *   void: 保留最后有效尺寸，不模拟拖动事件。
 */
function releaseLayoutPointer(element, pointerId) {
  element.releasePointerCapture(pointerId);
}

/**
 * 用真实鼠标拖动边界，可在移动后通过原生捕获丢失取消。
 * Args:
 *   page (Page): 真实浏览器页面。
 *   selector (string): 分隔条选择器。
 *   target (object): 目标客户端像素坐标。
 *   cancel (boolean): 是否在鼠标仍按下时释放捕获。
 * Returns:
 *   Promise<object>: 操作结束后的真实面板矩形。
 */
async function dragWorkspaceBoundary(page, selector, target, cancel = false) {
  const separator = page.locator(selector);
  await separator.scrollIntoViewIfNeeded();
  const box = await separator.boundingBox();
  const capture = cancel ? separator.evaluate(capturedLayoutPointer) : null;
  await page.mouse.move(Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2));
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, {steps: 8});
  const lastValid = await page.evaluate(workspaceGeometry);
  if (cancel) {
    await separator.evaluate(releaseLayoutPointer, await capture);
    // 后续真实移动应先交付 lostpointercapture，不能继续调整尺寸。
    await page.mouse.move(target.x + 24, target.y + 18, {steps: 3});
    const cancelled = await page.evaluate(workspaceGeometry);
    expect(cancelled.sidebar.width).toBe(lastValid.sidebar.width);
    expect(cancelled.details.width).toBe(lastValid.details.width);
    expect(cancelled.source.height).toBe(lastValid.source.height);
  }
  await page.mouse.up();
  await expect(separator).not.toHaveClass(/is-dragging/);
  await expect(page.locator("html")).not.toHaveClass(/is-resizing/);
  return page.evaluate(workspaceGeometry);
}

/**
 * 验收状态响应替身下的自动提示抑制，单独区别真实后端阅读链路。
 * Args:
 *   context (object): 真实页面与本测试专用的状态响应替身。
 * Returns:
 *   Promise<void>: 同分析的自动轮询不复活提示，新手动任务重新显示。
 */
async function dismissedPollingNoticeUiOnly({page}) {
  const audit = await offlineAudit(page);
  let starts = 0, polls = 0;
  /**
   * 只替代分析创建和持续状态，不制造或宣称修复真实后端错误。
   * Args:
   *   route (Route): 本测试的同源分析状态请求。
   * Returns:
   *   Promise<void>: 返回明确标注的固定前端状态输入。
   */
  async function statusFixture(route) {
    const request = route.request(), address = new URL(request.url());
    if (request.method() === "POST" && address.pathname === "/api/analyses") {
      starts += 1;
      await route.fulfill({json: {id: "ui-notice-fixture-" + starts}});
    } else if (request.method() === "GET") {
      polls += 1;
      await route.fulfill({json: {
        id: "ui-notice-fixture-" + starts, stage: "indexing",
        ready: false, structure_ready: false, stale: true,
        files_total: 3, files_processed: Math.min(polls, 3), calls_total: 6,
        calls_processed: Math.min(polls, 6), diagnostics: [],
      }});
    } else await route.continue();
  }
  /**
   * 读取替身状态实际响应的次数，等待自动轮询而不使用固定延时。
   * Args:
   *   无。
   * Returns:
   *   number: 已响应的状态查询次数。
   */
  function statusPollCount() { return polls; }
  await page.route(/\/api\/analyses(?:\/[^/?]+)?(?:\?.*)?$/, statusFixture);
  await page.goto("/");
  await page.getByTestId("project-path").fill(sampleRoot);
  await page.getByTestId("analyze-button").click();
  await expect(page.locator("#message")).toBeVisible();
  await expect(page.locator("#message-text")).toContainText(/变化/);
  await page.locator("#close-message").click();
  const closedAt = polls;
  await expect.poll(statusPollCount).toBeGreaterThanOrEqual(closedAt + 2);
  await expect(page.locator("#message")).toBeHidden();
  await page.getByTestId("language-select").selectOption("en");
  const englishAt = polls;
  await expect.poll(statusPollCount).toBeGreaterThanOrEqual(englishAt + 2);
  await expect(page.locator("#message")).toBeHidden();
  await page.getByTestId("language-select").selectOption("zh");
  await expect(page.locator("#message")).toBeHidden();

  // 再次手动发起相同目标属于新任务，允许同一自动原因重新提示。
  await page.getByTestId("analyze-button").click();
  await expect(page.locator("#message")).toBeVisible();
  expect(starts).toBe(2);
  await expect(page.locator("#message-text")).toContainText(/变化/);
  expect(audit.external).toEqual([]);
  expect(audit.errors).toEqual([]);
}
test("状态响应替身：关闭后自动轮询和切语言不复活提示", dismissedPollingNoticeUiOnly);

/**
 * 验收三条边界的真实拖动、极限、取消及双语小窗口连续阅读。
 * Args:
 *   context (object): Playwright 提供的真实浏览器页面。
 * Returns:
 *   Promise<void>: 布局可操作，原文、选区、折叠和图位置均保留。
 */
async function workspaceResizePreservesReading({page}) {
  const audit = await offlineAudit(page);
  await page.goto("/");
  await analyzeProject(page, sampleRoot);
  await openFile(page, "pipeline.py");
  await page.locator("#details .entity-row").getByRole("button", {name: "process", exact: true}).click();
  await expect(page.locator("#details h2")).toHaveText("process");
  await page.locator("#show-call").click();
  await expect(page.locator("#graph-summary")).toContainText("文件 / 类容器");
  await page.locator("#zoom-in").click();
  await page.locator("#source-view .cm-foldGutter span[title='折叠行']:visible").first().click();
  await expect(page.locator("#source-view .cm-foldPlaceholder")).toHaveCount(1);

  // 在真实只读源码中拖出非空选区，使状态保持检查有实际内容。
  const sourceLine = page.locator("#source-view .cm-line").filter({hasText: "def process("});
  await sourceLine.scrollIntoViewIfNeeded();
  const line = await sourceLine.boundingBox();
  await page.mouse.move(Math.round(line.x + 20), Math.round(line.y + line.height / 2));
  await page.mouse.down();
  await page.mouse.move(Math.round(line.x + 105), Math.round(line.y + line.height / 2), {steps: 5});
  await page.mouse.up();
  const original = await page.evaluate(layoutReadingContext);
  expect(original.selection.ranges[0].anchor).not.toBe(original.selection.ranges[0].head);
  expect(original.folds.length).toBeGreaterThan(0);
  const rawSource = await fs.readFile(path.join(sampleRoot, "pipeline.py"), "utf8");
  const expectedSource = rawSource.replace(/\r\n?/g, "\n");
  expect(original.source).toBe(expectedSource);
  const sourceNode = await page.locator("#source-view .cm-content").elementHandle();
  let geometry = await page.evaluate(workspaceGeometry);
  expect(geometry.sidebar.width).toBe(230);
  expect(geometry.details.width).toBe(345);
  expect(geometry.source.height).toBe(285);
  expect(geometry.sidebarBar.width).toBe(6);
  expect(geometry.detailsBar.width).toBe(6);
  expect(geometry.sourceBar.height).toBe(6);

  for (const [selector, orientation, controls] of [
    ["#sidebar-resizer", "vertical", "navigation-panel"],
    ["#details-resizer", "vertical", "details"],
    ["#source-resizer", "horizontal", "source-panel"],
  ]) {
    await expect(page.locator(selector)).toHaveAttribute("role", "separator");
    await expect(page.locator(selector)).toHaveAttribute("aria-orientation", orientation);
    // aria-controls 可以列出相邻两个面板，至少必须包含它直接调整的面板。
    const controlled = (await page.locator(selector).getAttribute("aria-controls")).split(/\s+/);
    expect(controlled).toContain(controls);
    await expect(page.locator(selector)).toHaveAccessibleName(/导航|详情|源码/);
  }

  // 三个方向分别实际移动；各次调整都必须保留完整阅读状态。
  geometry = await dragWorkspaceBoundary(page, "#sidebar-resizer", {
    x: Math.round(geometry.sidebarBar.x + 78), y: Math.round(geometry.sidebarBar.y + 40),
  });
  expect(geometry.sidebar.width).toBe(305);
  expect(await page.evaluate(layoutReadingContext)).toEqual(original);
  geometry = await dragWorkspaceBoundary(page, "#details-resizer", {
    x: Math.round(geometry.detailsBar.x - 67), y: Math.round(geometry.detailsBar.y + 40),
  });
  expect(geometry.details.width).toBe(415);
  expect(await page.evaluate(layoutReadingContext)).toEqual(original);
  geometry = await dragWorkspaceBoundary(page, "#source-resizer", {
    x: Math.round(geometry.sourceBar.x + 40), y: Math.round(geometry.sourceBar.y - 52),
  });
  expect(geometry.source.height).toBe(340);
  expect(await page.evaluate(layoutReadingContext)).toEqual(original);

  // 左右边界分别到达最小和共享上限；中央始终至少保留350像素。
  geometry = await dragWorkspaceBoundary(page, "#sidebar-resizer", {x: 1, y: 220});
  expect(geometry.sidebar.width).toBe(160);
  geometry = await dragWorkspaceBoundary(page, "#sidebar-resizer", {x: 1498, y: 220});
  expect(geometry.sidebar.width).toBeCloseTo(geometry.workspace.width - geometry.details.width - 12 - 350, 5);
  expect(geometry.reading.width).toBeGreaterThanOrEqual(350);
  geometry = await dragWorkspaceBoundary(page, "#sidebar-resizer", {
    x: Math.round(geometry.sidebarBar.x + 3 + 230 - geometry.sidebar.width), y: 220,
  });
  geometry = await dragWorkspaceBoundary(page, "#details-resizer", {x: 1498, y: 220});
  expect(geometry.details.width).toBe(240);
  geometry = await dragWorkspaceBoundary(page, "#details-resizer", {x: 1, y: 220});
  expect(geometry.details.width).toBeCloseTo(geometry.workspace.width - geometry.sidebar.width - 12 - 350, 5);
  expect(geometry.reading.width).toBeGreaterThanOrEqual(350);
  geometry = await dragWorkspaceBoundary(page, "#details-resizer", {
    x: Math.round(geometry.detailsBar.x + 3 + geometry.details.width - 345), y: 220,
  });

  // 源码上下边界按实际可用高度约束，不额外假定65vh上限。
  geometry = await dragWorkspaceBoundary(page, "#source-resizer", {
    x: Math.round(geometry.reading.x + 40), y: 1048,
  });
  expect(geometry.source.height).toBe(170);
  geometry = await dragWorkspaceBoundary(page, "#source-resizer", {
    x: Math.round(geometry.reading.x + 40), y: Math.round(geometry.reading.y + 1),
  });
  const sourceMaximum = Math.max(170, geometry.reading.height - geometry.fixedHeight - 6 - 180);
  expect(geometry.source.height).toBeCloseTo(sourceMaximum, 5);
  expect(geometry.canvas.height).toBeGreaterThanOrEqual(180);
  expect(await page.evaluate(layoutReadingContext)).toEqual(original);

  // 捕获丢失取消保留最后一次有效宽度，随后真实移动不能再拖动。
  geometry = await dragWorkspaceBoundary(page, "#sidebar-resizer", {
    x: Math.round(geometry.sidebarBar.x + 43), y: 240,
  }, true);
  expect(geometry.sidebar.width).toBe(270);
  expect(await page.evaluate(layoutReadingContext)).toEqual(original);
  expect(await sourceNode.evaluate(sameLayoutSource)).toBe(true);

  // 折叠状态仍在原生编辑器中；先真实滚回顶部，使第8行的折叠占位挂载并可见。
  const sourceViewport = await page.locator("#source-view .cm-scroller").boundingBox();
  await page.mouse.move(
    Math.round(sourceViewport.x + sourceViewport.width / 2),
    Math.round(sourceViewport.y + Math.min(sourceViewport.height / 2, 60)),
  );
  await page.mouse.wheel(0, -4000);
  await expect(page.locator("#source-view .cm-foldPlaceholder")).toBeInViewport();
  await page.evaluate(waitReadingFrames);
  expect(await page.evaluate(layoutReadingContext)).toEqual(original);

  // 英文和内部逻辑下继续调整；稳定帧后核对选区，源码不能接管原控件焦点。
  const focusBeforeLocale = await page.evaluate(readingFocusId);
  await page.getByTestId("language-select").selectOption("en");
  await page.evaluate(waitReadingFrames);
  expect(await page.evaluate(readingFocusId)).toBe(focusBeforeLocale);
  for (const selector of ["#sidebar-resizer", "#details-resizer", "#source-resizer"]) {
    await expect(page.locator(selector)).toHaveAccessibleName(/resize|adjust/i);
  }
  await expect(page.locator("#source-view .cm-foldPlaceholder")).toHaveAttribute("title", "unfold");
  expect(await page.evaluate(layoutReadingContext)).toEqual(original);
  await page.locator("#show-logic").click();
  await page.locator("#logic-expand").click();
  await expect(page.locator("#logic-view")).toContainText("for row in rows");
  const logicBefore = await page.evaluate(layoutReadingContext);
  expect(logicBefore.logic.length).toBeGreaterThan(0);
  geometry = await page.evaluate(workspaceGeometry);
  geometry = await dragWorkspaceBoundary(page, "#source-resizer", {
    x: Math.round(geometry.reading.x + 40), y: Math.round(geometry.sourceBar.y + 43),
  });
  expect(await page.evaluate(layoutReadingContext)).toEqual(logicBefore);
  await page.getByTestId("language-select").selectOption("zh");
  expect(await page.evaluate(layoutReadingContext)).toEqual(logicBefore);

  // 窄且较矮的窗口使用低高度下限，极短窗口通过中央滚动保留内容可达。
  await page.setViewportSize({width: 1000, height: 650});
  geometry = await page.evaluate(workspaceGeometry);
  expect(geometry.sidebar.width).toBeGreaterThanOrEqual(160);
  expect(geometry.details.width).toBeGreaterThanOrEqual(240);
  expect(geometry.reading.width).toBeGreaterThanOrEqual(350);
  expect(geometry.source.height).toBeGreaterThanOrEqual(150);
  expect(geometry.canvas.height).toBeGreaterThanOrEqual(140);
  geometry = await dragWorkspaceBoundary(page, "#source-resizer", {
    x: Math.round(geometry.reading.x + 40), y: 648,
  });
  expect(geometry.source.height).toBe(150);
  await page.setViewportSize({width: 900, height: 400});
  geometry = await page.evaluate(workspaceGeometry);
  expect(geometry.source.height).toBeGreaterThanOrEqual(150);
  expect(geometry.canvas.height).toBeGreaterThanOrEqual(140);
  expect(geometry.scrollHeight).toBeGreaterThan(geometry.clientHeight);
  expect(geometry.overflowY).toBe("auto");
  await page.locator("#source-panel").scrollIntoViewIfNeeded();
  await expect(page.locator("#source-view")).toBeInViewport();
  await page.locator("#definition-type").scrollIntoViewIfNeeded();
  await expect(page.locator("#definition-type")).toBeInViewport();
  expect(await page.evaluate(layoutReadingContext)).toEqual(logicBefore);
  expect(await sourceNode.evaluate(sameLayoutSource)).toBe(true);
  expect(await fs.readFile(path.join(sampleRoot, "pipeline.py"), "utf8")).toBe(rawSource);
  expect(audit.external).toEqual([]);
  expect(audit.errors).toEqual([]);
}
test("三条面板边界真实拖动并保留双语连续阅读", workspaceResizePreservesReading);

/**
 * 等待组件原生测量与选区事件经过两个浏览器动画帧。
 * Args:
 *   无。
 * Returns:
 *   Promise<void>: 不改变源码、选区或滚动位置。
 */
async function waitReadingFrames() {
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
}

/**
 * 读取当前操作控件的焦点标识。
 * Args:
 *   无。
 * Returns:
 *   string: 当前焦点元素的ID，未命名元素返回空字符串。
 */
function readingFocusId() {
  return document.activeElement?.id || "";
}

/**
 * 读取源码原生模型与浏览器文字选区，保留选区方向。
 * Args:
 *   无。
 * Returns:
 *   object: 原文、两种选区的端点、选中文字及选中行的真实视口边界。
 */
function sourceSelectionContext() {
  const content = document.querySelector("#source-view .cm-content");
  const editor = content.cmTile.root.view;
  const selection = document.getSelection();
  const anchorInside = !!selection?.anchorNode && content.contains(selection.anchorNode);
  const headInside = !!selection?.focusNode && content.contains(selection.focusNode);
  const anchor = anchorInside ? editor.posAtDOM(selection.anchorNode, selection.anchorOffset) : null;
  const head = headInside ? editor.posAtDOM(selection.focusNode, selection.focusOffset) : null;
  const line = selection?.anchorNode?.parentElement?.closest(".cm-line");
  return {
    source: editor.state.doc.toString(),
    model: {anchor: editor.state.selection.main.anchor, head: editor.state.selection.main.head},
    dom: {anchor, head, text: selection?.toString() || ""},
    line: line?.getBoundingClientRect().toJSON() || null,
    viewport: editor.scrollDOM.getBoundingClientRect().toJSON(),
    scrollTop: editor.scrollDOM.scrollTop,
  };
}

/**
 * 读取输入框独立的真实选区和焦点，避免混同于文档文字选区。
 * Args:
 *   element (HTMLInputElement): 真实项目路径输入框。
 * Returns:
 *   object: 输入值、选区方向和端点，以及是否仍拥有焦点。
 */
function inputSelectionContext(element) {
  return {
    value: element.value, start: element.selectionStart, end: element.selectionEnd,
    direction: element.selectionDirection, focused: document.activeElement === element,
  };
}

/**
 * 验收屏外反向源码选区和其他输入控件在语言切换时各自保持。
 * Args:
 *   context (object): Playwright 提供的真实浏览器页面。
 * Returns:
 *   Promise<void>: 原文、源码选择方向及输入框焦点和选区均保持。
 */
async function reverseSourceAndInputSelections({page}) {
  const audit = await offlineAudit(page);
  await page.goto("/");
  await analyzeProject(page, sampleRoot);
  await openFile(page, "pipeline.py");
  await page.locator("#details .entity-row").getByRole("button", {name: "process", exact: true}).click();
  await expect(page.locator("#details h2")).toHaveText("process");
  const sourceLine = page.locator("#source-view .cm-line").filter({hasText: "def process("});
  await sourceLine.scrollIntoViewIfNeeded();
  const box = await sourceLine.boundingBox();

  // 从右向左真实拖出非空选区，方向由浏览器和组件分别验证。
  await page.mouse.move(Math.round(box.x + 105), Math.round(box.y + box.height / 2));
  await page.mouse.down();
  await page.mouse.move(Math.round(box.x + 20), Math.round(box.y + box.height / 2), {steps: 5});
  await page.mouse.up();
  await page.evaluate(waitReadingFrames);
  const selected = await page.evaluate(sourceSelectionContext);
  const rawSource = await fs.readFile(path.join(sampleRoot, "pipeline.py"), "utf8");
  expect(selected.source).toBe(rawSource.replace(/\r\n?/g, "\n"));
  expect(selected.model.anchor).toBeGreaterThan(selected.model.head);
  expect(selected.dom.anchor).toBe(selected.model.anchor);
  expect(selected.dom.head).toBe(selected.model.head);
  expect(selected.dom.text.length).toBeGreaterThan(0);
  expect(selected.dom.text).toBe(selected.source.slice(selected.model.head, selected.model.anchor));

  // 真实滚动使选中的第47行离开屏幕；不能靠选择其他可见文字避开重绘边界。
  const viewport = await page.locator("#source-view .cm-scroller").boundingBox();
  await page.mouse.move(
    Math.round(viewport.x + viewport.width / 2),
    Math.round(viewport.y + Math.min(viewport.height / 2, 60)),
  );
  await page.mouse.wheel(0, -4000);
  await page.evaluate(waitReadingFrames);
  const offscreen = await page.evaluate(sourceSelectionContext);
  expect(offscreen.scrollTop).toBe(0);
  expect(offscreen.line).not.toBeNull();
  expect(offscreen.line.bottom <= offscreen.viewport.top || offscreen.line.top >= offscreen.viewport.bottom).toBe(true);
  expect(offscreen.model).toEqual(selected.model);
  expect(offscreen.dom).toEqual(selected.dom);
  const sourceFocus = await page.evaluate(readingFocusId);
  await page.getByTestId("language-select").selectOption("en");
  await page.evaluate(waitReadingFrames);
  const translated = await page.evaluate(sourceSelectionContext);
  expect(translated.model).toEqual(selected.model);
  expect(translated.dom).toEqual(selected.dom);
  expect(translated.source).toBe(selected.source);
  expect(await page.evaluate(readingFocusId)).toBe(sourceFocus);

  // 再由真实键盘选中输入框首字符，源码语言重绘不能接管别的控件选区。
  const projectInput = page.getByTestId("project-path");
  await projectInput.click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+ArrowRight");
  const inputBefore = await projectInput.evaluate(inputSelectionContext);
  expect(inputBefore).toMatchObject({value: sampleRoot, start: 0, end: 1, direction: "forward", focused: true});
  await page.getByTestId("language-select").selectOption("zh");
  await page.evaluate(waitReadingFrames);
  expect(await projectInput.evaluate(inputSelectionContext)).toEqual(inputBefore);
  expect((await page.evaluate(sourceSelectionContext)).source).toBe(selected.source);
  expect(await fs.readFile(path.join(sampleRoot, "pipeline.py"), "utf8")).toBe(rawSource);
  expect(audit.external).toEqual([]);
  expect(audit.errors).toEqual([]);
}

test("语言切换保留屏外反向源码选区和输入框选择", reverseSourceAndInputSelections);

import {t} from "./i18n";
import {EditorState, StateEffect, StateField, Compartment} from "@codemirror/state";
import {EditorView, Decoration, lineNumbers, highlightActiveLineGutter} from "@codemirror/view";
import {defaultHighlightStyle, syntaxHighlighting, foldGutter} from "@codemirror/language";
import {python} from "@codemirror/lang-python";

const markRange = StateEffect.define();
const highlightField = StateField.define({
  /** 创建空高亮。
   * Args: 无。
   * Returns: DecorationSet: 空装饰。 */
  create() { return Decoration.none; },
  /** 更新源码范围高亮。
   * Args: value (DecorationSet): 旧高亮；transaction (Transaction): 事务。
   * Returns: DecorationSet: 新高亮。 */
  update(value, transaction) {
    value = value.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(markRange)) {
        const {from, to} = effect.value;
        return to > from
          ? Decoration.set([Decoration.mark({class: "source-highlight"}).range(from, to)])
          : Decoration.none;
      }
    }
    return value;
  },
  /** 提供高亮扩展。
   * Args: field (StateField): 状态字段。
   * Returns: Extension: 装饰提供器。 */
  provide(field) { return EditorView.decorations.from(field); },
});

/**
 * 查找文本位置所在的行起点。
 * Args:
 *   starts (Array<number>): 严格递增的行起点。
 *   position (number): UTF-16 偏移。
 * Returns:
 *   number: 包含该位置的行索引。
 */
function lineIndex(starts, position) {
  let low = 0, high = starts.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    if (starts[middle] <= position) low = middle + 1;
    else high = middle - 1;
  }
  return Math.max(0, high);
}

/** 原文与编辑器换行坐标的双向映射；不改变后端原文。 */
export class SourceCoordinates {
  /**
   * 建立 CRLF、CR、LF 与编辑器单换行的映射。
   * Args:
   *   raw (string): 保留原始换行的源码。
   * Returns:
   *   SourceCoordinates: 原文与显示坐标转换对象。
   */
  constructor(raw) {
    // rawLength 为原文 UTF-16 长度；行起点仅按行保存，避免逐字符映射占用过多内存。
    this.rawLength = raw.length;
    this.rawStarts = [0];
    this.editorStarts = [0];
    this.contentLengths = [];
    const parts = [];
    let rawStart = 0, editorStart = 0, index = 0;
    while (index < raw.length) {
      const character = raw[index];
      if (character === "\r" || character === "\n") {
        const line = raw.slice(rawStart, index);
        parts.push(line);
        this.contentLengths.push(line.length);
        const width = character === "\r" && raw[index + 1] === "\n" ? 2 : 1;
        rawStart = index + width;
        editorStart += line.length + 1;
        this.rawStarts.push(rawStart);
        this.editorStarts.push(editorStart);
        index += width;
      } else index += 1;
    }
    parts.push(raw.slice(rawStart));
    this.contentLengths.push(raw.length - rawStart);
    // editorText 只用于显示，全部外部范围仍以 raw 原文计数。
    this.editorText = parts.join("\n");
  }

  /**
   * 将原文 UTF-16 偏移转为显示偏移。
   * Args:
   *   offset (number): 原文中的偏移。
   * Returns:
   *   number: 编辑器中的对应位置。
   */
  toEditor(offset) {
    const position = Math.max(0, Math.min(this.rawLength, Number(offset) || 0));
    const line = lineIndex(this.rawStarts, position);
    return this.editorStarts[line] + Math.min(position - this.rawStarts[line], this.contentLengths[line]);
  }

  /**
   * 将编辑器 UTF-16 偏移转回原文偏移。
   * Args:
   *   offset (number): 显示文本中的偏移。
   * Returns:
   *   number: 可直接发送后端的原文位置。
   */
  toRaw(offset) {
    const position = Math.max(0, Math.min(this.editorText.length, Number(offset) || 0));
    const line = lineIndex(this.editorStarts, position);
    return this.rawStarts[line] + Math.min(position - this.editorStarts[line], this.contentLengths[line]);
  }
}

/** 只读原文面板，所有名称语义由后端查询。 */
export class SourceView {
  /**
   * 建立源码显示组件。
   * Args:
   *   container (HTMLElement): 所在容器。
   *   onPosition (Function): 源码位置选择回调。
   * Returns:
   *   SourceView: 可高亮定位的只读原文面板。
   */
  constructor(container, onPosition) {
    // path/fileId 是当前原文来源，外部预览没有项目内文件标识。
    this.path = "";
    this.fileId = "";
    // originalText 保存未经换行正规化的原文；coordinates 负责显示边界转换。
    this.originalText = "";
    this.coordinates = new SourceCoordinates("");
    // onPosition 把原文位置交给统一名称查询；view 仅用于显示，不保存目标源码。
    this.onPosition = onPosition;
    // locale 仅重配置组件工具文案，保留原文、选择与折叠状态。
    this.locale = new Compartment();
    this.view = new EditorView({parent: container, state: this.createEditorState("")});
  }

  /**
   * 创建只读编辑器状态。
   * Args:
   *   text (string): 使用单换行的显示文本。
   * Returns:
   *   EditorState: 带语法着色的只读状态。
   */
  createEditorState(text) {
    return EditorState.create({
      doc: text,
      extensions: [
        EditorState.readOnly.of(true), EditorView.editable.of(false),
        lineNumbers(), highlightActiveLineGutter(), python(),
        this.locale.of(this.languageExtensions()),
        syntaxHighlighting(defaultHighlightStyle), highlightField,
        EditorView.domEventHandlers({click: this.handleClick.bind(this)}),
        EditorView.theme({
          "&": {height: "100%", fontSize: "13px"},
          ".cm-scroller": {overflow: "auto", fontFamily: "Consolas, 'Cascadia Code', monospace"},
          ".cm-content": {padding: "12px 0"},
          ".cm-line": {padding: "0 18px"},
          ".cm-gutters": {backgroundColor: "#f7f9fc", borderRight: "1px solid #e5eaf0"},
        }),
      ],
    });
  }

  /**
   * 将显示点击位置转回原文位置。
   * Args:
   *   event (MouseEvent): 点击事件。
   *   view (EditorView): 显示组件。
   * Returns:
   *   boolean: false 表示保留默认选择行为。
   */
  handleClick(event, view) {
    const offset = view.posAtCoords({x: event.clientX, y: event.clientY});
    if (offset !== null) this.onPosition(this.position(this.coordinates.toRaw(offset)));
    return false;
  }

  /**
   * 获取原文偏移对应的显示行列。
   * Args:
   *   rawOffset (number): 原文 UTF-16 偏移。
   * Returns:
   *   object: 原文偏移及可显示行列。
   */
  position(rawOffset) {
    const offset = this.coordinates.toEditor(rawOffset);
    const line = this.view.state.doc.lineAt(offset);
    return {offset: this.coordinates.toRaw(offset), line: line.number, column: offset - line.from};
  }

  /**
   * 显示本次分析原文或外部预览。
   * Args:
   *   data (object): 文件标识、原文和来源。
   *   range (object|null): 原文坐标范围。
   *   scroll (number|null): 恢复滚动位置，null 则定位范围。
   * Returns:
   *   void: 更新显示与高亮。
   */
  show(data, range = null, scroll = null) {
    const raw = data.source || "";
    if (this.fileId !== (data.id || "") || this.originalText !== raw) {
      this.fileId = data.id || "";
      this.path = data.path || "";
      this.originalText = raw;
      this.coordinates = new SourceCoordinates(raw);
      this.view.setState(this.createEditorState(this.coordinates.editorText));
    }
    this.highlight(range, scroll === null);
    if (scroll !== null) this.view.scrollDOM.scrollTop = scroll;
  }

  /**
   * 将原文范围转换为编辑器高亮。
   * Args:
   *   range (object|null): 原文 UTF-16 from/to。
   *   scroll (boolean): 是否滚动到范围。
   * Returns:
   *   void: 更新高亮位置。
   */
  highlight(range, scroll = true) {
    const from = this.coordinates.toEditor(range?.from || 0);
    const to = Math.max(from, this.coordinates.toEditor(range?.to ?? range?.from ?? 0));
    const effects = [markRange.of({from, to})];
    if (scroll && range) effects.push(EditorView.scrollIntoView(from, {y: "center"}));
    this.view.dispatch({effects, selection: {anchor: from, head: to}});
  }


  /**
   * 提供源码组件自身的工具说明，不接触项目文本。
   * Args:
   *   无。
   * Returns:
   *   Array<Extension>: 语言短语、折叠栏及无障碍说明。
   */
  languageExtensions() {
    return [
      EditorState.phrases.of({
        "Fold line": t("editor.foldLine"), "Unfold line": t("editor.unfoldLine"),
        "Folded lines": t("editor.foldedLines"), "Unfolded lines": t("editor.unfoldedLines"),
        "folded code": t("editor.foldedCode"), "unfold": t("editor.unfold"), "to": t("editor.to"),
      }),
      foldGutter(),
      EditorView.contentAttributes.of({"aria-label": t("source.heading")}),
    ];
  }

  /**
   * 通过组件原生配置切换工具语言，保留阅读状态。
   * Args:
   *   无。
   * Returns:
   *   void: 更新组件提示，并在原生布局测量阶段恢复阅读位置。
   */
  localize() {
    // 语言重配置会替换文本子节点，先将属于源码的浏览器选区转换为稳定文档位置。
    const selection = this.view.dom.ownerDocument.getSelection();
    const content = this.view.contentDOM;
    const sourceSelection = selection && content.contains(selection.anchorNode) &&
      content.contains(selection.focusNode)
      ? {anchor: this.view.posAtDOM(selection.anchorNode, selection.anchorOffset),
        head: this.view.posAtDOM(selection.focusNode, selection.focusOffset)}
      : null;
    const scroll = this.view.scrollSnapshot();
    this.view.dispatch({effects: this.locale.reconfigure(this.languageExtensions())});
    // 同步绑定新节点，避免失效端点被当作用户新选择回写；其他控件的选区不由此接管。
    if (sourceSelection) {
      const forward = sourceSelection.anchor <= sourceSelection.head;
      const anchor = this.view.domAtPos(sourceSelection.anchor, forward ? 1 : -1);
      const head = sourceSelection.anchor === sourceSelection.head
        ? anchor : this.view.domAtPos(sourceSelection.head, forward ? -1 : 1);
      selection.setBaseAndExtent(anchor.node, anchor.offset, head.node, head.offset);
    }
    // phrases 更新会在库内部提前返回；另行提交快照，使后续布局测量恢复阅读位置。
    this.view.dispatch({effects: scroll});
    // 折叠占位控件会缓存自身 DOM，仅更新这类已知工具属性。
    for (const placeholder of this.view.dom.querySelectorAll(".cm-foldPlaceholder")) {
      placeholder.setAttribute("aria-label", t("editor.foldedCode"));
      placeholder.title = t("editor.unfold");
    }
  }
  /**
   * 获取当前源码滚动距离。
   * Args:
   *   无。
   * Returns:
   *   number: 顶部滚动距离。
   */
  scrollPosition() { return this.view.scrollDOM.scrollTop; }
}

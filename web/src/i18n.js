/** 明确的工具界面中英文文案；不用于翻译项目源码或注释。 */
const messages = {
  "action.closeMessage": {
    "zh": "关闭提示",
    "en": "Dismiss message"
  },
  "layout.resizeNavigation": {
    "zh": "调整项目导航宽度",
    "en": "Resize project navigation"
  },
  "layout.resizeDetails": {
    "zh": "调整阅读详情宽度",
    "en": "Resize reading details"
  },
  "layout.resizeSource": {
    "zh": "调整源码区域高度",
    "en": "Resize source height"
  },
  "graph.focusSelection": {
    "zh": "以此为中心",
    "en": "Focus selection"
  },
  "graph.moduleBody": {
    "zh": "模块顶层",
    "en": "Module body"
  },
  "graph.externalCalls": {
    "zh": "外部调用",
    "en": "External calls"
  },
  "graph.unresolvedCalls": {
    "zh": "未解析调用",
    "en": "Unresolved calls"
  },
  "graph.membersShown": {
    "zh": "{shown}/{total} 个成员",
    "en": "{shown}/{total} members"
  },
  "graph.partialMembers": {
    "zh": "另有 {count} 个成员未显示",
    "en": "{count} more members are not shown"
  },
  "graph.hiddenEdges": {
    "zh": "另有{count}条关系未显示",
    "en": "{count} more relationships are not shown"
  },
  "graph.callStructureHint": {
    "zh": "文件 / 类容器 · 点击阅读，使用“以此为中心”改变范围",
    "en": "File / class containers · select to read; use Focus selection to change scope"
  },
  "app.title": {
    "zh": "PythonProjectReader · 项目代码阅读",
    "en": "PythonProjectReader · Project Code Reader"
  },
  "app.subtitle": {
    "zh": "本地 Python 项目代码阅读",
    "en": "Local Python project code reader"
  },
  "app.offline": {
    "zh": "本地离线分析",
    "en": "Local offline analysis"
  },
  "app.runtime": {
    "zh": "本地离线 · Python {version}",
    "en": "Local offline · Python {version}"
  },
  "app.language": {
    "zh": "界面语言",
    "en": "Interface language"
  },
  "project.path": {
    "zh": "项目目录",
    "en": "Project directory"
  },
  "project.placeholder": {
    "zh": "输入本地 Python 项目根目录",
    "en": "Enter a local Python project directory"
  },
  "project.analyze": {
    "zh": "分析项目",
    "en": "Analyze project"
  },
  "project.reanalyze": {
    "zh": "重新分析",
    "en": "Reanalyze"
  },
  "project.cancel": {
    "zh": "取消分析",
    "en": "Cancel analysis"
  },
  "project.settings": {
    "zh": "分析设置",
    "en": "Analysis settings"
  },
  "project.sourceRoots": {
    "zh": "源码根目录（每行一个，留空使用项目根）",
    "en": "Source roots (one per line; blank uses project root)"
  },
  "project.dependencies": {
    "zh": "依赖源码或类型存根目录（只读，每行一个）",
    "en": "Dependency source or stub directories (read only; one per line)"
  },
  "project.exclusions": {
    "zh": "排除目录名（每行一个，留空使用默认范围）",
    "en": "Excluded directories (one per line; blank uses defaults)"
  },
  "project.stubs": {
    "zh": "包含 .pyi 存根",
    "en": "Include .pyi stubs"
  },
  "project.timeout": {
    "zh": "单次查询超时（秒）",
    "en": "Query timeout (seconds)"
  },
  "project.readOnly": {
    "zh": "只读解析源码，不运行目标项目、不自动安装目标依赖。",
    "en": "Reads source without running the project or installing its dependencies."
  },
  "project.choose": {
    "zh": "选择一个项目开始阅读",
    "en": "Choose a project to start reading"
  },
  "project.waiting": {
    "zh": "正在读取项目…",
    "en": "Reading project…"
  },
  "project.structureReady": {
    "zh": "源码结构就绪后，可以选择文件开始阅读。",
    "en": "Choose a file once source structure is available."
  },
  "project.noFiles": {
    "zh": "当前范围没有 Python 文件，请检查目录与排除设置。",
    "en": "No Python files in this scope. Check the directory and exclusions."
  },
  "navigation.project": {
    "zh": "项目导航",
    "en": "Project navigation"
  },
  "navigation.search": {
    "zh": "搜索",
    "en": "Search"
  },
  "navigation.searchAria": {
    "zh": "搜索文件或符号",
    "en": "Search files or symbols"
  },
  "navigation.searchPlaceholder": {
    "zh": "文件 / 函数 / 类",
    "en": "File / function / class"
  },
  "navigation.filePending": {
    "zh": "分析后显示文件与入口。",
    "en": "Files and entry points appear after analysis."
  },
  "navigation.sourceReadOnly": {
    "zh": "源码只读 · 无需 LLM",
    "en": "Read-only source · No LLM required"
  },
  "navigation.unknownKept": {
    "zh": "动态关系保留候选与未知状态",
    "en": "Dynamic relationships retain candidates and unknown states"
  },
  "navigation.back": {
    "zh": "返回",
    "en": "Back"
  },
  "navigation.forward": {
    "zh": "前进",
    "en": "Forward"
  },
  "navigation.mode": {
    "zh": "阅读模式",
    "en": "Reading mode"
  },
  "navigation.module": {
    "zh": "文件关系",
    "en": "File relationships"
  },
  "navigation.call": {
    "zh": "函数调用",
    "en": "Function calls"
  },
  "navigation.logic": {
    "zh": "内部逻辑",
    "en": "Internal logic"
  },
  "navigation.none": {
    "zh": "尚未选择",
    "en": "Nothing selected"
  },
  "navigation.entrypoints": {
    "zh": "入口候选",
    "en": "Entry point candidates"
  },
  "navigation.entry": {
    "zh": "入口",
    "en": "Entry point"
  },
  "navigation.unresolvedEntry": {
    "zh": "未解析为可定位定义",
    "en": "No navigable definition resolved"
  },
  "graph.relationKind": {
    "zh": "文件关系种类",
    "en": "File relationship type"
  },
  "graph.imports": {
    "zh": "导入关系",
    "en": "Imports"
  },
  "graph.references": {
    "zh": "符号引用",
    "en": "Symbol references"
  },
  "graph.direction": {
    "zh": "关系方向",
    "en": "Relationship direction"
  },
  "graph.both": {
    "zh": "上下游",
    "en": "Upstream and downstream"
  },
  "graph.outgoing": {
    "zh": "下游",
    "en": "Downstream"
  },
  "graph.incoming": {
    "zh": "上游",
    "en": "Upstream"
  },
  "graph.depth": {
    "zh": "深度",
    "en": "Depth"
  },
  "graph.internalOnly": {
    "zh": "仅项目内",
    "en": "Project only"
  },
  "graph.indexReferences": {
    "zh": "建立引用索引",
    "en": "Index references"
  },
  "graph.reindexReferences": {
    "zh": "重新索引引用",
    "en": "Reindex references"
  },
  "graph.indexingReferences": {
    "zh": "引用索引中…",
    "en": "Indexing references…"
  },
  "graph.whole": {
    "zh": "项目全图",
    "en": "Whole project"
  },
  "graph.zoomOut": {
    "zh": "缩小",
    "en": "Zoom out"
  },
  "graph.zoomIn": {
    "zh": "放大",
    "en": "Zoom in"
  },
  "graph.fit": {
    "zh": "适应",
    "en": "Fit"
  },
  "graph.hint": {
    "zh": "关系图支持拖动、缩放和按需展开",
    "en": "Drag, zoom, and expand relationships as needed"
  },
  "graph.loadMore": {
    "zh": "继续加载",
    "en": "Load more"
  },
  "graph.summary": {
    "zh": "{nodes} 个可见节点 · {edges} 条关系",
    "en": "{nodes} visible nodes · {edges} relationships"
  },
  "graph.remaining": {
    "zh": " · 另有 {count} 项可继续加载",
    "en": " · {count} more available"
  },
  "graph.empty": {
    "zh": "当前范围没有可显示关系，可从文件与成员继续阅读。",
    "en": "No visible relationships in this scope. Continue through files and members."
  },
  "graph.externalBoundary": {
    "zh": "外部与未解析边界",
    "en": "External or unresolved boundary"
  },
  "graph.notNavigable": {
    "zh": "此节点没有可直接跳转的项目定义，可查看关联调用和源码。",
    "en": "This node has no directly navigable project definition. Inspect its related calls and source."
  },
  "empty.title": {
    "zh": "沿着代码关系，理解项目实现",
    "en": "Understand a project through its code relationships"
  },
  "empty.intro": {
    "zh": "选择本地项目，浏览文件、函数和对象。",
    "en": "Choose a local project to browse files, functions, and objects."
  },
  "empty.evidence": {
    "zh": "每一条关系都能回到源码。",
    "en": "Follow each relationship back to its source."
  },
  "source.heading": {
    "zh": "原始源码",
    "en": "Original source"
  },
  "source.choose": {
    "zh": "选择定义或调用位置查看",
    "en": "Select a definition or call site"
  },
  "source.waiting": {
    "zh": "等待选择源码",
    "en": "Waiting for source selection"
  },
  "source.binding": {
    "zh": "绑定定义",
    "en": "Binding definition"
  },
  "source.type": {
    "zh": "所属类 / 最终定义",
    "en": "Class / final definition"
  },
  "source.locate": {
    "zh": "定位源码",
    "en": "Locate source"
  },
  "source.stale": {
    "zh": "源码已变化：当前展示的是本次分析原文，请重新分析。",
    "en": "Source changed. The displayed text belongs to this analysis; reanalyze to refresh."
  },
  "source.projectStale": {
    "zh": "项目源码已变化，请重新分析。当前显示上一次读取的原文和位置。",
    "en": "Project source changed. Reanalyze; displayed text and positions are from the previous read."
  },
  "detail.heading": {
    "zh": "阅读详情",
    "en": "Reading details"
  },
  "detail.start": {
    "zh": "从文件开始",
    "en": "Start with a file"
  },
  "detail.intro": {
    "zh": "选择文件查看说明和成员，选择函数查看输入输出、对象和调用逻辑。",
    "en": "Select a file for documentation and members, or a function for inputs, outputs, objects, and calls."
  },
  "detail.unspecified": {
    "zh": "未提供",
    "en": "Not provided"
  },
  "detail.noDoc": {
    "zh": "无现有说明",
    "en": "No existing documentation"
  },
  "detail.nearbyComments": {
    "zh": "原始注释 / 定义附近注释",
    "en": "Original / nearby comments"
  },
  "detail.noMembers": {
    "zh": "没有提取到文件成员。",
    "en": "No file members were extracted."
  },
  "detail.noImports": {
    "zh": "文件没有显式导入。",
    "en": "No explicit imports in this file."
  },
  "detail.import": {
    "zh": "导入",
    "en": "Import"
  },
  "detail.importPending": {
    "zh": "尚无可定位目标；导入表达式已保留。",
    "en": "No navigable target yet; the import expression is retained."
  },
  "detail.references": {
    "zh": "符号引用位置（含待处理记录）",
    "en": "Symbol reference sites (including pending records)"
  },
  "detail.reference": {
    "zh": "引用",
    "en": "Reference"
  },
  "detail.referenceLocation": {
    "zh": "引用位置",
    "en": "Reference site"
  },
  "detail.referencePending": {
    "zh": "待索引：尚未查询此处的定义目标。",
    "en": "Pending: this site's definition has not been queried."
  },
  "detail.incomingReferences": {
    "zh": "其他文件对本文件的引用",
    "en": "References from other files"
  },
  "detail.incomingImports": {
    "zh": "导入本模块的文件",
    "en": "Files importing this module"
  },
  "detail.importLocation": {
    "zh": "导入位置",
    "en": "Import site"
  },
  "detail.noParams": {
    "zh": "没有显式参数。",
    "en": "No explicit parameters."
  },
  "detail.noAnnotation": {
    "zh": "无类型注解",
    "en": "No type annotation"
  },
  "detail.returnAnnotation": {
    "zh": "返回注解",
    "en": "Return annotation"
  },
  "detail.noReturns": {
    "zh": "没有显式返回表达式。",
    "en": "No explicit return expression."
  },
  "detail.return": {
    "zh": "返回",
    "en": "Return"
  },
  "detail.yield": {
    "zh": "产出",
    "en": "Yield"
  },
  "detail.expressionHint": {
    "zh": "默认值与返回值显示源码表达式，不计算运行时内容。参数和返回说明见原有文档。",
    "en": "Defaults and returns show source expressions, not runtime values. See the original documentation for descriptions."
  },
  "detail.noCalls": {
    "zh": "当前索引范围内没有已记录的调用位置。",
    "en": "No call sites recorded in the current indexed scope."
  },
  "detail.targetUnknown": {
    "zh": "目标尚未确定",
    "en": "Target not determined"
  },
  "detail.bases": {
    "zh": "基类表达式",
    "en": "Base class expressions"
  },
  "detail.noBases": {
    "zh": "未声明",
    "en": "Not declared"
  },
  "detail.annotation": {
    "zh": "类型注解",
    "en": "Type annotation"
  },
  "detail.assignment": {
    "zh": "赋值表达式",
    "en": "Assignment expression"
  },
  "detail.bindingLocation": {
    "zh": "绑定位置",
    "en": "Binding site"
  },
  "detail.objectType": {
    "zh": "查看所属类 / 定义",
    "en": "View class / definition"
  },
  "detail.callIndexing": {
    "zh": "调用关系仍在索引中；下列列表尚未完整。",
    "en": "Calls are still being indexed; the lists below are incomplete."
  },
  "detail.file": {
    "zh": "文件 / 模块",
    "en": "File / module"
  },
  "detail.parseStatus": {
    "zh": "解析状态",
    "en": "Parse status"
  },
  "detail.definitionNavigation": {
    "zh": "源码名称导航",
    "en": "Source name navigation"
  },
  "detail.bindingHint": {
    "zh": "变量绑定位置与其可能的类型分开展示。",
    "en": "Variable bindings and their possible types are shown separately."
  },
  "detail.typeHint": {
    "zh": "以下为静态分析候选，不代表运行时值。",
    "en": "These are static analysis candidates, not runtime values."
  },
  "detail.noTargets": {
    "zh": "没有可确定的定义候选。原表达式仍可在源码中查看。",
    "en": "No definition candidate could be determined. The original expression remains available."
  },
  "detail.project": {
    "zh": "项目内",
    "en": "In project"
  },
  "detail.external": {
    "zh": "外部",
    "en": "External"
  },
  "detail.externalDefinition": {
    "zh": "外部定义",
    "en": "External definition"
  },
  "detail.externalPreview": {
    "zh": "下方显示可获得的源码或存根。",
    "en": "Available source or stub text is shown below."
  },
  "detail.externalNoSource": {
    "zh": "没有可展示的 Python 源码，可能是内置或二进制实现。",
    "en": "No Python source is available; this may be a built-in or binary implementation."
  },
  "detail.querying": {
    "zh": "正在查询定义…",
    "en": "Looking up definition…"
  },
  "call.site": {
    "zh": "一次调用位置",
    "en": "One call site"
  },
  "call.title": {
    "zh": "函数调用",
    "en": "Function call"
  },
  "call.locate": {
    "zh": "定位调用",
    "en": "Locate call"
  },
  "call.caller": {
    "zh": "查看调用方",
    "en": "View caller"
  },
  "call.keyword": {
    "zh": "关键字 {name}",
    "en": "Keyword {name}"
  },
  "call.position": {
    "zh": "位置 {number}",
    "en": "Position {number}"
  },
  "call.emptyExpression": {
    "zh": "空表达式",
    "en": "Empty expression"
  },
  "call.parameter": {
    "zh": "签名参数：{name}",
    "en": "Signature parameter: {name}"
  },
  "call.noArguments": {
    "zh": "此处没有显式实参。",
    "en": "No explicit arguments at this call site."
  },
  "call.argumentsHint": {
    "zh": "展示调用处原表达式；展开参数、绑定方法或多候选时，以原文和目标签名为准。",
    "en": "Shows original argument expressions. For unpacking, bound methods, or multiple targets, consult the source and signature."
  },
  "call.noReceiver": {
    "zh": "此处没有直接接收赋值；可查看所在语句。",
    "en": "No direct receiving assignment here; inspect the containing statement."
  },
  "call.context": {
    "zh": "所属逻辑",
    "en": "Logic context"
  },
  "call.seeLogic": {
    "zh": "见内部逻辑视图",
    "en": "See internal logic"
  },
  "call.unresolved": {
    "zh": "调用目标尚未确定，已保留原表达式。",
    "en": "The call target is not determined; the original expression is retained."
  },
  "call.relationship": {
    "zh": "关系连线",
    "en": "Relationship edge"
  },
  "call.sites": {
    "zh": "调用位置",
    "en": "Call sites"
  },
  "call.moduleRelationship": {
    "zh": "模块关系",
    "en": "Module relationship"
  },
  "call.referenceJump": {
    "zh": "点击引用可定位源码。",
    "en": "Select a reference to locate its source."
  },
  "call.selectEndpoints": {
    "zh": "选择两端文件查看原始导入和引用。",
    "en": "Select endpoint files to view original imports and references."
  },
  "section.description": {
    "zh": "原有说明与注释",
    "en": "Original documentation and comments"
  },
  "section.members": {
    "zh": "文件成员与全局定义",
    "en": "File members and global definitions"
  },
  "section.imports": {
    "zh": "导入与跨文件引用",
    "en": "Imports and cross-file references"
  },
  "section.io": {
    "zh": "输入与输出",
    "en": "Inputs and outputs"
  },
  "section.classMembers": {
    "zh": "方法与属性",
    "en": "Methods and attributes"
  },
  "section.objects": {
    "zh": "局部对象与定义",
    "en": "Local objects and definitions"
  },
  "section.outgoing": {
    "zh": "调用的函数与构造位置",
    "en": "Callees and construction sites"
  },
  "section.incoming": {
    "zh": "调用者与调用位置",
    "en": "Callers and call sites"
  },
  "section.arguments": {
    "zh": "调用实参与目标签名",
    "en": "Call arguments and target signature"
  },
  "section.receiver": {
    "zh": "返回结果的直接接收",
    "en": "Direct receiver of the result"
  },
  "section.targets": {
    "zh": "被调定义与所属模块",
    "en": "Callee definitions and modules"
  },
  "section.edgeCalls": {
    "zh": "选择一次调用查看参数与源码",
    "en": "Select a call to inspect arguments and source"
  },
  "logic.heading": {
    "zh": "函数内部逻辑",
    "en": "Function internal logic"
  },
  "logic.intro": {
    "zh": "按源码结构展开；调用按钮可查看实参、结果接收语句与被调定义。",
    "en": "Expand source structure; select a call to inspect arguments, receivers, and target definitions."
  },
  "logic.expand": {
    "zh": "全部展开",
    "en": "Expand all"
  },
  "logic.collapse": {
    "zh": "全部收起",
    "en": "Collapse all"
  },
  "logic.hint": {
    "zh": "条件与表达式保留原文，点击调用继续阅读",
    "en": "Conditions and expressions remain original; select calls to continue"
  },
  "logic.summary": {
    "zh": "函数源码结构 · 调用项可查看参数与定义",
    "en": "Function source structure · Select calls for arguments and definitions"
  },
  "logic.chooseFunction": {
    "zh": "先从文件成员或调用图选择一个函数，再展开内部逻辑。",
    "en": "Select a function from file members or the call graph first."
  },
  "logic.source": {
    "zh": "查看这段源码",
    "en": "View this source block"
  },
  "logic.call": {
    "zh": "查看调用",
    "en": "View call"
  },
  "logic.transfer": {
    "zh": "{kind}：显式转移，具体条件见原文。",
    "en": "{kind}: explicit transfer; see the source for conditions."
  },
  "logic.loopTarget": {
    "zh": "查看所属循环 / 转移位置",
    "en": "View enclosing loop / transfer site"
  },
  "logic.finally": {
    "zh": "离开前关联的 finally 区块",
    "en": "Related finally block on exit"
  },
  "logic.exceptionHint": {
    "zh": "分区展示异常处理结构，不枚举所有隐式异常路径。",
    "en": "Shows exception-handling structure without enumerating every implicit exception path."
  },
  "logic.block": {
    "zh": "语句块",
    "en": "Statement block"
  },
  "logic.emptyBlock": {
    "zh": "空语句块",
    "en": "Empty block"
  },
  "logic.noBody": {
    "zh": "此定义没有可展开的函数体。",
    "en": "This definition has no expandable function body."
  },
  "references.project": {
    "zh": "项目范围显式引用已索引：{processed}/{total}；动态关系仍可能未解析。",
    "en": "Project-wide explicit references indexed: {processed}/{total}; dynamic relationships may remain unresolved."
  },
  "references.file": {
    "zh": "当前文件显式引用已索引：{processed}/{total}；其他文件的反向引用尚未完成全项目索引。",
    "en": "Current-file explicit references indexed: {processed}/{total}; reverse references from other files are not fully indexed."
  },
  "references.partial": {
    "zh": "已完成 {count} 个文件的引用索引；未完成项目范围索引。",
    "en": "References indexed for {count} files; project-wide indexing is incomplete."
  },
  "references.pending": {
    "zh": "尚未完成符号引用索引；待处理位置不代表没有引用。",
    "en": "Reference indexing is incomplete; pending sites do not imply no references."
  },
  "status.progress": {
    "zh": "文件 {files}/{filesTotal} · 调用位置 {calls}/{callsTotal}",
    "en": "Files {files}/{filesTotal} · Call sites {calls}/{callsTotal}"
  },
  "status.diagnostics": {
    "zh": "诊断 {count}",
    "en": "Diagnostics {count}"
  },
  "status.noDiagnostics": {
    "zh": "当前没有诊断。静态查询仍可能保留无法确定的动态关系。",
    "en": "No diagnostics currently. Static queries may still retain unresolved dynamic relationships."
  },
  "status.diagnostic": {
    "zh": "分析诊断",
    "en": "Analysis diagnostics"
  },
  "status.failedHint": {
    "zh": "分析失败，请查看诊断。",
    "en": "Analysis failed. See diagnostics."
  },
  "status.analyzing": {
    "zh": "正在分析",
    "en": "Analyzing"
  },
  "status.scanning": {
    "zh": "读取文件",
    "en": "Reading files"
  },
  "status.extracting": {
    "zh": "提取源码结构",
    "en": "Extracting source structure"
  },
  "status.indexing": {
    "zh": "索引调用关系",
    "en": "Indexing calls"
  },
  "status.ready": {
    "zh": "分析完成",
    "en": "Analysis complete"
  },
  "status.failed": {
    "zh": "分析失败",
    "en": "Analysis failed"
  },
  "status.cancelled": {
    "zh": "已取消",
    "en": "Cancelled"
  },
  "status.idle": {
    "zh": "等待分析",
    "en": "Waiting for analysis"
  },
  "status.resolved": {
    "zh": "已解析",
    "en": "Resolved"
  },
  "status.ambiguous": {
    "zh": "多个候选",
    "en": "Multiple candidates"
  },
  "status.unresolved": {
    "zh": "无法确定",
    "en": "Unresolved"
  },
  "status.pending": {
    "zh": "待索引",
    "en": "Pending"
  },
  "status.error": {
    "zh": "查询失败",
    "en": "Query failed"
  },
  "status.interrupted": {
    "zh": "查询中断",
    "en": "Query interrupted"
  },
  "status.ok": {
    "zh": "正常",
    "en": "OK"
  },
  "status.parsed": {
    "zh": "已解析",
    "en": "Parsed"
  },
  "status.success": {
    "zh": "正常",
    "en": "OK"
  },
  "status.read_error": {
    "zh": "读取失败",
    "en": "Read failed"
  },
  "status.syntax_error": {
    "zh": "语法错误",
    "en": "Syntax error"
  },
  "search.none": {
    "zh": "没有匹配的文件或定义。",
    "en": "No matching files or definitions."
  },
  "search.remaining": {
    "zh": "另有 {count} 项，请增加搜索条件。",
    "en": "{count} more matches; refine the search."
  },
  "kind.file": {
    "zh": "文件",
    "en": "File"
  },
  "kind.module": {
    "zh": "模块",
    "en": "Module"
  },
  "kind.class": {
    "zh": "类",
    "en": "Class"
  },
  "kind.function": {
    "zh": "函数",
    "en": "Function"
  },
  "kind.method": {
    "zh": "方法",
    "en": "Method"
  },
  "kind.variable": {
    "zh": "变量",
    "en": "Variable"
  },
  "kind.parameter": {
    "zh": "参数",
    "en": "Parameter"
  },
  "kind.attribute": {
    "zh": "属性",
    "en": "Attribute"
  },
  "kind.lambda": {
    "zh": "匿名函数",
    "en": "Lambda"
  },
  "kind.namespace": {
    "zh": "命名空间包",
    "en": "Namespace package"
  },
  "logic.kind.if": {
    "zh": "条件分支",
    "en": "Conditional branch"
  },
  "logic.kind.for": {
    "zh": "循环",
    "en": "Loop"
  },
  "logic.kind.async_for": {
    "zh": "异步循环",
    "en": "Async loop"
  },
  "logic.kind.while": {
    "zh": "条件循环",
    "en": "Conditional loop"
  },
  "logic.kind.try": {
    "zh": "异常处理",
    "en": "Exception handling"
  },
  "logic.kind.try_star": {
    "zh": "异常组处理",
    "en": "Exception group handling"
  },
  "logic.kind.match": {
    "zh": "模式匹配",
    "en": "Pattern matching"
  },
  "logic.kind.with": {
    "zh": "上下文",
    "en": "Context"
  },
  "logic.kind.async_with": {
    "zh": "异步上下文",
    "en": "Async context"
  },
  "logic.kind.return": {
    "zh": "返回",
    "en": "Return"
  },
  "logic.kind.raise": {
    "zh": "抛出异常",
    "en": "Raise"
  },
  "logic.kind.break": {
    "zh": "跳出循环",
    "en": "Break"
  },
  "logic.kind.continue": {
    "zh": "继续循环",
    "en": "Continue"
  },
  "logic.kind.yield": {
    "zh": "产出",
    "en": "Yield"
  },
  "logic.kind.yield_from": {
    "zh": "转交产出",
    "en": "Yield from"
  },
  "logic.kind.await": {
    "zh": "等待",
    "en": "Await"
  },
  "logic.kind.statement": {
    "zh": "语句",
    "en": "Statement"
  },
  "param.positional_only": {
    "zh": "仅位置参数",
    "en": "Positional only"
  },
  "param.positional_or_keyword": {
    "zh": "位置或关键字参数",
    "en": "Positional or keyword"
  },
  "param.keyword_only": {
    "zh": "仅关键字参数",
    "en": "Keyword only"
  },
  "param.vararg": {
    "zh": "可变位置参数",
    "en": "Variable positional"
  },
  "param.kwarg": {
    "zh": "可变关键字参数",
    "en": "Variable keyword"
  },
  "param.positional": {
    "zh": "位置参数",
    "en": "Positional"
  },
  "param.posonly": {
    "zh": "仅位置参数",
    "en": "Positional only"
  },
  "param.kwonly": {
    "zh": "仅关键字参数",
    "en": "Keyword only"
  },
  "param.arg": {
    "zh": "参数",
    "en": "Parameter"
  },
  "api.invalid_response": {
    "zh": "本地服务未返回有效数据，请检查服务是否正常运行。",
    "en": "The local service returned invalid data. Check whether it is running."
  },
  "api.query_failed": {
    "zh": "本地查询失败",
    "en": "Local query failed"
  },
  "line": {
    "zh": "第 {line} 行",
    "en": "Line {line}"
  },
  "action.closeDiagnostics": {
    "zh": "关闭诊断",
    "en": "Close diagnostics"
  }
,

  "context.module": {
    "zh": "模块顶层",
    "en": "Module top level"
  },
  "context.function": {
    "zh": "函数体",
    "en": "Function body"
  },
  "context.class": {
    "zh": "类体初始化",
    "en": "Class initialization"
  },
  "context.lambda": {
    "zh": "匿名函数体",
    "en": "Lambda body"
  },
  "context.condition": {
    "zh": "条件表达式",
    "en": "Condition"
  },
  "context.if_true": {
    "zh": "条件成立分支",
    "en": "If branch"
  },
  "context.else": {
    "zh": "否则分支",
    "en": "Else branch"
  },
  "context.iterable": {
    "zh": "循环迭代对象",
    "en": "Loop iterable"
  },
  "context.loop": {
    "zh": "循环体",
    "en": "Loop body"
  },
  "context.loop_else": {
    "zh": "循环自然结束",
    "en": "Loop else (normal completion)"
  },
  "context.loop_condition": {
    "zh": "循环条件",
    "en": "Loop condition"
  },
  "context.with_expression": {
    "zh": "上下文表达式",
    "en": "Context expression"
  },
  "context.with_body": {
    "zh": "上下文主体",
    "en": "Context body"
  },
  "context.try": {
    "zh": "try 主体",
    "en": "Try body"
  },
  "context.exception_type": {
    "zh": "异常类型表达式",
    "en": "Exception type expression"
  },
  "context.except": {
    "zh": "异常处理 {type}",
    "en": "Exception handler {type}"
  },
  "context.try_else": {
    "zh": "try 正常完成后的 else",
    "en": "Try else (normal completion)"
  },
  "context.finally": {
    "zh": "finally 区块",
    "en": "Finally"
  },
  "context.match": {
    "zh": "match 表达式",
    "en": "Match expression"
  },
  "context.case": {
    "zh": "case {pattern}",
    "en": "Case {pattern}"
  },
  "context.guard": {
    "zh": "case 守卫条件",
    "en": "Case guard"
  },
  "context.short_circuit": {
    "zh": "短路 {operator}（条件求值）",
    "en": "Short-circuit {operator} (conditional evaluation)"
  },
  "context.conditional_test": {
    "zh": "条件表达式判断",
    "en": "Conditional expression test"
  },
  "context.conditional_true": {
    "zh": "条件表达式成立部分",
    "en": "Conditional expression true branch"
  },
  "context.conditional_false": {
    "zh": "条件表达式否则部分",
    "en": "Conditional expression false branch"
  },
  "context.generator": {
    "zh": "生成器表达式（延迟求值）",
    "en": "Generator expression (lazy evaluation)"
  },
  "context.comprehension": {
    "zh": "推导式（迭代与过滤）",
    "en": "Comprehension (iteration and filters)"
  },
  "context.annotation": {
    "zh": "类型注解",
    "en": "Type annotation"
  },
  "context.decorator": {
    "zh": "装饰器表达式（定义时）",
    "en": "Decorator expression (definition time)"
  },
  "context.default": {
    "zh": "默认参数表达式（定义时）",
    "en": "Default argument (definition time)"
  },
  "context.class_definition": {
    "zh": "类定义表达式",
    "en": "Class definition expression"
  },
  "context.class_keyword": {
    "zh": "类关键字表达式",
    "en": "Class keyword expression"
  },
  "context.lambda_default": {
    "zh": "匿名函数默认参数（定义时）",
    "en": "Lambda default (definition time)"
  },
  "branch.if_true": {
    "zh": "条件成立",
    "en": "Condition true"
  },
  "branch.else": {
    "zh": "否则",
    "en": "Else"
  },
  "branch.loop": {
    "zh": "循环体",
    "en": "Loop body"
  },
  "branch.loop_else": {
    "zh": "自然结束（未 break）",
    "en": "Normal completion (without break)"
  },
  "branch.try": {
    "zh": "try 主体",
    "en": "Try body"
  },
  "branch.try_else": {
    "zh": "else（主体正常完成）",
    "en": "Else (try completed normally)"
  },
  "branch.finally": {
    "zh": "finally（离开时执行）",
    "en": "Finally (on exit)"
  },
  "branch.with": {
    "zh": "上下文主体",
    "en": "Context body"
  },
  "branch.source": {
    "zh": "{text}",
    "en": "{text}"
  },
  "logic.finally_note": {
    "zh": "关联 finally；最终转移仍以源码结构为准",
    "en": "Related finally blocks; final transfer follows source structure."
  },
  "analysis.invalid_root": {
    "zh": "项目目录不存在或不是目录：{path}",
    "en": "Project directory does not exist or is not a directory: {path}"
  },
  "analysis.invalid_source_root": {
    "zh": "源码根不是可读目录：{path}",
    "en": "Source root is not a readable directory: {path}"
  },
  "analysis.directory_read_failed": {
    "zh": "无法读取目录：{error}",
    "en": "Cannot read directory: {error}"
  },
  "analysis.config_read_failed": {
    "zh": "无法读取静态入口配置：{error}",
    "en": "Cannot read static entry configuration: {error}"
  },
  "analysis.source_read_failed": {
    "zh": "无法读取或解码源码：{error}",
    "en": "Cannot read or decode source: {error}"
  },
  "analysis.syntax_error": {
    "zh": "当前 Python 语法无法解析：{error}",
    "en": "Cannot parse with this Python syntax: {error}"
  },
  "analysis.module_ambiguity": {
    "zh": "模块 {module} 对应多个文件，请检查源码根",
    "en": "Module {module} maps to multiple files; check source roots."
  },
  "analysis.nonlocal_missing": {
    "zh": "nonlocal {name} 未找到外层词法绑定",
    "en": "No enclosing lexical binding for nonlocal {name}."
  },
  "analysis.excluded_directory": {
    "zh": "目录已排除",
    "en": "Directory excluded"
  },
  "analysis.skipped_directory_link": {
    "zh": "跳过目录链接",
    "en": "Directory link skipped"
  },
  "analysis.skipped_file_link": {
    "zh": "跳过文件链接",
    "en": "File link skipped"
  },
  "entry.script": {
    "zh": "pyproject.toml project.{section} 的静态入口",
    "en": "Static entry in pyproject.toml project.{section}"
  },
  "entry.module_main": {
    "zh": "__main__.py 模块入口",
    "en": "__main__.py module entry"
  },
  "entry.main_guard": {
    "zh": "__name__ == '__main__' 入口守卫",
    "en": "__name__ == '__main__' guard"
  },
  "resolve.unknown": {
    "zh": "静态分析未能确定目标，保留源码表达式。",
    "en": "Static analysis could not determine the target; the source expression is retained."
  },
  "resolve.opaque": {
    "zh": "被调表达式不是直接名称或属性，保留调用位置。",
    "en": "Callee is not a direct name or attribute; the call site is retained."
  },
  "resolve.query_failed": {
    "zh": "名称查询失败：{error}",
    "en": "Name query failed: {error}"
  },
  "resolve.preview_failed": {
    "zh": "外部源码不可读取：{error}",
    "en": "External source cannot be read: {error}"
  },
  "resolve.preview_missing": {
    "zh": "没有可显示的 Python 源码或存根。",
    "en": "No displayable Python source or stub."
  },
  "resolve.source_unreadable": {
    "zh": "无法重新读取源码：{path}；{error}",
    "en": "Source cannot be read again: {path}; {error}"
  },
  "resolve.source_changed": {
    "zh": "源码已变化：{path}；请重新分析",
    "en": "Source changed: {path}; reanalyze."
  },
  "resolve.invalid_mode": {
    "zh": "查询模式必须是 binding 或 type",
    "en": "Query mode must be binding or type."
  },
  "graph.edge_call": {
    "zh": "{count} 次调用",
    "en": "{count} calls"
  },
  "graph.edge_reference": {
    "zh": "{count} 处引用",
    "en": "{count} references"
  },
  "graph.edge_import": {
    "zh": "{count} 处导入",
    "en": "{count} imports"
  },
  "graph.namespace": {
    "zh": "命名空间包，没有独立模块源码文件",
    "en": "Namespace package without a separate module source file."
  },
  "graph.external_import": {
    "zh": "外部或未解析的导入模块",
    "en": "External or unresolved imported module."
  },
  "graph.invalid_direction": {
    "zh": "不支持的关系方向",
    "en": "Unsupported relationship direction."
  },
  "graph.invalid_kind": {
    "zh": "不支持的关系图种类",
    "en": "Unsupported relationship graph type."
  },
  "analysis.unsupported_command": {
    "zh": "不支持的分析命令",
    "en": "Unsupported analysis command."
  },
  "analysis.process_exited": {
    "zh": "分析工作进程已退出",
    "en": "The analysis worker exited."
  },
  "analysis.expired": {
    "zh": "分析结果已过期，请重新分析",
    "en": "This analysis is no longer active; reanalyze."
  },
  "analysis.reading": {
    "zh": "源码结构尚在读取中",
    "en": "Source structure is still being read."
  },
  "analysis.process_unavailable": {
    "zh": "分析进程不可用，请重新分析",
    "en": "The analysis worker is unavailable; reanalyze."
  },
  "analysis.query_timeout": {
    "zh": "查询超时，请调整超时设置或缩小查询范围",
    "en": "Query timed out. Adjust the timeout or narrow the scope."
  },
  "analysis.query_timeout_stopped": {
    "zh": "查询超时，分析工作进程已停止，请重新分析",
    "en": "Query timed out and the analysis worker stopped; reanalyze."
  },
  "analysis.cancelled": {
    "zh": "分析已取消",
    "en": "Analysis cancelled."
  },
  "analysis.failed": {
    "zh": "分析失败：{error}",
    "en": "Analysis failed: {error}"
  }

,

  "api.invalid_request": {
    "zh": "请求参数无效，请检查输入。",
    "en": "Invalid request parameters. Check the input."
  },
  "api.analysis_expired": {
    "zh": "分析结果已过期，请选择当前项目。",
    "en": "This analysis has expired. Select the current project."
  },
  "api.analysis_not_ready": {
    "zh": "分析结构尚未就绪：{error}",
    "en": "Analysis structure is not ready: {error}"
  },
  "api.invalid_project": {
    "zh": "项目目录无效：{error}",
    "en": "Invalid project directory: {error}"
  },
  "api.file_missing": {
    "zh": "没有找到该文件",
    "en": "The file was not found."
  },
  "api.entity_missing": {
    "zh": "没有找到该定义",
    "en": "The definition was not found."
  },
  "api.call_missing": {
    "zh": "没有找到该调用位置",
    "en": "The call site was not found."
  },
  "api.definition_failed": {
    "zh": "定义查询失败：{error}",
    "en": "Definition lookup failed: {error}"
  },
  "api.syntax_support": {
    "zh": "支持当前解释器语法；动态关系可能无法静态定位",
    "en": "Uses the current interpreter's syntax; dynamic relationships may not be statically resolved."
  }

,

  "detail.openLogic": {
    "zh": "查看内部逻辑",
    "en": "View internal logic"
  },
  "param.var_positional": {
    "zh": "可变位置参数",
    "en": "Variable positional"
  },
  "param.var_keyword": {
    "zh": "可变关键字参数",
    "en": "Variable keyword"
  },
  "status.unreadable": {
    "zh": "不可读取",
    "en": "Unreadable"
  }

,

  "editor.foldLine": {
    "zh": "折叠行",
    "en": "Fold line"
  },
  "editor.unfoldLine": {
    "zh": "展开行",
    "en": "Unfold line"
  },
  "editor.foldedLines": {
    "zh": "已折叠行",
    "en": "Folded lines"
  },
  "editor.unfoldedLines": {
    "zh": "已展开行",
    "en": "Unfolded lines"
  },
  "editor.foldedCode": {
    "zh": "已折叠代码",
    "en": "folded code"
  },
  "editor.unfold": {
    "zh": "展开",
    "en": "unfold"
  },
  "editor.to": {
    "zh": "至",
    "en": "to"
  }

};

let language = "zh";

/**
 * 读取用户当前选择的工具界面语言。
 * Args:
 *   无。
 * Returns:
 *   string: zh 或 en，首访固定为 zh。
 */
export function getLanguage() { return language; }

/**
 * 切换工具界面语言，不改变项目数据或分析。
 * Args:
 *   value (string): 语言选择器给出的 zh 或 en。
 * Returns:
 *   void: 更新语言与文档语言属性。
 */
export function setLanguage(value) {
  language = value === "en" ? "en" : "zh";
  document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  document.title = t("app.title");
}

/**
 * 读取明确字典项并代入原值参数。
 * Args:
 *   key (string): 工具文案或后端机器码。
 *   params (object): 只代入占位符，不翻译参数原值。
 * Returns:
 *   string: 所选语言的工具文字；未知键保留键。
 */
export function t(key, params = {}) {
  const template = messages[key]?.[language] ?? key;
  /**
   * 将字典占位符替换成未经翻译的参数。
   * Args:
   *   match (string): 完整占位符。
   *   name (string): 参数名。
   * Returns:
   *   string: 原值文本或未提供的占位符。
   */
  function replaceParameter(match, name) {
    return params[name] === undefined || params[name] === null ? match : String(params[name]);
  }
  return template.replace(/\{(\w+)\}/g, replaceParameter);
}

/**
 * 显示有明确机器码的工具说明，其他文本作为证据原文保留。
 * Args:
 *   record (object|null): message_code、params 及原始说明。
 *   fallback (string): 没有已知机器码时显示的原文。
 * Returns:
 *   string: 本地化工具说明或未改变的原文。
 */
export function formatMessage(record, fallback = "") {
  const key = record?.message_code;
  return key && messages[key] ? t(key, record.params || {}) : fallback;
}

/**
 * 显示工具枚举值，未知枚举不伪造翻译。
 * Args:
 *   prefix (string): 枚举字典前缀。
 *   value (string): 状态或种类值。
 *   fallback (string|null): 未知时的原文。
 * Returns:
 *   string: 对应标签。
 */
export function enumLabel(prefix, value, fallback = null) {
  const key = prefix + "." + value;
  return messages[key] ? t(key) : (fallback ?? value ?? "");
}

/**
 * 更新明确标记过的工具外壳，不遍历或翻译项目文本。
 * Args:
 *   root (ParentNode): 工具外壳根节点。
 * Returns:
 *   void: 更新标记的文字、提示与无障碍属性。
 */
export function applyTranslations(root = document) {
  for (const node of root.querySelectorAll("[data-i18n]")) {
    node.textContent = t(node.dataset.i18n);
  }
  for (const attribute of ["placeholder", "title", "aria-label"]) {
    for (const node of root.querySelectorAll("[data-i18n-" + attribute + "]")) {
      node.setAttribute(attribute, t(node.getAttribute("data-i18n-" + attribute)));
    }
  }
}

/**
 * 根据真实关系数量生成边标签，不翻译模块或源码名称。
 * Args:
 *   edge (object): 带 kind 与关系位置标识列表的边。
 * Returns:
 *   string: 工具关系数量说明或原标签。
 */
export function edgeLabel(edge) {
  const bucket = {call: "call_ids", reference: "reference_ids", import: "import_ids"}[edge.kind];
  if (!bucket) return edge.label || "";
  return t("graph.edge_" + edge.kind, {count: edge[bucket]?.length ?? edge.params?.count ?? 0});
}


import {t, formatMessage} from "./i18n";
/** 本地接口客户端；所有源码与分析数据仅由同源服务提供。 */
let currentAnalysis = "";

/**
 * 设置后续查询所属的分析。
 * Args:
 *   id (string): 当前分析标识。
 * Returns:
 *   void: 不返回数据。
 */
export function setAnalysis(id) {
  currentAnalysis = id || "";
}

/**
 * 调用本地接口并统一处理中文错误。
 * Args:
 *   path (string): 同源接口路径。
 *   options (object): 方法、参数、请求体及是否附带分析标识。
 * Returns:
 *   Promise<object>: 服务返回的数据；失败时抛出包含原因的异常。
 */
export async function request(path, options = {}) {
  const query = new URLSearchParams();
  if (currentAnalysis && options.analysis !== false) {
    query.set("analysis_id", currentAnalysis);
  }
  for (const [key, value] of Object.entries(options.params || {})) {
    if (value !== undefined && value !== null && value !== "") {
      query.set(key, String(value));
    }
  }
  const address = path + (query.size ? "?" + query.toString() : "");
  const init = {method: options.method || "GET", headers: {}};
  if (options.body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }
  const response = await fetch(address, init);
  let data;
  try {
    data = await response.json();
  } catch {
    const error = new Error(t("api.invalid_response"));
    error.message_code = "api.invalid_response";
    error.params = {};
    throw error;
  }
  if (!response.ok) {
    const detail = data.detail || data.message || t("api.query_failed");
    const message = typeof detail === "string" ? detail : JSON.stringify(detail);
    const error = new Error(formatMessage(data, message));
    error.message_code = data.message_code;
    error.params = data.params || {};
    error.raw = message;
    error.status = response.status;
    throw error;
  }
  return data;
}

/**
 * 发起带分析标识的名称定义查询。
 * Args:
 *   fileId (string): 源文件标识。
 *   offset (number): UTF-16 源码偏移。
 *   mode (string): binding 查询绑定；type 查询所属类或最终定义。
 * Returns:
 *   Promise<object>: 候选定义与解析状态。
 */
export function definitions(fileId, offset, mode) {
  return request("/api/definitions", {
    method: "POST",
    body: {analysis_id: currentAnalysis, file_id: fileId, offset, mode},
  });
}

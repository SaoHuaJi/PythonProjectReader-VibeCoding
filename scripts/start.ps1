<#
启动本地 PythonProjectReader，自动分配端口并在当前终端显示地址。
输入：Project 为可选预填目录；NoBrowser 表示不自动打开浏览器。
输出：终端地址及服务日志；沿用 Python 服务退出码。
#>
[CmdletBinding()]
param(
    [string]$Project = "",
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$python = Join-Path $projectRoot ".venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $python -PathType Leaf)) {
    Write-Host "未找到项目虚拟环境，请先按 README 创建 .venv 并安装依赖。"
    exit 1
}
$launchArguments = @("-B", "-m", "code_browser")
if ($Project) {
    $launchArguments += @("--project", $Project)
}
if ($NoBrowser) {
    $launchArguments += "--no-browser"
}
Push-Location -LiteralPath $projectRoot
try {
    & $python @launchArguments
    $serviceExitCode = $LASTEXITCODE
}
finally {
    Pop-Location
}
exit $serviceExitCode
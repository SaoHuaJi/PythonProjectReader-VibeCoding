<#
关闭当前工作区登记的 PythonProjectReader，无需知道实际端口。
输入：无；读取工具自己的实例记录。
输出：关闭结果；沿用 Python 入口退出码。
#>
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$python = Join-Path $projectRoot ".venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $python -PathType Leaf)) {
    Write-Host "未找到项目虚拟环境，请先按 README 创建 .venv 并安装依赖。"
    exit 1
}
Push-Location -LiteralPath $projectRoot
try {
    & $python -B -m code_browser --stop
    $serviceExitCode = $LASTEXITCODE
}
finally {
    Pop-Location
}
exit $serviceExitCode
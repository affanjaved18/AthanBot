import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { dataDir } from './settings.js';
import { run } from './audio.js';

function encode(script) {
  return Buffer.from(script, 'utf16le').toString('base64');
}

async function task(script, env = process.env, timeout = 30_000) {
  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  const powershell = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const { stdout } = await run(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encode(`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try {
  $user = [Security.Principal.WindowsIdentity]::GetCurrent()
  $name = 'AthanBot-' + $user.User.Value
  ${script}
} catch {
  [Console]::Error.WriteLine($_.Exception.GetBaseException().ToString())
  exit 1
}
exit 0
  `)], { env, windowsHide: true, timeout });
  return stdout.trim();
}

const findTask = `
$scheduler = New-Object -ComObject Schedule.Service
$scheduler.Connect()
$folder = $scheduler.GetFolder('\\')
$task = $folder.GetTasks(1) | Where-Object Name -eq $name | Select-Object -First 1
`;

export async function windowsStartupEnabled() {
  return await task(findTask + "if ($task -and $task.Enabled) { 'enabled' }") === 'enabled';
}

export async function windowsStartup(entry, enable) {
  if (!enable) {
    await task(findTask + `
if ($task) {
  $task.Enabled = $false
  if ($task.State -eq 4) { $task.Stop(0) }
  $folder.DeleteTask($name, 0)
}
    `, process.env, 90_000);
    return;
  }
  await mkdir(dataDir, { recursive: true });
  const config = Buffer.from(JSON.stringify({
    dataDir, player: process.env.ATHANBOT_MPV || 'mpv.exe', node: process.execPath,
    entry, log: join(dataDir, 'athanbot.log'),
  })).toString('base64');
  const runner = `
$config = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${config}')) | ConvertFrom-Json
$env:ATHANBOT_DATA_DIR = $config.dataDir
$env:ATHANBOT_MPV = $config.player
& $config.node $config.entry run *>> $config.log
exit $LASTEXITCODE
  `;
  await task(`
$task = Get-ScheduledTask -TaskPath '\\' | Where-Object { $_.TaskName -eq $name }
$arguments = $env:ATHANBOT_TASK_ARGUMENTS
$execute = "$PSHOME\\powershell.exe"
if (!$task -or @($task.Actions).Count -ne 1 -or $task.Actions[0].Execute -ne $execute -or $task.Actions[0].Arguments -cne $arguments) {
  if ($task.State -eq 'Running') { Stop-ScheduledTask -TaskName $name }
  $action = New-ScheduledTaskAction -Execute $execute -Argument $arguments
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $user.Name
  $principal = New-ScheduledTaskPrincipal -UserId $user.Name -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
  Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
} elseif ($task.State -eq 'Disabled') {
  Enable-ScheduledTask -TaskName $name | Out-Null
} elseif ($task.State -eq 'Running') {
  return
}
Start-ScheduledTask -TaskName $name
  `, { ...process.env, ATHANBOT_TASK_ARGUMENTS: `-NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ${encode(runner)}` });
}

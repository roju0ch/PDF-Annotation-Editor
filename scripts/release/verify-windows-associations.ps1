param([Parameter(Mandatory=$true)][string]$BundleRoot)
$ErrorActionPreference = 'Stop'
$configuration = Get-Content 'src-tauri/tauri.conf.json' -Raw | ConvertFrom-Json
$programId = $configuration.bundle.fileAssociations[0].name
$applicationId = $configuration.identifier
$classes = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Software\Classes\.pdf')
$hadDefault = $classes.GetValueNames() -contains ''
$oldDefault = $classes.GetValue('', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
$oldKind = if ($hadDefault) { $classes.GetValueKind('') } else { $null }
$sentinel = 'CodexAssociationTest.PreviousPdfHandler'
$installDirectory = Join-Path $env:RUNNER_TEMP ('pdf-association-install-' + [guid]::NewGuid().ToString('N'))
function UserChoiceSnapshot {
  $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.pdf\UserChoice')
  if (!$key) { return '<absent>' }
  try {
    $values = [ordered]@{}
    foreach ($name in ($key.GetValueNames() | Sort-Object)) { $values[$name] = $key.GetValue($name) }
    return ($values | ConvertTo-Json -Compress)
  } finally { $key.Dispose() }
}
function AssertUnchangedDefault($userChoice) {
  if ($classes.GetValue('') -ne $sentinel) { throw 'Installer changed the existing .pdf default' }
  if ((UserChoiceSnapshot) -ne $userChoice) { throw 'Installer changed protected Explorer UserChoice' }
}
function ReadUserValue($keyPath, $name='') {
  $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($keyPath)
  if (!$key) { return $null }
  try { return $key.GetValue($name) } finally { $key.Dispose() }
}
try {
  # Seed a prior handler and preserve the runner's protected UserChoice exactly.
  # This is isolated to the disposable CI account; no user machine is changed.
  $classes.SetValue('', $sentinel, [Microsoft.Win32.RegistryValueKind]::String)
  $userChoice = UserChoiceSnapshot
  $installers = @(Get-ChildItem $BundleRoot -Filter '*.exe' -Recurse)
  if ($installers.Count -ne 1) { throw 'Expected exactly one NSIS installer' }
  $install = Start-Process $installers[0].FullName -ArgumentList @('/S', "/D=$installDirectory") -Wait -PassThru
  if ($install.ExitCode -ne 0) { throw "NSIS installation failed: $($install.ExitCode)" }
  AssertUnchangedDefault $userChoice
  if ((ReadUserValue 'Software\Classes\.pdf\OpenWithProgids' $programId) -ne '') { throw 'Missing PDF OpenWithProgids registration' }
  $command = ReadUserValue "Software\Classes\$programId\shell\open\command"
  if (!$command -or $command -notmatch '^"[^"\r\n]+\.exe" "%1"$') { throw 'PDF open command does not quote both executable and filename' }
  if ((ReadUserValue "Software\$applicationId\Capabilities\FileAssociations" '.pdf') -ne $programId) { throw 'Missing Default Apps PDF capability' }
  if ((ReadUserValue 'Software\RegisteredApplications' $applicationId) -ne "Software\$applicationId\Capabilities") { throw 'Missing RegisteredApplications candidate' }
  Write-Output '::notice title=Windows PDF association::Real NSIS installation registered Open With and Default Apps; existing .pdf default and Explorer UserChoice unchanged; filename command quoted.'
  $uninstaller = Join-Path $installDirectory 'uninstall.exe'
  if (!(Test-Path $uninstaller)) { throw 'Missing installed NSIS uninstaller' }
  $uninstall = Start-Process $uninstaller -ArgumentList @('/S') -Wait -PassThru
  if ($uninstall.ExitCode -ne 0) { throw "NSIS uninstall failed: $($uninstall.ExitCode)" }
  $deadline = (Get-Date).AddSeconds(30)
  while ((ReadUserValue "Software\Classes\$programId\shell\open\command") -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 250 }
  AssertUnchangedDefault $userChoice
  if ((ReadUserValue "Software\Classes\$programId\shell\open\command") -or (ReadUserValue 'Software\RegisteredApplications' $applicationId)) { throw 'Uninstall left the app association behind' }
  Write-Output '::notice title=Windows PDF association::Real NSIS uninstall removed app registration and preserved prior default and UserChoice.'
} catch {
  $message = $_.Exception.Message.Replace('%', '%25').Replace("`r", '%0D').Replace("`n", '%0A')
  Write-Output "::error title=Windows PDF association::$message"
  throw
} catch {
  $detail = $_.Exception.Message.Replace('%', '%25').Replace("`r", '%0D').Replace("`n", '%0A')
  Write-Output "::error title=Windows PDF association::$detail"
  throw
} finally {
  if ($hadDefault) { $classes.SetValue('', $oldDefault, $oldKind) } else { $classes.DeleteValue('', $false) }
  $classes.Dispose()
  # Leftover binaries stay only in the disposable runner and are not artifacts.
}

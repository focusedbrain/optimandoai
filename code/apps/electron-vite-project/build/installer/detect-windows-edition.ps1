# Returns: home | pro | other
# Used by installer tests and mirrors NSIS EditionID registry logic.

param(
  [string]$EditionId = ''
)

if ([string]::IsNullOrWhiteSpace($EditionId)) {
  try {
    $EditionId = (Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' -Name EditionID -ErrorAction Stop).EditionID
  } catch {
    Write-Output 'other'
    exit 0
  }
}

$homeIds = @('Core', 'CoreSingleLanguage', 'CoreCountrySpecific', 'Home', 'Home N', 'Home Single Language')
$proIds = @(
  'Professional', 'ProfessionalEducation', 'ProfessionalEducationN', 'ProfessionalN',
  'ProfessionalWorkstation', 'ProfessionalWorkstationN', 'Enterprise', 'EnterpriseN',
  'Education', 'EducationN'
)

if ($homeIds -contains $EditionId) {
  Write-Output 'home'
  exit 0
}
if ($proIds -contains $EditionId) {
  Write-Output 'pro'
  exit 0
}

Write-Output 'other'
exit 0

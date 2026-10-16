function Get-NormalizedCadTrust([string]$Value) {
    # AutoCAD expands %USERPROFILE% and normalizes separators when saving profiles.
    # Compare the ordered path list, while retaining the exact original registry value.
    return ((@($Value -split ';' | Where-Object {-not [String]::IsNullOrWhiteSpace($_)} | ForEach-Object {
        $normalized=[Environment]::ExpandEnvironmentVariables($_.Trim()).Replace('/','\')
        if($normalized -notmatch '^[A-Za-z]:\\$'){$normalized=$normalized.TrimEnd('\')}
        $normalized.ToUpperInvariant()
    })) -join ';')
}
function Restore-CadTrust([string]$Variables,[bool]$WasPresent,[string]$Previous,[string]$OwnedValue) {
    $current=[string](Get-Item -LiteralPath $Variables).GetValue('TRUSTEDPATHS','')
    $currentPaths=Get-NormalizedCadTrust $current
    if($currentPaths -ne (Get-NormalizedCadTrust $Previous) -and $currentPaths -ne (Get-NormalizedCadTrust $OwnedValue)){
        throw 'TRUST_RESTORE_CONFLICT: external configuration changes preserved; inspect the task evidence'
    }
    if($current -ne $Previous){
        if($WasPresent){Set-ItemProperty -LiteralPath $Variables -Name TRUSTEDPATHS -Value $Previous}
        else{Remove-ItemProperty -LiteralPath $Variables -Name TRUSTEDPATHS -ErrorAction SilentlyContinue}
    }
}

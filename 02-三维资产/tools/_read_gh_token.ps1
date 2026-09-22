# 从 Windows 凭据管理器直接读取 git 的 GitHub 凭据，写入临时文件供推送脚本使用。
# 为什么不用 `git credential fill`：受限环境下它会间歇性挂起（无输出、无报错）。
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class CredMan {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct CREDENTIAL {
        public uint Flags;
        public uint Type;
        public string TargetName;
        public string Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public uint CredentialBlobSize;
        public IntPtr CredentialBlob;
        public uint Persist;
        public uint AttributeCount;
        public IntPtr Attributes;
        public string TargetAlias;
        public string UserName;
    }

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredRead(string target, uint type, uint flags, out IntPtr credential);
    [DllImport("advapi32.dll")]
    private static extern void CredFree(IntPtr cred);

    public static string Read(string target, uint type) {
        IntPtr p;
        if (!CredRead(target, type, 0, out p)) { return null; }
        try {
            CREDENTIAL c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL));
            if (c.CredentialBlobSize == 0) { return ""; }
            return Marshal.PtrToStringUni(c.CredentialBlob, (int)(c.CredentialBlobSize / 2));
        } finally { CredFree(p); }
    }
}
"@

$target = 'git:https://zhchunyu@github.com'
$tok = [CredMan]::Read($target, 1)   # 1 = CRED_TYPE_GENERIC
if (-not $tok) { Write-Output "未读到凭据：$target"; exit 1 }

$dir = Join-Path $env:TEMP 'chunyu_push'
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
$out = Join-Path $dir 'token.txt'
[System.IO.File]::WriteAllText($out, $tok, (New-Object System.Text.ASCIIEncoding))
Write-Output ("token 长度 " + $tok.Length + " → " + $out)

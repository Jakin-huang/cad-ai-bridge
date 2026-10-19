using System;
using System.IO;
using System.Linq;
using System.Management.Automation;
using System.Management.Automation.Runspaces;
using System.Threading;
using System.Windows.Forms;

// A window host for the existing PowerShell onboarding script; no background service.
internal static class UserLauncher
{
    [STAThread]
    private static int Main(string[] args)
    {
        Application.EnableVisualStyles();
        try
        {
            string root = AppDomain.CurrentDomain.BaseDirectory;
            string script = Path.Combine(root, "scripts", "start-user.ps1");
            if (!File.Exists(script))
                script = Path.GetFullPath(Path.Combine(root, "..", "..", "scripts", "start-user.ps1"));
            if (!File.Exists(script)) throw new FileNotFoundException("请保留并完整解压用户包，再打开“开始使用”。");
            // Match the existing .cmd entry for this runspace only; do not change registry policy.
            InitialSessionState initial = InitialSessionState.CreateDefault();
            initial.ExecutionPolicy = Microsoft.PowerShell.ExecutionPolicy.Bypass;
            using (Runspace runspace = RunspaceFactory.CreateRunspace(initial))
            {
                runspace.ApartmentState = ApartmentState.STA;
                runspace.ThreadOptions = PSThreadOptions.UseCurrentThread;
                runspace.Open();
                using (PowerShell shell = PowerShell.Create())
                {
                    shell.Runspace = runspace;
                    shell.AddCommand(script);
                    if (args.Length % 2 != 0) throw new ArgumentException("启动参数无效，请直接双击“开始使用.exe”。");
                    for (int i = 0; i < args.Length; i += 2)
                    {
                        string name = args[i].TrimStart('-');
                        if (!String.Equals(name, "ClientHome", StringComparison.OrdinalIgnoreCase) &&
                            !String.Equals(name, "RenderTo", StringComparison.OrdinalIgnoreCase) &&
                            !String.Equals(name, "PreviewReport", StringComparison.OrdinalIgnoreCase))
                            throw new ArgumentException("启动参数无效，请直接双击“开始使用.exe”。");
                        shell.AddParameter(name, args[i + 1]);
                    }
                    shell.Invoke();
                    if (shell.HadErrors) throw new InvalidOperationException(String.Join(Environment.NewLine, shell.Streams.Error.Select(e => e.ToString())));
                }
            }
            return 0;
        }
        catch (Exception error)
        {
            if (args.Any(a => String.Equals(a, "-RenderTo", StringComparison.OrdinalIgnoreCase))) return 1;
            MessageBox.Show("无法打开接入窗口。请确认完整解压了用户包，并查看同目录的“使用说明.html”。\n\n" + error.Message,
                "CAD AI Bridge · 启动未完成", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }
}

using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        foreach (var path in Candidates())
        {
            if (File.Exists(path))
            {
                Process.Start(new ProcessStartInfo(path) { UseShellExecute = true });
                return;
            }
        }

        MessageBox.Show(
            "Account Manager is not installed yet.\n\nRun Account-Manager-Setup from the release folder, or use the portable exe.",
            "Account Manager",
            MessageBoxButtons.OK,
            MessageBoxIcon.Information);
    }

    private static string[] Candidates()
    {
        var here = AppDomain.CurrentDomain.BaseDirectory;
        var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var list = new System.Collections.Generic.List<string>
        {
            Path.Combine(local, "Programs", "Account Manager", "Account Manager.exe"),
            Path.Combine(here, "release", "win-unpacked", "Account Manager.exe"),
            Path.Combine(here, "win-unpacked", "Account Manager.exe"),
            Path.Combine(here, "Account Manager.exe")
        };
        try
        {
            list.AddRange(Directory.GetFiles(here, "Account-Manager-*-portable.exe"));
            var release = Path.Combine(here, "release");
            if (Directory.Exists(release))
            {
                list.AddRange(Directory.GetFiles(release, "Account-Manager-*-portable.exe"));
            }
        }
        catch
        {
        }
        return list.ToArray();
    }
}

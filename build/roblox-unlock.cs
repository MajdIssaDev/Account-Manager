using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

internal static class Program
{
    private const uint PROCESS_DUP_HANDLE = 0x0040;
    private const uint PROCESS_QUERY_INFORMATION = 0x0400;
    private const uint DUPLICATE_CLOSE_SOURCE = 0x00000001;
    private const uint DUPLICATE_SAME_ACCESS = 0x00000002;
    private const int ProcessHandleInformation = 51;
    private const int SystemExtendedHandleInformation = 64;
    private const int ObjectNameInformation = 1;
    private const int STATUS_INFO_LENGTH_MISMATCH = unchecked((int)0xC0000004);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint access, bool inherit, int pid);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool DuplicateHandle(
        IntPtr sourceProcess,
        IntPtr sourceHandle,
        IntPtr targetProcess,
        out IntPtr targetHandle,
        uint access,
        bool inherit,
        uint options);

    [DllImport("kernel32.dll")]
    private static extern IntPtr GetCurrentProcess();

    [DllImport("ntdll.dll")]
    private static extern int NtQueryInformationProcess(
        IntPtr process,
        int infoClass,
        IntPtr buffer,
        int length,
        out int returnLength);

    [DllImport("ntdll.dll")]
    private static extern int NtQueryObject(
        IntPtr handle,
        int infoClass,
        IntPtr buffer,
        int length,
        out int returnLength);

    [DllImport("ntdll.dll")]
    private static extern int NtQuerySystemInformation(
        int infoClass,
        IntPtr buffer,
        int length,
        out int returnLength);

    [STAThread]
    private static int Main(string[] args)
    {
        bool watch = args.Length > 0 && string.Equals(args[0], "--watch", StringComparison.OrdinalIgnoreCase);
        if (!watch)
        {
            CloseSingletons();
            return 0;
        }

        Thread stdin = new Thread(WaitForStdinClose);
        stdin.IsBackground = true;
        stdin.Start();
        while (true)
        {
            CloseSingletons();
            Thread.Sleep(35);
        }
    }

    private static void WaitForStdinClose()
    {
        try
        {
            using (var input = Console.OpenStandardInput())
            {
                byte[] buf = new byte[1];
                while (input.Read(buf, 0, 1) > 0)
                {
                }
            }
        }
        catch
        {
        }
        Environment.Exit(0);
    }

    private static void CloseSingletons()
    {
        Process[] procs;
        try
        {
            procs = Process.GetProcessesByName("RobloxPlayerBeta");
        }
        catch
        {
            return;
        }

        for (int i = 0; i < procs.Length; i++)
        {
            try
            {
                CloseInProcess(procs[i].Id);
            }
            catch
            {
            }
            finally
            {
                try
                {
                    procs[i].Dispose();
                }
                catch
                {
                }
            }
        }
    }

    private static void CloseInProcess(int pid)
    {
        IntPtr process = OpenProcess(PROCESS_DUP_HANDLE | PROCESS_QUERY_INFORMATION, false, pid);
        if (process == IntPtr.Zero)
        {
            return;
        }

        IntPtr buffer = IntPtr.Zero;
        try
        {
            int length = 0x10000;
            int status;
            int needed;
            do
            {
                if (buffer != IntPtr.Zero)
                {
                    Marshal.FreeHGlobal(buffer);
                }
                buffer = Marshal.AllocHGlobal(length);
                status = NtQueryInformationProcess(process, ProcessHandleInformation, buffer, length, out needed);
                if (status == STATUS_INFO_LENGTH_MISMATCH)
                {
                    length = needed > length ? needed + 4096 : length * 2;
                }
            }
            while (status == STATUS_INFO_LENGTH_MISMATCH && length < 32 * 1024 * 1024);

            if (status != 0)
            {
                CloseFromSystemTable(process, pid);
                return;
            }

            long count = Marshal.ReadIntPtr(buffer).ToInt64();
            int offset = IntPtr.Size * 2;
            int stride = IntPtr.Size * 3 + 16;
            for (long i = 0; i < count; i++)
            {
                IntPtr handleValue = Marshal.ReadIntPtr(buffer, offset + (int)(i * stride));
                CloseIfSingleton(process, handleValue);
            }
        }
        finally
        {
            if (buffer != IntPtr.Zero)
            {
                Marshal.FreeHGlobal(buffer);
            }
            CloseHandle(process);
        }
    }

    private static void CloseFromSystemTable(IntPtr process, int pid)
    {
        int length = 1 << 20;
        IntPtr buffer = IntPtr.Zero;
        try
        {
            int status;
            int needed;
            do
            {
                if (buffer != IntPtr.Zero)
                {
                    Marshal.FreeHGlobal(buffer);
                }
                buffer = Marshal.AllocHGlobal(length);
                status = NtQuerySystemInformation(SystemExtendedHandleInformation, buffer, length, out needed);
                if (status == STATUS_INFO_LENGTH_MISMATCH)
                {
                    length = needed > length ? needed + 65536 : length * 2;
                }
            }
            while (status == STATUS_INFO_LENGTH_MISMATCH && length < 64 * 1024 * 1024);

            if (status != 0)
            {
                return;
            }

            long count = Marshal.ReadIntPtr(buffer).ToInt64();
            int offset = IntPtr.Size * 2;
            int stride = IntPtr.Size * 3 + 16;
            for (long i = 0; i < count; i++)
            {
                int row = offset + (int)(i * stride);
                long owner = Marshal.ReadIntPtr(buffer, row + IntPtr.Size).ToInt64();
                if (owner != pid)
                {
                    continue;
                }
                IntPtr handleValue = Marshal.ReadIntPtr(buffer, row + IntPtr.Size * 2);
                CloseIfSingleton(process, handleValue);
            }
        }
        finally
        {
            if (buffer != IntPtr.Zero)
            {
                Marshal.FreeHGlobal(buffer);
            }
        }
    }

    private static void CloseIfSingleton(IntPtr process, IntPtr handleValue)
    {
        if (handleValue == IntPtr.Zero)
        {
            return;
        }

        IntPtr local;
        if (!DuplicateHandle(process, handleValue, GetCurrentProcess(), out local, 0, false, DUPLICATE_SAME_ACCESS))
        {
            return;
        }

        try
        {
            string name = ObjectName(local);
            if (name == null || name.IndexOf("ROBLOX_singleton", StringComparison.OrdinalIgnoreCase) < 0)
            {
                return;
            }

            IntPtr discarded;
            DuplicateHandle(
                process,
                handleValue,
                GetCurrentProcess(),
                out discarded,
                0,
                false,
                DUPLICATE_CLOSE_SOURCE | DUPLICATE_SAME_ACCESS);
            if (discarded != IntPtr.Zero)
            {
                CloseHandle(discarded);
            }
        }
        finally
        {
            CloseHandle(local);
        }
    }

    private static string ObjectName(IntPtr handle)
    {
        int length = 2048;
        IntPtr buffer = Marshal.AllocHGlobal(length);
        try
        {
            int needed;
            int status = NtQueryObject(handle, ObjectNameInformation, buffer, length, out needed);
            if (status != 0 && needed > length)
            {
                Marshal.FreeHGlobal(buffer);
                length = needed + 64;
                buffer = Marshal.AllocHGlobal(length);
                status = NtQueryObject(handle, ObjectNameInformation, buffer, length, out needed);
            }
            if (status != 0)
            {
                return null;
            }

            short bytes = Marshal.ReadInt16(buffer, 0);
            if (bytes <= 0)
            {
                return null;
            }

            IntPtr str = Marshal.ReadIntPtr(buffer, IntPtr.Size);
            if (str == IntPtr.Zero)
            {
                return null;
            }

            return Marshal.PtrToStringUni(str, bytes / 2);
        }
        catch
        {
            return null;
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }
}

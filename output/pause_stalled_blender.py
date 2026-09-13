"""Reversibly pause the stalled Blender process to stop runaway allocation.
Run with --resume to resume it. Never terminates or closes Blender.
"""
import ctypes as C, sys
from ctypes import wintypes as W
k = C.WinDLL('kernel32', use_last_error=True)
n = C.WinDLL('ntdll')
k.OpenProcess.argtypes = [W.DWORD, W.BOOL, W.DWORD]; k.OpenProcess.restype = W.HANDLE
k.CloseHandle.argtypes = [W.HANDLE]
function = n.NtResumeProcess if '--resume' in sys.argv else n.NtSuspendProcess
function.argtypes = [W.HANDLE]; function.restype = W.LONG
handle = k.OpenProcess(0x0800, False, 17936)
if not handle: raise C.WinError(C.get_last_error())
try:
    result = function(handle)
    if result != 0: raise RuntimeError(f'NTSTATUS {result:#x}')
    print('Blender resumed.' if '--resume' in sys.argv else 'Blender paused without terminating it.')
finally:
    k.CloseHandle(handle)

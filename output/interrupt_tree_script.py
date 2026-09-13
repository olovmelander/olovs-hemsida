"""Request a Python KeyboardInterrupt in the stalled Blender script.
Does not terminate Blender or execute scene edits. Calls only CPython's
documented signal-safe PyErr_SetInterrupt entry point in that process.
"""
import ctypes as C
from ctypes import wintypes as W

PID = 17936
REMOTE_PYTHON = 140718875082752
DLL = r'C:\Program Files\Blender Foundation\Blender 4.5\python311.dll'
k = C.WinDLL('kernel32', use_last_error=True)
k.LoadLibraryExW.argtypes = [W.LPCWSTR, W.HANDLE, W.DWORD]; k.LoadLibraryExW.restype = W.HMODULE
k.GetProcAddress.argtypes = [W.HMODULE, C.c_char_p]; k.GetProcAddress.restype = C.c_void_p
k.OpenProcess.argtypes = [W.DWORD, W.BOOL, W.DWORD]; k.OpenProcess.restype = W.HANDLE
k.CreateRemoteThread.argtypes = [W.HANDLE, C.c_void_p, C.c_size_t, C.c_void_p, C.c_void_p, W.DWORD, C.POINTER(W.DWORD)]
k.CreateRemoteThread.restype = W.HANDLE
k.WaitForSingleObject.argtypes = [W.HANDLE, W.DWORD]; k.WaitForSingleObject.restype = W.DWORD
k.CloseHandle.argtypes = [W.HANDLE]
# Map only to find the exported function's RVA; never initialize/call the DLL
# in the helper's different Python interpreter.
mapped = k.LoadLibraryExW(DLL, None, 1)
if not mapped: raise C.WinError(C.get_last_error())
entry = k.GetProcAddress(mapped, b'PyErr_SetInterrupt')
if not entry: raise C.WinError(C.get_last_error())
address = REMOTE_PYTHON + entry - mapped
handle = k.OpenProcess(0x0002 | 0x0400 | 0x0008 | 0x0020 | 0x0010, False, PID)
if not handle: raise C.WinError(C.get_last_error())
try:
    thread = k.CreateRemoteThread(handle, None, 0, address, None, 0, None)
    if not thread: raise C.WinError(C.get_last_error())
    try:
        result = k.WaitForSingleObject(thread, 5000)
        print('Requested KeyboardInterrupt; signal function wait result:', result)
    finally:
        k.CloseHandle(thread)
finally:
    k.CloseHandle(handle)

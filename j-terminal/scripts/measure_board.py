"""Windows release smoke test. Runs in a private temporary vault alongside the normal launcher."""
from contextlib import closing
import ctypes as ct
from ctypes import wintypes as wt
import base64
import struct
import datetime
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import time
import uuid

user = ct.WinDLL("user32", use_last_error=True)
user.SetProcessDpiAwarenessContext(wt.HANDLE(-4))
visitor = ct.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)
user.EnumWindows.argtypes = [visitor, wt.LPARAM]
user.GetWindowTextW.argtypes = [wt.HWND, wt.LPWSTR, ct.c_int]
user.GetWindowThreadProcessId.argtypes = [wt.HWND, ct.POINTER(wt.DWORD)]
user.IsWindowVisible.argtypes = [wt.HWND]
user.PostMessageW.argtypes = [wt.HWND, wt.UINT, wt.WPARAM, wt.LPARAM]
user.GetWindowRect.argtypes = [wt.HWND, ct.POINTER(wt.RECT)]


def wait_for(probe, timeout=8):
    deadline = time.perf_counter() + timeout
    while time.perf_counter() < deadline:
        result = probe()
        if result:
            return result
        time.sleep(.004)
    raise RuntimeError(f"Timed out waiting for {probe.__name__}")


def visible_window(pid):
    found = []

    @visitor
    def visit(hwnd, _):
        owner = wt.DWORD()
        user.GetWindowThreadProcessId(hwnd, ct.byref(owner))
        if owner.value == pid and user.IsWindowVisible(hwnd):
            title = ct.create_unicode_buffer(256)
            user.GetWindowTextW(hwnd, title, len(title))
            if title.value.endswith("J-TerminaL"):
                found.append((hwnd, title.value))
        return True

    user.EnumWindows(visit, 0)
    return found[0] if found else None


def key(hwnd, vk):
    scan = user.MapVirtualKeyW(vk, 0)
    data = 1 | (scan << 16)
    for msg, bits in [(0x100, data), (0x101, data | 0xc0000000)]:
        if not user.PostMessageW(hwnd, msg, vk, bits):
            raise ct.WinError(ct.get_last_error())
    time.sleep(.008)


def bounds(hwnd):
    rect = wt.RECT()
    if not user.GetWindowRect(hwnd, ct.byref(rect)):
        raise ct.WinError(ct.get_last_error())
    return (rect.left, rect.top, rect.right, rect.bottom)


def memory(process):
    psapi = ct.WinDLL("psapi", use_last_error=True)
    psapi.QueryWorkingSet.argtypes = [wt.HANDLE, ct.c_void_p, wt.DWORD]
    pages = (ct.c_size_t * 131072)()
    if not psapi.QueryWorkingSet(int(process._handle), pages, ct.sizeof(pages)):
        raise ct.WinError(ct.get_last_error())
    import mmap
    private = sum(1 for page in pages[1:pages[0]+1] if not page & 0x100)
    return f"private={private * mmap.PAGESIZE / 2**20:.2f} MiB, total={pages[0] * mmap.PAGESIZE / 2**20:.2f} MiB"


class Info(ct.Structure):
    _fields_ = [("kind", wt.UINT), ("id", wt.UINT), ("frame", wt.UINT), ("flags", wt.UINT),
                ("source", wt.HANDLE), ("target", wt.HWND), ("pixel", wt.POINT), ("metric", wt.POINT),
                ("raw", wt.POINT), ("raw_metric", wt.POINT), ("time", wt.DWORD), ("history", wt.UINT),
                ("data", ct.c_int), ("keys", wt.DWORD), ("counter", ct.c_uint64), ("change", ct.c_int)]

class Pen(ct.Structure):
    _fields_ = [("info", Info), ("flags", wt.UINT), ("mask", wt.UINT), ("pressure", wt.UINT),
                ("rotation", wt.UINT), ("tilt_x", ct.c_int), ("tilt_y", ct.c_int)]

class Touch(ct.Structure):
    _fields_ = [("info", Info), ("flags", wt.UINT), ("mask", wt.UINT), ("area", wt.RECT),
                ("raw_area", wt.RECT), ("orientation", wt.UINT), ("pressure", wt.UINT)]

class Payload(ct.Union):
    _fields_ = [("pen", Pen), ("touch", Touch)]

class Packet(ct.Structure):
    _fields_ = [("kind", wt.UINT), ("payload", Payload)]

user.CreateSyntheticPointerDevice.restype = wt.HANDLE
user.CreateSyntheticPointerDevice.argtypes = [wt.UINT, wt.UINT, wt.UINT]
user.InjectSyntheticPointerInput.argtypes = [wt.HANDLE, ct.POINTER(Packet), wt.UINT]
user.DestroySyntheticPointerDevice.argtypes = [wt.HANDLE]
user.WindowFromPoint.argtypes = [wt.POINT]
user.WindowFromPoint.restype = wt.HWND


def pen_gesture(hwnd, samples, saved, inverted=False, observe=None, interval=.012):
    """Send native coalescible pen packets only over our own test window."""
    device = user.CreateSyntheticPointerDevice(3, 1, 3)
    if not device:
        raise ct.WinError(ct.get_last_error())
    try:
        packet = Packet()
        packet.kind = 3
        pen = packet.payload.pen
        pen.info.kind = 3
        pen.info.id = 0
        pen.mask = 1
        left, top, _, _ = bounds(hwnd)
        hover = (samples[0][0], samples[0][1], 0, 0x20000 | 2)
        for x, y, pressure, flags in [hover, *samples]:
            point = wt.POINT(left+x, top+y)
            if user.WindowFromPoint(point) != hwnd:
                raise RuntimeError("Synthetic pen target is outside the test window")
            # InjectSyntheticPointerInput counts pixels from the virtual desktop's top left.
            pen.info.pixel = wt.POINT(point.x - user.GetSystemMetrics(76), point.y - user.GetSystemMetrics(77))
            pen.pressure = pressure
            pen.flags = 6 if inverted else 0
            pen.info.flags = flags
            started = time.perf_counter()
            if not user.InjectSyntheticPointerInput(device, ct.byref(packet), 1):
                raise ct.WinError(ct.get_last_error())
            if observe and flags & 4:
                observe(x, y, started)
            time.sleep(interval)
        return wait_for(saved)
    finally:
        user.DestroySyntheticPointerDevice(device)


def check_touch_camera(hwnd, ink_pixel):
    """Exercise native single-touch pan and a two-finger pinch on the drawing surface."""
    device = user.CreateSyntheticPointerDevice(2, 2, 3)
    if not device:
        raise ct.WinError(ct.get_last_error())
    left, top, _, _ = bounds(hwnd)
    def frame(contacts):
        packets = (Packet * len(contacts))()
        for packet, (finger, x, y, flags) in zip(packets, contacts):
            if user.WindowFromPoint(wt.POINT(left+x, top+y)) != hwnd:
                raise RuntimeError("Synthetic touch target is outside the test window")
            px, py = left+x-user.GetSystemMetrics(76), top+y-user.GetSystemMetrics(77)
            packet.kind = packet.payload.touch.info.kind = 2
            touch = packet.payload.touch
            touch.info.id = finger
            touch.info.pixel = wt.POINT(px, py)
            touch.info.flags = flags
            touch.mask = 7
            touch.area = wt.RECT(px-2, py-2, px+2, py+2)
            touch.orientation = 90
            touch.pressure = 512
        if not user.InjectSyntheticPointerInput(device, packets, len(packets)):
            raise ct.WinError(ct.get_last_error())
        time.sleep(.04)
    down, move, up = 0x10006, 0x20006, 0x40000
    try:
        frame([(1,360,250,down)])
        frame([(1,360,294,move)])
        wait_for(lambda: ink_pixel(215,214) and not ink_pixel(215,170))
        frame([(1,360,294,up)])
        frame([(1,160,214,down), (2,360,214,down)])
        frame([(1,160,214,move), (2,460,214,move)])
        wait_for(lambda: ink_pixel(780,214) and ink_pixel(160,214))
        frame([(1,160,214,up), (2,460,214,up)])
    finally:
        user.DestroySyntheticPointerDevice(device)
    print("Native one-finger pan and two-finger pinch verified", flush=True)


def check_pen(hwnd, db, card_id):
    user.GetForegroundWindow.restype = wt.HWND
    user.OpenInputDesktop.argtypes = [wt.DWORD, wt.BOOL, wt.DWORD]
    user.OpenInputDesktop.restype = wt.HANDLE
    desktop = user.OpenInputDesktop(0, False, 1)
    if not desktop:
        raise RuntimeError("No accessible input desktop for the native pen test")
    user.CloseDesktop(wt.HANDLE(desktop))
    user.GetThreadDesktop.restype = wt.HANDLE
    current_desktop = user.GetThreadDesktop(ct.windll.kernel32.GetCurrentThreadId())
    is_input = wt.BOOL()
    if not user.GetUserObjectInformationW(wt.HANDLE(current_desktop), 6, ct.byref(is_input), ct.sizeof(is_input), None) or not is_input.value:
        raise RuntimeError("The test process is running outside the active input desktop")
    if user.GetForegroundWindow() != hwnd:
        raise RuntimeError("The test drawing window must have foreground focus")
    down = 0x10000 | 6 | 0x10
    move = 0x20000 | 6 | 0x10
    up = 0x40000 | 2
    def all_strokes():
        with closing(sqlite3.connect(db)) as conn:
            value = conn.execute("SELECT value FROM settings WHERE key=?", ("board:card:"+card_id,)).fetchone()[0]
            return json.loads(value).get("ink", {}).get("strokes", [])

    existing = all_strokes()
    def strokes():
        return all_strokes()[len(existing):]

    # Observe actual pixels while contact is still active and verify storage stays untouched.
    user.GetDC.restype = wt.HDC
    gdi = ct.windll.gdi32
    gdi.GetPixel.argtypes = [wt.HDC, ct.c_int, ct.c_int]
    def ink_pixel(x, y):
        dc = user.GetDC(wt.HWND(hwnd))
        try:
            pixel = gdi.GetPixel(dc, x, y)
            return pixel >= 0 and (pixel & 255) < 140
        finally:
            user.ReleaseDC(wt.HWND(hwnd), wt.HDC(dc))
    def line_profile():
        # Antialiased edges and actual pen widths, sampled well behind the tip.
        dc = user.GetDC(wt.HWND(hwnd))
        try:
            return [gdi.GetPixel(dc, x, y) for x in range(135, 221, 9) for y in range(162, 179)]
        finally:
            user.ReleaseDC(wt.HWND(hwnd), wt.HDC(dc))

    assert not ink_pixel(130, 170) and not ink_pixel(216, 170)
    delays = []
    checkpoints = {130, 145, 170, 195, 220, 360, 500, 640}
    before_lift = []
    def observe(x, y, started):
        if x not in checkpoints:
            return
        # Sample the line behind its tip, outside the current system pen cursor.
        probe = x - 4 if 130 < x <= 220 else x
        wait_for(lambda: ink_pixel(probe, y), timeout=.7)
        delays.append((time.perf_counter() - started) * 1000)
        assert not strokes(), "Ink reached SQLite before pen-up"
        if x == 640:
            before_lift.extend(line_profile())
    line_samples = [(130, 170, 200, down), (145, 170, 400, move), (170, 170, 650, move),
                    (195, 170, 800, move), (220, 170, 900, move)]
    # Leave a short blank gap at each checkpoint so a previous round tip cannot satisfy the probe.
    line_samples.extend((x, 170, 800, move) for x in range(222, 641, 2)
                        if not any(check - 22 <= x < check for check in (360, 500, 640)))
    line_samples.append((655, 195, 0, up))  # The lifted tip has moved away from the line.
    line = pen_gesture(hwnd, line_samples, strokes, observe=observe, interval=.004)[0]
    print("Visible ink before pen-up (ms): " + ", ".join(f"{v:.1f}" for v in delays), flush=True)
    def points(stroke):
        x = y = pressure = 0
        for dx, dy, dp in struct.iter_unpack("<hhh", base64.b64decode(stroke["points"])):
            x, y, pressure = x + dx, y + dy, pressure + dp
            yield x, y, pressure

    assert all_strokes()[:len(existing)] == existing
    time.sleep(.12)  # Allow the saved outline to reach the native window after the SQLite commit.
    after_lift = line_profile()
    assert len(set(before_lift)) > 1, "Native edge probes missed the live ink"
    changed = sum(a != b for a, b in zip(before_lift, after_lift))
    assert not changed, f"{changed} native edge pixels changed on release"
    original = list(points(line))
    assert all(y == original[0][1] for _, y, _ in original), "Pen-up added a tail after contact ended"
    pressures = {p for _, _, p in original if p > 0}
    assert min(pressures) < 400 and max(pressures) > 650, pressures
    inverted = "--inverted" in sys.argv[2:]
    if not inverted:
        # Activate the eraser in the editor toolbar while keeping the same note open.
        left, _, right, _ = bounds(hwnd)
        scale = user.GetDpiForWindow(hwnd) / 96
        x = right - left - round(195 * scale)
        y = round(26 * scale)
        for msg, button in [(0x200, 0), (0x201, 1), (0x202, 0)]:
            user.PostMessageW(hwnd, msg, button, (y << 16) | x)
        prefs = db.parent / "j-terminal-ink.json"
        wait_for(lambda: prefs.exists() and json.loads(prefs.read_text(encoding="utf-8"))["tool"] == "eraser")
    pen_gesture(hwnd, [(380, 150, 500, down), (380, 167, 500, move), (380, 188, 500, move), (380, 190, 0, up)],
                lambda: len(strokes()) == 2, inverted=inverted)
    left, right = (list(points(stroke)) for stroke in strokes())
    assert left[0][:2] == original[0][:2] and right[-1][:2] == original[-1][:2], (original, left, right)
    assert left[-1][0] < right[0][0] and all(y == original[0][1] for _, y, _ in left + right)
    print("Native pen pressure and partial eraser verified (" + ("inverted tip" if inverted else "eraser tool") + ")", flush=True)

    # Move the paper itself, then zoom around the first point on the moved line.
    def middle_drag(y0, y1):
        x, top, _, _ = bounds(hwnd)
        start, end = wt.POINT(x+240, top+y0), wt.POINT(x+240, top+y1)
        if any(user.WindowFromPoint(p) != hwnd for p in (start, end)):
            raise RuntimeError("Mouse drag would leave the test canvas")
        original_cursor = wt.POINT()
        user.GetCursorPos(ct.byref(original_cursor))
        user.SetCursorPos(start.x, start.y)
        try:
            time.sleep(.04)
            user.mouse_event(0x20, 0, 0, 0, 0)  # middle down
            time.sleep(.04)
            user.SetCursorPos(end.x, end.y)
            time.sleep(.08)
        finally:
            user.mouse_event(0x40, 0, 0, 0, 0)  # middle up
            user.SetCursorPos(original_cursor.x, original_cursor.y)
    assert ink_pixel(215, 170) and not ink_pixel(215, 214)
    middle_drag(190, 234)
    wait_for(lambda: ink_pixel(215, 214) and not ink_pixel(215, 170))
    screen_x, screen_y, _, _ = bounds(hwnd)
    anchor = (((screen_y + 214) & 0xffff) << 16) | ((screen_x + 130) & 0xffff)
    for delta, expected in [(120, True), (-120, False)]:
        user.PostMessageW(hwnd, 0x20a, ((delta & 0xffff) << 16) | 8, anchor)
        wait_for(lambda: ink_pixel(700, 214) == expected and ink_pixel(140, 214))
    middle_drag(234, 190)
    wait_for(lambda: ink_pixel(215, 170))
    if "--touch" in sys.argv[2:]:
        check_touch_camera(hwnd, ink_pixel)
    assert [list(points(s)) for s in strokes()] == [left, right], "Moving the camera edited a stroke"
    print("Canvas pan and pointer-anchored zoom verified in F11", flush=True)



def open_board(pid, hwnd):
    wait_for(lambda: visible_window(pid) == (hwnd, "J-TerminaL"))
    for character in "/board":
        user.PostMessageW(hwnd, 0x100, 0xe7, 1)
        user.PostMessageW(hwnd, 0x102, ord(character), 1)
        user.PostMessageW(hwnd, 0x101, 0xe7, 0xc0000001)
        time.sleep(.03)
    started = time.perf_counter()
    key(hwnd, 0x0d)
    wait_for(lambda: (visible_window(pid) or (None, "J-TerminaL"))[1] != "J-TerminaL")
    print(f"Board title visible after {(time.perf_counter()-started)*1000:.1f} ms", flush=True)
    time.sleep(.2)


def open_drawing(pid, hwnd):
    open_board(pid, hwnd)
    before = bounds(hwnd)
    key(hwnd, 0x0d)
    key(hwnd, 0x7a)  # F11
    wait_for(lambda: bounds(hwnd) != before)
    time.sleep(.2)
    return before


def measure_drag(hwnd, db, card_id):
    """Sample the moving paper edge on the native software-rendered window."""
    from statistics import median
    from threading import Thread

    scale = user.GetDpiForWindow(hwnd) / 96
    left, top, right, bottom = bounds(hwnd)
    width = right - left
    y = round((52 + 18 + 16 + 100) * scale)
    assert y < bottom - top
    gdi = ct.WinDLL("gdi32", use_last_error=True)
    user.GetDC.argtypes = [wt.HWND]
    user.GetDC.restype = wt.HDC
    user.ReleaseDC.argtypes = [wt.HWND, wt.HDC]
    gdi.CreateCompatibleDC.argtypes = [wt.HDC]
    gdi.CreateCompatibleDC.restype = wt.HDC
    gdi.CreateDIBSection.argtypes = [wt.HDC, ct.c_void_p, wt.UINT, ct.POINTER(ct.c_void_p), wt.HANDLE, wt.DWORD]
    gdi.CreateDIBSection.restype = wt.HANDLE
    gdi.SelectObject.argtypes = [wt.HDC, wt.HANDLE]
    gdi.SelectObject.restype = wt.HANDLE
    gdi.BitBlt.argtypes = [wt.HDC, ct.c_int, ct.c_int, ct.c_int, ct.c_int, wt.HDC, ct.c_int, ct.c_int, wt.DWORD]
    gdi.DeleteObject.argtypes = [wt.HANDLE]
    gdi.DeleteDC.argtypes = [wt.HDC]
    dc = user.GetDC(hwnd)
    row = gdi.CreateCompatibleDC(dc)
    ptr = ct.c_void_p()
    info = struct.pack("<IiiHHIIiiII", 40, width, -1, 1, 32, 0, 0, 0, 0, 0, 0)
    bitmap = gdi.CreateDIBSection(dc, info, 0, ct.byref(ptr), None, 0)
    if not bitmap:
        raise ct.WinError(ct.get_last_error())
    old = gdi.SelectObject(row, bitmap)

    def paper_edge(right_limit=None):
        gdi.BitBlt(row, 0, 0, width, 1, dc, 0, y, 0x00CC0020)
        gdi.GdiFlush()
        pixels = ct.string_at(ptr, width * 4)
        paper = bytes((0x8c, 0xd9, 0xe9))
        if right_limit is None:
            return pixels.find(paper) // 4
        return pixels.rfind(paper, 0, right_limit * 4) // 4

    def mouse(msg, x, pressed):
        user.PostMessageW(hwnd, msg, int(pressed), (y << 16) | x)

    def stored_x():
        with closing(sqlite3.connect(db)) as conn:
            raw = conn.execute("SELECT value FROM settings WHERE key=?", ("board:card:"+card_id,)).fetchone()[0]
            return json.loads(raw).get("boardX")

    try:
        edge = wait_for(lambda: max(0, paper_edge()))
        start = edge + round(24 * scale)
        distance = min(round(160 * scale), width - start - 20)
        original = stored_x()
        # WM_MOUSEWHEEL carries screen coordinates and its own Ctrl state.
        # Read the rendered left edge against the pointer-anchored zoom equation.
        anchor = edge + round(82 * scale)
        right_edge = paper_edge(edge + round(252 * scale))
        location = (((top + y) & 0xffff) << 16) | ((left + anchor) & 0xffff)
        user.PostMessageW(hwnd, 0x20a, (120 << 16) | 8, location)
        enlarged = wait_for(lambda: (p if 0 < (p := paper_edge()) < edge - 5 else None))
        assert abs(enlarged - (anchor + 1.2 * (edge - anchor))) <= 3, (edge, enlarged)
        zoomed_right = paper_edge(enlarged + round(1.2 * 252 * scale))
        assert abs((zoomed_right - enlarged) - 1.2 * (right_edge - edge)) < 4, (edge, right_edge, enlarged, zoomed_right)
        user.PostMessageW(hwnd, 0x20a, ((-120 & 0xffff) << 16) | 8, location)
        wait_for(lambda: abs(paper_edge() - edge) <= 1)
        print("Ctrl+wheel zoomed in and out around the pointer", flush=True)

        # Simulate lost capture with no button-up, then start a normal new drag.
        mouse(0x200, start, False)
        mouse(0x201, start, True)
        mouse(0x200, start + 28, True)
        wait_for(lambda: paper_edge() > edge + 12)
        user.PostMessageW(hwnd, 0x215, 0, 0)
        wait_for(lambda: abs(paper_edge() - edge) <= 1)
        assert stored_x() == original
        mouse(0x200, start, False)
        mouse(0x201, start, True)
        def move():
            for offset in range(1, distance + 1):
                mouse(0x200, start + offset, True)
                time.sleep(.004)
        worker = Thread(target=move)
        worker.start()
        samples = []
        last = edge
        while worker.is_alive():
            x = paper_edge()
            if x > last:
                samples.append(time.perf_counter())
                last = x
            time.sleep(.001)
        worker.join()
        assert stored_x() == original, "Geometry was saved while the pointer was down"
        mouse(0x202, start + distance, False)
        wait_for(lambda: stored_x() != original)
        assert len(samples) >= 4, ("Too few distinct displayed positions", samples)
        intervals = sorted((b-a)*1000 for a,b in zip(samples,samples[1:]))
        print(f"Native drag, 8 cards: {len(samples)} displayed positions, "
              f"median {median(intervals):.1f} ms, p95 {intervals[int(.95*(len(intervals)-1))]:.1f} ms, "
              f"saved on release at x={stored_x()}", flush=True)
    finally:
        gdi.SelectObject(row, old)
        gdi.DeleteObject(bitmap)
        gdi.DeleteDC(row)
        user.ReleaseDC(hwnd, dc)


def check_focus_frame(hwnd):
    """Deactivate the drawing window with an independent test HWND and inspect its header."""
    user.GetDC.restype = wt.HDC
    user.GetForegroundWindow.restype = wt.HWND
    user.SetForegroundWindow.argtypes = [wt.HWND]
    user.CreateWindowExW.restype = wt.HWND
    user.CreateWindowExW.argtypes = [wt.DWORD, wt.LPCWSTR, wt.LPCWSTR, wt.DWORD, ct.c_int, ct.c_int,
                                     ct.c_int, ct.c_int, wt.HWND, wt.HMENU, wt.HINSTANCE, ct.c_void_p]
    user.DestroyWindow.argtypes = [wt.HWND]
    gdi = ct.windll.gdi32
    gdi.GetPixel.argtypes = [wt.HDC, ct.c_int, ct.c_int]

    def header_pixel(fraction):
        dc = user.GetDC(wt.HWND(hwnd))
        try:
            return gdi.GetPixel(dc, round((bounds(hwnd)[2] - bounds(hwnd)[0]) * fraction), 12)
        finally:
            user.ReleaseDC(wt.HWND(hwnd), wt.HDC(dc))

    def dark_header():
        # The inactive Slint header can repaint between its two dark background tones.
        # The system caption from the regression is a light strip across this row.
        for fraction in (.5, .65, .8):
            pixel = header_pixel(fraction)
            if pixel < 0 or max(pixel >> shift & 255 for shift in (0, 8, 16)) >= 100:
                return False
        return True

    wait_for(dark_header)
    original = bounds(hwnd)
    # A tool window off the workspace receives real activation without covering any test pixels.
    sink = user.CreateWindowExW(0x80, "STATIC", "", 0x90000000, -32000, -32000, 1, 1, None, None, None, None)
    if not sink:
        raise ct.WinError(ct.get_last_error())
    current = ct.windll.kernel32.GetCurrentThreadId()
    window_thread = user.GetWindowThreadProcessId(hwnd, None)
    if not user.AttachThreadInput(current, window_thread, True):
        user.DestroyWindow(sink)
        raise ct.WinError(ct.get_last_error())
    try:
        user.SetActiveWindow(wt.HWND(sink))
        user.SetForegroundWindow(sink)
        user.SetFocus(wt.HWND(sink))
        wait_for(lambda: user.GetForegroundWindow() == sink)
        time.sleep(.15)
        assert user.IsWindowVisible(wt.HWND(hwnd)), "Drawing window hid on focus loss"
        assert user.GetWindowLongW(wt.HWND(hwnd), -16) & 0xc00000 == 0, "Launcher gained WS_CAPTION"
        origin = wt.POINT(0, 0)
        user.ClientToScreen(wt.HWND(hwnd), ct.byref(origin))
        assert (origin.x, origin.y) == original[:2], "Client area gained a native frame"
        assert dark_header(), "Windows painted a caption on deactivation"
        user.SetActiveWindow(wt.HWND(hwnd))
        user.SetForegroundWindow(hwnd)
        user.SetFocus(wt.HWND(hwnd))
        wait_for(lambda: user.GetForegroundWindow() == hwnd)
    finally:
        user.AttachThreadInput(current, window_thread, False)
        user.DestroyWindow(sink)


def run(exe):
    with tempfile.TemporaryDirectory(prefix="j-terminal-board-") as folder:
        root = Path(folder)
        db = root / "journal.sqlite3"
        sqlite3.connect(db).close()
        (root / "board-scopes.json").write_text('["day"]', encoding="utf-8")
        args = [str(exe), "--data", folder]
        with subprocess.Popen([*args, "--background"], stderr=subprocess.PIPE, creationflags=subprocess.CREATE_NO_WINDOW) as app:
            try:
                def ready():
                    with closing(sqlite3.connect(db)) as conn:
                        return conn.execute("SELECT count(*) FROM sqlite_master WHERE name='settings'").fetchone()[0]
                wait_for(ready)
                card_id = str(uuid.uuid4())
                card = dict(id=card_id, kind="note", title="Stiftprobe", mode="ink", w=760, h=520, dates=[str(datetime.date.today())], text="")
                if "--pen" in sys.argv[2:] or "--inverted" in sys.argv[2:]:
                    saved = []
                    for i in range(120):
                        raw = struct.pack("<hhh", (12 + (i%12)*54)*4, (180 + i//12*15)*4, 520)
                        raw += b"".join(struct.pack("<hhh", 4, (j%5 - 2)*2, 0) for j in range(36))
                        saved.append(dict(points=base64.b64encode(raw).decode("ascii"), size=2, pressure=True))
                    card["ink"] = dict(v=1, strokes=saved)
                    card["inkPaper"] = dict(kind="grid", step=4)
                with closing(sqlite3.connect(db)) as conn:
                    conn.execute("INSERT INTO settings(key,value) VALUES(?,?)", ("board:card:" + card_id, json.dumps(card)))
                    if "--drag" in sys.argv[2:]:
                        card.update(w=232, h=174, title="Hallo ich habe einen Titel", mode="text", text="# Auflistung\n\nIch bin hier noch nicht **fertig**",
                                    boardX=30, y=18, order=0)
                        conn.execute("UPDATE settings SET value=? WHERE key=?", (json.dumps(card), "board:card:"+card_id))
                        for index in range(1,8):
                            peer = dict(card, id=str(uuid.uuid4()), boardX=340 + (index%3)*244, y=18+(index//3)*190, order=index)
                            conn.execute("INSERT INTO settings(key,value) VALUES(?,?)", ("board:card:"+peer["id"],json.dumps(peer)))
                    conn.commit()
                time.sleep(.4)
                print("Background", memory(app), flush=True)
                subprocess.run(args, timeout=5, check=True, creationflags=subprocess.CREATE_NO_WINDOW)
                hwnd, _ = wait_for(lambda: visible_window(app.pid))
                time.sleep(.3)
                # Windows can briefly return focus to the invoking shell after IPC activation.
                # The launcher hides on focus loss. Reactivate only this temporary vault's window.
                if not visible_window(app.pid):
                    subprocess.run(args, timeout=5, check=True, creationflags=subprocess.CREATE_NO_WINDOW)
                    hwnd, _ = wait_for(lambda: visible_window(app.pid))
                if "--drag" in sys.argv[2:]:
                    open_board(app.pid, hwnd)
                    measure_drag(hwnd, db, card_id)
                    return
                before = open_drawing(app.pid, hwnd)
                if {"--pen", "--inverted"}.intersection(sys.argv[2:]):
                    check_pen(hwnd, db, card_id)
                check_focus_frame(hwnd)
                key(hwnd, 0x1b)
                wait_for(lambda: bounds(hwnd) == before)
                check_focus_frame(hwnd)
                key(hwnd, 0x1b)
                key(hwnd, 0x1b)
                wait_for(lambda: visible_window(app.pid) == (hwnd, "J-TerminaL"))
                key(hwnd, 0x1b)
                wait_for(lambda: not visible_window(app.pid))
                time.sleep(.5)
                print("After closing board", memory(app), flush=True)
                print(f"Restored window {before}; digitizer flags 0x{user.GetSystemMetrics(94):x}", flush=True)
            finally:
                app.terminate()
                app.wait(timeout=8)
                print(app.stderr.read().decode(errors="replace"), end="")


if __name__ == "__main__":
    run(Path(sys.argv[1]).resolve(strict=True))

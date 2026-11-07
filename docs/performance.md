# Resource management

- Closed book drawers and Nebula windows keep their frame/position but unmount their calendar or notebook content. Minimized Nebula panels unmount their content too. Card writes remain in the shared persistent write queue.
- Calendar range data replaces the previous range instead of accumulating all dates visited.
- The journal retains at most 32 recently requested days. Evicted days reload from SQLite.
- Window blur or document visibility loss pauses CSS animations, including the large SVG orbits. Focus resumes them.
- Windows WebView2 receives MemoryUsageTargetLevel.Low on loss of focus and Normal on focus. Unsupported runtime interfaces are skipped. Full renderer suspension is deliberately avoided because the main window also handles background mail recognition/import and inter-window events.
- The local mail inference worker releases its model after 60 seconds of idle time, checked every 15 seconds independently of the five-minute mail fetch. An active inference holds the worker lock and cannot be killed by the cleanup. A subsequent mail reloads the model.

Checks: native suite; journal-cache.test.mjs; JOURNAL_UI_SCOPE=performance, notebook and calendar-start. Browser checks use synthetic data. These are functional checks, not a measured before/after RAM or CPU benchmark. Actual savings depend on loaded mail models, content, images, open windows and the installed WebView2 runtime.

#!/bin/sh
# Stands in for $SHELL during the smoke tests. The app runs `$SHELL -ilc "printf MARKER; env -0"` to learn the user's real
# environment; this answers the same way but with the stand-in `claude` first on PATH, so no real Claude is ever started.
exec env PATH="$SMOKE_BIN:$PATH" /bin/sh -c "printf '%s' '__CLAUDE_BOARD_ENV__'; env -0"

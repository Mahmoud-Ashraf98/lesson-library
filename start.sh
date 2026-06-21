#!/data/data/com.termux/files/usr/bin/bash
# Material Library launcher.
# Keeps an identical copy of itself at ~/.shortcuts/LessonLibrary.sh so the
# Termux:Widget app can start the server with one tap. The app directory is
# remembered in ~/.lessonlibrary-app-dir so the widget copy finds server.py.

DIR="$(cd "$(dirname "$0")" && pwd)"
if [ ! -f "$DIR/server.py" ] && [ -f "$HOME/.lessonlibrary-app-dir" ]; then
  DIR="$(cat "$HOME/.lessonlibrary-app-dir")"
fi
if [ ! -f "$DIR/server.py" ]; then
  echo "server.py not found — run start.sh from the app folder once."
  exit 1
fi

printf '%s\n' "$DIR" > "$HOME/.lessonlibrary-app-dir"
mkdir -p "$HOME/.shortcuts" 2>/dev/null \
  && cp -f "$DIR/start.sh" "$HOME/.shortcuts/LessonLibrary.sh" 2>/dev/null

# Best effort: keep Android from killing the server while the screen is off.
command -v termux-wake-lock >/dev/null 2>&1 && termux-wake-lock

cd "$DIR" && exec python server.py

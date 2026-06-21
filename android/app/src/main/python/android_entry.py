"""Android entry point for the embedded Material Library server."""

import importlib
import os


def start(data_dir):
    os.environ["LESSONLIB_DATA_DIR"] = str(data_dir)
    server = importlib.import_module("server")
    server.ensure_dirs()
    server.ensure_port_free()
    server.rebuild_index()
    server.log(f"data: {server.DATA_DIR}")
    server.app.run(
        host=server.HOST,
        port=server.PORT,
        threaded=True,
        debug=False,
        use_reloader=False,
    )

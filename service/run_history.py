"""Phase3A supported launcher. Fixed loopback, fixed port, private local runtime."""
import os
import sys
sys.dont_write_bytecode = True
from archive_cli import configure_ephemeral_key
from app.history_store import DEFAULT_STATE

if __name__ == '__main__':
    configure_ephemeral_key(os.environ.get('FLOWASSERT_HISTORY_STATE', str(DEFAULT_STATE)))
    import uvicorn
    uvicorn.run('app.history_api:create_history_app', factory=True, host='127.0.0.1', port=8765, access_log=False)

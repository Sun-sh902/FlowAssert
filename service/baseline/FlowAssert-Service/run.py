"""Supported launch entry point: loopback only, no runtime configuration from HTTP."""
import sys
sys.dont_write_bytecode=True
import uvicorn
if __name__ == '__main__':
    uvicorn.run('app.main:app',host='127.0.0.1',port=8765,access_log=False)

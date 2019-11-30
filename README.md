# Inouk Python 3 DeBugger for Visual Studio Code (Alpha)

## Introduction

This extension allows to use the Ikp3db Python debugger with Visual Studio Code.

IKp3db is the python debugger used by Cloud9 then AWS Cloud9 since 2016.

While this is a preliminary version, it is stable enough to be used daily.

## Features available in this extension

* Add/remove breakpoints
* Conditional breakpoints
* Suspend, Resume, Step over, Step in, Step out
* Local and Global variables
* Watch window
* Evaluate Expressions
* Local Debugging (compatible with VS Code `Remote Development - Remote SSH`)
* Multi-threaded debugging (see [documentation](documentation/multi_threaded.md))

## Features availables in the debugger but not yet in this extension

* Remote (docker) debugging over TCP

## Features not available

* Multi Process debugging (not **yet** available).

## Why this extension ????

I was unable to use VS Code default python debugger with some of my projects.<br/>
I got a "stack overflow" with this message:

    Traceback (most recent call last):
        File "/home/cmorisse_mpy/.vscode-server-insiders/extensions/ms-python.python-2019.11.50794/pythonFiles/lib/python/old_ptvsd/ptvsd/_vendored/pydevd/_pydevd_bundle/pydevd_trace_dispatch_regular.py", line 412, in __call__
            if frame_cache_key in cache_skips:
        RecursionError: maximum recursion depth exceeded in comparison
        Fatal Python error: Cannot recover from stack overflow.

As I searched further I found this: https://github.com/microsoft/vscode-python/issues/5375 <br/>
Then this: https://github.com/microsoft/ptvsd/issues/1379#issuecomment-495576724 where
I understood that I won't be able to use the default debugger soon.

So I decided to try to integrate IKp3db (the debugger) into VS Code and wrote this extension.

If you're also concerned by the issue above, you may give a try to IKp3db for VS Code.


## Requirements

This VS Code extension requires:

* IKp3db v1.5 and above
* Python 3.6 and above

IKp3db debugger requires:

* macOS or Linux (Windows is not supported)
* a Compiler and Python headers

Note that remote debugging of Python programs running on Linux from VS Code 
running on Windows should work.

## Installation

This extension, requires the ikp3db debugger (version 1.5 or above) python package.

### Installation of the IKp3db debugger

IK3db version 1.5 or above must be available in PYTHONPATH (or current 
virtualenv).<br/>To install:

    # Preferably in a virtualenv
    pip install -i https://test.pypi.org/simple ikp3db==1.5.dev002

Note: ikp3db 1.5 will be hosted on `test pypi` as long as it is under development.

## Extension Settings / Debugger configuration

Here is a typical IKp3db Launch configuration:
```
{
    // Use IntelliSense to learn about possible attributes.
    // Hover to view descriptions of existing attributes.
    // For more information, visit: https://go.microsoft.com/fwlink/?linkid=830387
    "version": "0.2.0",
    "configurations": [
        {
            "type": "ikp3db",
            "request": "launch",
            "name": "Launch (Ikp3db)",
            "pythonPath": "${config:python.pythonPath}"
            "cwd": "${workspaceFolder}",
            "ikp3dbArgs": [
                "--ikpdb-log=G"
            ],
            "program": "${file}",
            "args": [
            ],
        }
    ]
}
```

3 configuration options are **required**:

* *pythonPath*
* *cwd*
* *program*

### pythonPath

Default is to use VS Code `current` virtualenv.

### cwd

Current Working Directory of debugged program. Usually the directory from where
you launch your program.<br/>
Default is `${workspaceFolder}`

### program

Absolute path (or relative path from cwd) of program to debug.

## Licence

This extension is Licenced under MIT.


## Sources and References

* https://github.com/cmorisse/ikp3db
* https://github.com/cmorisse/vscode-ikp3db
* https://ikpdb.readthedocs.io/en/1.x/


## Release Notes
[CHANGELOG](CHANGELOG.md)


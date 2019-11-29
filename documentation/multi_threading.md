# Debugging of Multithreaded Programs

Multithreaded debugging is supported.

## Currently Debugged Thread

IKp3db identifies the currently debugged thread in `ìs_debugged_thread`.
In VS Code GUI, the currently debugged thread is identified by his name starting 
with a star.

When debugger starts `is_debugged_thread` is None.

The first thread that triggers a breakpoint becomes the current debugged thread and 
remains it until it is reset. 
For that you must click on the stop button of the IKpdnMainLoop thread is the threads list.






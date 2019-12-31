# Debug Configurations Reference

There are 2 ways to launch a debug session:

* Using a "launch" configuration; VS Code launch the debugger and connects to it.
* Using an "attach" configuration; You launch the debugger and VS Code connects to it.


## "launch" configurations

There are 2 kind of 'launch' configurations; **standard** and **advanced**.

### **standard** 'launch' configurations

In **standard** 'launch' configurations, all debugging parameters can be defined using VS Code UI. 

Paremeters definition can be found in the § "Extension Settings / Debugger configuration" of the README.md and in the `package.json` of the plugin.

### **advanced** 'launch' configurations

In **advanced** 'launch' configurations, you get total control over the launch of the debugged program. With **advanced** 'launch' configurations, you can run programs that require sudo or launch docker containers

Here is an example of advanced 'launch' configuration.

    {
        "type": "ikp3db",
        "request": "launch",
        "name": "In docker",
        "spawnCommand": [
            "docker run -i",
            "-p 10069:8069 -p 8072:8072 -p 15470:15470",
            "-v /Users/cmorisse/dev-oursbleu/appserver-boken/datadir:/var/lib/odoo",
            "-v /Users/cmorisse/dev-oursbleu/appserver-boken/parts:/opt/appserver/parts",
            "-v /Users/cmorisse/dev-oursbleu/appserver--boken/project_addons:/opt/appserver/project_addons",
            "-v /Users/cmorisse/dev-oursbleu/appserver--boken/etc:/opt/appserver/etc",
            "-e IKP3DB_ARGS='--ikpdb-protocol=vscode --ikpdb-address=0.0.0.0 -ik_ccwd=/Users/cmorisse/dev-oursbleu/appserver-xsid -ik_cwd=/opt/appserver --ikpdb-log=9pPg'",
            "-e PGHOST=docker.for.mac.host.internal",
            "inouk-odoo-dev:v12",
            "ikp3db"
        ],
        "spawnOptions": {}
    },

As you can see, **advanced** configurations use only 2 options:

* `spawnCommand` ; an array of string that is transformed to a command string (using join(' '))
* `spawnOptions`; an object.

both options are passed to nodejs api [child_process.spawn()](https://nodejs.org/api/child_process.html#child_process_child_process_spawn_command_args_options).

Note that the plugin forces the option shell so we don't use `args`.

## "attach" configurations

"attach" configuration require only 3 parameters to define how to connect to a running ikp3db debugger:

* **'host'**; IP address of the host on which the debugger is running. This can be any address (localhost, a domain name, or a full IP v4 address).
* **'port'**; The network port on the host on which ikp3db is listening. Default is 15470.
* **'sourceRoot'**; The root of the source files. Usually this is the workspace folder. And it **must** be the same as ikp3db client working directory.

Here is a typical **'attach'** configuration

    {
        "type": "ikp3db",
        "request": "attach",
        "name": "debug cfg name (attach)",
        "host": "127.0.0.1",
        "port": 15470,
        "sourceRoot": "${workspaceFolder}"
    },    

### Example use of an attach configuration

* install ikp3db in your virtual env
    * pip install --pre -i https://test.pypi.org/simple ikp3db
* Launch the program to debug
    * python3 -m ikp3db --ikpdb-protocol=vscode --ikpdb-address=0.0.0.0 -ik_ccwd={{{{{ same value as sourceRoot }} -ik_cwd={{ cwd of debugged program }}--ikpdb-log=Pg your_prog.py your_prog_arg1
* Launch the VS Code attach configuration





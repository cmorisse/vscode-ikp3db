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
        "name": "docker launch (advanced)",
        "spawnCommand": [
            "docker run -i",
            "-p 10069:8069 -p 8072:8072 -p 15470:15470",
            "-v ${workspaceFolder}/datadir:/var/lib/odoo",
            "-v ${workspaceFolder}/parts:/opt/appserver/parts",
            "-v ${workspaceFolder}/project_addons:/opt/appserver/project_addons",
            "-v ${workspaceFolder}/etc:/opt/appserver/etc",
            "-e IKP3DB_ARGS='--ikpdb-protocol=vscode --ikpdb-address=0.0.0.0 -ik_ccwd=${workspaceFolder} -ik_cwd=/opt/appserver --ikpdb-log=9pPg'",
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

### Special notes about 'Docker'

Ikp3db analyses `spawnCommand` to check wether it's a "docker run" command. In that
case it searches for a `--name` argument. <br/>
If `--name` is found then the container name is used to emit a `docker rm --force ${name}` when you stop debugging (by 
clicking on the red square). <br/>
If none is found then ikp3db injects a `--name=ikp3db_{{aRandomNumber}}` in 
the spawnCommand and use this name to emit a `docker rm --force ikp3db_{{aRandomNumber}}`
 when you stop debugging.
 
 If this behaviour does not suit you or you want a total control over your container lifecycle, you should use an "attach" configuration.


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





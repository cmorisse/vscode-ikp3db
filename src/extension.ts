'use strict';

import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as child_process from 'child_process';
import * as Net from 'net';

import { localize } from './utilities';
import { Ikp3dbDebugSession } from './ikp3dbDebug';

const EMBED_DEBUG_ADAPTER = false;

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('ikp3db', new Ikp3dbConfigurationProvider()));

    if (EMBED_DEBUG_ADAPTER) {
        const factory = new Ikp3dbDebugAdapterDescriptorFactory();
        context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory('ikp3db', factory));
        context.subscriptions.push(factory);
	} else {
		// The following use of a DebugAdapter factory shows how to control what 
		// debug adapter executable is used.
		// Since the code implements the default behavior, it is absolutely not 
		// neccessary and we show it here only for educational purpose.
		context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory('ikp3db', {
			createDebugAdapterDescriptor: (session: vscode.DebugSession, executable: vscode.DebugAdapterExecutable | undefined) => {
				// param "executable" contains the executable optionally specified 
				// in the package.json (if any)
				// use the executable specified in the package.json if it exists
				// or determine it based on some other information (e.g. the session)
				if (!executable) {
					const command = "absolute path to my DA executable";
					const args = [
						"some args",
						"another arg"
					];
					const options = {
						cwd: "working directory for executable",
						env: { "VAR": "some value" }
					};
					executable = new vscode.DebugAdapterExecutable(command, args, options);
				}

				// make VS Code launch the DA executable
				return executable;
			}
		}));
	}
}

export function deactivate() {
	console.debug("Entering deactivate()")
}

class Ikp3dbConfigurationProvider implements vscode.DebugConfigurationProvider {
	
		/**
		 * Returns an initial debug configuration based on contextual information, e.g. package.json or folder.
		 */
		provideDebugConfigurations(folder: vscode.WorkspaceFolder | undefined, token?: vscode.CancellationToken): vscode.ProviderResult<vscode.DebugConfiguration[]> {
			return [createLaunchConfigFromContext(folder, false)];
		}
	
		/**
		 * Try to add all missing attributes to the debug configuration being launched.
		 */
		resolveDebugConfiguration(folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration, token?: vscode.CancellationToken): vscode.ProviderResult<vscode.DebugConfiguration> {
	
			if (!config.type && !config.request && !config.name) {	
				config = createLaunchConfigFromContext(folder, true);
				if (!config.program) {
					const message = "Cannot find a program to debug";
					return vscode.window.showInformationMessage(message).then(_ => {
						return undefined;	// abort launch
					});
				}
			}
	
			if (!config.cwd) {
				if (folder) {
					config.cwd = folder.uri.fsPath
				} else if (config.program) {
					// derive 'cwd' from 'program'
					config.cwd = path.dirname(config.program)
				}
			}

			config.pythonPath = config.pythonPath || "${config:python.pythonPath}"
			return config;
		}
	
	}

	function createLaunchConfigFromContext(folder: vscode.WorkspaceFolder | undefined, resolve: boolean): vscode.DebugConfiguration {
		const config = {
			type: 'ikp3db',
			request: 'launch',
			name: localize('ikp3db.launch.config.name', "Launch (Ikp3db)")
		};
	
		let program: string | undefined;
		
		// try to use file open in editor
		const editor = vscode.window.activeTextEditor;
		if (editor) {
			const languageId = editor.document.languageId;
			if (languageId === 'python') {
				const wf = vscode.workspace.getWorkspaceFolder(editor.document.uri);
				if (wf === folder) {
					program = vscode.workspace.asRelativePath(editor.document.uri);
					if (!path.isAbsolute(program)) {
						program = '${workspaceFolder}/' + program;
					}
				}
			}
		}
	
		// if we couldn't find a value for 'program', we just let the launch config use the file open in the editor
		if (!resolve && !program) {
			program = '${file}';
		}
	
		if (program) {
			config['program'] = program;
		}
	
		return config;
	}
	
class Ikp3dbDebugAdapterDescriptorFactory implements vscode.DebugAdapterDescriptorFactory {

	private server?: Net.Server;

	createDebugAdapterDescriptor(session: vscode.DebugSession, executable: vscode.DebugAdapterExecutable | undefined): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {

		if (!this.server) {
			// start listening on a random port
			this.server = Net.createServer(socket => {
				const session = new Ikp3dbDebugSession();
				session.setRunAsServer(true);
				session.start(<NodeJS.ReadableStream>socket, socket);
			}).listen(0);
		}

		// make VS Code connect to debug server
		return new vscode.DebugAdapterServer((<Net.AddressInfo>this.server.address()).port);
	}

	dispose() {
		if (this.server) {
			this.server.close();
		}
	}
}
	
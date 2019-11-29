'use strict';

import {
	DebugSession,
	InitializedEvent, TerminatedEvent, ContinuedEvent, StoppedEvent, BreakpointEvent, OutputEvent, Event,
	Thread, StackFrame, Scope, Source, Handles, Breakpoint
} from 'vscode-debugadapter';
import { DebugProtocol } from 'vscode-debugprotocol';
import { readFileSync, existsSync } from 'fs';
import { fork, spawn, ChildProcess } from 'child_process';
import * as net from 'net';
import * as path from 'path';


const IKPDB_MAGIC_CODE: string = "LLADpcdtbdpac";

export interface LaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {

	program: string;
	args: string[];
	ikp3dbArgs: string[];
	cwd: string;
	host: string;
	port: number;
	pythonPath: string;
	sourceRoot?: string | string[];
	stopOnEntry?: boolean;
}

export interface AttachRequestArguments extends DebugProtocol.AttachRequestArguments {
	host: string;
	port: number;
	sourceRoot: string | string[];

	stopOnEntry?: boolean;
}

export interface Ikp3dbServerEvent {
	_id: number;
	command: string;
	result: any;
	commandExecStatus: string;
	exception?: any;
	frames?: any[];
	threads?: any[];
	thread_ident?: number;
	info_messages?: string[];
	warning_messages?: string[];
	error_messages?: string[];
}

class Ikp3dbVariable {
	public constructor(
		id: number,
		name: string,
		type: string,
		value: any,
		children_count: number,
	) {}
}

class Ikp3dbVariablesReference {
	public constructor(
		public type: string,
		public name: string,
		public key: string,

		public command: string, 
		public args: any
	) {}
}

export interface Ikp3dbFrame {
	id: number;
	name: string;
	thread: number;
	thread_name: string;
	line_number:  number;
	file_path: string;
	f_locals: Array<Ikp3dbVariable>
	f_globals: Array<Ikp3dbVariable>
}

export interface Ikp3dbClientEvent {
	_id: number;
	command: string;
	args: any;
}

interface Ikp3dbClient {
	send(command: string, args?: any, callback?: (response: any) => void);
	end();
	on_event: (event: Ikp3dbServerEvent) => void;
	on_close: () => void;
	on_open: () => void;
	on_error: (e: any) => void;
	on_data: (data: string) => void;
}

class Ikp3dbBTCPClient {
	private _connection: net.Socket;

	private _callback_map = {};
	private _request_id = 0;
	private _end = false;

	private on_close_() {
		for (var key in this._callback_map) {
			this._callback_map[key]({ result: null, id: key });
			delete this._callback_map[key];
		}

		if (this.on_close) {
			this.on_close();
		}
	}
	private on_connect_() {
		this._connection.on('close', () => {
			this.on_close_();
		});
		if (this.on_open) {
			this.on_open();
		}
	}

	public constructor(port: number, host: string) {
		console.info("Ikp3dbClient connects to "+host+":"+port)
		this._connection = net.connect(port, host);
		this._connection.on('connect', () => {
			this.on_connect_();
		});

		var retryCount = 0;
		this._connection.on('error', (e: any) => {
			if (e.code == 'ECONNREFUSED' && retryCount < 10) {
				console.warn("Ikp3dbClient failed to connect: "+e.message);
				retryCount++;
				setTimeout(() => {
					console.info("Ikp3dbClient retrying connection to "+host+":"+port)
					if (!this._end) {
						this._connection.connect(port, host);
					}
				}, 500);
				return;
			}

			console.error("Ikp3dbClient Error: "+e.message);
			if (this.on_error) {
				this.on_error(e);
			}
		});

		var chunk = "";
		/**
		 * Message format:
		 * length=%s{{IKPDB_MAGIC_CODE}}{{MESSAGE_DATA}}
		 * length does not include MAGIC_CODE
		 */
		var ondata = (data) => {
			//console.log("received:"+data)
			chunk += data.toString();
			do {
				var magicCodeIdx = chunk.indexOf(IKPDB_MAGIC_CODE);
				var lengthIdx = chunk.indexOf("length=");
				if (magicCodeIdx == -1 || lengthIdx == -1) {
					return
				}
				var jsonLength = parseInt(chunk.slice(lengthIdx + 7, magicCodeIdx));
				var messageLength = magicCodeIdx + IKPDB_MAGIC_CODE.length + jsonLength;
				if (chunk.length >= messageLength) {
					var message = chunk.slice(0, messageLength);
					chunk = chunk.slice(messageLength);
					var payload = JSON.parse(message.split(IKPDB_MAGIC_CODE)[1]);
					this.receive(payload);
				} else return;
			} while(chunk)
		}
		this._connection.on('data', ondata);
	}

	public send(command: string, args?: any, callback?: (response: any) => void) {
		let id = this._request_id++;

		let payload:Ikp3dbClientEvent = {
			_id: id,
			command: command,
			args: args || {}
		}
		const payloadStr = JSON.stringify(payload);
		const msgStr = ["length=", payloadStr.length, IKPDB_MAGIC_CODE, payloadStr].join("");

		var ret = this._connection.write(msgStr);

		if (callback) {
			if (ret) {
				this._callback_map[id] = callback
			} else {
				setTimeout(function () {
					callback({ result: null, id: id });
				}, 0);
			}
		}
	}

	public receive(event: Ikp3dbServerEvent) {
		if (this._callback_map[event._id]) {
			this._callback_map[event._id](event);
			delete this._callback_map[event._id];
		} else {
			if (this.on_event) {
				this.on_event(event);
			}
		}
	}
	public end() {
		this._end = true;
		this._connection.end();
	}

	on_event: (event: Ikp3dbServerEvent) => void;
	on_data: (data: string) => void;
	on_close: () => void;
	public on_open(): void {
		console.info("Ikp3dbClient connected.")
	}
	on_error: (e: any) => void;
}

export class Ikp3dbDebugSession extends DebugSession {

	private static THREAD_ID = 1;
	private _debug_server_process: ChildProcess;
	private _debug_client: Ikp3dbClient;

	// maps from sourceFile to array of Breakpoints
	private _breakPoints = new Map<string, DebugProtocol.Breakpoint[]>();
	private _breakPointID = 1000;
	private _sourceHandles = new Handles<string>();
	private _stopOnEntry: boolean;
	
	private _variablesHandles = new Handles<Ikp3dbVariablesReference>();

	/**
	 * Creates a new debug adapter that is used for one debug session.
	 * We configure the default implementation of a debug adapter here.
	 */
	public constructor() {
		super();
		this.setDebuggerLinesStartAt1(true);
		this.setDebuggerColumnsStartAt1(true);
	}

	/**
	 * The 'initialize' request is the first request called by the frontend
	 * to interrogate the features the debug adapter provides.
	 * See values in debugProtocol.ts
	 */
	protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {
		if (this._debug_server_process) {
			this._debug_server_process.kill();
			delete this._debug_server_process;
		}
		if (this._debug_client) {
			this._debug_client.end();
			delete this._debug_client;
		}
		// This debug adapter implements the configurationDoneRequest.
		response.body.supportsConfigurationDoneRequest = true;
		response.body.supportsConditionalBreakpoints = true;

		/** The debug adapter supports breakpoints that break execution after a specified number of hits. */
		//response.body.supportsHitConditionalBreakpoints = false;

		/*
		response.body.supportsEvaluateForHovers = false;
		response.body.supportsRestartRequest =  true;
		*/
        response.body.supportsSetVariable = true;		

		/** The debug adapter supports the 'terminateDebuggee' attribute on the 'disconnect' request. */
		//response.body.supportTerminateDebuggee = false;

		/** The debug adapter supports the 'terminate' request. */
		//response.body.supportsTerminateRequest = true;

		/** The debug adapter supports the 'breakpointLocations' request. */
		//response.body.supportsBreakpointLocationsRequest = false;

		this.sendResponse(response);
	}

	private setupSourceEnv(sourceRoot: string[]) {
		this.convertClientPathToDebugger = (clientPath: string): string => {
			for (let index = 0; index < sourceRoot.length; index++) {
				var root = sourceRoot[index];
				var resolvedRoot = path.resolve(root);
				var resolvedClient = path.resolve(clientPath);
				if (resolvedClient.startsWith(resolvedRoot)) {
					return path.relative(resolvedRoot, resolvedClient);
				}
			}
			return path.relative(sourceRoot[0], clientPath);
		}
		this.convertDebuggerPathToClient = (debuggerPath: string): string => {
			// TODO: How to handle evaluated tring path
			const filename: string = debuggerPath;
			if (path.isAbsolute(filename)) {
				return filename;
			} else {
				if (sourceRoot.length > 1) {
					for (let index = 0; index < sourceRoot.length; index++) {
						var absolutePath = path.join(sourceRoot[index], filename);
						if (existsSync(absolutePath)) {
							return absolutePath
						}
					}
				}
				return path.join(sourceRoot[0], filename);
			}
		}
	}

	protected launchRequest(response: DebugProtocol.LaunchResponse, args: LaunchRequestArguments): void {
		this._stopOnEntry = args.stopOnEntry;
		const cwd = args.cwd ? args.cwd : process.cwd();
		var sourceRoot = args.sourceRoot ? args.sourceRoot : cwd;

		if (typeof (sourceRoot) === "string") {
			sourceRoot = [sourceRoot];
		}

		this.setupSourceEnv(sourceRoot);
		const dbg_port = args.port ? args.port : 15470
		const dbg_host = args.host || '127.0.0.1'
		const dbg_args = args.ikp3dbArgs || []
		const programArgs = args.args || []
		const interpreterPath = args.pythonPath

		//"python -m ikp3db {{ikpdbArgs} debuggee.py {args}"
		let launchArgs = ['-m', 'ikp3db', '--ikpdb-protocol=vscode'].concat(dbg_args).concat(args.program).concat(programArgs);
		this._debug_server_process = spawn(interpreterPath, launchArgs, { cwd: cwd })
		this._debug_client = new Ikp3dbBTCPClient(dbg_port, dbg_host);

		this._debug_client.on_event = (event: Ikp3dbServerEvent) => { this.handleServerEvents(event) };
		this._debug_client.on_close = () => { };
		this._debug_client.on_error = (e: any) => { };
		this._debug_client.on_open = () => {
			this.sendEvent(new InitializedEvent());
		};
		this._debug_server_process.stdout.on('data', (data: any) => {
			this.sendEvent(new OutputEvent(data.toString(), 'stdout'));
		});
		this._debug_server_process.stderr.on('data', (data: any) => {
			this.sendEvent(new OutputEvent(data.toString(), 'stderr'));
		});
		this._debug_server_process.on('error', (msg: string) => {
			this.sendEvent(new OutputEvent(msg, 'error'));
		});
		this._debug_server_process.on('close', (code: number, signal: string) => {
			this.sendEvent(new OutputEvent(`exit status: ${code}\n`));
			this.sendEvent(new TerminatedEvent());
		});
		this.sendResponse(response);
	}

	protected attachRequest(response: DebugProtocol.AttachResponse, oargs: DebugProtocol.AttachRequestArguments): void {
		let args = oargs as AttachRequestArguments;
		this._stopOnEntry = args.stopOnEntry;
		var sourceRoot = args.sourceRoot;

		if (typeof (sourceRoot) === "string") {
			sourceRoot = [sourceRoot];
		}

		this.setupSourceEnv(sourceRoot);

		this._debug_client = new Ikp3dbBTCPClient(args.port, args.host);
		this._debug_client.on_event = (event: Ikp3dbServerEvent) => { this.handleServerEvents(event) };
		this._debug_client.on_close = () => {
			this.sendEvent(new TerminatedEvent());
		};
		this._debug_client.on_error = (e: any) => {
		};

		this._debug_client.on_open = () => {
			this.sendEvent(new InitializedEvent());
		};
		this.sendResponse(response);
	}

	protected configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse, args: DebugProtocol.ConfigurationDoneArguments): void {
		this.sendResponse(response);
		this._debug_client.send("runScript", null, (event: Ikp3dbServerEvent) => {
			console.debug("Debugged program started.");
		});
	}

	protected setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments): void {

		var path = args.source.path;
		// read file contents into array for direct access
		var lines = readFileSync(path).toString().split('\n');
		var breakpoints = new Array<Breakpoint>();
		var debuggerFilePath = this.convertClientPathToDebugger(path);

		this._debug_client.send("clearBreakpoints", { "fileName": debuggerFilePath });
		// verify breakpoint locations
		for (let sourceBreakpoint of args.breakpoints) {
			var bp_l = sourceBreakpoint.line;
			var verified = false;
			while (bp_l <= lines.length) {
				const line = lines[bp_l - 1].trim();
				if (line.length == 0 || line.startsWith("#")) {
					bp_l++;
				} else {
					verified = true;
					break;
				}
			}
			const bp = <DebugProtocol.Breakpoint>new Breakpoint(verified, bp_l);
			bp.id = this._breakPointID++;
			breakpoints.push(bp);
			if (verified) {
				var setBreakpointPayload = { 
					"line_number": bp_l, 
					"file_name": debuggerFilePath, 
					"condition": undefined, 
					"hit_condition": undefined, // TODO: Implement
					"enabled": true 
				};
				if (sourceBreakpoint.condition) {
					setBreakpointPayload.condition = sourceBreakpoint.condition;
				}
				if (sourceBreakpoint.hitCondition) {
					setBreakpointPayload.hit_condition = sourceBreakpoint.hitCondition;
				}
				this._debug_client.send(
					"setBreakpoint", 
					setBreakpointPayload, 
					(setBreakpointResponse: Ikp3dbServerEvent) => {
						console.dir(setBreakpointResponse);
					}
				);
			}
		}
		this._breakPoints.set(path, breakpoints);
		response.body = {
			breakpoints: breakpoints
		};
		this.sendResponse(response);
	}

	protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
		this._debug_client.send("getThreads", null, (getThreadsResponse: Ikp3dbServerEvent) => {
			let threadIdents = Object.keys(getThreadsResponse.result);
			let threadsObjects = threadIdents.map( (a_key) => new Thread(
					getThreadsResponse.result[a_key].ident, 
					getThreadsResponse.result[a_key].name
				)
			);
			response.body = {
				threads: threadsObjects
			};
			this.sendResponse(response);
		})
	}

	protected stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments): void {

		this._debug_client.send("getStackTrace", null, (getStackTraceResponse: Ikp3dbServerEvent) => {
			if (getStackTraceResponse.commandExecStatus == 'ok') {
				var ikpdbFrames = getStackTraceResponse.result as Array<Ikp3dbFrame>;
				let frames = new Array<StackFrame>();
				for (let a_frame of ikpdbFrames) {
					let filename = a_frame.file_path
					let filePath = this.convertDebuggerPathToClient(filename)
					let source = new Source(
						path.basename(filename), //name
						filePath,
						undefined, //id
						undefined,   // origin
						null // data
					);
					frames.push(
						new StackFrame(
							a_frame.id, 
							a_frame.name, 
							source,
							this.convertDebuggerLineToClient(a_frame.line_number),
							1  // column
						)
					);
				}
				response.body = {
					stackFrames: frames,
					totalFrames: getStackTraceResponse.result.length
				};
			} else {
				response.success = false;
				response.message = getStackTraceResponse.error_messages[0];
			}
			this.sendResponse(response);
		});
	}

	protected scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments): void {
		const scopes = new Array<Scope>();
		scopes.push(
			new Scope(
				"Local", 
				this._variablesHandles.create(
					new Ikp3dbVariablesReference(
						"_Frame",
						"f_locals",
						"",
						"getFrameVariables", 
						{
							"frame_id": args.frameId, 
							"f_locals": true, 
							"f_globals": false 
						}
					)
				), 
				false
			)
		);
		scopes.push(
			new Scope(
				"Global", 
				this._variablesHandles.create(
					new Ikp3dbVariablesReference(
						"_Frame",
						"f_locals",
						"",
						"getFrameVariables", 
						{ 
							"frame_id": args.frameId, 
							"f_locals": false, 
							"f_globals": true 
						}
					)
				), 
				false  // expensive
			)
		);

		response.body = {
			scopes: scopes
		};
		this.sendResponse(response);
	}

	protected variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments): void {
		const frameHandle = this._variablesHandles.get(args.variablesReference);
		if (frameHandle != null) {
			this._debug_client.send(
				frameHandle.command, 
				frameHandle.args, 
				(getVariablesResponse: Ikp3dbServerEvent) => {
					if (getVariablesResponse.commandExecStatus != "ok") {
						response.success = false;
						response.message = getVariablesResponse.error_messages.join('\n');
						this.sendResponse(response);
					} else {
						this.variablesRequestResponse(response, getVariablesResponse.result, frameHandle);
					}
				}
			);
		} else {
			response.success = false;
			this.sendResponse(response);
		}
	}

	protected stringify(value: any): string {
		if (value == null || value == undefined)
			return "None";
		return JSON.stringify(value);
	}

	/**
	 * generate complete var name (lvalue) for a_var
	 * @param a_var 
	 * @param varContainerHandle 
	 */
	protected generateLValue(a_var: any, varContainerHandle:Ikp3dbVariablesReference): string {
		let result:string = "'None'"
		switch(varContainerHandle.type) {
			case '_Frame':
				result = a_var.name
				break
			case 'dict':
				result =  varContainerHandle.key + "[" + a_var.name + "]"
				break
			case 'list':
				result =  varContainerHandle.key + "[" + a_var.name + "]"
				break
			case 'tuple':
				result = varContainerHandle.key + "[" + a_var.name + "]"
				break
			default:
				console.error("generateLValue("+a_var+","+varContainerHandle+") failed !!!");
				result = 'None'
		}
		return result
	}

	private variablesRequestResponse(response: DebugProtocol.VariablesResponse, variablesData: any, varContainerHandle: Ikp3dbVariablesReference): void {
		let variables = [];
		for(let a_var of variablesData) {
			const typeName = a_var['type'].split(' ')[0]
			let varRef=null;
			if(a_var.children_count) {
				varRef = this._variablesHandles.create(
					new Ikp3dbVariablesReference(
						typeName,
						a_var.name,
						this.generateLValue(a_var, varContainerHandle),
						"getProperties",
						{"id": a_var.id, "frame_id": varContainerHandle.args.frame_id},
					)
				);
			}
			variables.push({
				name: a_var.name,
				type: typeName,
				value: a_var.value,
				variablesReference: varRef
			});
		}
		response.body = {
			variables: variables
		};
		this.sendResponse(response);
	}

	protected setVariableRequest(response: DebugProtocol.SetVariableResponse, args: DebugProtocol.SetVariableArguments): void {
		const varContainerHandle = this._variablesHandles.get(args.variablesReference);
		if (varContainerHandle != null) {
			this._debug_client.send(
				"setVariable", 
				{
					"frame_id": varContainerHandle.args.frame_id, 
					"name": this.generateLValue(args, varContainerHandle),
					"value": args.value
				},
				(setVariableResponse: Ikp3dbServerEvent) => {
					if (setVariableResponse.commandExecStatus != "ok") {
						response.success = false;
						response.message = setVariableResponse.error_messages.join('\n');
						this.sendResponse(response);
					} else {
						this.sendResponse(response);
					}
				}
			);
		} else {
			response.success = false
			response.message ="var container not found."
			this.sendResponse(response)
		}
	}

	protected continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): void {
		this._debug_client.send("resume", null, (cmdResponse: Ikp3dbServerEvent) => {
			if (cmdResponse.commandExecStatus=="error") {
				response.success = false;
				response.message = cmdResponse.error_messages.join('\n');
				this.sendResponse(response);
			} else {
				this.sendResponse(response);
			}
		});
	}

	protected nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void {
		this._debug_client.send("stepOver", null, (cmdResponse: Ikp3dbServerEvent) => {
			if (cmdResponse.commandExecStatus=="error") {
				response.success = false;
				response.message = cmdResponse.error_messages.join('\n');
				this.sendResponse(response);
			} else {
				this.sendResponse(response);
			}
		});
	}

	protected stepInRequest(response: DebugProtocol.StepInResponse, args: DebugProtocol.StepInArguments): void {
		this._debug_client.send("stepInto", null, (cmdResponse: Ikp3dbServerEvent) => {
			if (cmdResponse.commandExecStatus=="error") {
				response.success = false;
				response.message = cmdResponse.error_messages.join('\n');
				this.sendResponse(response);
			} else {
				this.sendResponse(response);
			}
		});
	}

	protected stepOutRequest(response: DebugProtocol.StepOutResponse, args: DebugProtocol.StepOutArguments): void {
		this._debug_client.send("stepOut", null, (cmdResponse: Ikp3dbServerEvent) => {
			if (cmdResponse.commandExecStatus=="error") {
				response.success = false;
				response.message = cmdResponse.error_messages.join('\n');
				this.sendResponse(response);
			} else {
				this.sendResponse(response);
			}
		});
	}

	protected pauseRequest(response: DebugProtocol.PauseResponse, args: DebugProtocol.PauseArguments): void {
		let params = args.threadId ? {thread_ident: args.threadId} : null;
		this._debug_client.send("suspend", params, (cmdResponse: Ikp3dbServerEvent) => {
			if (cmdResponse.commandExecStatus=="error") {
				response.success = false;
				response.message = cmdResponse.error_messages.join('\n');
				this.sendResponse(response);
			} else {
				this.sendResponse(response);
			}
		});
	}

	protected sourceRequest(response: DebugProtocol.SourceResponse, args: DebugProtocol.SourceArguments): void {
		const id = this._sourceHandles.get(args.sourceReference);
		if (id) {
			response.body = {
				content: id
			};
		}
		this.sendResponse(response);
	}

	protected disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments): void {
		if (this._debug_server_process) {
			this._debug_server_process.kill('SIGKILL');
			delete this._debug_server_process;
			if (this._debug_client) {
				this._debug_client.end();
				delete this._debug_client;
			}
			this.sendResponse(response);
		}
	}

	protected evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments): void {
		if (!this._debug_client) {
			response.success = false;
			this.sendResponse(response);
			return;
		}
		this._debug_client.send("evaluate", args, (evalResponse: Ikp3dbServerEvent) => {
			if (evalResponse.commandExecStatus=="ok") {
				response.body = {
					result: evalResponse.result.value,
					type: evalResponse.result.type,
					variablesReference: 0
				};
			} else {
				response.body = {
					result: "",
					variablesReference: 0
				};
				response.success = false;
				response.message = evalResponse.error_messages.join('\n');
			}
			this.sendResponse(response);
		});
	}

	private handleServerEvents(event: Ikp3dbServerEvent) {
		if (event.command == "start") {
			console.log(`Connected to Ikp3db ${event.info_messages[2]}.`);

		} else if (event.command == "programBreak") {
			if(event.exception) {
				let excEvt = new StoppedEvent(
					"exception", 
					event.thread_ident, 
					event.exception.type
				)
				excEvt.body.reason = event.exception.info
				this.sendEvent(excEvt);
			} else
				this.sendEvent(new StoppedEvent("breakpoint", event.thread_ident));

		} else if (event.command == "programEnd" ) {
			this.sendEvent(new TerminatedEvent(false));

		} else if (event.command == "paused" && event.result.reason != "entry") {
			this.sendEvent(new StoppedEvent(event.result.reason, Ikp3dbDebugSession.THREAD_ID));
/*
		} else if (event.command == "runScript") {
			this._variablesHandles.reset();
			this.sendEvent(new ContinuedEvent(Ikp3dbDebugSession.THREAD_ID));
*/
		} else {
			console.error(`Received unknown event:${event.command} from ikp3db debugger.`)
//			vscode.window.showErrorMessage("Received unknown event from ikp3db debugger.");
		}
	}
}

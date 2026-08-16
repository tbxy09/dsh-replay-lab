import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import z from "@deepseek-ai/schemastery";
import { resolveSessionPreset } from "@deepseek-ai/dsh-agent-presets";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, readlink, rename, rm, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { LlmAdapter, createUserMessage } from "@deepseek-ai/dsh-llm";
import { SessionId } from "@deepseek-ai/dsh-session";
import { setSandboxMode } from "@deepseek-ai/dsh-sandbox-policy";
import { z as z$1 } from "zod";
//#region src/hash.ts
function sha256(value) {
	return createHash("sha256").update(value).digest("hex");
}
function canonicalJson(value) {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
	return JSON.stringify(value);
}
/** 递归哈希一个目录，产出稳定的 workspace fixture hash。 */
async function hashDirectory(root) {
	const entries = [];
	const visit = async (directory) => {
		for (const name of (await readdir(directory)).sort()) {
			const target = join(directory, name);
			const info = await lstat(target);
			if (info.isDirectory()) await visit(target);
			else if (info.isFile()) {
				const body = await readFile(target);
				entries.push({
					path: relative(root, target).replaceAll("\\", "/"),
					kind: "file",
					hash: sha256(body),
					size: body.length
				});
			} else if (info.isSymbolicLink()) {
				const link = await readlink(target);
				entries.push({
					path: relative(root, target).replaceAll("\\", "/"),
					kind: "symlink",
					hash: sha256(link),
					size: Buffer.byteLength(link)
				});
			}
		}
	};
	await visit(root);
	return sha256(canonicalJson(entries));
}
//#endregion
//#region src/case-source.ts
function requireString(record, key) {
	const value = record[key];
	if (typeof value !== "string" || value.length === 0) throw new Error(`history source 缺少 ${key}`);
	return value;
}
function validateSource(value) {
	if (value === null || typeof value !== "object") throw new Error("history source 必须是对象");
	const row = value;
	const kind = requireString(row, "kind");
	if (kind !== "history" && kind !== "bookmark") throw new Error("history source kind 无效");
	for (const key of [
		"id",
		"sessionId",
		"prompt",
		"provider",
		"model",
		"reasoning",
		"presetSurface",
		"systemHash",
		"toolSchemaHash"
	]) requireString(row, key);
	if (!Number.isSafeInteger(row.turn) || Number(row.turn) < 1) throw new Error("history source turn 无效");
	if (!Number.isSafeInteger(row.maxTokens) || Number(row.maxTokens) < 1) throw new Error("history source maxTokens 无效");
	return row;
}
function buildCase(source, sourceCwd, sourceWorkspaceHash) {
	const body = `${source.sessionId}\0${String(source.turn)}\0${source.prompt}\0${sourceWorkspaceHash}`;
	return Object.freeze({
		id: `case-${sha256(body).slice(0, 20)}`,
		sourceId: source.id,
		sourceSessionId: source.sessionId,
		sourceTurn: source.turn,
		createdAt: (/* @__PURE__ */ new Date()).toISOString(),
		prompt: source.prompt,
		promptHash: sha256(source.prompt),
		sourceCwd,
		sourceWorkspaceHash,
		provider: source.provider,
		model: source.model,
		reasoning: source.reasoning,
		maxTokens: source.maxTokens,
		presetSurface: source.presetSurface,
		systemHash: source.systemHash,
		toolSchemaHash: source.toolSchemaHash
	});
}
/** Freeze a host-resolved authoritative session projection record. */
async function freezeReplayTurn(sessionId, record, sourceCwd) {
	if (!record.replayable || record.evidenceHash === null) throw new Error(`turn ${record.turn} is not replayable: ${record.missingFields.join(", ") || "incomplete evidence"}`);
	if (record.prompt === null || record.provider === null || record.model === null || record.reasoning === null || record.maxTokens === null || record.presetSurface === null || record.systemHash === null || record.toolSchemaHash === null || record.metrics === null) throw new Error(`turn ${record.turn} has inconsistent replay evidence`);
	const sourceWorkspaceHash = await hashDirectory(resolve(sourceCwd));
	const frozen = buildCase({
		id: `${sessionId}:${record.turn}`,
		sessionId,
		turn: record.turn,
		prompt: record.prompt,
		provider: record.provider,
		model: record.model,
		reasoning: record.reasoning,
		maxTokens: record.maxTokens,
		presetSurface: record.presetSurface,
		systemHash: record.systemHash,
		toolSchemaHash: record.toolSchemaHash
	}, resolve(sourceCwd), sourceWorkspaceHash);
	const observedBaseline = {
		runId: `observed-${sessionId}-${record.turn}`,
		sessionId,
		variantId: "observed-current-session",
		status: "completed",
		requestPhases: ["observed"],
		metrics: record.metrics,
		complete: true,
		eventCount: record.eventCount,
		evidenceHash: sha256(canonicalJson({
			sessionId,
			turn: record.turn,
			evidenceHash: record.evidenceHash
		})),
		workspace: {
			sourceCwd: resolve(sourceCwd),
			sourceHash: sourceWorkspaceHash,
			executionCwd: resolve(sourceCwd),
			executionHash: sourceWorkspaceHash,
			isolation: "observed-source",
			policy: "durable current-session turn; no replay executed"
		}
	};
	return Object.freeze({
		...frozen,
		observedBaseline
	});
}
var FixtureCaseSource = class {
	file;
	workspaceFixture;
	id = "fixture-history";
	cache;
	constructor(file, workspaceFixture) {
		this.file = file;
		this.workspaceFixture = workspaceFixture;
	}
	async workspaceHash() {
		return hashDirectory(resolve(this.workspaceFixture));
	}
	async list() {
		if (this.cache !== void 0) return this.cache;
		const parsed = JSON.parse(await readFile(resolve(this.file), "utf8"));
		if (!Array.isArray(parsed)) throw new Error("history fixture 顶层必须是数组");
		this.cache = Object.freeze(parsed.map(validateSource));
		return this.cache;
	}
	async freeze(sourceId) {
		const source = (await this.list()).find((item) => item.id === sourceId);
		if (source === void 0) throw new Error(`找不到 source ${sourceId}`);
		return buildCase(source, resolve(this.workspaceFixture), await this.workspaceHash());
	}
};
//#endregion
//#region src/artifact-store.ts
function isTerminal(experiment) {
	return experiment !== void 0 && [
		"completed",
		"failed",
		"aborted"
	].includes(experiment.status);
}
function historyEntry(replayCase, experiment) {
	return {
		sourceSessionId: replayCase.sourceSessionId,
		sourceTurn: replayCase.sourceTurn,
		...replayCase.observedBaseline?.evidenceHash === void 0 ? {} : { sourceEvidenceHash: replayCase.observedBaseline.evidenceHash },
		replayCase,
		experiment
	};
}
function backfilledEntry(experiment) {
	if (!isTerminal(experiment) || experiment.baseline === void 0) return void 0;
	const prefix = `observed-${experiment.baseline.sessionId}-`;
	if (!experiment.baseline.runId.startsWith(prefix)) return void 0;
	const sourceTurn = Number(experiment.baseline.runId.slice(prefix.length));
	if (!Number.isSafeInteger(sourceTurn) || sourceTurn < 1) return void 0;
	return {
		sourceSessionId: experiment.baseline.sessionId,
		sourceTurn,
		...experiment.baseline.evidenceHash === void 0 ? {} : { sourceEvidenceHash: experiment.baseline.evidenceHash },
		experiment
	};
}
var JsonArtifactStore = class {
	file;
	artifactDirectory;
	id = "json-artifacts";
	constructor(file, artifactDirectory) {
		this.file = file;
		this.artifactDirectory = artifactDirectory;
	}
	async artifactHistory() {
		let names;
		try {
			names = await readdir(resolve(this.artifactDirectory));
		} catch (error) {
			if (error.code === "ENOENT") return [];
			throw error;
		}
		return (await Promise.all(names.filter((name) => name.startsWith("experiment-") && name.endsWith(".json")).map(async (name) => backfilledEntry(JSON.parse(await readFile(join(resolve(this.artifactDirectory), name), "utf8")))))).filter((entry) => entry !== void 0);
	}
	async load() {
		const artifacts = await this.artifactHistory();
		try {
			const value = JSON.parse(await readFile(resolve(this.file), "utf8"));
			if (value.version === 1) {
				const history = value.replayCase !== void 0 && isTerminal(value.experiment) ? [historyEntry(value.replayCase, value.experiment)] : [];
				const merged = new Map(artifacts.map((entry) => [entry.experiment.id, entry]));
				for (const entry of history) merged.set(entry.experiment.id, entry);
				return {
					...value.replayCase === void 0 ? {} : { replayCase: value.replayCase },
					...value.experiment === void 0 ? {} : { experiment: value.experiment },
					history: [...merged.values()]
				};
			}
			if (value.version !== 2 || !Array.isArray(value.history)) throw new Error("Replay Lab state 版本不支持");
			const merged = new Map(artifacts.map((entry) => [entry.experiment.id, entry]));
			for (const entry of value.history) merged.set(entry.experiment.id, entry);
			return {
				...value.replayCase === void 0 ? {} : { replayCase: value.replayCase },
				...value.experiment === void 0 ? {} : { experiment: value.experiment },
				history: [...merged.values()]
			};
		} catch (error) {
			if (error.code === "ENOENT") return { history: artifacts };
			throw error;
		}
	}
	async save(value) {
		await mkdir(dirname(resolve(this.file)), { recursive: true });
		const temp = `${resolve(this.file)}.tmp`;
		await writeFile(temp, JSON.stringify({
			version: 2,
			...value
		}, null, 2), "utf8");
		await rename(temp, resolve(this.file));
	}
	async put(kind, id, value) {
		const directory = resolve(this.artifactDirectory);
		await mkdir(directory, { recursive: true });
		const target = join(directory, `${kind}-${id}.json`);
		await writeFile(target, JSON.stringify(value, null, 2), "utf8");
		return target;
	}
};
//#endregion
//#region src/http.ts
function respond(res, status, body) {
	const bytes = Buffer.from(JSON.stringify(body));
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"content-length": String(bytes.length),
		"cache-control": "no-store",
		"x-content-type-options": "nosniff"
	});
	res.end(bytes);
}
function success(value) {
	return {
		ok: true,
		value
	};
}
function failure(code, message) {
	return {
		ok: false,
		error: {
			code,
			message
		}
	};
}
async function body(req) {
	const chunks = [];
	let size = 0;
	for await (const chunk of req) {
		const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		size += bytes.length;
		if (size > 65536) throw new Error("request body too large");
		chunks.push(bytes);
	}
	if (chunks.length === 0) return {};
	const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("body 必须是 JSON object");
	return value;
}
function asIdentifier(value) {
	if (typeof value.sessionId !== "string" || value.sessionId.length === 0) throw new Error("sessionId is required");
	if (!Number.isSafeInteger(value.turn) || Number(value.turn) < 1) throw new Error("turn must be a positive integer");
	if (typeof value.expectedEvidenceHash !== "string" || !/^[a-f0-9]{64}$/u.test(value.expectedEvidenceHash)) throw new Error("expectedEvidenceHash must be a SHA-256 hash");
	return value;
}
function asSessionId(value) {
	if (typeof value.sessionId !== "string" || value.sessionId.length === 0) throw new Error("sessionId is required");
	return value.sessionId;
}
function createHttpHandler(service) {
	return async (req, res) => {
		const url = new URL(req.url ?? "/", "http://localhost");
		const base = service.routeBase;
		const path = url.pathname === base ? "" : url.pathname.startsWith(`${base}/`) ? url.pathname.slice(base.length + 1) : null;
		if (path === null) {
			respond(res, 404, failure("not-found", "Replay Lab route 不存在"));
			return;
		}
		try {
			if (req.method === "GET" && path === "") {
				const sessionId = url.searchParams.get("sessionId") ?? void 0;
				respond(res, 200, success(await service.snapshot(sessionId)));
				return;
			}
			if (req.method === "POST" && path === "case") {
				const value = await body(req);
				if (typeof value.sourceId !== "string") throw new Error("sourceId 必须是字符串");
				respond(res, 200, success(await service.freeze(value.sourceId)));
				return;
			}
			if (req.method === "POST" && path === "admit") {
				respond(res, 200, success(await service.admit(asIdentifier(await body(req)))));
				return;
			}
			if (req.method === "POST" && path === "plan") {
				const value = await body(req);
				if (typeof value.candidateVariantId !== "string") throw new Error("candidateVariantId 必须是字符串");
				respond(res, 200, success(await service.plan(value.candidateVariantId, asSessionId(value))));
				return;
			}
			if (req.method === "POST" && path === "approve-run") {
				respond(res, 202, success(await service.approveAndRun(asSessionId(await body(req)))));
				return;
			}
			if (req.method === "POST" && path === "abort") {
				respond(res, 200, success(await service.abort(asSessionId(await body(req)))));
				return;
			}
			if (req.method === "POST" && path === "reset") {
				respond(res, 200, success(await service.reset(asSessionId(await body(req)))));
				return;
			}
			respond(res, 405, failure("method", "Replay Lab method 不支持"));
		} catch (error) {
			respond(res, 400, failure("request", error instanceof Error ? error.message : String(error)));
		}
	};
}
//#endregion
//#region src/metrics.ts
function record(value) {
	return value !== null && typeof value === "object" ? value : {};
}
function number(value) {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
var SessionMetricsExtractor = class {
	id = "session-events-v1";
	extract(events) {
		const records = events.filter((event) => event !== null && typeof event === "object");
		const types = records.map((event) => event.type);
		if (!types.includes("turn/end")) return void 0;
		const usages = records.filter((event) => event.type === "assistant/message").map((event) => record(record(event.data).usage));
		const sumUsage = (key) => usages.reduce((total, usage) => total + number(usage[key]), 0);
		const started = records.find((event) => event.type === "turn/start")?.time;
		const ended = [...records].reverse().find((event) => event.type === "turn/end")?.time;
		return {
			freshInputTokens: sumUsage("inputTokens"),
			outputTokens: sumUsage("outputTokens"),
			cacheReadTokens: sumUsage("cacheReadTokens"),
			durationMs: typeof started === "number" && typeof ended === "number" ? Math.max(0, ended - started) : 0,
			stepCount: types.filter((type) => type === "step/start").length,
			toolCalls: types.filter((type) => type === "tool/call").length
		};
	}
};
const labels = {
	freshInputTokens: "Fresh 输入",
	outputTokens: "输出",
	cacheReadTokens: "缓存命中",
	durationMs: "耗时",
	stepCount: "步骤数",
	toolCalls: "工具调用"
};
var IndependentEvidenceOracle = class {
	id = "independent-evidence-v1";
	score(baseline, candidate) {
		if (baseline?.complete !== true || baseline.metrics === void 0) return void 0;
		if (candidate?.complete !== true || candidate.metrics === void 0) return void 0;
		if (baseline.sessionId === candidate.sessionId || baseline.evidenceHash === candidate.evidenceHash) return void 0;
		const rows = Object.keys(labels).map((key) => ({
			key,
			label: labels[key],
			baseline: baseline.metrics[key],
			candidate: candidate.metrics[key],
			delta: candidate.metrics[key] - baseline.metrics[key]
		}));
		return {
			baselineSessionId: baseline.sessionId,
			candidateSessionId: candidate.sessionId,
			rows
		};
	}
};
function evidenceDigest(sessionId, events) {
	return sha256(canonicalJson({
		sessionId,
		events
	}));
}
//#endregion
//#region src/runner.ts
function object(value) {
	return value !== null && typeof value === "object" ? value : {};
}
function realTarget(path) {
	const target = resolve(path);
	let existing = target;
	while (!existsSync(existing)) {
		const parent = dirname(existing);
		if (parent === existing) break;
		existing = parent;
	}
	const canonicalExisting = realpathSync(existing);
	return resolve(canonicalExisting, relative(existing, target));
}
function inside(root, target) {
	const child = relative(root, target);
	return child === "" || child !== ".." && !child.startsWith(`..${sep}`);
}
function pathValues(value, key = "") {
	if (typeof value === "string") return /(?:^|_)(?:path|paths|cwd|workdir|file|files|directory|directories)$/i.test(key) ? [value] : [];
	if (Array.isArray(value)) return value.flatMap((item) => pathValues(item, key));
	if (value === null || typeof value !== "object") return [];
	return Object.entries(value).flatMap(([childKey, child]) => pathValues(child, childKey));
}
/** Monotonic guard for structured file arguments used by replay agents and descendants. */
function candidatePathGuard(argumentsValue, executionCwd) {
	const root = realTarget(executionCwd);
	for (const value of pathValues(argumentsValue)) {
		if (!value.startsWith(sep)) continue;
		if (!inside(root, realTarget(value))) return `Replay candidates may access files only inside their isolated workspace: ${executionCwd}`;
	}
}
/** Recover every distinct, durable provider-bound request surface in log order. */
function requestSurfaceEvidence(events, behavior) {
	return events.filter((event) => object(event).type === "request/header").map((event) => object(object(event.data).header)).map((header, index) => {
		const config = object(header.config);
		const tools = Array.isArray(header.tools) ? header.tools : [];
		return {
			phase: behavior === "anchored" ? index === 0 ? "bootstrap" : index === 1 ? "promoted" : `dynamic-unlock-${index - 1}` : "request",
			provider: typeof config.provider === "string" ? config.provider : "",
			model: typeof config.model === "string" ? config.model : "",
			...typeof config.reasoningEffort === "string" ? { reasoning: config.reasoningEffort } : {},
			...typeof config.maxTokens === "number" ? { maxTokens: config.maxTokens } : {},
			systemHash: sha256(canonicalJson(header.system ?? null)),
			toolSchemaHash: sha256(canonicalJson(tools)),
			toolNames: tools.map((tool) => object(tool).name).filter((name) => typeof name === "string")
		};
	});
}
function safePathSegment(value) {
	return value.normalize("NFKD").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 96) || "replay";
}
function replayDisplayNames(replayCase, variant) {
	const source = basename(resolve(replayCase.sourceCwd)) || "workspace";
	const candidate = variant.label.trim() || variant.id;
	return {
		workspaceTitle: `${source} · Isolated Replay · Turn ${replayCase.sourceTurn} · ${candidate}`,
		sessionTitle: `Replay · Turn ${replayCase.sourceTurn} · ${candidate}`,
		executionName: safePathSegment(`${source}-turn-${replayCase.sourceTurn}-${variant.id}`)
	};
}
/** Copy the frozen source workspace and verify byte provenance. */
async function copyWorkspaceSnapshot(sourceCwd, expectedHash, options = {}) {
	const source = resolve(sourceCwd);
	const sourceHash = await hashDirectory(source);
	if (sourceHash !== expectedHash) throw new Error("source workspace changed after the replay case was frozen");
	const durable = options.parentDirectory !== void 0;
	const parent = durable ? resolve(options.parentDirectory) : tmpdir();
	await mkdir(parent, { recursive: true });
	const root = await mkdtemp(join(parent, "candidate-"));
	const executionCwd = join(root, safePathSegment(options.executionName ?? "replay"));
	try {
		await cp(source, executionCwd, {
			recursive: true,
			dereference: false,
			verbatimSymlinks: true,
			preserveTimestamps: true
		});
		const executionHash = await hashDirectory(executionCwd);
		if (executionHash !== expectedHash) throw new Error("isolated workspace copy does not match the frozen source hash");
		return {
			root,
			durable,
			provenance: {
				sourceCwd: source,
				sourceHash,
				executionCwd,
				executionHash,
				isolation: "copy",
				policy: durable ? "recursive symlink-preserving copy in the Replay Lab managed artifact directory" : "recursive symlink-preserving copy in a process-owned temporary directory"
			}
		};
	} catch (error) {
		await rm(root, {
			recursive: true,
			force: true
		});
		throw error;
	}
}
var DeterministicReplayAdapter = class extends LlmAdapter {
	async *stream(options) {
		const text = "fixture-ok";
		const chunks = [
			{
				type: "block-start",
				index: 0,
				blockType: "text"
			},
			{
				type: "text-delta",
				index: 0,
				text
			},
			{
				type: "block-end",
				index: 0,
				block: {
					type: "text",
					text
				}
			},
			{
				type: "usage",
				usage: {
					inputTokens: 128,
					outputTokens: 10,
					cacheReadTokens: 64
				}
			},
			{
				type: "finish",
				reason: { kind: "stop" }
			}
		];
		for (const chunk of chunks) {
			if (options.signal?.aborted) throw new Error("fixture run aborted");
			yield chunk;
		}
	}
};
var CordisAgentRunner = class {
	ctx;
	metrics;
	variantLookup;
	managedWorkspaceDirectory;
	id = "cordis-agent-runner";
	handles = /* @__PURE__ */ new Set();
	isolatedRoots = /* @__PURE__ */ new Set();
	constructor(ctx, metrics, variantLookup, managedWorkspaceDirectory) {
		this.ctx = ctx;
		this.metrics = metrics;
		this.variantLookup = variantLookup;
		this.managedWorkspaceDirectory = managedWorkspaceDirectory;
	}
	async run(input) {
		const sessionId = SessionId(`replay-${input.experimentId}-${input.variant.id}-${randomUUID()}`);
		const runId = `run-${randomUUID()}`;
		const hookPhases = [];
		let handle;
		let workspace;
		try {
			const variant = this.variantLookup(input.variant.id);
			if (variant === void 0 || !variant.supported || variant.preset === void 0) throw new Error(variant?.unsupportedReason ?? `variant ${input.variant.id} 不可运行`);
			const names = replayDisplayNames(input.replayCase, input.variant);
			workspace = await copyWorkspaceSnapshot(input.replayCase.sourceCwd, input.replayCase.sourceWorkspaceHash, {
				parentDirectory: this.managedWorkspaceDirectory,
				executionName: names.executionName
			});
			if (!workspace.durable) this.isolatedRoots.add(workspace.root);
			handle = await this.ctx.agents.create({
				sessionId,
				meta: {
					cwd: workspace.provenance.executionCwd,
					agentPreset: variant.preset
				},
				agentOptions: {
					provider: input.replayCase.provider,
					model: input.replayCase.model,
					maxTokens: input.replayCase.maxTokens,
					reasoningEffort: input.replayCase.reasoning
				},
				setup: async (agentCtx) => {
					await this.ctx.agentPresets.mount(agentCtx, variant.preset);
					variant.install?.(agentCtx, hookPhases);
				}
			});
			this.handles.add(handle);
			setSandboxMode(handle.agent.session, "workspace-write");
			this.ctx.sessionTitle.rename(handle.agent.session, names.sessionTitle);
			const replayWorkspace = await this.ctx.workspaceRegistry.create(workspace.provenance.executionCwd, names.workspaceTitle);
			await replayWorkspace.attachSession(sessionId);
			const sourceWorkspace = await this.ctx.workspaceRegistry.resolveByPath(input.replayCase.sourceCwd);
			if (sourceWorkspace !== void 0) {
				const withoutReplay = this.ctx.workspaceRegistry.list().filter((item) => item.id !== replayWorkspace.id);
				const sourceIndex = withoutReplay.findIndex((item) => item.id === sourceWorkspace.id);
				if (sourceIndex >= 0) await this.ctx.workspaceRegistry.insertBefore(replayWorkspace.id, withoutReplay[sourceIndex + 1]?.id);
			}
			handle.agent.followup(createUserMessage({
				content: [{
					type: "text",
					text: input.replayCase.prompt
				}],
				source: {
					kind: "plugin",
					plugin: "@tbxy09/dsh-replay-lab"
				}
			}));
			await handle.agent.whenIdle();
			const events = [...handle.agent.session.events];
			const metrics = this.metrics.extract(events);
			const requestSurfaces = requestSurfaceEvidence(events, variant.behavior);
			const requestPhases = requestSurfaces.length > 0 ? requestSurfaces.map((surface) => surface.phase) : hookPhases.length > 0 ? hookPhases : variant.requestPhases.slice(0, 1);
			return {
				runId,
				sessionId,
				variantId: variant.id,
				status: metrics === void 0 ? "failed" : "completed",
				requestPhases: Object.freeze([...requestPhases]),
				requestSurfaces: Object.freeze(requestSurfaces),
				...metrics === void 0 ? {
					complete: false,
					missingReason: "session 未形成完整 turn/end evidence"
				} : {
					metrics,
					complete: true
				},
				eventCount: events.length,
				evidenceHash: evidenceDigest(sessionId, events),
				workspace: workspace.provenance
			};
		} catch (error) {
			const events = handle === void 0 ? [] : [...handle.agent.session.events];
			return {
				runId,
				sessionId,
				variantId: input.variant.id,
				status: "failed",
				requestPhases: Object.freeze([...hookPhases]),
				complete: false,
				missingReason: error instanceof Error ? error.message : String(error),
				eventCount: events.length,
				evidenceHash: evidenceDigest(sessionId, events),
				...workspace === void 0 ? {} : { workspace: workspace.provenance }
			};
		}
	}
	async dispose() {
		const handles = [...this.handles];
		this.handles.clear();
		await Promise.all(handles.map((handle) => handle.dispose()));
		const roots = [...this.isolatedRoots];
		this.isolatedRoots.clear();
		await Promise.all(roots.map((root) => rm(root, {
			recursive: true,
			force: true
		})));
	}
};
//#endregion
//#region src/registries.ts
var ContributionRegistry = class {
	entries = /* @__PURE__ */ new Map();
	register(value) {
		if (this.entries.has(value.id)) throw new Error(`重复 contribution id: ${value.id}`);
		this.entries.set(value.id, value);
		return () => {
			this.entries.delete(value.id);
		};
	}
	get(id) {
		return this.entries.get(id);
	}
	list() {
		return [...this.entries.values()];
	}
};
var ReplayLabRegistries = class {
	caseSources = new ContributionRegistry();
	variants = new ContributionRegistry();
	runners = new ContributionRegistry();
	metricsExtractors = new ContributionRegistry();
	oracles = new ContributionRegistry();
	artifactStores = new ContributionRegistry();
	hooks = new ContributionRegistry();
};
//#endregion
//#region src/service.ts
function validHistoryEntry(entry) {
	return entry.replayCase !== void 0 && entry.replayCase.sourceSessionId === entry.sourceSessionId && entry.replayCase.sourceTurn === entry.sourceTurn && (entry.experiment.baseline === void 0 || entry.experiment.baseline.sessionId === entry.sourceSessionId);
}
var ReplayLabService = class {
	routeBase;
	resolveTurn;
	registries = new ReplayLabRegistries();
	drafts = /* @__PURE__ */ new Map();
	history = [];
	running = /* @__PURE__ */ new Map();
	constructor(routeBase, resolveTurn) {
		this.routeBase = routeBase;
		this.resolveTurn = resolveTurn;
	}
	async restore(store) {
		const state = await store.load();
		this.history = state.history.filter(validHistoryEntry);
		if (state.replayCase !== void 0 && state.experiment !== void 0 && [
			"completed",
			"failed",
			"aborted"
		].includes(state.experiment.status)) {
			if (validHistoryEntry({
				sourceSessionId: state.replayCase.sourceSessionId,
				sourceTurn: state.replayCase.sourceTurn,
				...state.replayCase.observedBaseline?.evidenceHash === void 0 ? {} : { sourceEvidenceHash: state.replayCase.observedBaseline.evidenceHash },
				replayCase: state.replayCase,
				experiment: state.experiment
			})) this.upsertHistory(state.replayCase, state.experiment);
		}
		await this.persist();
	}
	source() {
		const source = this.registries.caseSources.list()[0];
		if (source === void 0) throw new Error("没有 case source");
		return source;
	}
	store() {
		const store = this.registries.artifactStores.list()[0];
		if (store === void 0) throw new Error("没有 artifact store");
		return store;
	}
	runner() {
		const runner = this.registries.runners.list()[0];
		if (runner === void 0) throw new Error("没有 runner");
		return runner;
	}
	oracle() {
		const oracle = this.registries.oracles.list()[0];
		if (oracle === void 0) throw new Error("没有 oracle");
		return oracle;
	}
	sessionId(requested) {
		if (requested !== void 0) return requested;
		return this.drafts.size === 1 ? this.drafts.keys().next().value : void 0;
	}
	requireDraft(requested) {
		const sessionId = this.sessionId(requested);
		const draft = sessionId === void 0 ? void 0 : this.drafts.get(sessionId);
		if (sessionId === void 0 || draft === void 0) throw new Error("请先创建冻结 replay case");
		return [sessionId, draft];
	}
	async snapshot(requestedSessionId) {
		const sessionId = this.sessionId(requestedSessionId);
		const draft = sessionId === void 0 ? void 0 : this.drafts.get(sessionId);
		return {
			sources: await this.source().list(),
			variants: this.registries.variants.list(),
			history: this.history,
			...draft === void 0 ? {} : { replayCase: draft.replayCase },
			...draft?.experiment === void 0 ? {} : { experiment: draft.experiment }
		};
	}
	async freeze(sourceId) {
		const replayCase = await this.source().freeze(sourceId);
		this.drafts.set(replayCase.sourceSessionId, { replayCase });
		return this.snapshot(replayCase.sourceSessionId);
	}
	/** Resolve an identifier against the authoritative host projection, then freeze it. */
	async admit(identifier) {
		if (this.resolveTurn === void 0) throw new Error("session replay resolver is unavailable");
		const resolved = await this.resolveTurn(identifier);
		const replayCase = await freezeReplayTurn(identifier.sessionId, resolved.record, resolved.sourceCwd);
		const prior = this.history.slice().reverse().find((entry) => validHistoryEntry(entry) && entry.sourceSessionId === identifier.sessionId && entry.sourceTurn === identifier.turn && entry.sourceEvidenceHash === replayCase.observedBaseline?.evidenceHash && entry.replayCase?.sourceCwd === replayCase.sourceCwd)?.experiment;
		this.drafts.set(identifier.sessionId, {
			replayCase,
			...prior === void 0 ? {} : { experiment: prior }
		});
		return this.snapshot(identifier.sessionId);
	}
	async plan(candidateVariantId, requestedSessionId) {
		const [sessionId, draft] = this.requireDraft(requestedSessionId);
		if (draft.replayCase.observedBaseline === void 0 || !draft.replayCase.observedBaseline.complete) throw new Error("current session turn has no complete observed baseline evidence");
		const candidate = this.requireVariant(candidateVariantId);
		if (!candidate.supported) throw new Error(candidate.unsupportedReason ?? "candidate variant 不支持");
		const now = (/* @__PURE__ */ new Date()).toISOString();
		const experiment = {
			id: `exp-${randomUUID()}`,
			caseId: draft.replayCase.id,
			baselineMode: "observed-current-session",
			candidateVariantId,
			status: "planned",
			createdAt: now,
			updatedAt: now
		};
		this.drafts.set(sessionId, {
			...draft,
			experiment
		});
		await this.transition("planned", experiment);
		return this.snapshot(sessionId);
	}
	async approveAndRun(requestedSessionId) {
		const [sessionId, draft] = this.requireDraft(requestedSessionId);
		if (draft.experiment === void 0) throw new Error("没有可批准的实验计划");
		if (draft.experiment.status !== "planned") throw new Error(`实验状态 ${draft.experiment.status} 不能批准`);
		const experiment = {
			...draft.experiment,
			status: "approved",
			approvedAt: (/* @__PURE__ */ new Date()).toISOString(),
			updatedAt: (/* @__PURE__ */ new Date()).toISOString()
		};
		this.drafts.set(sessionId, {
			...draft,
			experiment
		});
		await this.transition("approved", experiment);
		const running = this.execute(sessionId, experiment.id);
		this.running.set(sessionId, running);
		running.finally(() => {
			if (this.running.get(sessionId) === running) this.running.delete(sessionId);
		}).catch(() => void 0);
		return this.snapshot(sessionId);
	}
	async abort(requestedSessionId) {
		const [sessionId, draft] = this.requireDraft(requestedSessionId);
		if (draft.experiment === void 0) throw new Error("没有实验");
		if (![
			"planned",
			"approved",
			"running"
		].includes(draft.experiment.status)) throw new Error("当前实验不可中止");
		const experiment = {
			...draft.experiment,
			status: "aborted",
			updatedAt: (/* @__PURE__ */ new Date()).toISOString()
		};
		this.drafts.set(sessionId, {
			...draft,
			experiment
		});
		this.upsertHistory(draft.replayCase, experiment);
		await this.transition("aborted", experiment);
		return this.snapshot(sessionId);
	}
	async reset(requestedSessionId) {
		const sessionId = this.sessionId(requestedSessionId);
		if (sessionId !== void 0) this.drafts.delete(sessionId);
		await this.persist();
		return this.snapshot(requestedSessionId);
	}
	async execute(sessionId, experimentId) {
		const draft = this.drafts.get(sessionId);
		if (draft?.experiment?.id !== experimentId) return;
		let experiment = {
			...draft.experiment,
			status: "running",
			updatedAt: (/* @__PURE__ */ new Date()).toISOString()
		};
		this.drafts.set(sessionId, {
			...draft,
			experiment
		});
		await this.transition("running", experiment);
		try {
			const candidateVariant = this.requireVariant(experiment.candidateVariantId);
			const baseline = draft.replayCase.observedBaseline;
			if (baseline === void 0) throw new Error("current session turn has no observed baseline evidence");
			const candidate = await this.runner().run({
				replayCase: draft.replayCase,
				experimentId,
				variant: candidateVariant
			});
			const current = this.drafts.get(sessionId);
			if (current?.experiment?.id !== experimentId || current.experiment.status === "aborted") return;
			const scorecard = this.oracle().score(baseline, candidate);
			const scorecardMissingReason = scorecard === void 0 ? !baseline.complete ? `baseline evidence 缺失：${baseline.missingReason ?? "未知原因"}` : !candidate.complete ? `candidate evidence 缺失：${candidate.missingReason ?? "未知原因"}` : "baseline/candidate evidence 不独立" : void 0;
			experiment = {
				...experiment,
				status: "completed",
				updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
				baseline,
				candidate,
				...scorecard === void 0 ? { scorecardMissingReason } : { scorecard }
			};
			this.drafts.set(sessionId, {
				...current,
				experiment
			});
			this.upsertHistory(draft.replayCase, experiment);
			await this.store().put("experiment", experimentId, experiment);
			await this.transition("completed", experiment);
		} catch (error) {
			const current = this.drafts.get(sessionId);
			if (current?.experiment?.id !== experimentId || current.experiment.status === "aborted") return;
			experiment = {
				...current.experiment,
				status: "failed",
				updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
				error: error instanceof Error ? error.message : String(error)
			};
			this.drafts.set(sessionId, {
				...current,
				experiment
			});
			this.upsertHistory(draft.replayCase, experiment);
			await this.transition("failed", experiment);
		}
	}
	requireVariant(id) {
		const variant = this.registries.variants.get(id);
		if (variant === void 0) throw new Error(`找不到 variant ${id}`);
		return variant;
	}
	async transition(stage, experiment) {
		await Promise.all(this.registries.hooks.list().map((hook) => hook.onTransition(stage, experiment)));
		await this.persist();
	}
	async persist() {
		await this.store().save({ history: this.history });
	}
	upsertHistory(replayCase, experiment) {
		const entry = {
			sourceSessionId: replayCase.sourceSessionId,
			sourceTurn: replayCase.sourceTurn,
			...replayCase.observedBaseline?.evidenceHash === void 0 ? {} : { sourceEvidenceHash: replayCase.observedBaseline.evidenceHash },
			replayCase,
			experiment
		};
		const existing = this.history.findIndex((item) => item.experiment.id === experiment.id);
		if (existing === -1) this.history = [...this.history, entry];
		else this.history = this.history.map((item, index) => index === existing ? entry : item);
	}
};
//#endregion
//#region src/variants.ts
function builtInVariants(options = {}) {
	const anchored = options.anchoredStandard ?? { available: true };
	return [
		{
			id: "standard",
			label: "Standard replay",
			description: "Fresh DSH standard-preset candidate",
			plane: "agent",
			preset: "standard",
			pluginSurface: "preset:standard",
			supported: true,
			requestPhases: ["request"],
			behavior: "normal"
		},
		{
			id: "minimal",
			label: "Minimal",
			description: "最小 agent preset",
			plane: "agent",
			preset: "minimal",
			pluginSurface: "preset:minimal",
			supported: true,
			requestPhases: ["request"],
			behavior: "normal"
		},
		{
			id: "anchored",
			label: "Anchored Standard",
			description: "Native preset: exact Minimal bootstrap, then resident discovery tools with durable on-demand unlocks",
			plane: "agent",
			preset: "anchored-standard",
			pluginSurface: "preset:anchored-standard",
			supported: anchored.available,
			...anchored.available ? {} : { unsupportedReason: anchored.reason ?? "The anchored-standard preset is not installed in this DSH profile." },
			requestPhases: [
				"bootstrap",
				"promoted",
				"dynamic unlocks"
			],
			behavior: "anchored"
		},
		{
			id: "candidate-agent-plugin",
			label: "Candidate Agent Plugin",
			description: "agent-scoped request-hook 候选",
			plane: "agent",
			preset: "standard",
			pluginSurface: "agent-plugin:candidate@1",
			supported: true,
			requestPhases: ["request"],
			behavior: "normal",
			install: (agentCtx, phases) => {
				agentCtx.on("agent/request", async (_payload, next) => {
					phases.push("request");
					return next();
				});
			}
		},
		{
			id: "candidate-missing-evidence",
			label: "Candidate（缺 evidence fixture）",
			description: "确定性失败，用于验证缺 evidence 边界",
			plane: "agent",
			preset: "standard",
			pluginSurface: "agent-plugin:missing-evidence@1",
			supported: true,
			requestPhases: ["request"],
			behavior: "missing-evidence",
			install: (agentCtx, phases) => {
				agentCtx.on("agent/request", async () => {
					phases.push("request");
					throw new Error("fixture: candidate evidence intentionally unavailable");
				});
			}
		},
		{
			id: "host-provider-switch",
			label: "Provider / Sandbox Switch",
			description: "需要切换 host singleton",
			plane: "host",
			pluginSurface: "host-plane:provider+sandbox",
			supported: false,
			unsupportedReason: "首期仅支持 agent-scoped preset/request-hook；该 variant 需要 host-plane singleton",
			requestPhases: []
		}
	];
}
//#endregion
//#region src/replay-turn-projection.ts
const nullableString = z$1.string().min(1).nullable();
const metricsSchema = z$1.object({
	freshInputTokens: z$1.number().nonnegative(),
	outputTokens: z$1.number().nonnegative(),
	cacheReadTokens: z$1.number().nonnegative(),
	durationMs: z$1.number().nonnegative(),
	stepCount: z$1.number().int().nonnegative(),
	toolCalls: z$1.number().int().nonnegative()
}).strict();
const recordSchema = z$1.object({
	turn: z$1.number().int().positive(),
	prompt: nullableString,
	provider: nullableString,
	model: nullableString,
	reasoning: nullableString,
	maxTokens: z$1.number().int().positive().nullable(),
	presetSurface: nullableString,
	systemHash: nullableString,
	toolSchemaHash: nullableString,
	evidenceHash: nullableString,
	missingFields: z$1.array(z$1.string()),
	replayable: z$1.boolean(),
	metrics: metricsSchema.nullable(),
	eventCount: z$1.number().int().nonnegative(),
	stepCount: z$1.number().int().nonnegative(),
	completedAt: z$1.number().nonnegative(),
	endReason: z$1.string().min(1)
}).strict();
const projectionSchema = z$1.object({ turns: z$1.array(recordSchema) }).strict();
function finite(value) {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}
function textOfUser(event) {
	if (event.data.source.kind !== "user") return null;
	const text = event.data.content.filter((block) => block.type === "text").map((block) => block.text).join("\n").trim();
	return text.length === 0 ? null : text;
}
function requestEvidence(event) {
	const { header } = event.data;
	return {
		provider: header.config.provider || null,
		model: header.config.model || null,
		reasoning: header.config.reasoningEffort ?? null,
		maxTokens: Number.isSafeInteger(header.config.maxTokens) && (header.config.maxTokens ?? 0) > 0 ? header.config.maxTokens ?? null : null,
		systemHash: sha256(canonicalJson(header.system ?? null)),
		toolSchemaHash: sha256(canonicalJson(header.tools ?? []))
	};
}
function observe(state, event) {
	const open = state.openTurn;
	if (open === null || event.type === "turn/start") return state;
	let next = {
		...open,
		eventCount: open.eventCount + 1
	};
	if (event.type === "step/start" && event.data.turn === open.turn) next.stepCount += 1;
	if (event.type === "tool/call" && event.data.turn === open.turn) {
		next.toolCalls += 1;
		next.outputEvidence = [...next.outputEvidence, sha256(canonicalJson(event.data))];
	}
	if (event.type === "tool/result" && event.data.turn === open.turn) next.outputEvidence = [...next.outputEvidence, sha256(canonicalJson(event.data))];
	if (event.type === "assistant/message" && event.data.turn === open.turn) {
		next.freshInputTokens += finite(event.data.usage?.inputTokens);
		next.outputTokens += finite(event.data.usage?.outputTokens);
		next.cacheReadTokens += finite(event.data.usage?.cacheReadTokens);
		next.outputEvidence = [...next.outputEvidence, sha256(canonicalJson(event.data))];
	}
	return {
		...state,
		openTurn: next
	};
}
function finalized(state, event) {
	const open = state.openTurn?.turn === event.data.turn ? state.openTurn : null;
	const prompt = open === null ? null : open.promptParts.join("\n\n").trim() || null;
	const request = state.request;
	const metrics = open === null ? null : {
		freshInputTokens: open.freshInputTokens,
		outputTokens: open.outputTokens,
		cacheReadTokens: open.cacheReadTokens,
		durationMs: Math.max(0, event.time - open.startedAt),
		stepCount: open.stepCount,
		toolCalls: open.toolCalls
	};
	const missingFields = [];
	if (prompt === null) missingFields.push("original user prompt");
	if (request?.provider == null) missingFields.push("provider");
	if (request?.model == null) missingFields.push("model");
	if (request?.reasoning == null) missingFields.push("reasoning");
	if (request?.maxTokens == null) missingFields.push("maxTokens");
	if (request === null) missingFields.push("request header");
	if (metrics === null) missingFields.push("observed turn metrics");
	const facts = missingFields.length === 0 && prompt !== null && request !== null && metrics !== null ? {
		prompt,
		provider: request.provider,
		model: request.model,
		reasoning: request.reasoning,
		maxTokens: request.maxTokens,
		systemHash: request.systemHash,
		toolSchemaHash: request.toolSchemaHash,
		metrics,
		outputEvidence: open?.outputEvidence ?? [],
		endReason: event.data.reason.kind
	} : null;
	return {
		turn: event.data.turn,
		prompt,
		provider: request?.provider ?? null,
		model: request?.model ?? null,
		reasoning: request?.reasoning ?? null,
		maxTokens: request?.maxTokens ?? null,
		presetSurface: state.presetSurface,
		systemHash: request?.systemHash ?? null,
		toolSchemaHash: request?.toolSchemaHash ?? null,
		evidenceHash: facts === null ? null : sha256(canonicalJson(facts)),
		missingFields,
		replayable: facts !== null,
		metrics,
		eventCount: open?.eventCount ?? 0,
		stepCount: metrics?.stepCount ?? 0,
		completedAt: event.time,
		endReason: event.data.reason.kind
	};
}
/** Native whole-log projection serving live updates and cache-backed historical backfill. */
const replayTurnsProjectionDefinition = {
	key: "replayLabTurns",
	schema: projectionSchema,
	stateVersion: 2,
	init: () => ({
		presetSurface: null,
		request: null,
		openTurn: null,
		turns: []
	}),
	apply: (prior, event) => {
		const state = observe(prior, event);
		switch (event.type) {
			case "agent-preset/selected": return {
				...state,
				presetSurface: event.data.agentPreset
			};
			case "request/header": return {
				...state,
				request: requestEvidence(event)
			};
			case "turn/start": return {
				...state,
				openTurn: {
					turn: event.data.turn,
					startedAt: event.time,
					promptParts: [],
					freshInputTokens: 0,
					outputTokens: 0,
					cacheReadTokens: 0,
					stepCount: 0,
					toolCalls: 0,
					eventCount: 1,
					outputEvidence: []
				}
			};
			case "user/message": {
				if (state.openTurn === null) return state;
				const text = textOfUser(event);
				return text === null ? state : {
					...state,
					openTurn: {
						...state.openTurn,
						promptParts: [...state.openTurn.promptParts, text]
					}
				};
			}
			case "turn/end": {
				const record = finalized(state, event);
				const priorIndex = state.turns.findIndex((turn) => turn.turn === record.turn);
				const turns = priorIndex < 0 ? [...state.turns, record] : state.turns.map((turn, index) => index === priorIndex ? record : turn);
				return {
					...state,
					openTurn: null,
					turns
				};
			}
			default: return state;
		}
	},
	view: (state) => ({ turns: state.turns })
};
//#endregion
//#region src/types.ts
/** Stable identity shared by React keys, test ids, and host resolution. */
function replayTurnKey(sessionId, turn) {
	return `${sessionId}:${turn}`;
}
function replayTurnTestId(sessionId, turn) {
	return `replay-turn-${replayTurnKey(sessionId, turn)}`;
}
//#endregion
//#region src/index.ts
const name = "replay-lab-dsh";
const inject = [
	"webServer",
	"agents",
	"agentPresets",
	"llm",
	"sessions",
	"sessionProjections",
	"sessionTitle",
	"workspaceRegistry",
	"tools"
];
const Config = z.object({
	routeBase: z.string().default("/replay-lab-dsh"),
	historyFixture: z.string().required(),
	workspaceFixture: z.string().required(),
	stateFile: z.string().required(),
	artifactDirectory: z.string().required(),
	provider: z.string().default("replay-lab-fake"),
	fakeAdapter: z.boolean().default(false)
});
function baseDirectory(ctx) {
	if (ctx.baseUrl === void 0) return process.cwd();
	try {
		return dirname(fileURLToPath(new URL("profile-anchor", ctx.baseUrl)));
	} catch {
		return ctx.baseUrl;
	}
}
function absolute(base, value) {
	return resolve(base, value);
}
async function apply(ctx, config) {
	if (!/^\/[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*$/.test(config.routeBase)) throw new TypeError("routeBase 必须是无尾斜杠的绝对路径");
	const base = baseDirectory(ctx);
	const workspaceFixture = absolute(base, config.workspaceFixture);
	ctx.sessionProjections.register(replayTurnsProjectionDefinition);
	const resolveTurn = async (identifier) => {
		const session = ctx.sessions.get(identifier.sessionId);
		if (session === void 0) throw new Error(`session "${identifier.sessionId}" is not live`);
		const sourceCwd = session.header.cwd;
		if (typeof sourceCwd !== "string" || sourceCwd.length === 0) throw new Error(`session "${identifier.sessionId}" has no durable source cwd`);
		const record = ctx.sessionProjections.snapshot(session).values.replayLabTurns?.turns.find((turn) => turn.turn === identifier.turn);
		if (record === void 0) throw new Error(`turn ${identifier.turn} is not finalized in session "${identifier.sessionId}"`);
		if (!record.replayable || record.evidenceHash === null) throw new Error(`turn ${identifier.turn} is not replayable: ${record.missingFields.join(", ") || "incomplete evidence"}`);
		if (record.evidenceHash !== identifier.expectedEvidenceHash) throw new Error(`turn ${identifier.turn} evidence changed; refresh the session projection and try again`);
		const presetSurface = record.presetSurface ?? resolveSessionPreset(session) ?? null;
		if (presetSurface === null) throw new Error(`turn ${identifier.turn} has no durable preset/plugin surface`);
		return {
			record: {
				...record,
				presetSurface
			},
			sourceCwd
		};
	};
	const service = new ReplayLabService(config.routeBase, resolveTurn);
	const source = new FixtureCaseSource(absolute(base, config.historyFixture), workspaceFixture);
	const artifactDirectory = absolute(base, config.artifactDirectory);
	const store = new JsonArtifactStore(absolute(base, config.stateFile), artifactDirectory);
	const metrics = new SessionMetricsExtractor();
	const oracle = new IndependentEvidenceOracle();
	service.registries.caseSources.register(source);
	service.registries.artifactStores.register(store);
	service.registries.metricsExtractors.register(metrics);
	service.registries.oracles.register(oracle);
	let anchoredStandard;
	try {
		const preset = await ctx.agentPresets.resolve("anchored-standard");
		anchoredStandard = preset.broken === void 0 ? { available: true } : {
			available: false,
			reason: `anchored-standard is installed but cannot mount: ${preset.broken}`
		};
	} catch (error) {
		anchoredStandard = {
			available: false,
			reason: `Install anchored-standard in this DSH profile and restart the server. ${error instanceof Error ? error.message : String(error)}`
		};
	}
	for (const variant of builtInVariants({ anchoredStandard })) service.registries.variants.register(variant);
	const runner = new CordisAgentRunner(ctx, metrics, (id) => service.registries.variants.get(id), join(artifactDirectory, "candidate-workspaces"));
	ctx.tools.guard((exec) => {
		let session = exec.agent?.session;
		while (session !== void 0) {
			if (String(session.id).startsWith("replay-")) {
				const cwd = exec.agent?.session.header.cwd;
				return typeof cwd === "string" && cwd.length > 0 ? candidatePathGuard(exec.arguments, cwd) : "Replay candidate has no isolated workspace boundary.";
			}
			session = session.header.parentSession === void 0 ? void 0 : ctx.sessions.get(session.header.parentSession);
		}
	});
	service.registries.runners.register(runner);
	service.registries.hooks.register({
		id: "artifact-transition-audit",
		async onTransition(stage, experiment) {
			await store.put("transition", `${experiment.id}-${stage}`, {
				stage,
				experiment
			});
		}
	});
	await service.restore(store);
	if (config.fakeAdapter) ctx.llm.registerAdapter([config.provider], new DeterministicReplayAdapter());
	ctx.provide("replayLabDsh", service);
	ctx.effect(() => ctx.webServer.register({
		kind: "prefix",
		path: config.routeBase,
		handler: createHttpHandler(service)
	}), "replay-lab-dsh: host route");
	ctx.effect(() => async () => {
		await runner.dispose();
	}, "replay-lab-dsh: runner lifecycle");
}
//#endregion
export { Config, ContributionRegistry, CordisAgentRunner, DeterministicReplayAdapter, FixtureCaseSource, IndependentEvidenceOracle, JsonArtifactStore, ReplayLabRegistries, ReplayLabService, SessionMetricsExtractor, apply, builtInVariants, inject, name, replayTurnKey, replayTurnTestId };

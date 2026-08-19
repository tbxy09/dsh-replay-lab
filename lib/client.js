window.__ModuleLoader__.load({
	id: "@tbxy09/dsh-replay-lab",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/controller.ts
		var ReplayLabController = class {
			apiBase;
			sessionId;
			listeners = /* @__PURE__ */ new Set();
			state = Object.freeze({
				open: false,
				status: "cold"
			});
			poll;
			constructor(apiBase = "/replay-lab-dsh", sessionId) {
				this.apiBase = apiBase;
				this.sessionId = sessionId;
			}
			subscribe = (listener) => {
				this.listeners.add(listener);
				return () => {
					this.listeners.delete(listener);
				};
			};
			getSnapshot = () => this.state;
			open() {
				this.patch({ open: true });
				this.refresh();
			}
			close() {
				this.patch({
					open: false,
					unsupported: void 0
				});
				this.stopPolling();
			}
			async refresh() {
				const query = this.sessionId === void 0 ? "" : `?sessionId=${encodeURIComponent(this.sessionId)}`;
				await this.request("GET", query);
				const status = this.state.snapshot?.experiment?.status;
				if (status === "approved" || status === "running") this.startPolling();
				else this.stopPolling();
			}
			async freeze(sourceId) {
				await this.request("POST", "/case", { sourceId });
			}
			async admit(identifier) {
				if (this.sessionId !== void 0 && identifier.sessionId !== this.sessionId) throw new Error("Replay controller session mismatch");
				await this.request("POST", "/admit", identifier);
			}
			async plan(candidateVariantId) {
				const variant = this.state.snapshot?.variants.find((item) => item.id === candidateVariantId);
				if (variant?.supported === false) {
					this.patch({ unsupported: variant.unsupportedReason ?? "该 variant 不支持" });
					return;
				}
				this.patch({ unsupported: void 0 });
				await this.request("POST", "/plan", {
					sessionId: this.requireSessionId(),
					candidateVariantId
				});
			}
			async approveRun() {
				await this.request("POST", "/approve-run", { sessionId: this.requireSessionId() });
				this.startPolling();
			}
			async reset() {
				await this.request("POST", "/reset", { sessionId: this.requireSessionId() });
				this.stopPolling();
			}
			async abort() {
				await this.request("POST", "/abort", { sessionId: this.requireSessionId() });
				this.stopPolling();
			}
			requireSessionId() {
				if (this.sessionId === void 0) throw new Error("session-scoped Replay controller is required");
				return this.sessionId;
			}
			async request(method, path, value) {
				this.patch({
					status: "loading",
					error: void 0
				});
				try {
					const payload = await (await fetch(`${this.apiBase}${path}`, {
						method,
						headers: value === void 0 ? void 0 : { "content-type": "application/json" },
						body: value === void 0 ? void 0 : JSON.stringify(value)
					})).json();
					if (!payload.ok) throw new Error(payload.error.message);
					this.patch({
						status: "ready",
						snapshot: payload.value,
						error: void 0
					});
				} catch (error) {
					this.patch({
						status: "error",
						error: error instanceof Error ? error.message : String(error)
					});
				}
			}
			startPolling() {
				if (this.poll !== void 0) return;
				this.poll = window.setInterval(() => {
					this.refresh();
				}, 120);
			}
			stopPolling() {
				if (this.poll !== void 0) window.clearInterval(this.poll);
				this.poll = void 0;
			}
			patch(next) {
				this.state = Object.freeze({
					...this.state,
					...next
				});
				for (const listener of this.listeners) listener();
			}
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
		//#region src/client/SessionReplayTab.tsx
		const statusLabel = {
			planned: "Ready to run",
			approved: "Approved",
			running: "Running",
			completed: "Completed",
			aborted: "Aborted",
			failed: "Failed"
		};
		const integerFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
		const decimalFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
		const percentageFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
		const metricLabels = {
			freshInputTokens: "Fresh input tokens",
			outputTokens: "Output tokens",
			cacheReadTokens: "Cache read tokens",
			durationMs: "Duration",
			stepCount: "Steps",
			toolCalls: "Tool calls"
		};
		const metricKeys = Object.keys(metricLabels);
		function formatCount(value) {
			return integerFormatter.format(value);
		}
		function formatDuration(milliseconds) {
			if (milliseconds < 1e3) return `${formatCount(milliseconds)} ms`;
			if (milliseconds < 6e4) return `${decimalFormatter.format(milliseconds / 1e3)} s`;
			const minutes = Math.floor(milliseconds / 6e4);
			const seconds = Math.round(milliseconds % 6e4 / 1e3);
			if (seconds === 60) return `${formatCount(minutes + 1)} min`;
			return seconds === 0 ? `${formatCount(minutes)} min` : `${formatCount(minutes)} min ${seconds} s`;
		}
		function formatMetricValue(key, value) {
			return key === "durationMs" ? formatDuration(value) : formatCount(value);
		}
		function formatMetricDelta(key, value) {
			return `${value > 0 ? "+" : value < 0 ? "−" : ""}${formatMetricValue(key, Math.abs(value))}`;
		}
		function metricDeltaChange(value) {
			return value > 0 ? "increase" : value < 0 ? "decrease" : "unchanged";
		}
		function formatMetricPercentDelta(baseline, delta) {
			if (baseline === 0) return void 0;
			const value = delta / baseline * 100;
			return `${value > 0 ? "+" : value < 0 ? "−" : ""}${percentageFormatter.format(Math.abs(value))}%`;
		}
		function metricDeltaTone(key, value) {
			if (key === "stepCount" || key === "toolCalls") return "neutral";
			return metricDeltaChange(value);
		}
		function formatRequestPhase(phase) {
			return {
				observed: "Observed baseline",
				request: "Request",
				bootstrap: "Bootstrap",
				promoted: "Promoted",
				"dynamic-unlocks": "Dynamic unlocks"
			}[phase] ?? phase.replaceAll("-", " ").replace(/^./, (character) => character.toUpperCase());
		}
		function formatSurface(surface) {
			const [scope, value] = surface.split(":", 2);
			const label = (value ?? scope ?? "").replaceAll("-", " ").replace(/^./, (character) => character.toUpperCase());
			if (value === void 0) return label;
			if (scope === "preset") return `${label} preset`;
			if (scope === "agent-plugin") return `${label} plugin`;
			if (scope === "host-plane") return `${label.replaceAll("+", " + ")} (host-level)`;
			return label;
		}
		function compactIdentifier(value) {
			return value.length <= 28 ? value : `${value.slice(0, 17)}…${value.slice(-8)}`;
		}
		function unique(values) {
			return [...new Set(values.filter((value) => value.length > 0))];
		}
		function requestSurfaces(evidence) {
			return evidence?.requestSurfaces ?? [];
		}
		function sequenceStatus(left, right) {
			if (left.length === 0 || right.length === 0) return "unknown";
			return left.length === right.length && left.every((value, index) => value === right[index]) ? "match" : "mismatch";
		}
		function compareRequestSurfaces(baseline, candidate, baselineFallback) {
			const baselineSurfaces = requestSurfaces(baseline);
			const candidateSurfaces = requestSurfaces(candidate);
			const baselineRoute = baselineSurfaces.length > 0 ? unique(baselineSurfaces.map((surface) => `${surface.provider} / ${surface.model}`)) : baselineFallback === void 0 ? [] : [`${baselineFallback.provider} / ${baselineFallback.model}`];
			const candidateRoute = unique(candidateSurfaces.map((surface) => `${surface.provider} / ${surface.model}`));
			const baselinePhases = unique(baseline?.requestPhases ?? baselineSurfaces.map((surface) => surface.phase));
			const candidatePhases = unique(candidate?.requestPhases ?? candidateSurfaces.map((surface) => surface.phase));
			const baselineTools = unique(baselineSurfaces.flatMap((surface) => surface.toolNames));
			const candidateTools = unique(candidateSurfaces.flatMap((surface) => surface.toolNames));
			const baselineToolSet = new Set(baselineTools);
			const candidateToolSet = new Set(candidateTools);
			const toolDiffKnown = baselineSurfaces.length > 0 && candidateSurfaces.length > 0;
			const baselineSystemHashes = baselineSurfaces.length > 0 ? unique(baselineSurfaces.map((surface) => surface.systemHash)) : baselineFallback === void 0 ? [] : [baselineFallback.systemHash];
			const candidateSystemHashes = unique(candidateSurfaces.map((surface) => surface.systemHash));
			const baselineToolSchemaHashes = baselineSurfaces.length > 0 ? unique(baselineSurfaces.map((surface) => surface.toolSchemaHash)) : baselineFallback === void 0 ? [] : [baselineFallback.toolSchemaHash];
			const candidateToolSchemaHashes = unique(candidateSurfaces.map((surface) => surface.toolSchemaHash));
			return {
				baselineRoute,
				candidateRoute,
				routeStatus: sequenceStatus(baselineRoute, candidateRoute),
				baselinePhases,
				candidatePhases,
				phaseStatus: sequenceStatus(baselinePhases, candidatePhases),
				toolDiffStatus: toolDiffKnown ? "known" : "unknown",
				toolsAdded: toolDiffKnown ? candidateTools.filter((tool) => !baselineToolSet.has(tool)) : [],
				toolsRemoved: toolDiffKnown ? baselineTools.filter((tool) => !candidateToolSet.has(tool)) : [],
				baselineSystemHashes,
				candidateSystemHashes,
				systemHashStatus: sequenceStatus(baselineSystemHashes, candidateSystemHashes),
				baselineToolSchemaHashes,
				candidateToolSchemaHashes,
				toolSchemaHashStatus: sequenceStatus(baselineToolSchemaHashes, candidateToolSchemaHashes)
			};
		}
		function EvidenceSummary({ title, evidence }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "rld-session-evidence",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", { children: title }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
					"data-status": evidence?.status,
					children: evidence === void 0 ? "Not run" : statusLabel[evidence.status]
				})] }), evidence === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: "rld-session-muted",
					children: "No independent evidence yet."
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dl", { children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "Session ID" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", {
						title: evidence.sessionId,
						children: compactIdentifier(evidence.sessionId)
					})] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "Request phase" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: evidence.requestPhases.map(formatRequestPhase).join(" → ") || "—" })] }),
					evidence.requestSurfaces?.map((surface, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dt", { children: [formatRequestPhase(surface.phase), " tools"] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", {
						title: surface.toolNames.join(", "),
						children: surface.toolNames.join(", ") || "No tools"
					})] }, `${surface.phase}-${index}`)),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "Events" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", {
						title: String(evidence.eventCount),
						children: formatCount(evidence.eventCount)
					})] })
				] }), evidence.metrics === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
					className: "rld-session-warning",
					role: "status",
					children: ["Evidence unavailable: ", evidence.missingReason ?? "incomplete event stream"]
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "rld-session-metrics",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: "Fresh input tokens" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
							title: String(evidence.metrics.freshInputTokens),
							children: formatCount(evidence.metrics.freshInputTokens)
						})] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: "Output tokens" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
							title: String(evidence.metrics.outputTokens),
							children: formatCount(evidence.metrics.outputTokens)
						})] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: "Cache read tokens" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
							title: String(evidence.metrics.cacheReadTokens),
							children: formatCount(evidence.metrics.cacheReadTokens)
						})] })
					]
				})] })]
			});
		}
		function workspaceDriftNotice(drift) {
			return drift?.detected === true ? "Workspace changed after this replay case was frozen. The candidate used the current workspace state, so this is not a strict controlled comparison." : void 0;
		}
		function WorkspaceDriftNotice({ drift }) {
			const notice = workspaceDriftNotice(drift);
			if (notice === void 0 || drift === void 0) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "rld-session-drift-notice",
				role: "status",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "Workspace drift" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: notice }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("code", {
						title: `Frozen: ${drift.frozenHash}\nCurrent: ${drift.currentHash}`,
						children: [
							drift.frozenHash.slice(0, 12),
							" → ",
							drift.currentHash.slice(0, 12)
						]
					})
				]
			});
		}
		function comparisonLabel(status) {
			return status === "match" ? "Match" : status === "mismatch" ? "Changed" : "Unknown";
		}
		function ReplayWorkflowGuide() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("ol", {
				className: "rld-replay-guide",
				"aria-label": "Replay workflow",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "1" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "Run setup" })] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "2" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "Saved runs" })] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "3" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "Inspect evidence" })] })
				]
			});
		}
		function TextSequence({ values, format = (value) => value }) {
			return values.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "rld-result-empty",
				children: "Unknown"
			}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				title: values.join(" → "),
				children: values.map(format).join(" → ")
			});
		}
		function HashSequence({ values }) {
			return values.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "rld-result-empty",
				children: "Unknown"
			}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "rld-result-hashes",
				title: values.join(" → "),
				children: values.map((value, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: value.slice(0, 12) }, `${value}-${index}`))
			});
		}
		function ToolSequence({ values }) {
			return values.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "rld-result-empty",
				children: "None"
			}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "rld-result-tools",
				children: values.map((value) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: value }, value))
			});
		}
		function RequestSurfaceDiff({ baseline, candidate, baselineFallback }) {
			const comparison = compareRequestSurfaces(baseline, candidate, baselineFallback);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "rld-result-section rld-result-surface",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: "Request surface diff" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "Durable request headers only" })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "rld-result-table-scroll",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("table", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: "Surface" }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: "Baseline (observed)" }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: "Candidate (isolated replay)" }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: "Difference" })
					] }) }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tbody", { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: "Provider / model" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextSequence, { values: comparison.baselineRoute }) }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextSequence, { values: comparison.candidateRoute }) }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
								"data-status": comparison.routeStatus,
								children: comparisonLabel(comparison.routeStatus)
							})
						] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: "Request phases" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextSequence, {
								values: comparison.baselinePhases,
								format: formatRequestPhase
							}) }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextSequence, {
								values: comparison.candidatePhases,
								format: formatRequestPhase
							}) }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
								"data-status": comparison.phaseStatus,
								children: comparisonLabel(comparison.phaseStatus)
							})
						] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: "Tools added" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "rld-result-empty",
								children: "—"
							}) }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: comparison.toolDiffStatus === "known" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ToolSequence, { values: comparison.toolsAdded }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "rld-result-empty",
								children: "Unknown"
							}) }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
								"data-status": comparison.toolDiffStatus === "unknown" ? "unknown" : comparison.toolsAdded.length === 0 ? "match" : "mismatch",
								children: comparison.toolDiffStatus === "unknown" ? "Unknown" : comparison.toolsAdded.length === 0 ? "None" : `${comparison.toolsAdded.length} added`
							})
						] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: "Tools removed" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: comparison.toolDiffStatus === "known" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ToolSequence, { values: comparison.toolsRemoved }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "rld-result-empty",
								children: "Unknown"
							}) }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "rld-result-empty",
								children: "—"
							}) }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
								"data-status": comparison.toolDiffStatus === "unknown" ? "unknown" : comparison.toolsRemoved.length === 0 ? "match" : "mismatch",
								children: comparison.toolDiffStatus === "unknown" ? "Unknown" : comparison.toolsRemoved.length === 0 ? "None" : `${comparison.toolsRemoved.length} removed`
							})
						] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: "System hash" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(HashSequence, { values: comparison.baselineSystemHashes }) }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(HashSequence, { values: comparison.candidateSystemHashes }) }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
								"data-status": comparison.systemHashStatus,
								children: comparisonLabel(comparison.systemHashStatus)
							})
						] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: "Tool-schema hash" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(HashSequence, { values: comparison.baselineToolSchemaHashes }) }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(HashSequence, { values: comparison.candidateToolSchemaHashes }) }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
								"data-status": comparison.toolSchemaHashStatus,
								children: comparisonLabel(comparison.toolSchemaHashStatus)
							})
						] })
					] })] })
				})]
			});
		}
		function ExecutionDelta({ scorecard, missingReason }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "rld-result-section rld-result-execution",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: "Execution delta" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "Candidate − baseline" })] }), scorecard === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: "rld-session-muted",
					children: missingReason ?? "Complete independent evidence is required."
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "rld-result-table-scroll",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("table", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: "Metric" }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: "Baseline" }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: "Candidate" }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: "Delta" }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: "Delta (%)" })
					] }) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tbody", { children: scorecard.rows.map((row) => {
						const percent = formatMetricPercentDelta(row.baseline, row.delta);
						const tone = metricDeltaTone(row.key, row.delta);
						return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", {
							"data-neutral": tone === "neutral" || void 0,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
									title: row.label,
									children: metricLabels[row.key]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
									title: String(row.baseline),
									children: formatMetricValue(row.key, row.baseline)
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
									className: "rld-result-candidate",
									title: String(row.candidate),
									children: formatMetricValue(row.key, row.candidate)
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
									"data-tone": tone,
									title: String(row.delta),
									children: formatMetricDelta(row.key, row.delta)
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
									"data-tone": tone,
									children: percent ?? "—"
								})
							]
						}, row.key);
					}) })] })
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: "rld-result-neutral-note",
					children: "Steps and tool calls describe execution activity, not outcome quality."
				})] })]
			});
		}
		function VariantRow({ variant, selected, onSelect }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				className: "rld-session-variant",
				"aria-pressed": selected,
				disabled: !variant.supported,
				title: !variant.supported ? variant.unsupportedReason : void 0,
				onClick: onSelect,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: variant.label }) }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
						title: variant.pluginSurface,
						children: formatSurface(variant.pluginSurface)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: variant.requestPhases.map(formatRequestPhase).join(" → ") || "—" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("em", {
						"data-supported": variant.supported,
						children: variant.supported ? "Supported" : "Unavailable"
					})
				]
			});
		}
		function replayHistoryForTurn(history, sessionId, turn) {
			return history.filter((entry) => entry.sourceSessionId === sessionId && entry.sourceTurn === turn && entry.replayCase?.sourceSessionId === sessionId && entry.replayCase.sourceTurn === turn && (entry.experiment.baseline === void 0 || entry.experiment.baseline.sessionId === sessionId)).sort((left, right) => right.experiment.updatedAt.localeCompare(left.experiment.updatedAt));
		}
		function FrozenRequest({ replayCase }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "rld-session-frozen",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: "Observed baseline request" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: replayCase.id })] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("blockquote", { children: replayCase.prompt }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dl", { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "Model" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: replayCase.model })] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "Reasoning" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: replayCase.reasoning })] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "Max tokens" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", {
							title: replayCase.maxTokens === void 0 ? void 0 : String(replayCase.maxTokens),
							children: replayCase.maxTokens === void 0 ? "Default" : formatCount(replayCase.maxTokens)
						})] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "Preset" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", {
							title: replayCase.presetSurface,
							children: formatSurface(replayCase.presetSurface)
						})] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "Source workspace" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", {
							title: replayCase.sourceCwd,
							children: replayCase.sourceCwd
						})] })
					] })
				]
			});
		}
		function CandidateVariants({ variants, selectedId, onSelect }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "rld-session-variants",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: "Candidate" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "Choose one agent-scoped replay" })] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "rld-session-variant-head",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "Variant" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "Surface" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "Request phase" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "Support" })
						]
					}),
					variants.map((variant) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(VariantRow, {
						variant,
						selected: selectedId === variant.id,
						onSelect: () => {
							onSelect(variant.id);
						}
					}, variant.id))
				]
			});
		}
		function SavedRuns({ history, variants, displayedId, onSelect }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "rld-result-history-list",
				children: history.map((entry) => {
					const variant = variants.find((item) => item.id === entry.experiment.candidateVariantId);
					const drift = entry.experiment.scorecard?.workspaceDrift ?? entry.experiment.candidate?.workspace?.drift;
					return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						"aria-pressed": displayedId === entry.experiment.id,
						onClick: () => {
							onSelect(entry.experiment.id);
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: variant?.label ?? entry.experiment.candidateVariantId }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: new Date(entry.experiment.updatedAt).toLocaleString() })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("em", {
							"data-status": entry.experiment.status,
							children: statusLabel[entry.experiment.status]
						}), drift?.detected === true && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("em", {
							"data-drift": true,
							children: "Workspace drift"
						})] })]
					}, entry.experiment.id);
				})
			});
		}
		function allRunEvidenceColumns(replayCase, experiment, history, variants) {
			const retainedHistory = history.map((entry) => entry.experiment);
			const retained = retainedHistory.some((item) => item.id === experiment.id) ? retainedHistory : [experiment, ...retainedHistory];
			const variantLabels = new Map(variants.map((variant) => [variant.id, variant.label]));
			const baseline = experiment.baseline ?? replayCase.observedBaseline ?? retained.find((item) => item.baseline !== void 0)?.baseline;
			return [{
				id: `observed-${replayCase.sourceSessionId}-${replayCase.sourceTurn}`,
				label: "Observed baseline",
				detail: `Turn ${replayCase.sourceTurn}`,
				kind: "baseline",
				metrics: baseline?.metrics
			}, ...retained.map((item) => ({
				id: item.id,
				label: variantLabels.get(item.candidateVariantId) ?? item.candidateVariantId,
				detail: item.candidate?.metrics === void 0 ? statusLabel[item.status] : new Date(item.updatedAt).toLocaleString(),
				kind: "candidate",
				metrics: item.candidate?.metrics
			}))];
		}
		function metricBarPercent(value, maximum) {
			if (value <= 0 || maximum <= 0) return 0;
			return Math.max(2, Math.min(100, value / maximum * 100));
		}
		function AllRunsEvidence({ replayCase, experiment, history, variants }) {
			const columns = allRunEvidenceColumns(replayCase, experiment, history, variants);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "rld-result-section rld-result-runs",
				"data-testid": "all-runs-evidence",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: "Evidence summary · All runs" }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
						"1 observed baseline · ",
						columns.length - 1,
						" saved ",
						columns.length === 2 ? "run" : "runs"
					] })] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "rld-result-table-scroll",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("table", {
							"aria-label": "Recorded execution metrics for the observed baseline and all saved replay runs",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: "Metric" }), columns.map((column) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("th", {
								"data-active": column.id === experiment.id || void 0,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: column.label }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: column.detail })]
							}, column.id))] }) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tbody", { children: metricKeys.map((key) => {
								const maximum = Math.max(0, ...columns.map((column) => column.metrics?.[key] ?? 0));
								return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: metricLabels[key] }), columns.map((column) => {
									const value = column.metrics?.[key];
									return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
										"data-kind": column.kind,
										"data-active": column.id === experiment.id || void 0,
										children: value === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "rld-result-empty",
											children: "Unavailable"
										}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
											title: String(value),
											children: formatMetricValue(key, value)
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "rld-result-bar",
											"aria-hidden": "true",
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: { width: `${metricBarPercent(value, maximum)}%` } })
										})] })
									}, column.id);
								})] }, key);
							}) })]
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "rld-result-neutral-note",
						children: "Bars are scaled within each metric. Steps and tool calls describe activity, not outcome quality."
					})
				]
			});
		}
		function rawEvidenceDownloadName(replayCase, experiment) {
			const experimentId = experiment.id.replace(/[^a-zA-Z0-9._-]+/g, "-");
			return `replay-evidence-turn-${replayCase.sourceTurn}-${experimentId}.json`;
		}
		function rawEvidenceArtifact(replayCase, experiment, workspaceDrift) {
			return {
				schemaVersion: 1,
				source: {
					caseId: replayCase.id,
					sessionId: replayCase.sourceSessionId,
					turn: replayCase.sourceTurn,
					promptHash: replayCase.promptHash,
					workspaceHash: replayCase.sourceWorkspaceHash
				},
				experiment: {
					id: experiment.id,
					candidateVariantId: experiment.candidateVariantId,
					status: experiment.status,
					createdAt: experiment.createdAt,
					updatedAt: experiment.updatedAt,
					approvedAt: experiment.approvedAt
				},
				baseline: experiment.baseline ?? replayCase.observedBaseline ?? null,
				candidate: experiment.candidate ?? null,
				scorecard: experiment.scorecard ?? null,
				scorecardMissingReason: experiment.scorecardMissingReason ?? null,
				workspaceDrift: workspaceDrift ?? null
			};
		}
		function rawEvidenceDownloadHref(replayCase, experiment, workspaceDrift) {
			const json = `${JSON.stringify(rawEvidenceArtifact(replayCase, experiment, workspaceDrift), null, 2)}\n`;
			return `data:application/json;charset=utf-8,${encodeURIComponent(json)}`;
		}
		function CompletedResult({ replayCase, experiment, activeExperiment, variants, history, workspaceDrift, onPlan, onSelectHistory }) {
			const rawEvidenceFilename = rawEvidenceDownloadName(replayCase, experiment);
			const rawEvidenceHref = rawEvidenceDownloadHref(replayCase, experiment, workspaceDrift);
			const viewedVariant = variants.find((variant) => variant.id === experiment.candidateVariantId);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("main", {
				className: "rld-result",
				"data-testid": "session-replay-result",
				children: [
					workspaceDrift?.detected === true && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(WorkspaceDriftNotice, { drift: workspaceDrift }),
					history.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
						className: "rld-result-disclosure rld-result-saved-disclosure",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("summary", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("strong", { children: ["Saved runs · ", viewedVariant?.label ?? experiment.candidateVariantId] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							"data-status": experiment.status,
							children: [
								statusLabel[experiment.status],
								" · ",
								history.length,
								" retained"
							]
						})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SavedRuns, {
							history,
							variants,
							displayedId: experiment.id,
							onSelect: onSelectHistory
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AllRunsEvidence, {
						replayCase,
						experiment,
						history,
						variants
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
						className: "rld-result-disclosure rld-result-setup-disclosure",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("summary", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "Run setup" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "Observed turn · isolated candidate · explicit approval" })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "rld-result-setup-grid",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(FrozenRequest, { replayCase }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CandidateVariants, {
								variants,
								selectedId: activeExperiment?.candidateVariantId,
								onSelect: onPlan
							})]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(RequestSurfaceDiff, {
						baseline: experiment.baseline,
						candidate: experiment.candidate,
						baselineFallback: replayCase
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ExecutionDelta, {
						scorecard: experiment.scorecard,
						missingReason: experiment.scorecardMissingReason
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
						className: "rld-result-disclosure",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("summary", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "Raw evidence" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "Downloadable JSON · session IDs, event counts, request headers, and metrics" })] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "rld-result-download",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: "Artifact filename" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
									title: rawEvidenceFilename,
									children: rawEvidenceFilename
								})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
									href: rawEvidenceHref,
									download: rawEvidenceFilename,
									children: "Download JSON"
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "rld-session-evidence-grid",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(EvidenceSummary, {
									title: `Baseline · Turn ${replayCase.sourceTurn}`,
									evidence: experiment.baseline ?? replayCase.observedBaseline
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(EvidenceSummary, {
									title: "Candidate replay",
									evidence: experiment.candidate
								})]
							})
						]
					})
				]
			});
		}
		function ExperimentWorkbench({ controller, state, sessionId, onBack }) {
			const snapshot = state.snapshot;
			const replayCase = snapshot?.replayCase;
			const experiment = snapshot?.experiment;
			const variants = snapshot?.variants ?? [];
			const history = replayHistoryForTurn(snapshot?.history ?? [], sessionId, replayCase?.sourceTurn ?? -1);
			const [viewingId, setViewingId] = (0, react.useState)(experiment?.id);
			(0, react.useEffect)(() => {
				setViewingId(experiment?.id);
			}, [experiment?.id]);
			const displayedExperiment = history.find((entry) => entry.experiment.id === viewingId)?.experiment ?? experiment;
			const displayedDrift = displayedExperiment?.scorecard?.workspaceDrift ?? displayedExperiment?.candidate?.workspace?.drift;
			if (replayCase === void 0 || replayCase.sourceSessionId !== sessionId) return null;
			const completedResult = displayedExperiment?.status === "completed" && displayedExperiment.baseline !== void 0 && displayedExperiment.candidate !== void 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "rld-session-workbench",
				"data-testid": "session-replay-workbench",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
						className: "rld-session-workbench-header",
						"data-result": completedResult || void 0,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								onClick: onBack,
								children: "← Choose another turn"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: completedResult ? `Replay · Turn ${replayCase.sourceTurn}` : `Current session · Turn ${replayCase.sourceTurn}` }), completedResult ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ReplayWorkflowGuide, {}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "This observed baseline is fixed. Choose one isolated candidate, then explicitly approve its run." })] }),
							displayedExperiment !== void 0 && (!completedResult || history.length === 0) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
								"data-status": displayedExperiment.status,
								children: statusLabel[displayedExperiment.status]
							})
						]
					}),
					state.error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "rld-session-error",
						role: "alert",
						children: state.error
					}),
					completedResult ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CompletedResult, {
						replayCase,
						experiment: displayedExperiment,
						activeExperiment: experiment,
						variants,
						history,
						workspaceDrift: displayedDrift,
						onPlan: (variantId) => {
							controller.plan(variantId);
						},
						onSelectHistory: setViewingId
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "rld-session-workbench-grid",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "rld-session-plan",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(FrozenRequest, { replayCase }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CandidateVariants, {
								variants,
								selectedId: experiment?.candidateVariantId,
								onSelect: (variantId) => {
									controller.plan(variantId);
								}
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("aside", {
							className: "rld-session-run",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
								className: "rld-session-run-control",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: "Approval gate" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "The baseline is already observed; only the isolated candidate executes." })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									disabled: experiment?.status !== "planned",
									onClick: () => {
										controller.approveRun();
									},
									children: experiment?.status === "running" ? "Candidate running…" : "Approve and run candidate"
								})]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(EvidenceSummary, {
								title: "Candidate replay",
								evidence: experiment?.candidate
							})]
						})]
					}), history.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
						className: "rld-result-disclosure rld-result-saved-setup",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("summary", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "Saved runs" }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [history.length, " retained for this turn"] })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SavedRuns, {
							history,
							variants,
							displayedId: displayedExperiment?.id,
							onSelect: setViewingId
						})]
					})] })
				]
			});
		}
		function TurnPicker({ turns, history, projectionAvailable, sessionId, submitting, error, onReplay }) {
			const ready = turns.filter((turn) => turn.replayable).length;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "rld-tab",
				"data-testid": "session-replay-tab",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
						className: "rld-tab-header",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: "Replay this session" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "One row per completed turn, using its recorded prompt and request surface." })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "rld-tab-summary",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: turns.length }), " completed"] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: ready }), " ready"] })]
						})]
					}),
					error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "rld-session-error",
						role: "alert",
						children: error
					}),
					!projectionAvailable ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "rld-tab-empty",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: "Replay metadata unavailable" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "The host replay-turn projection is not installed for this session. Replay is disabled." })]
					}) : turns.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "rld-tab-empty",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: "No completed turns" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "This session does not have a finalized turn yet." })]
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ol", {
						className: "rld-turn-list",
						children: turns.map((item) => {
							const saved = replayHistoryForTurn(history, sessionId, item.turn).length;
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
								className: "rld-turn-row",
								"data-ready": item.replayable || void 0,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "rld-turn-index",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "Turn" }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: item.turn }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: "Completed" })
										]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "rld-turn-content",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: "rld-turn-meta",
												children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: "Model" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: item.model ?? "Unavailable" })] }),
													/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: "Reasoning" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: item.reasoning })] }),
													/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: "Max tokens" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
														title: item.maxTokens == null ? void 0 : String(item.maxTokens),
														children: item.maxTokens == null ? "Unavailable" : formatCount(item.maxTokens)
													})] }),
													/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: "Steps" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
														title: String(item.stepCount),
														children: formatCount(item.stepCount)
													})] })
												]
											}),
											item.prompt === null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
												className: "rld-turn-prompt rld-session-muted",
												children: "The user prompt is outside the loaded history window."
											}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
												className: "rld-turn-prompt",
												children: item.prompt
											}),
											!item.replayable && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
												className: "rld-turn-missing",
												role: "status",
												children: [
													"Needs more recorded data: ",
													item.missingFields.join(", "),
													"."
												]
											})
										]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "rld-turn-action",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											"data-testid": replayTurnTestId(sessionId, item.turn),
											disabled: !item.replayable || submitting !== void 0,
											onClick: () => {
												onReplay(item);
											},
											children: submitting === item.turn ? "Opening…" : saved > 0 ? `Open Turn ${item.turn}` : `Replay Turn ${item.turn}`
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: saved > 0 ? `${saved} saved run${saved === 1 ? "" : "s"}` : item.replayable ? "Recorded request surface available" : "Not replayable yet" })]
									})
								]
							}, replayTurnKey(sessionId, item.turn));
						})
					})
				]
			});
		}
		function SessionReplayTab({ useProjection, sessionId, controllerFor }) {
			const controller = controllerFor(String(sessionId));
			const projection = useProjection("replayLabTurns");
			const controllerState = (0, react.useSyncExternalStore)(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
			const [submitting, setSubmitting] = (0, react.useState)();
			const [localError, setLocalError] = (0, react.useState)();
			const turns = projection?.turns ?? [];
			const activeCase = controllerState.snapshot?.replayCase?.sourceSessionId === String(sessionId);
			(0, react.useEffect)(() => {
				controller.refresh();
			}, [controller]);
			const replay = async (item) => {
				setSubmitting(item.turn);
				setLocalError(void 0);
				try {
					if (item.evidenceHash === null) throw new Error(`Turn ${item.turn} has incomplete replay evidence.`);
					await controller.admit({
						sessionId: String(sessionId),
						turn: item.turn,
						expectedEvidenceHash: item.evidenceHash
					});
				} catch (error) {
					setLocalError(error instanceof Error ? error.message : String(error));
				} finally {
					setSubmitting(void 0);
				}
			};
			if (activeCase) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ExperimentWorkbench, {
				controller,
				state: controllerState,
				sessionId: String(sessionId),
				onBack: () => {
					controller.reset();
				}
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TurnPicker, {
				turns,
				history: controllerState.snapshot?.history ?? [],
				projectionAvailable: projection !== void 0,
				sessionId: String(sessionId),
				submitting,
				error: localError ?? controllerState.error,
				onReplay: (item) => {
					replay(item);
				}
			});
		}
		//#endregion
		//#region src/client/styles.ts
		const CSS = `
.rld-session-scorecard tbody td:nth-child(3){background:#f5f8ff;color:#1d4ed8;font-weight:650}.rld-session-scorecard td[data-change]{font-weight:750}.rld-session-scorecard td[data-change=increase]{background:#fff4e5;color:#b54708}.rld-session-scorecard td[data-change=decrease]{background:#ecfdf3;color:#067647}.rld-session-scorecard td[data-change=unchanged]{background:#f2f4f7;color:#475467}
.rld-tab,.rld-session-workbench{--rld-blue:#245fda;--rld-text:#1b2433;--rld-muted:#667085;--rld-border:#d9dee8;--rld-soft:#f6f8fb;min-height:100%;background:#fff;color:var(--rld-text);font:400 12px/1.45 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.rld-tab *,.rld-session-workbench *{box-sizing:border-box}.rld-tab button,.rld-session-workbench button{font:inherit}.rld-tab-header{position:sticky;top:0;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:24px;min-height:72px;padding:14px 18px;border-bottom:1px solid var(--rld-border);background:rgba(255,255,255,.96);backdrop-filter:blur(8px)}.rld-tab-header h2,.rld-session-workbench h2,.rld-session-workbench h3,.rld-session-workbench h4{margin:0}.rld-tab-header h2{font-size:17px;letter-spacing:-.015em}.rld-tab-header p{margin:3px 0 0;color:var(--rld-muted);font-size:11px}.rld-tab-summary{display:flex;align-items:center;gap:14px;color:var(--rld-muted);white-space:nowrap}.rld-tab-summary span{display:flex;align-items:baseline;gap:4px}.rld-tab-summary strong{color:var(--rld-text);font-size:14px}.rld-tab-summary button,.rld-session-workbench-header>button{height:30px;padding:0 10px;border:1px solid var(--rld-border);border-radius:5px;background:#fff;color:#344054;cursor:pointer}.rld-tab-summary button:hover,.rld-session-workbench-header>button:hover{background:var(--rld-soft)}.rld-tab-summary button:disabled{cursor:wait;opacity:.6}.rld-tab-empty{display:flex;min-height:280px;flex-direction:column;align-items:center;justify-content:center;padding:32px;color:var(--rld-muted);text-align:center}.rld-tab-empty h3{margin:0;color:var(--rld-text);font-size:14px}.rld-tab-empty p{margin:5px 0 0}.rld-turn-list{margin:0;padding:0;list-style:none}.rld-turn-row{display:grid;grid-template-columns:76px minmax(0,1fr) 180px;gap:18px;min-height:132px;padding:16px 18px;border-bottom:1px solid #e9edf3;background:#fff}.rld-turn-row:hover{background:#fbfcfe}.rld-turn-row[data-ready]{box-shadow:inset 3px 0 var(--rld-blue)}.rld-turn-index{display:flex;flex-direction:column;align-items:flex-start;padding-top:2px;color:var(--rld-muted);text-transform:uppercase}.rld-turn-index>span{font-size:9px;font-weight:700;letter-spacing:.08em}.rld-turn-index>strong{margin-top:-2px;color:var(--rld-text);font-size:28px;line-height:1.1;letter-spacing:-.04em}.rld-turn-index>small{margin-top:5px;color:#18a558;font-size:9px;font-weight:650;text-transform:none}.rld-turn-content{min-width:0}.rld-turn-meta{display:flex;align-items:flex-start;gap:22px;margin-bottom:10px}.rld-turn-meta span{display:flex;min-width:70px;flex-direction:column;gap:1px}.rld-turn-meta small{color:var(--rld-muted);font-size:8px;text-transform:uppercase;letter-spacing:.05em}.rld-turn-meta strong{overflow:hidden;max-width:180px;font:600 10px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;text-overflow:ellipsis;white-space:nowrap}.rld-turn-prompt{display:-webkit-box;margin:0;overflow:hidden;color:#344054;font-size:12px;line-height:1.55;white-space:pre-wrap;-webkit-box-orient:vertical;-webkit-line-clamp:3}.rld-turn-missing{margin:9px 0 0;color:#9a6700;font-size:10px}.rld-turn-action{display:flex;flex-direction:column;align-items:stretch;justify-content:center;gap:6px}.rld-turn-action button{height:32px;border:1px solid #1e55bd;border-radius:5px;background:var(--rld-blue);color:#fff;font-weight:650;cursor:pointer}.rld-turn-action button:hover{background:#194fac}.rld-turn-action button:disabled{border-color:#d0d5dd;background:#e4e7ec;color:#98a2b3;cursor:not-allowed}.rld-turn-action small{color:var(--rld-muted);font-size:9px;text-align:center}.rld-tab-history-note{padding:12px 18px;border-top:1px solid var(--rld-border);background:#fbfcfe;color:var(--rld-muted);font-size:10px}.rld-session-muted{color:var(--rld-muted)!important}.rld-session-error{padding:9px 16px;border-bottom:1px solid #f2b8b5;background:#fff3f2;color:#b42318}.rld-session-workbench-header{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:16px;min-height:72px;padding:12px 18px;border-bottom:1px solid var(--rld-border)}.rld-session-workbench-header h2{font-size:17px}.rld-session-workbench-header p{margin:3px 0 0;color:var(--rld-muted);font-size:11px}.rld-session-workbench-header>strong{padding:5px 8px;border-left:3px solid #98a2b3;background:var(--rld-soft);font-size:10px}.rld-session-workbench-header>strong[data-status=completed]{border-color:#18a558}.rld-session-workbench-header>strong[data-status=running]{border-color:var(--rld-blue)}.rld-session-workbench-header>strong[data-status=failed],.rld-session-workbench-header>strong[data-status=aborted]{border-color:#d92d20}.rld-replay-guide{display:flex;align-items:center;gap:7px;margin:5px 0 0;padding:0;color:var(--rld-muted);font-size:10px;list-style:none}.rld-replay-guide li{display:flex;min-width:0;align-items:center;gap:5px;white-space:nowrap}.rld-replay-guide li:not(:last-child)::after{content:'→';margin-left:2px;color:#98a2b3}.rld-replay-guide li>span{display:grid;width:18px;height:18px;flex:0 0 auto;place-items:center;border-radius:50%;background:#eef4ff;color:#1d4ed8;font-size:9px;font-weight:750}.rld-replay-guide strong{color:#344054;font-size:10px}.rld-session-workbench-grid{display:grid;grid-template-columns:minmax(520px,1fr) minmax(360px,430px);min-height:calc(100vh - 160px)}.rld-session-plan{min-width:0;border-right:1px solid var(--rld-border)}.rld-session-frozen,.rld-session-variants,.rld-session-scorecard{border-bottom:1px solid var(--rld-border)}.rld-session-frozen>header,.rld-session-variants>header,.rld-session-scorecard>header{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:40px;padding:0 14px;border-bottom:1px solid #e9edf3}.rld-session-frozen h3,.rld-session-variants h3,.rld-session-scorecard h3,.rld-session-run h3{font-size:12px}.rld-session-frozen>header code{overflow:hidden;max-width:260px;color:var(--rld-muted);font-size:9px;text-overflow:ellipsis;white-space:nowrap}.rld-session-frozen blockquote{margin:0;padding:16px 18px;border:0;color:#27364b;font-size:13px;line-height:1.6}.rld-session-frozen dl{display:grid;grid-template-columns:repeat(4,1fr);margin:0;padding:0 18px 16px}.rld-session-frozen dl>div{min-width:0;border-left:1px solid var(--rld-border);padding-left:10px}.rld-session-frozen dt{color:var(--rld-muted);font-size:8px;text-transform:uppercase;letter-spacing:.05em}.rld-session-frozen dd{margin:2px 0 0;overflow:hidden;font:600 10px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;text-overflow:ellipsis;white-space:nowrap}.rld-session-variants>header span,.rld-session-scorecard>header span{color:var(--rld-muted);font-size:9px}.rld-session-variant-head,.rld-session-variant{display:grid;grid-template-columns:1.35fr 1.2fr 1fr 78px;align-items:center;gap:10px;padding:8px 14px}.rld-session-variant-head{border-bottom:1px solid #e9edf3;color:var(--rld-muted);font-size:8px;font-weight:650;text-transform:uppercase}.rld-session-variant{width:100%;border:0;border-bottom:1px solid #eef1f6;background:#fff;color:var(--rld-text);text-align:left;cursor:pointer}.rld-session-variant:hover{background:#f7f9fc}.rld-session-variant[aria-pressed=true]{background:#eef4ff;box-shadow:inset 3px 0 var(--rld-blue)}.rld-session-variant:disabled{cursor:default;opacity:.62}.rld-session-variant>span:first-child{display:flex;align-items:center;gap:6px}.rld-session-variant strong{font-size:10px}.rld-session-variant small{color:var(--rld-muted);font-size:8px}.rld-session-variant code{overflow:hidden;color:var(--rld-muted);font-size:9px;text-overflow:ellipsis;white-space:nowrap}.rld-session-variant>span:nth-child(3){font-size:9px}.rld-session-variant em{justify-self:end;color:#d92d20;font-size:8px;font-style:normal;font-weight:650}.rld-session-variant em[data-supported=true]{color:#18a558}.rld-session-run{min-width:0;background:#fbfcfe}.rld-session-run-control{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px;border-bottom:1px solid var(--rld-border)}.rld-session-run-control p{margin:3px 0 0;color:var(--rld-muted);font-size:9px}.rld-session-run-control>button{height:32px;padding:0 12px;border:1px solid #1e55bd;border-radius:5px;background:var(--rld-blue);color:#fff;font-weight:650;cursor:pointer}.rld-session-run-control>button:disabled{border-color:#d0d5dd;background:#e4e7ec;color:#98a2b3;cursor:not-allowed}.rld-session-evidence-grid{display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid var(--rld-border)}.rld-session-evidence{min-width:0;padding:12px;border-right:1px solid var(--rld-border)}.rld-session-evidence:last-child{border-right:0}.rld-session-evidence>header{display:flex;align-items:center;justify-content:space-between;gap:8px}.rld-session-evidence h4{font-size:11px}.rld-session-evidence>header strong{color:var(--rld-muted);font-size:8px;text-transform:uppercase}.rld-session-evidence>header strong[data-status=completed]{color:#18a558}.rld-session-evidence dl{margin:10px 0 0}.rld-session-evidence dl>div{display:grid;grid-template-columns:66px minmax(0,1fr);gap:6px;margin:5px 0}.rld-session-evidence dt{color:var(--rld-muted);font-size:8px}.rld-session-evidence dd{margin:0;overflow:hidden;font:500 8px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;text-overflow:ellipsis;white-space:nowrap}.rld-session-evidence>p{margin:12px 0 0;font-size:9px}.rld-session-warning{padding:7px;border-left:3px solid #f79009;background:#fffaeb;color:#93370d}.rld-session-metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:5px;margin-top:10px}.rld-session-metrics span{display:flex;min-width:0;flex-direction:column;padding:5px;border:1px solid var(--rld-border);background:#fff}.rld-session-metrics small{overflow:hidden;color:var(--rld-muted);font-size:7px;text-overflow:ellipsis;white-space:nowrap}.rld-session-metrics strong{font-size:11px}.rld-session-scorecard>p{margin:0;padding:14px;font-size:9px}.rld-session-scorecard table{width:100%;border-collapse:collapse;font-size:9px}.rld-session-scorecard th,.rld-session-scorecard td{padding:6px 10px;border-bottom:1px solid #eef1f6;text-align:right}.rld-session-scorecard th:first-child{text-align:left}.rld-session-scorecard thead th{color:var(--rld-muted);font-size:8px}
@media(max-width:1100px){.rld-workbench{grid-template-columns:210px minmax(430px,1fr) 350px}.rld-topbar p{display:none}.rld-frozen dl>div{grid-template-columns:155px}.rld-matrix-head,.rld-variant-row{grid-template-columns:130px 150px 130px 60px}.rld-turn-row{grid-template-columns:64px minmax(0,1fr) 150px}.rld-turn-meta{gap:14px}.rld-session-workbench-grid{grid-template-columns:minmax(460px,1fr) 350px}}@media(max-width:820px){.rld-workbench{display:block;overflow:auto}.rld-sources,.rld-center,.rld-execution{overflow:visible;border:0}.rld-sources{min-height:280px}.rld-source-list{max-height:240px}.rld-topbar{position:sticky;top:0;z-index:2}.rld-evidence-column{min-height:150px}.rld-matrix{overflow:auto}.rld-matrix-head,.rld-variant-row{min-width:580px}.rld-tab-header{position:static;align-items:flex-start;flex-direction:column;gap:10px}.rld-tab-summary{width:100%;flex-wrap:wrap}.rld-turn-row{grid-template-columns:50px minmax(0,1fr)}.rld-turn-action{grid-column:2;align-items:flex-start}.rld-turn-action button{min-width:150px}.rld-turn-action small{text-align:left}.rld-turn-meta{display:grid;grid-template-columns:1fr 1fr}.rld-session-workbench-header{grid-template-columns:1fr}.rld-session-workbench-header>button{justify-self:start}.rld-session-workbench-header>strong{justify-self:start}.rld-session-workbench-grid{display:block}.rld-session-plan{border-right:0}.rld-session-frozen dl{grid-template-columns:1fr 1fr;gap:12px}.rld-session-variant-head,.rld-session-variant{min-width:600px}.rld-session-variants{overflow:auto}}
.rld-session-history{border-bottom:1px solid var(--rld-border)}.rld-session-history>header{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:40px;padding:0 14px;border-bottom:1px solid #e9edf3}.rld-session-history>header span{color:var(--rld-muted);font-size:9px}.rld-session-history>div{display:flex;overflow:auto}.rld-session-history button{display:flex;min-width:170px;flex-direction:column;gap:2px;padding:8px 10px;border:0;border-right:1px solid #e9edf3;background:#fff;color:var(--rld-text);text-align:left;cursor:pointer}.rld-session-history button[aria-pressed=true]{background:#eef4ff;box-shadow:inset 0 -2px var(--rld-blue)}.rld-session-history button strong{font-size:9px}.rld-session-history button span{color:var(--rld-muted);font-size:7px}
.rld-session-history button em{align-self:flex-start;padding:1px 4px;border-radius:999px;background:#fff4e5;color:#9a6700;font-size:7px;font-style:normal;font-weight:700}.rld-session-drift-notice{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid #f2d29b;background:#fffaf0;color:#7a4d00}.rld-session-drift-notice strong{font-size:9px}.rld-session-drift-notice span{font-size:8px}.rld-session-drift-notice code{font-size:7px;white-space:nowrap}
.rld-turn-index>span,.rld-turn-index>small,.rld-turn-meta small,.rld-turn-action small,.rld-session-frozen>header code,.rld-session-frozen dt,.rld-session-variants>header span,.rld-session-scorecard>header span,.rld-session-variant-head,.rld-session-variant small,.rld-session-variant code,.rld-session-variant>span:nth-child(3),.rld-session-variant em,.rld-session-run-control p,.rld-session-evidence>header strong,.rld-session-evidence dt,.rld-session-evidence>p,.rld-session-history>header span,.rld-session-drift-notice strong,.rld-session-drift-notice span{font-size:10px}.rld-turn-meta strong,.rld-session-variant strong,.rld-session-evidence h4{font-size:11px}.rld-session-evidence dd{font-size:10px}.rld-session-metrics small,.rld-session-history button span,.rld-session-history button em,.rld-session-drift-notice code{font-size:9px}.rld-session-history button strong,.rld-session-scorecard thead th{font-size:10px}.rld-session-scorecard>p{font-size:10px}.rld-session-scorecard table{font-size:11px}

.rld-result{padding:16px 18px 28px;background:#fff}
.rld-result-section{margin-top:12px;border:1px solid var(--rld-border);border-radius:5px;background:#fff;overflow:hidden}.rld-result-section>header{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:44px;padding:0 14px;border-bottom:1px solid var(--rld-border);background:#fbfcfe}.rld-result-section h3{font-size:13px}.rld-result-section>header span{color:var(--rld-muted);font-size:10px}.rld-result-table-scroll{max-width:100%;overflow:auto}.rld-result-section table{width:100%;min-width:760px;border-collapse:collapse;font-size:11px}.rld-result-section th,.rld-result-section td{padding:9px 14px;border-right:1px solid #e9edf3;border-bottom:1px solid #e9edf3;text-align:left;vertical-align:top}.rld-result-section th:last-child,.rld-result-section td:last-child{border-right:0}.rld-result-section tbody tr:last-child>*{border-bottom:0}.rld-result-section thead th{background:#fff;color:var(--rld-muted);font-size:10px;font-weight:650}.rld-result-section tbody th{width:21%;color:#27364b;font-size:11px;font-weight:650}.rld-result-section tbody td{color:#344054}.rld-result-section td[data-status=match]{color:#087443;font-weight:700}.rld-result-section td[data-status=mismatch]{color:#b54708;font-weight:700}.rld-result-section td[data-status=unknown]{color:#667085;font-weight:650}.rld-result-empty{color:#98a2b3}.rld-result-hashes{display:flex;flex-wrap:wrap;gap:4px}.rld-result-hashes code,.rld-result-tools code{padding:2px 5px;border-radius:3px;background:#f2f4f7;color:#344054;font:500 10px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace}.rld-result-tools{display:flex;flex-wrap:wrap;gap:4px}.rld-result-execution table{font-size:12px}.rld-result-execution th,.rld-result-execution td{padding-top:10px;padding-bottom:10px;text-align:right}.rld-result-execution th:first-child{text-align:left}.rld-result-execution .rld-result-candidate{background:#f5f8ff;color:#1d4ed8;font-weight:700}.rld-result-execution td[data-tone]{font-weight:750}.rld-result-execution td[data-tone=increase]{background:#fff4e5;color:#b54708}.rld-result-execution td[data-tone=decrease]{background:#ecfdf3;color:#067647}.rld-result-execution td[data-tone=unchanged]{background:#f2f4f7;color:#475467}.rld-result-execution td[data-tone=neutral]{background:#f8fafc;color:#344054}.rld-result-neutral-note{margin:0;padding:9px 14px;border-top:1px solid #e9edf3;background:#fbfcfe;color:var(--rld-muted);font-size:10px}.rld-result-execution>p.rld-session-muted{margin:0;padding:18px}
.rld-result-runs>header{min-height:52px}.rld-result-runs>header h3{font-size:15px}.rld-result-runs>header span{font-size:12px}.rld-result-runs table{width:max-content;min-width:100%;font-size:13px}.rld-result-runs thead th:first-child{min-width:160px}.rld-result-runs thead th:not(:first-child){min-width:200px}.rld-result-runs thead th{vertical-align:bottom}.rld-result-runs thead th>strong,.rld-result-runs thead th>small{display:block}.rld-result-runs thead th>strong{color:#27364b;font-size:13px}.rld-result-runs thead th>small{margin-top:3px;color:var(--rld-muted);font-size:11px;font-weight:400}.rld-result-runs tbody th{font-size:12px}.rld-result-runs th[data-active],.rld-result-runs td[data-active]{background:#f5f8ff}.rld-result-runs td{min-width:200px}.rld-result-runs td>strong{display:block;margin-bottom:7px;color:#344054;font-size:13px;font-variant-numeric:tabular-nums}.rld-result-runs td[data-active]>strong{color:#1d4ed8}.rld-result-runs>.rld-result-neutral-note{font-size:11px}.rld-result-bar{display:block;height:9px;overflow:hidden;border-radius:2px;background:#edf0f5}.rld-result-bar>span{display:block;height:100%;border-radius:2px;background:#98a2b3}.rld-result-runs td[data-kind=candidate] .rld-result-bar>span{background:#6f91dc}.rld-result-runs td[data-active] .rld-result-bar>span{background:var(--rld-blue)}
.rld-result-disclosure{margin-top:10px;border:1px solid var(--rld-border);border-radius:5px;background:#fff;overflow:hidden}.rld-result-saved-disclosure{margin-top:0}.rld-result-disclosure>summary{position:relative;display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:44px;padding:0 14px;cursor:pointer;list-style:none}.rld-result-disclosure>summary::-webkit-details-marker{display:none}.rld-result-disclosure>summary::after{content:'⌄';color:#667085;font-size:15px;transition:transform .15s ease}.rld-result-disclosure[open]>summary::after{transform:rotate(180deg)}.rld-result-disclosure>summary strong{font-size:12px}.rld-result-disclosure>summary span{margin-left:auto;color:var(--rld-muted);font-size:10px}.rld-result-saved-disclosure>summary>span[data-status=completed]{color:#087443;font-weight:700}.rld-result-saved-disclosure>summary>span[data-status=failed],.rld-result-saved-disclosure>summary>span[data-status=aborted]{color:#b42318;font-weight:700}.rld-result-disclosure[open]>summary{border-bottom:1px solid var(--rld-border);background:#fbfcfe}.rld-result-disclosure .rld-session-evidence-grid{border-bottom:0}.rld-result-disclosure .rld-session-evidence{padding:16px}.rld-result-download{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:10px 14px;border-bottom:1px solid var(--rld-border);background:#fff}.rld-result-download>span{display:flex;min-width:0;flex-direction:column;gap:2px}.rld-result-download small{color:var(--rld-muted);font-size:9px}.rld-result-download code{overflow:hidden;color:#344054;font:500 10px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;text-overflow:ellipsis;white-space:nowrap}.rld-result-download>a{display:inline-flex;flex:0 0 auto;min-height:32px;align-items:center;padding:0 12px;border:1px solid #b9c7da;border-radius:4px;background:#fff;color:#1d4ed8;font-size:10px;font-weight:700;text-decoration:none}.rld-result-download>a:hover{background:#eef4ff}.rld-result-download>a:focus-visible{outline:2px solid var(--rld-blue);outline-offset:2px}.rld-result-setup-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.05fr)}.rld-result-setup-grid>.rld-session-frozen{border-right:1px solid var(--rld-border);border-bottom:0}.rld-result-setup-grid>.rld-session-variants{min-width:0;border-bottom:0;overflow:auto}.rld-result-setup-grid .rld-session-frozen dl{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.rld-result-setup-grid .rld-session-variant-head,.rld-result-setup-grid .rld-session-variant{grid-template-columns:1.2fr 1fr 1fr 76px}.rld-result-history-list{display:flex;overflow:auto}.rld-result-history-list button{display:flex;min-width:250px;align-items:center;justify-content:space-between;gap:14px;padding:11px 14px;border:0;border-right:1px solid #e9edf3;background:#fff;color:var(--rld-text);text-align:left;cursor:pointer}.rld-result-history-list button:hover{background:#f8fafc}.rld-result-history-list button[aria-pressed=true]{background:#eef4ff;box-shadow:inset 0 -2px var(--rld-blue)}.rld-result-history-list button>span{display:flex;min-width:0;flex-direction:column;gap:2px}.rld-result-history-list button>span:last-child{align-items:flex-end}.rld-result-history-list button strong{font-size:11px}.rld-result-history-list button small{color:var(--rld-muted);font-size:9px}.rld-result-history-list button em{color:#667085;font-size:9px;font-style:normal;font-weight:700;text-transform:uppercase}.rld-result-history-list button em[data-status=completed]{color:#087443}.rld-result-history-list button em[data-drift]{color:#b54708;text-transform:none}.rld-result-saved-setup{margin:10px 14px}.rld-session-run>.rld-session-evidence{border-right:0;border-bottom:1px solid var(--rld-border)}
@media(max-width:820px){.rld-result{padding:12px}.rld-result-section>header{align-items:flex-start;flex-direction:column;gap:2px;padding-top:10px;padding-bottom:10px}.rld-result-section table{min-width:720px}.rld-result-disclosure>summary{align-items:flex-start;flex-wrap:wrap;gap:2px;padding-top:10px;padding-bottom:10px}.rld-result-disclosure>summary span{width:calc(100% - 24px);margin-left:0}.rld-result-disclosure>summary::after{position:absolute;right:26px}.rld-result-setup-disclosure>summary{align-items:center;flex-wrap:nowrap;gap:10px;padding-top:0;padding-bottom:0}.rld-result-setup-disclosure>summary strong{white-space:nowrap}.rld-result-setup-disclosure>summary span{width:auto;margin-left:auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.rld-result-download{align-items:stretch;flex-direction:column;gap:8px}.rld-result-download>a{align-self:flex-start}.rld-result-setup-grid{display:block}.rld-result-setup-grid>.rld-session-frozen{border-right:0;border-bottom:1px solid var(--rld-border)}.rld-result-setup-grid .rld-session-variant-head,.rld-result-setup-grid .rld-session-variant{min-width:600px}.rld-result-history-list{display:block}.rld-result-history-list button{width:100%;min-width:0;border-right:0;border-bottom:1px solid #e9edf3}.rld-session-evidence-grid{grid-template-columns:1fr}.rld-session-evidence{border-right:0;border-bottom:1px solid var(--rld-border)}.rld-session-evidence:last-child{border-bottom:0}}
@media(max-width:820px){.rld-session-workbench-header[data-result]{grid-template-columns:minmax(0,1fr) auto;gap:8px 10px;padding:10px 12px}.rld-session-workbench-header[data-result]>button{grid-column:1/-1;justify-self:start}.rld-session-workbench-header[data-result]>div{grid-column:1;min-width:0}.rld-session-workbench-header[data-result]>strong{grid-column:2;align-self:end;justify-self:end}}

`;
		const ID = "@tbxy09/dsh-replay-lab/styles";
		function injectStyles() {
			if (typeof document === "undefined") return () => {};
			if (document.querySelector(`style[data-plugin-css="${ID}"]`) !== null) return () => {};
			const tag = document.createElement("style");
			tag.dataset.pluginCss = ID;
			tag.textContent = CSS;
			document.head.appendChild(tag);
			return () => {
				tag.remove();
			};
		}
		//#endregion
		//#region src/client/index.ts
		const inject = ["slots", "sessions"];
		function apply(ctx) {
			ctx.effect(injectStyles, "replay-lab-dsh: styles");
			const controllers = /* @__PURE__ */ new Map();
			const controllerFor = (sessionId) => {
				const existing = controllers.get(sessionId);
				if (existing !== void 0) return existing;
				const controller = new ReplayLabController("/replay-lab-dsh", sessionId);
				controllers.set(sessionId, controller);
				return controller;
			};
			ctx.slots.inject("conversation.view", () => ctx.slots.register({
				name: "conversation.view",
				id: "replay-lab-dsh",
				order: 50,
				label: "Replay",
				inject: () => ({ controllerFor })
			}, SessionReplayTab));
		}
		//#endregion
		exports.ReplayLabController = ReplayLabController;
		exports.SessionReplayTab = SessionReplayTab;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map
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
		function EvidenceSummary({ title, evidence }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "rld-session-evidence",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", { children: title }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
					"data-status": evidence?.status,
					children: evidence?.status ?? "Not run"
				})] }), evidence === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: "rld-session-muted",
					children: "No independent evidence yet."
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dl", { children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "Session" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", {
						title: evidence.sessionId,
						children: evidence.sessionId
					})] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "Request phase" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: evidence.requestPhases.join(" → ") || "—" })] }),
					evidence.requestSurfaces?.map((surface, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dt", { children: [surface.phase, " tools"] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", {
						title: surface.toolNames.join(", "),
						children: surface.toolNames.join(", ") || "No tools"
					})] }, `${surface.phase}-${index}`)),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "Events" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: evidence.eventCount })] })
				] }), evidence.metrics === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
					className: "rld-session-warning",
					role: "status",
					children: ["Evidence unavailable: ", evidence.missingReason ?? "incomplete event stream"]
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "rld-session-metrics",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: "Fresh input" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: evidence.metrics.freshInputTokens })] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: "Output" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: evidence.metrics.outputTokens })] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: "Cache read" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: evidence.metrics.cacheReadTokens })] })
					]
				})] })]
			});
		}
		function ScorecardTable({ scorecard, missingReason }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "rld-session-scorecard",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: "Scorecard" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "Independent evidence only" })] }), scorecard === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: "rld-session-muted",
					children: missingReason ?? "Generated after the candidate produces complete evidence."
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("table", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: "Metric" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: "Baseline" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: "Candidate" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: "Delta" })
				] }) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tbody", { children: scorecard.rows.map((row) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: row.label }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: row.baseline }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: row.candidate }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("td", { children: [row.delta > 0 ? "+" : "", row.delta] })
				] }, row.key)) })] })]
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
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: variant.pluginSurface }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: variant.requestPhases.join(" → ") || "—" }),
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
			if (replayCase === void 0 || replayCase.sourceSessionId !== sessionId) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "rld-session-workbench",
				"data-testid": "session-replay-workbench",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
						className: "rld-session-workbench-header",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								onClick: onBack,
								children: "← Choose another turn"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("h2", { children: ["Current session · Turn ", replayCase.sourceTurn] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "This observed baseline is fixed. Choose one isolated candidate, then explicitly approve its run." })] }),
							displayedExperiment !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
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
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "rld-session-workbench-grid",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "rld-session-plan",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
								className: "rld-session-frozen",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: "Observed baseline request" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: replayCase.id })] }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("blockquote", { children: replayCase.prompt }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dl", { children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "Model" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: replayCase.model })] }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "Reasoning" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: replayCase.reasoning })] }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "Max tokens" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: replayCase.maxTokens })] }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "Preset" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: replayCase.presetSurface })] }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "Source workspace" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", {
											title: replayCase.sourceCwd,
											children: replayCase.sourceCwd
										})] })
									] })
								]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
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
										selected: experiment?.candidateVariantId === variant.id,
										onSelect: () => {
											controller.plan(variant.id);
										}
									}, variant.id))
								]
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("aside", {
							className: "rld-session-run",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
									className: "rld-session-run-control",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: "Run comparison" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "The baseline is already observed; only the candidate executes." })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										disabled: experiment?.status !== "planned",
										onClick: () => {
											controller.approveRun();
										},
										children: "Approve candidate run"
									})]
								}),
								history.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
									className: "rld-session-history",
									"aria-label": "Saved replay runs",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: "Saved runs" }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [history.length, " retained for this turn"] })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: history.map((entry) => {
										const variant = variants.find((item) => item.id === entry.experiment.candidateVariantId);
										return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
											type: "button",
											"aria-pressed": displayedExperiment?.id === entry.experiment.id,
											onClick: () => {
												setViewingId(entry.experiment.id);
											},
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: variant?.label ?? entry.experiment.candidateVariantId }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
												statusLabel[entry.experiment.status],
												" · ",
												new Date(entry.experiment.updatedAt).toLocaleString()
											] })]
										}, entry.experiment.id);
									}) })]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "rld-session-evidence-grid",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(EvidenceSummary, {
										title: `Current session · Turn ${replayCase.sourceTurn}`,
										evidence: displayedExperiment?.baseline ?? replayCase.observedBaseline
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(EvidenceSummary, {
										title: "Candidate replay",
										evidence: displayedExperiment?.candidate
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ScorecardTable, {
									scorecard: displayedExperiment?.scorecard,
									missingReason: displayedExperiment?.scorecardMissingReason
								})
							]
						})]
					})
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
													/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: "Max tokens" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: item.maxTokens ?? "Unavailable" })] }),
													/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: "Steps" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: item.stepCount })] })
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
.rld-tab,.rld-session-workbench{--rld-blue:#245fda;--rld-text:#1b2433;--rld-muted:#667085;--rld-border:#d9dee8;--rld-soft:#f6f8fb;min-height:100%;background:#fff;color:var(--rld-text);font:400 12px/1.45 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.rld-tab *,.rld-session-workbench *{box-sizing:border-box}.rld-tab button,.rld-session-workbench button{font:inherit}.rld-tab-header{position:sticky;top:0;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:24px;min-height:72px;padding:14px 18px;border-bottom:1px solid var(--rld-border);background:rgba(255,255,255,.96);backdrop-filter:blur(8px)}.rld-tab-header h2,.rld-session-workbench h2,.rld-session-workbench h3,.rld-session-workbench h4{margin:0}.rld-tab-header h2{font-size:17px;letter-spacing:-.015em}.rld-tab-header p{margin:3px 0 0;color:var(--rld-muted);font-size:11px}.rld-tab-summary{display:flex;align-items:center;gap:14px;color:var(--rld-muted);white-space:nowrap}.rld-tab-summary span{display:flex;align-items:baseline;gap:4px}.rld-tab-summary strong{color:var(--rld-text);font-size:14px}.rld-tab-summary button,.rld-session-workbench-header>button{height:30px;padding:0 10px;border:1px solid var(--rld-border);border-radius:5px;background:#fff;color:#344054;cursor:pointer}.rld-tab-summary button:hover,.rld-session-workbench-header>button:hover{background:var(--rld-soft)}.rld-tab-summary button:disabled{cursor:wait;opacity:.6}.rld-tab-empty{display:flex;min-height:280px;flex-direction:column;align-items:center;justify-content:center;padding:32px;color:var(--rld-muted);text-align:center}.rld-tab-empty h3{margin:0;color:var(--rld-text);font-size:14px}.rld-tab-empty p{margin:5px 0 0}.rld-turn-list{margin:0;padding:0;list-style:none}.rld-turn-row{display:grid;grid-template-columns:76px minmax(0,1fr) 180px;gap:18px;min-height:132px;padding:16px 18px;border-bottom:1px solid #e9edf3;background:#fff}.rld-turn-row:hover{background:#fbfcfe}.rld-turn-row[data-ready]{box-shadow:inset 3px 0 var(--rld-blue)}.rld-turn-index{display:flex;flex-direction:column;align-items:flex-start;padding-top:2px;color:var(--rld-muted);text-transform:uppercase}.rld-turn-index>span{font-size:9px;font-weight:700;letter-spacing:.08em}.rld-turn-index>strong{margin-top:-2px;color:var(--rld-text);font-size:28px;line-height:1.1;letter-spacing:-.04em}.rld-turn-index>small{margin-top:5px;color:#18a558;font-size:9px;font-weight:650;text-transform:none}.rld-turn-content{min-width:0}.rld-turn-meta{display:flex;align-items:flex-start;gap:22px;margin-bottom:10px}.rld-turn-meta span{display:flex;min-width:70px;flex-direction:column;gap:1px}.rld-turn-meta small{color:var(--rld-muted);font-size:8px;text-transform:uppercase;letter-spacing:.05em}.rld-turn-meta strong{overflow:hidden;max-width:180px;font:600 10px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;text-overflow:ellipsis;white-space:nowrap}.rld-turn-prompt{display:-webkit-box;margin:0;overflow:hidden;color:#344054;font-size:12px;line-height:1.55;white-space:pre-wrap;-webkit-box-orient:vertical;-webkit-line-clamp:3}.rld-turn-missing{margin:9px 0 0;color:#9a6700;font-size:10px}.rld-turn-action{display:flex;flex-direction:column;align-items:stretch;justify-content:center;gap:6px}.rld-turn-action button{height:32px;border:1px solid #1e55bd;border-radius:5px;background:var(--rld-blue);color:#fff;font-weight:650;cursor:pointer}.rld-turn-action button:hover{background:#194fac}.rld-turn-action button:disabled{border-color:#d0d5dd;background:#e4e7ec;color:#98a2b3;cursor:not-allowed}.rld-turn-action small{color:var(--rld-muted);font-size:9px;text-align:center}.rld-tab-history-note{padding:12px 18px;border-top:1px solid var(--rld-border);background:#fbfcfe;color:var(--rld-muted);font-size:10px}.rld-session-muted{color:var(--rld-muted)!important}.rld-session-error{padding:9px 16px;border-bottom:1px solid #f2b8b5;background:#fff3f2;color:#b42318}.rld-session-workbench-header{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:16px;min-height:72px;padding:12px 18px;border-bottom:1px solid var(--rld-border)}.rld-session-workbench-header h2{font-size:17px}.rld-session-workbench-header p{margin:3px 0 0;color:var(--rld-muted);font-size:11px}.rld-session-workbench-header>strong{padding:5px 8px;border-left:3px solid #98a2b3;background:var(--rld-soft);font-size:10px}.rld-session-workbench-header>strong[data-status=completed]{border-color:#18a558}.rld-session-workbench-header>strong[data-status=running]{border-color:var(--rld-blue)}.rld-session-workbench-header>strong[data-status=failed],.rld-session-workbench-header>strong[data-status=aborted]{border-color:#d92d20}.rld-session-workbench-grid{display:grid;grid-template-columns:minmax(520px,1fr) minmax(360px,430px);min-height:calc(100vh - 160px)}.rld-session-plan{min-width:0;border-right:1px solid var(--rld-border)}.rld-session-frozen,.rld-session-variants,.rld-session-scorecard{border-bottom:1px solid var(--rld-border)}.rld-session-frozen>header,.rld-session-variants>header,.rld-session-scorecard>header{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:40px;padding:0 14px;border-bottom:1px solid #e9edf3}.rld-session-frozen h3,.rld-session-variants h3,.rld-session-scorecard h3,.rld-session-run h3{font-size:12px}.rld-session-frozen>header code{overflow:hidden;max-width:260px;color:var(--rld-muted);font-size:9px;text-overflow:ellipsis;white-space:nowrap}.rld-session-frozen blockquote{margin:0;padding:16px 18px;border:0;color:#27364b;font-size:13px;line-height:1.6}.rld-session-frozen dl{display:grid;grid-template-columns:repeat(4,1fr);margin:0;padding:0 18px 16px}.rld-session-frozen dl>div{min-width:0;border-left:1px solid var(--rld-border);padding-left:10px}.rld-session-frozen dt{color:var(--rld-muted);font-size:8px;text-transform:uppercase;letter-spacing:.05em}.rld-session-frozen dd{margin:2px 0 0;overflow:hidden;font:600 10px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;text-overflow:ellipsis;white-space:nowrap}.rld-session-variants>header span,.rld-session-scorecard>header span{color:var(--rld-muted);font-size:9px}.rld-session-variant-head,.rld-session-variant{display:grid;grid-template-columns:1.35fr 1.2fr 1fr 78px;align-items:center;gap:10px;padding:8px 14px}.rld-session-variant-head{border-bottom:1px solid #e9edf3;color:var(--rld-muted);font-size:8px;font-weight:650;text-transform:uppercase}.rld-session-variant{width:100%;border:0;border-bottom:1px solid #eef1f6;background:#fff;color:var(--rld-text);text-align:left;cursor:pointer}.rld-session-variant:hover{background:#f7f9fc}.rld-session-variant[aria-pressed=true]{background:#eef4ff;box-shadow:inset 3px 0 var(--rld-blue)}.rld-session-variant:disabled{cursor:default;opacity:.62}.rld-session-variant>span:first-child{display:flex;align-items:center;gap:6px}.rld-session-variant strong{font-size:10px}.rld-session-variant small{color:var(--rld-muted);font-size:8px}.rld-session-variant code{overflow:hidden;color:var(--rld-muted);font-size:9px;text-overflow:ellipsis;white-space:nowrap}.rld-session-variant>span:nth-child(3){font-size:9px}.rld-session-variant em{justify-self:end;color:#d92d20;font-size:8px;font-style:normal;font-weight:650}.rld-session-variant em[data-supported=true]{color:#18a558}.rld-session-run{min-width:0;background:#fbfcfe}.rld-session-run-control{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px;border-bottom:1px solid var(--rld-border)}.rld-session-run-control p{margin:3px 0 0;color:var(--rld-muted);font-size:9px}.rld-session-run-control>button{height:32px;padding:0 12px;border:1px solid #1e55bd;border-radius:5px;background:var(--rld-blue);color:#fff;font-weight:650;cursor:pointer}.rld-session-run-control>button:disabled{border-color:#d0d5dd;background:#e4e7ec;color:#98a2b3;cursor:not-allowed}.rld-session-evidence-grid{display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid var(--rld-border)}.rld-session-evidence{min-width:0;padding:12px;border-right:1px solid var(--rld-border)}.rld-session-evidence:last-child{border-right:0}.rld-session-evidence>header{display:flex;align-items:center;justify-content:space-between;gap:8px}.rld-session-evidence h4{font-size:11px}.rld-session-evidence>header strong{color:var(--rld-muted);font-size:8px;text-transform:uppercase}.rld-session-evidence>header strong[data-status=completed]{color:#18a558}.rld-session-evidence dl{margin:10px 0 0}.rld-session-evidence dl>div{display:grid;grid-template-columns:66px minmax(0,1fr);gap:6px;margin:5px 0}.rld-session-evidence dt{color:var(--rld-muted);font-size:8px}.rld-session-evidence dd{margin:0;overflow:hidden;font:500 8px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;text-overflow:ellipsis;white-space:nowrap}.rld-session-evidence>p{margin:12px 0 0;font-size:9px}.rld-session-warning{padding:7px;border-left:3px solid #f79009;background:#fffaeb;color:#93370d}.rld-session-metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:5px;margin-top:10px}.rld-session-metrics span{display:flex;min-width:0;flex-direction:column;padding:5px;border:1px solid var(--rld-border);background:#fff}.rld-session-metrics small{overflow:hidden;color:var(--rld-muted);font-size:7px;text-overflow:ellipsis;white-space:nowrap}.rld-session-metrics strong{font-size:11px}.rld-session-scorecard>p{margin:0;padding:14px;font-size:9px}.rld-session-scorecard table{width:100%;border-collapse:collapse;font-size:9px}.rld-session-scorecard th,.rld-session-scorecard td{padding:6px 10px;border-bottom:1px solid #eef1f6;text-align:right}.rld-session-scorecard th:first-child{text-align:left}.rld-session-scorecard thead th{color:var(--rld-muted);font-size:8px}
@media(max-width:1100px){.rld-workbench{grid-template-columns:210px minmax(430px,1fr) 350px}.rld-topbar p{display:none}.rld-frozen dl>div{grid-template-columns:155px}.rld-matrix-head,.rld-variant-row{grid-template-columns:130px 150px 130px 60px}.rld-turn-row{grid-template-columns:64px minmax(0,1fr) 150px}.rld-turn-meta{gap:14px}.rld-session-workbench-grid{grid-template-columns:minmax(460px,1fr) 350px}}@media(max-width:820px){.rld-workbench{display:block;overflow:auto}.rld-sources,.rld-center,.rld-execution{overflow:visible;border:0}.rld-sources{min-height:280px}.rld-source-list{max-height:240px}.rld-topbar{position:sticky;top:0;z-index:2}.rld-evidence-column{min-height:150px}.rld-matrix{overflow:auto}.rld-matrix-head,.rld-variant-row{min-width:580px}.rld-tab-header{position:static;align-items:flex-start;flex-direction:column;gap:10px}.rld-tab-summary{width:100%;flex-wrap:wrap}.rld-turn-row{grid-template-columns:50px minmax(0,1fr)}.rld-turn-action{grid-column:2;align-items:flex-start}.rld-turn-action button{min-width:150px}.rld-turn-action small{text-align:left}.rld-turn-meta{display:grid;grid-template-columns:1fr 1fr}.rld-session-workbench-header{grid-template-columns:1fr}.rld-session-workbench-header>button{justify-self:start}.rld-session-workbench-header>strong{justify-self:start}.rld-session-workbench-grid{display:block}.rld-session-plan{border-right:0}.rld-session-frozen dl{grid-template-columns:1fr 1fr;gap:12px}.rld-session-variant-head,.rld-session-variant{min-width:600px}.rld-session-variants{overflow:auto}}
.rld-session-history{border-bottom:1px solid var(--rld-border)}.rld-session-history>header{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:40px;padding:0 14px;border-bottom:1px solid #e9edf3}.rld-session-history>header span{color:var(--rld-muted);font-size:9px}.rld-session-history>div{display:flex;overflow:auto}.rld-session-history button{display:flex;min-width:170px;flex-direction:column;gap:2px;padding:8px 10px;border:0;border-right:1px solid #e9edf3;background:#fff;color:var(--rld-text);text-align:left;cursor:pointer}.rld-session-history button[aria-pressed=true]{background:#eef4ff;box-shadow:inset 0 -2px var(--rld-blue)}.rld-session-history button strong{font-size:9px}.rld-session-history button span{color:var(--rld-muted);font-size:7px}

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
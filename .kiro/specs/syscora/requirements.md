# Requirements Document

## Introduction

SYSCORA (System Cognitive Reasoning Architecture) is a production-grade AI operating layer that inverts the traditional OS interaction model. Rather than requiring users to navigate applications, menus, and command interfaces, SYSCORA accepts a natural-language objective, reasons about the current system state, constructs a typed execution plan, assesses risk, obtains required permissions and approvals, executes actions through a deterministic execution boundary, verifies outcomes, recovers from failures, and explains results in natural language.

SYSCORA is not a chatbot, a shell-command generator, or a thin LLM wrapper. It is a commercial software platform with a local-first architecture, a deterministic policy and permission layer the LLM cannot override, a full audit trail, structured memory, and a multi-tier commercial deployment model. The initial target platform is Ubuntu Linux, with the architecture designed from the start to support Windows and macOS adapters.

This document defines the requirements for the complete SYSCORA platform across its 32 subsystems, organized by functional area. Requirements are expressed using EARS patterns and comply with INCOSE quality rules.

---

## Glossary

- **SYSCORA**: The overall system being specified — System Cognitive Reasoning Architecture.
- **Agent_Runtime**: The event-driven state machine that drives the full lifecycle of an intent from receipt to completion.
- **Intent**: A natural-language expression of an objective submitted by a user.
- **UserIntent**: The structured domain model representing a parsed user objective.
- **Goal**: A decomposed, structured target state derived from a UserIntent.
- **Task**: A discrete unit of work within a TaskGraph, mapped to one or more Actions.
- **Action**: A typed, fully-declared executable operation that passes through the Execution_Engine.
- **ActionResult**: The structured outcome of an executed Action including status, outputs, and observations.
- **TaskGraph**: A directed acyclic graph (DAG) of Tasks with declared dependencies.
- **ExecutionPlan**: A validated, policy-checked, risk-assessed plan composed of a TaskGraph and associated metadata.
- **Capability**: A registered, typed unit of system functionality the Planner may select and the Execution_Engine may invoke.
- **Capability_Registry**: The authoritative catalogue of all registered Capabilities.
- **Tool_Router**: The subsystem that selects the safest available mechanism for a given Capability invocation.
- **Policy_Engine**: The deterministic subsystem that makes allow/deny/escalate decisions for Actions. The LLM cannot override its decisions.
- **Permission_Broker**: The subsystem that manages least-privilege access and controlled escalation for elevated operations.
- **Risk_Engine**: The subsystem that assesses risk dimensions for Actions and produces structured RiskAssessments.
- **RiskAssessment**: A structured record of risk dimension scores, overall score, confidence, evidence, affected entities, predicted state changes, and mitigations for an Action.
- **Execution_Engine**: The subsystem that validates, precondition-checks, policy-checks, checkpoints, executes, observes, and verifies each Action.
- **Observation_Engine**: The subsystem that converts raw execution output into structured Observations.
- **Verification_Engine**: The subsystem that confirms whether an Action's intended effect actually occurred.
- **Recovery_Engine**: The subsystem that classifies failures and selects recovery strategies.
- **Rollback_Engine**: The subsystem that reverts system state to a known-good checkpoint.
- **Sandbox_Manager**: The subsystem that executes untrusted or risky operations in isolated environments using Linux namespaces and containers.
- **Semantic_OS_State_Engine**: The graph-based subsystem that maintains a typed, versioned model of system entities and their relationships.
- **Knowledge_Graph**: The persistent graph store backing the Semantic_OS_State_Engine.
- **Memory_System**: The multi-tier subsystem managing working, episodic, semantic, preference, procedural, and system history memory.
- **Intent_Understanding_Engine**: The subsystem that parses, disambiguates, and structures a raw UserIntent into Goals and Constraints.
- **Context_Engine**: The subsystem that assembles the ResolvedContext required for planning from available memory, system state, and integrations.
- **Planner**: The subsystem that decomposes Goals into a validated TaskGraph using registered Capabilities.
- **Audit_System**: The append-only event stream and query layer that records every significant event in the SYSCORA lifecycle.
- **Credential_Broker**: The subsystem that manages secrets and credentials, providing opaque references to the Agent_Runtime without exposing secret values.
- **Application_Integration_Framework**: The subsystem providing a uniform ApplicationAdapter interface for all integrated applications and services.
- **Browser_Automation_Layer**: The subsystem that automates browser interactions via extension, CDP, and accessibility APIs.
- **Desktop_Automation_Layer**: The subsystem that automates GUI interactions using Linux accessibility APIs.
- **Developer_Workspace_Intelligence**: The subsystem that discovers, inspects, and understands developer projects and environments.
- **Background_Task_Scheduler**: The subsystem that manages recurring and deferred task execution.
- **Notification_System**: The subsystem that delivers status and approval notifications to the user.
- **Extension_SDK**: The framework through which third-party capabilities are packaged and registered.
- **Local_API**: The versioned gRPC/Unix domain socket/WebSocket interface through which local clients interact with the Agent_Runtime daemon.
- **Desktop_Client**: The Tauri-based desktop application providing the primary user interface.
- **Daemon**: The background process hosting the Agent_Runtime, Local_API, and all core subsystems.
- **OS_Adapter**: The platform-specific implementation layer abstracting OS-level operations for Linux, Windows, and macOS.
- **Checkpoint**: A persistent snapshot of system state taken before a reversible Action, used as the basis for rollback.
- **ConfirmationLevel**: An enumeration of required user interaction levels: NONE, AUDIT, CONFIRM, REAUTHENTICATE, ELEVATE, SANDBOX, DENY.
- **RiskLevel**: An enumeration of action risk tiers: LOW, MEDIUM, HIGH, CRITICAL.
- **AuditEvent**: A single structured, immutable record appended to the Audit_System's event stream.
- **MemoryRecord**: A single entry in the Memory_System with provenance, confidence score, timestamp, expiration policy, sensitivity, and user visibility.
- **Workspace**: A project-specific context grouping associated files, processes, environment variables, tools, and history.
- **GraphStore**: The storage interface for the Knowledge_Graph, with a local-first embedded implementation and an optional Neo4j adapter.
- **LLM_Provider**: An adapter implementing the LanguageModelProvider interface for a specific cloud or local model provider.
- **Secret_Reference**: An opaque token passed to the Agent_Runtime in place of a raw credential value.

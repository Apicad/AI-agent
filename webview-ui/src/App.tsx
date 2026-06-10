import { useCallback, useEffect, useRef, useState } from 'react';

import { toMajorMinor } from './changelogData.js';
import { ActivitySidebar } from './components/ActivitySidebar.js';
import { AdminRoomsPanel } from './components/AdminRoomsPanel.js';
import { AgentNetworkCanvas } from './components/AgentNetworkCanvas.js';
import { BottomToolbar } from './components/BottomToolbar.js';
import { PreviewPane } from './components/PreviewPane.js';
import { ChangelogModal } from './components/ChangelogModal.js';
import { DebugView } from './components/DebugView.js';
import { EditActionBar } from './components/EditActionBar.js';
import { FleetPanel } from './components/FleetPanel.js';
import { FurnitureLibraryPanel } from './components/FurnitureLibraryPanel.js';
import { MeetingPanel } from './components/MeetingPanel.js';
import { MigrationNotice } from './components/MigrationNotice.js';
import type { NewAgentConfig } from './components/NewAgentModal.js';
import { NewAgentModal } from './components/NewAgentModal.js';
import { PhaseReviewModal } from './components/PhaseReviewModal.js';
import { RoomsModal } from './components/RoomsModal.js';
import { SettingsModal } from './components/SettingsModal.js';
import { Tooltip } from './components/Tooltip.js';
import { Modal } from './components/ui/Modal.js';
import { VersionIndicator } from './components/VersionIndicator.js';
import { ZoomControls } from './components/ZoomControls.js';
import { useEditorActions } from './hooks/useEditorActions.js';
import { useEditorKeyboard } from './hooks/useEditorKeyboard.js';
import type { ChatMessage } from './hooks/useExtensionMessages.js';
import { useExtensionMessages } from './hooks/useExtensionMessages.js';
import { OfficeCanvas } from './office/components/OfficeCanvas.js';
import { ToolOverlay } from './office/components/ToolOverlay.js';
import { EditorState } from './office/editor/editorState.js';
import { playGateSound } from './notificationSound.js';
import { EditorToolbar } from './office/editor/EditorToolbar.js';
import { OfficeState } from './office/engine/officeState.js';
import { isRotatable } from './office/layout/furnitureCatalog.js';
import { EditTool } from './office/types.js';
import { isBrowserRuntime, isStandaloneRuntime } from './runtime.js';
import { vscode } from './vscodeApi.js';

// Game state lives outside React — updated imperatively by message handlers
const officeStateRef = { current: null as OfficeState | null };
const editorState = new EditorState();

function getOfficeState(): OfficeState {
  if (!officeStateRef.current) {
    officeStateRef.current = new OfficeState();
  }
  return officeStateRef.current;
}

function App() {
  // Browser runtime (dev or static dist): dispatch mock messages after the
  // useExtensionMessages listener has been registered.
  useEffect(() => {
    if (isBrowserRuntime && !isStandaloneRuntime) {
      void import('./browserMock.js').then(({ dispatchMockMessages }) => dispatchMockMessages());
    }
  }, []);

  const editor = useEditorActions(getOfficeState, editorState);

  const isEditDirty = useCallback(
    () => editor.isEditMode && editor.isDirty,
    [editor.isEditMode, editor.isDirty],
  );

  const {
    agents,
    selectedAgent,
    agentTools,
    agentStatuses,
    subagentTools,
    subagentCharacters,
    layoutReady,
    layoutWasReset,
    loadedAssets,
    workspaceFolders,
    externalAssetDirectories,
    lastSeenVersion,
    extensionVersion,
    watchAllSessions,
    setWatchAllSessions,
    alwaysShowLabels,
    hooksEnabled,
    setHooksEnabled,
    hooksInfoShown,
    agentHistory,
    adminRooms,
    agentNames,
    agentTasks,
    agentFolderNames,
    agentFolderPaths,
    agentMessages,
    agentModes,
    agentHomeZones,
    agentRoles,
    hasCeoAgent,
    ceoAgentIds,
    pendingFileAttach,
    clearPendingFileAttach,
    agentChecklist,
    isMeetingActive,
    meetingTopic,
    newAgentFolderPath,
    agentLastMessageAt,
    agentActiveIds,
    agentCanSpawn,
    pendingPhaseReview,
    clearPendingPhaseReview,
    fleetState,
    lastError,
  } = useExtensionMessages(getOfficeState, editor.setLastSavedLayout, isEditDirty);

  // Sent messages (user side of chat — tracked locally, not from hook)
  // Key 0 is used for meeting broadcast messages sent by the user
  const [sentMessages, setSentMessages] = useState<Record<number, ChatMessage[]>>({});

  const [isNewAgentOpen, setIsNewAgentOpen] = useState(false);
  const pendingAgentConfigRef = useRef<{ name: string; task: string; mode: string } | null>(null);
  const pendingAgentConfigQueue = useRef<Array<{ name: string; task: string; mode: string }>>([]);
  const prevAgentsRef = useRef<number[]>([]);

  // Show migration notice once layout reset is detected
  const [migrationNoticeDismissed, setMigrationNoticeDismissed] = useState(false);
  const showMigrationNotice = layoutWasReset && !migrationNoticeDismissed;

  const [isChangelogOpen, setIsChangelogOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isRoomsOpen, setIsRoomsOpen] = useState(false);
  const [isAdminOpen, setIsAdminOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isFurnitureLibraryOpen, setIsFurnitureLibraryOpen] = useState(false);

  // Fetch admin rooms when panel opens
  useEffect(() => {
    if (isAdminOpen) vscode.postMessage({ type: 'getAdminRooms' });
  }, [isAdminOpen]);

  // Close furniture library when leaving edit mode
  useEffect(() => {
    if (!editor.isEditMode) setIsFurnitureLibraryOpen(false);
  }, [editor.isEditMode]);
  const [isSimulationMode, setIsSimulationMode] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isPhaseReviewOpen, setIsPhaseReviewOpen] = useState(false);
  const [currentPhaseLocal, setCurrentPhaseLocal] = useState('');
  const [phaseGatePending, setPhaseGatePending] = useState(false);
  const [phaseNames, setPhaseNames] = useState<string[]>([]);
  const [runMode, setRunMode] = useState('');
  const prevGatePending = useRef(false);

  // Auto-open Phase Review modal when a phaseComplete event arrives
  useEffect(() => {
    if (pendingPhaseReview) setIsPhaseReviewOpen(true);
  }, [pendingPhaseReview]);

  // Poll localStorage for phase state (agents write via ceo-agent-tools)
  useEffect(() => {
    const check = () => {
      const p = localStorage.getItem('pixel-agents-current-phase') ?? '';
      const g = localStorage.getItem('pixel-agents-phase-gate');
      const names = (() => { try { return JSON.parse(localStorage.getItem('pixel-agents-phase-names') ?? '[]') as string[]; } catch { return []; } })();
      const mode = localStorage.getItem('pixel-agents-run-mode') ?? '';
      const pending = !!g && (() => {
        try { const d = JSON.parse(g) as { timestamp: number }; return (Date.now() - d.timestamp) < 7_200_000; }
        catch { return false; }
      })();
      setCurrentPhaseLocal(p);
      setPhaseGatePending(pending);
      setPhaseNames(names);
      setRunMode(mode);
    };
    check();
    const id = setInterval(check, 2000);
    return () => clearInterval(id);
  }, []);

  // Play notification sound when gate becomes pending
  useEffect(() => {
    if (phaseGatePending && !prevGatePending.current) {
      playGateSound();
    }
    prevGatePending.current = phaseGatePending;
  }, [phaseGatePending]);
  const [isHooksInfoOpen, setIsHooksInfoOpen] = useState(false);
  const [hooksTooltipDismissed, setHooksTooltipDismissed] = useState(false);
  const [isDebugMode, setIsDebugMode] = useState(false);
  const [alwaysShowOverlay, setAlwaysShowOverlay] = useState(false);

  const currentMajorMinor = toMajorMinor(extensionVersion);

  const handleWhatsNewDismiss = useCallback(() => {
    vscode.postMessage({ type: 'setLastSeenVersion', version: currentMajorMinor });
  }, [currentMajorMinor]);

  const handleOpenChangelog = useCallback(() => {
    setIsChangelogOpen(true);
    vscode.postMessage({ type: 'setLastSeenVersion', version: currentMajorMinor });
  }, [currentMajorMinor]);

  // Sync alwaysShowOverlay from persisted settings
  useEffect(() => {
    setAlwaysShowOverlay(alwaysShowLabels);
  }, [alwaysShowLabels]);

  const handleToggleDebugMode = useCallback(() => setIsDebugMode((prev) => !prev), []);
  const handleToggleAlwaysShowOverlay = useCallback(() => {
    setAlwaysShowOverlay((prev) => {
      const newVal = !prev;
      vscode.postMessage({ type: 'setAlwaysShowLabels', enabled: newVal });
      return newVal;
    });
  }, []);

  const handleSelectAgent = useCallback((id: number) => {
    vscode.postMessage({ type: 'focusAgent', id });
  }, []);

  const containerRef = useRef<HTMLDivElement>(null);

  const [editorTickForKeyboard, setEditorTickForKeyboard] = useState(0);
  useEditorKeyboard(
    editor.isEditMode,
    editorState,
    editor.handleDeleteSelected,
    editor.handleRotateSelected,
    editor.handleToggleState,
    editor.handleUndo,
    editor.handleRedo,
    editor.handleRoomStampCancel,
    useCallback(() => setEditorTickForKeyboard((n) => n + 1), []),
    editor.handleToggleEditMode,
  );

  const handleCloseAgent = useCallback((id: number) => {
    vscode.postMessage({ type: 'closeAgent', id });
  }, []);

  const handleCloseAllAgents = useCallback(() => {
    vscode.postMessage({ type: 'closeAllAgents' });
  }, []);

  const handleSendAgentMessage = useCallback((id: number, message: string) => {
    vscode.postMessage({ type: 'sendAgentMessage', id, message });
  }, []);

  const handleStartMeeting = useCallback(() => {
    const topic = window.prompt('Meeting topic (leave blank for general discussion):') ?? '';
    if (topic === null) return; // cancelled
    vscode.postMessage({ type: 'startMeeting', topic: topic.trim() });
    // Walk all agents to the conference table area immediately
    const os = getOfficeState();
    const mainAgents = agents.filter((id) => !os.characters.get(id)?.isSubagent);
    os.walkAgentsToMeetingArea(mainAgents);
  }, [agents]);

  const handleEndMeeting = useCallback(() => {
    vscode.postMessage({ type: 'endMeeting' });
    // Send agents back to their seats
    const os = getOfficeState();
    for (const id of agents) {
      os.sendToSeat(id);
    }
  }, [agents]);

  const handleMeetingBroadcast = useCallback((message: string) => {
    vscode.postMessage({ type: 'meetingBroadcast', message });
    setSentMessages((prev) => ({
      ...prev,
      0: [...(prev[0] ?? []).slice(-49), { role: 'user', text: message, ts: Date.now() }],
    }));
  }, []);

  const handleSetAgentMeta = useCallback(
    (id: number, updates: { name?: string; task?: string; folderPath?: string; mode?: string; homeZoneId?: string }) => {
      vscode.postMessage({ type: 'setAgentMeta', id, ...updates });
      // Optimistic update in OfficeState so ToolOverlay reflects change immediately
      const ch = getOfficeState().characters.get(id);
      if (ch) {
        if (updates.name !== undefined) ch.customName = updates.name || undefined;
        if (updates.task !== undefined) ch.task = updates.task || undefined;
        if (updates.mode !== undefined) ch.mode = updates.mode as 'default' | 'planner';
        if (updates.homeZoneId !== undefined) ch.homeZoneId = updates.homeZoneId || undefined;
      }
    },
    [],
  );

  // Apply pending name/task/mode when a new agent appears in the list
  useEffect(() => {
    const prevSet = new Set(prevAgentsRef.current);
    const newIds = agents.filter((id) => !prevSet.has(id));
    if (newIds.length > 0) {
      for (const id of newIds) {
        // Queue takes priority (roster spawns); fall back to single-ref (normal spawns)
        const config = pendingAgentConfigQueue.current.length > 0
          ? pendingAgentConfigQueue.current.shift()!
          : pendingAgentConfigRef.current;
        if (config === pendingAgentConfigRef.current) pendingAgentConfigRef.current = null;
        if (!config) continue;
        const updates: { name?: string; task?: string; mode?: string } = {};
        if (config.name) updates.name = config.name;
        if (config.task) updates.task = config.task;
        if (config.mode && config.mode !== 'default') updates.mode = config.mode;
        if (Object.keys(updates).length > 0) handleSetAgentMeta(id, updates);
      }
    }
    prevAgentsRef.current = [...agents];
  }, [agents, handleSetAgentMeta]);

  const handleOpenClaudeModal = useCallback(() => {
    setIsNewAgentOpen(true);
  }, []);

  const handleNewAgentConfirm = useCallback((config: NewAgentConfig) => {
    setIsNewAgentOpen(false);
    vscode.postMessage({
      type: 'openClaude',
      folderPath: config.folderPath || undefined,
      mode: config.plan ? 'planner' : undefined,
      effort: config.effort !== 'none' ? config.effort : undefined,
      bypassPermissions: config.bypassPermissions,
      headless: config.headless,
      isCeo: config.isCeo,
    });
    pendingAgentConfigRef.current = { name: config.name, task: config.task, mode: config.plan ? 'planner' : 'default' };
  }, []);

  const handleReloadRoster = useCallback(() => {
    const listener = (event: MessageEvent) => {
      const msg = event.data as { type?: string; roster?: { agents: Array<{ name: string; task: string; role: string; plan: boolean; effort: string; isCeo: boolean; bypassPermissions: boolean; headless: boolean; folderPath: string }> } };
      if (msg?.type !== 'agentRosterLoaded') return;
      window.removeEventListener('message', listener);
      const rosterAgents = msg.roster?.agents ?? [];
      if (rosterAgents.length === 0) return;
      // Push all configs into the queue so each agent gets the right name/task
      pendingAgentConfigQueue.current = rosterAgents.map((a) => ({
        name: a.name,
        task: a.task,
        mode: a.plan ? 'planner' : 'default',
      }));
      // Spawn each agent
      for (const a of rosterAgents) {
        vscode.postMessage({
          type: 'openClaude',
          folderPath: a.folderPath || undefined,
          mode: a.plan ? 'planner' : undefined,
          effort: a.effort !== 'none' ? a.effort : undefined,
          bypassPermissions: a.bypassPermissions,
          headless: a.headless,
          isCeo: a.isCeo,
        });
      }
    };
    window.addEventListener('message', listener);
    vscode.postMessage({ type: 'loadAgentRoster' });
  }, []);

  const handleResetLayout = useCallback(() => {
    fetch('./assets/default-layout.json')
      .then((r) => r.json())
      .then((layout) => {
        editor.handleApplyRoom(layout);
      })
      .catch(() => {
        // If no default layout, reset to blank via extension
        vscode.postMessage({ type: 'importLayout' });
      });
  }, [editor]);

  const handleClick = useCallback((agentId: number) => {
    // If clicked agent is a sub-agent, focus the parent's terminal instead
    const os = getOfficeState();
    const meta = os.subagentMeta.get(agentId);
    const focusId = meta ? meta.parentAgentId : agentId;
    vscode.postMessage({ type: 'focusAgent', id: focusId });
  }, []);

  const officeState = getOfficeState();

  // Force dependency on editorTickForKeyboard to propagate keyboard-triggered re-renders
  void editorTickForKeyboard;

  // Show "Press R to rotate" hint when a rotatable item is selected or being placed
  const showRotateHint =
    editor.isEditMode &&
    (() => {
      if (editorState.selectedFurnitureUid) {
        const item = officeState
          .getLayout()
          .furniture.find((f) => f.uid === editorState.selectedFurnitureUid);
        if (item && isRotatable(item.type)) return true;
      }
      if (
        editorState.activeTool === EditTool.FURNITURE_PLACE &&
        isRotatable(editorState.selectedFurnitureType)
      ) {
        return true;
      }
      return false;
    })();

  if (!layoutReady) {
    return <div className="w-full h-full flex items-center justify-center ">Loading...</div>;
  }

  return (
    <div ref={containerRef} className="w-full h-full relative overflow-hidden">
      <OfficeCanvas
        officeState={officeState}
        onClick={handleClick}
        isEditMode={editor.isEditMode}
        editorState={editorState}
        onEditorTileAction={editor.handleEditorTileAction}
        onEditorEraseAction={editor.handleEditorEraseAction}
        onEditorSelectionChange={editor.handleEditorSelectionChange}
        onDeleteSelected={editor.handleDeleteSelected}
        onRotateSelected={editor.handleRotateSelected}
        onDragMove={editor.handleDragMove}
        onDragMoveMultiple={editor.handleDragMoveMultiple}
        onRoomStampAction={editor.handleRoomStampAction}
        onRoomStampCancel={editor.handleRoomStampCancel}
        pendingRoomStamp={editor.pendingRoomStamp}
        onAddZone={editor.handleAddZone}
        onUpdateZone={editor.handleUpdateZone}
        zones={editor.zones}
        editorTick={editor.editorTick}
        zoom={editor.zoom}
        onZoomChange={editor.handleZoomChange}
        panRef={editor.panRef}
      />

      {!isDebugMode ? (
        <>
          <ZoomControls zoom={editor.zoom} onZoomChange={editor.handleZoomChange} />

          {/* Vignette overlay */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ background: 'var(--vignette)' }}
          />

          {editor.isEditMode && editor.isDirty && (
            <EditActionBar editor={editor} editorState={editorState} />
          )}

          {editor.pendingRoomStamp && (
            <div
              className="absolute left-1/2 -translate-x-1/2 z-20 bg-accent text-white text-sm py-4 px-12 pointer-events-none whitespace-nowrap border-2 border-accent-bright shadow-pixel"
            >
              Click to place room · Escape to cancel
            </div>
          )}

          {showRotateHint && (
            <div
              className="absolute left-1/2 -translate-x-1/2 z-11 bg-accent-bright text-white text-sm py-3 px-8 rounded-none border-2 border-accent shadow-pixel pointer-events-none whitespace-nowrap"
              style={{ top: editor.isDirty ? 64 : 8 }}
            >
              Rotate (R)
            </div>
          )}

          {editor.isEditMode && (() => {
              const selUid = editorState.selectedFurnitureUid;
              const selColor = selUid
                ? (officeState.getLayout().furniture.find((f) => f.uid === selUid)?.color ?? null)
                : null;
              const handleToolChange = (tool: EditTool) => {
                editor.handleToolChange(tool);
                if (tool !== EditTool.FURNITURE_PLACE && tool !== EditTool.FURNITURE_PICK) {
                  setIsFurnitureLibraryOpen(false);
                }
              };
              const handleToggleFurnitureLibrary = () => {
                if (!isFurnitureLibraryOpen) {
                  editor.handleToolChange(EditTool.FURNITURE_PLACE);
                }
                setIsFurnitureLibraryOpen((v) => !v);
              };
              return (
                <>
                  <EditorToolbar
                    isEditMode={editor.isEditMode}
                    activeTool={editorState.activeTool}
                    selectedTileType={editorState.selectedTileType}
                    selectedFurnitureType={editorState.selectedFurnitureType}
                    selectedFurnitureUid={selUid}
                    selectedFurnitureColor={selColor}
                    floorColor={editorState.floorColor}
                    wallColor={editorState.wallColor}
                    selectedWallSet={editorState.selectedWallSet}
                    eraserSize={editor.eraserSize}
                    onToolChange={handleToolChange}
                    onTileTypeChange={editor.handleTileTypeChange}
                    onFloorColorChange={editor.handleFloorColorChange}
                    onWallColorChange={editor.handleWallColorChange}
                    onWallSetChange={editor.handleWallSetChange}
                    onSelectedFurnitureColorChange={editor.handleSelectedFurnitureColorChange}
                    onFurnitureTypeChange={editor.handleFurnitureTypeChange}
                    onEraserSizeChange={editor.handleEraserSizeChange}
                    loadedAssets={loadedAssets}
                    onOpenRooms={() => setIsRoomsOpen(true)}
                    onToggleEditMode={editor.handleToggleEditMode}
                    isFurnitureLibraryOpen={isFurnitureLibraryOpen}
                    onToggleFurnitureLibrary={handleToggleFurnitureLibrary}
                    zones={editor.zones}
                    onAddZone={editor.handleAddZone}
                    onUpdateZone={editor.handleUpdateZone}
                    onRemoveZone={editor.handleRemoveZone}
                  />
                  <FurnitureLibraryPanel
                    isOpen={isFurnitureLibraryOpen && editor.isEditMode}
                    onClose={() => setIsFurnitureLibraryOpen(false)}
                    loadedAssets={loadedAssets}
                    selectedFurnitureType={editorState.selectedFurnitureType}
                    onSelectFurniture={(type) => {
                      editor.handleFurnitureTypeChange(type);
                      if (editorState.activeTool !== EditTool.FURNITURE_PLACE) {
                        editor.handleToolChange(EditTool.FURNITURE_PLACE);
                      }
                    }}
                    onActivatePick={() => {
                      editor.handleToolChange(EditTool.FURNITURE_PICK);
                    }}
                    isPickActive={editorState.activeTool === EditTool.FURNITURE_PICK}
                    externalAssetDirectories={externalAssetDirectories}
                  />
                </>
              );
            })()}

          <ToolOverlay
            officeState={officeState}
            agents={agents}
            agentTools={agentTools}
            subagentCharacters={subagentCharacters}
            containerRef={containerRef}
            zoom={editor.zoom}
            panRef={editor.panRef}
            onCloseAgent={handleCloseAgent}
            alwaysShowOverlay={alwaysShowOverlay}
          />

          {isSidebarOpen && (
            <ActivitySidebar
              agents={agents}
              agentTools={agentTools}
              agentStatuses={agentStatuses}
              agentHistory={agentHistory}
              agentNames={agentNames}
              agentTasks={agentTasks}
              agentFolderNames={agentFolderNames}
              agentFolderPaths={agentFolderPaths}
              workspaceFolders={workspaceFolders}
              agentMessages={agentMessages}
              agentModes={agentModes}
              agentHomeZones={agentHomeZones}
              agentRoles={agentRoles}
              ceoAgentIds={ceoAgentIds}
              sentMessages={sentMessages}
              isMeetingActive={isMeetingActive}
              zones={editor.zones}
              onClose={() => setIsSidebarOpen(false)}
              onCloseAgent={handleCloseAgent}
              onCloseAllAgents={handleCloseAllAgents}
              onStartMeeting={handleStartMeeting}
              onSendAgentMessage={handleSendAgentMessage}
              onSetAgentMeta={handleSetAgentMeta}
              onSpawnCeo={(name, task, folderPath) => {
                vscode.postMessage({
                  type: 'openClaude',
                  folderPath: folderPath || workspaceFolders[0]?.path,
                  isCeo: true,
                  bypassPermissions: true,
                  headless: false,
                });
                if (name || task) {
                  pendingAgentConfigRef.current = { name: name ?? 'CEO', task: task ?? '', mode: 'default' };
                }
              }}
              pendingFileAttach={pendingFileAttach}
              onClearPendingFileAttach={clearPendingFileAttach}
              onBrowseFile={(agentId, imageOnly) =>
                vscode.postMessage({ type: 'browseFile', agentId, imageOnly: imageOnly ?? false })
              }
            />
          )}

          {isMeetingActive && (
            <MeetingPanel
              topic={meetingTopic}
              agents={agents.filter((id) => !getOfficeState().characters.get(id)?.isSubagent)}
              agentNames={agentNames}
              agentMessages={agentMessages}
              sentMessages={sentMessages}
              onEndMeeting={handleEndMeeting}
              onBroadcast={handleMeetingBroadcast}
            />
          )}

          {/* ── Phase pipeline banner ── pixel-panel blocky style, matches BottomToolbar ── */}
          {phaseNames.length > 0 && currentPhaseLocal && (() => {
            const activeNum = parseInt(currentPhaseLocal, 10) || 0;
            return (
              <div
                className="pixel-panel no-scrollbar"
                style={{
                  position: 'fixed', top: 14, left: '50%', transform: 'translateX(-50%)',
                  zIndex: 100,
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '12px 18px',
                  fontFamily: 'FS Pixel Sans, monospace',
                  maxWidth: 'calc(100vw - 32px)',
                  overflowX: 'auto',
                  flexWrap: 'nowrap',
                }}
              >
                {phaseNames.map((name, i) => {
                  const phaseNum = i + 1;
                  const isCompleted = phaseNum < activeNum;
                  const isActive = phaseNum === activeNum;
                  const isPending = phaseGatePending && isActive;
                  const stepLabel = String(phaseNum).padStart(2, '0');
                  return (
                    <div
                      key={i}
                      style={{
                        position: 'relative',
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '8px 14px',
                        background: isActive
                          ? 'rgba(249,115,22,0.18)'
                          : isCompleted
                          ? 'rgba(34,197,94,0.10)'
                          : 'rgba(255,255,255,0.04)',
                        border: `2px solid ${
                          isActive ? '#f97316' : isCompleted ? 'rgba(34,197,94,0.45)' : 'rgba(255,255,255,0.12)'
                        }`,
                        color: isActive ? '#fff' : isCompleted ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.55)',
                        animation: isPending
                          ? 'phase-active-glow 1.4s ease-in-out infinite'
                          : isActive
                          ? 'phase-active-glow 2.6s ease-in-out infinite'
                          : 'none',
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                      }}
                    >
                      {/* Numbered square (matches blocky aesthetic — no border-radius) */}
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        width: 28, height: 28,
                        fontSize: 12, fontWeight: 'bold', letterSpacing: '0.5px',
                        background: isCompleted
                          ? '#22c55e'
                          : isActive
                          ? '#f97316'
                          : 'rgba(255,255,255,0.08)',
                        color: isCompleted || isActive ? '#0a1628' : 'rgba(255,255,255,0.4)',
                        flexShrink: 0,
                      }}>
                        {isCompleted ? '✓' : stepLabel}
                      </span>
                      <span style={{
                        fontSize: 16,
                        fontWeight: isActive ? 'bold' : 600,
                        letterSpacing: '0.02em',
                      }}>
                        {name}
                      </span>
                      {isPending && (
                        <span style={{
                          position: 'absolute', top: -6, right: -6,
                          width: 12, height: 12, background: '#f59e0b',
                          border: '2px solid #0e0e18',
                          animation: 'phase-gate-dot 1.0s ease-in-out infinite',
                        }} />
                      )}
                    </div>
                  );
                })}

                {/* Run mode + gate indicator — also blocky */}
                {runMode && (
                  <span style={{
                    fontSize: 13, fontWeight: 'bold',
                    color: '#4dd9ff',
                    background: 'rgba(77,217,255,0.10)',
                    border: '2px solid rgba(77,217,255,0.45)',
                    padding: '7px 12px', letterSpacing: '0.06em',
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                  }}>
                    @{runMode}
                  </span>
                )}
                {phaseGatePending && (
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    fontSize: 13, fontWeight: 'bold',
                    color: '#0a1628',
                    background: '#f59e0b',
                    border: '2px solid #f59e0b',
                    padding: '7px 12px',
                    animation: 'phase-gate-dot 1.4s ease-in-out infinite',
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                  }}>
                    ⏳ GATE
                  </span>
                )}
              </div>
            );
          })()}
        </>
      ) : (
        <DebugView
          agents={agents}
          selectedAgent={selectedAgent}
          agentTools={agentTools}
          agentStatuses={agentStatuses}
          subagentTools={subagentTools}
          onSelectAgent={handleSelectAgent}
        />
      )}

      {/* Hooks first-run tooltip */}
      {!hooksInfoShown && !hooksTooltipDismissed && (
        <Tooltip
          title="Instant Detection Active"
          position="top-right"
          onDismiss={() => {
            setHooksTooltipDismissed(true);
            vscode.postMessage({ type: 'setHooksInfoShown' });
          }}
        >
          <span className="text-sm text-text leading-none">
            Your agents now respond in real-time.{' '}
            <span
              className="text-accent cursor-pointer underline"
              onClick={() => {
                setIsHooksInfoOpen(true);
                setHooksTooltipDismissed(true);
                vscode.postMessage({ type: 'setHooksInfoShown' });
              }}
            >
              View more
            </span>
          </span>
        </Tooltip>
      )}

      {/* Hooks info modal */}
      <Modal
        isOpen={isHooksInfoOpen}
        onClose={() => setIsHooksInfoOpen(false)}
        title="Instant Detection is ON"
        zIndex={52}
      >
        <div className="text-base text-text px-10" style={{ lineHeight: 1.4 }}>
          <p className="mb-8">Your Pixel Agents office now reacts in real-time:</p>
          <ul className="mb-8 pl-18 list-disc m-0">
            <li className="text-sm mb-2">Permission prompts appear instantly</li>
            <li className="text-sm mb-2">Turn completions detected the moment they happen</li>
            <li className="text-sm mb-2">Sound notifications play immediately</li>
          </ul>
          <p className="mb-12 text-text-muted">
            This works through Claude Code Hooks, small event listeners that notify Pixel Agents
            whenever something happens in your Claude sessions.
          </p>
          <div className="text-center">
            <button
              onClick={() => setIsHooksInfoOpen(false)}
              className="py-4 px-20 text-lg bg-accent text-white border-2 border-accent rounded-none cursor-pointer shadow-pixel"
            >
              Got it
            </button>
          </div>
          <p className="mt-8 text-xs text-text-muted text-center">
            To disable, go to Settings {'>'} Instant Detection
          </p>
        </div>
      </Modal>

      <BottomToolbar
        onOpenClaude={handleOpenClaudeModal}
        isSettingsOpen={isSettingsOpen}
        onToggleSettings={() => setIsSettingsOpen((v) => !v)}
        isSidebarOpen={isSidebarOpen}
        onToggleSidebar={() => setIsSidebarOpen((v) => !v)}
        workspaceFolders={workspaceFolders}
        isAdminOpen={isAdminOpen}
        onToggleAdmin={isStandaloneRuntime ? () => setIsAdminOpen((v) => !v) : undefined}
        isEditMode={editor.isEditMode}
        onToggleEditMode={editor.handleToggleEditMode}
        hasCeoAgent={hasCeoAgent}
        onCeoCatchUp={() => vscode.postMessage({ type: 'ceoCatchUp' })}
        onReloadRoster={handleReloadRoster}
        isSimulationMode={isSimulationMode}
        onToggleSimulation={() => setIsSimulationMode((v) => !v)}
        isPreviewOpen={isPreviewOpen}
        onTogglePreview={() => setIsPreviewOpen((v) => !v)}
        onPhaseReview={() => setIsPhaseReviewOpen(true)}
        hasPhaseReview={!!pendingPhaseReview || phaseGatePending}
        onSpawnTeam={() => {
          const project = window.prompt('Project name? (leave empty for default 11-agent roster)\n\nKnown projects: default, autoflow, AdobeHealthDashboardStage', 'default');
          if (project === null) return; // user cancelled
          vscode.postMessage({ type: 'spawnTeam', project: project.trim() || 'default' });
        }}
      />

      {isSimulationMode && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 210, display: 'flex' }}>
          <ActivitySidebar
            agents={agents}
            agentTools={agentTools}
            agentStatuses={agentStatuses}
            agentHistory={agentHistory}
            agentNames={agentNames}
            agentTasks={agentTasks}
            agentFolderNames={agentFolderNames}
            agentFolderPaths={agentFolderPaths}
            workspaceFolders={workspaceFolders}
            agentMessages={agentMessages}
            agentModes={agentModes}
            agentHomeZones={agentHomeZones}
            agentRoles={agentRoles}
            ceoAgentIds={ceoAgentIds}
            sentMessages={sentMessages}
            isMeetingActive={isMeetingActive}
            zones={editor.zones}
            mode="split"
            onClose={() => setIsSimulationMode(false)}
            onCloseAgent={handleCloseAgent}
            onCloseAllAgents={handleCloseAllAgents}
            onStartMeeting={handleStartMeeting}
            onSendAgentMessage={handleSendAgentMessage}
            onSetAgentMeta={handleSetAgentMeta}
            onSpawnCeo={(name, task, folderPath) => {
              vscode.postMessage({
                type: 'openClaude',
                folderPath: folderPath || workspaceFolders[0]?.path,
                isCeo: true,
                bypassPermissions: true,
                headless: false,
              });
              if (name || task) {
                pendingAgentConfigRef.current = { name: name ?? 'CEO', task: task ?? '', mode: 'default' };
              }
            }}
            pendingFileAttach={pendingFileAttach}
            onClearPendingFileAttach={clearPendingFileAttach}
            onBrowseFile={(agentId, imageOnly) =>
              vscode.postMessage({ type: 'browseFile', agentId, imageOnly: imageOnly ?? false })
            }
          />
          <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
            <AgentNetworkCanvas
              onClose={() => setIsSimulationMode(false)}
              agents={agents}
              agentNames={agentNames}
              agentTasks={agentTasks}
              agentStatuses={agentStatuses}
              agentTools={agentTools}
              agentModes={agentModes}
              agentFolderNames={agentFolderNames}
              agentFolderPaths={agentFolderPaths}
              agentMessages={agentMessages}
              subagentCharacters={subagentCharacters}
              agentHomeZones={agentHomeZones}
              agentRoles={agentRoles}
              hasCeoAgent={hasCeoAgent}
              ceoAgentIds={ceoAgentIds}
              workspaceFolders={workspaceFolders}
              externalFolderPath={newAgentFolderPath}
              agentLastMessageAt={agentLastMessageAt}
              agentActiveIds={agentActiveIds}
              agentCanSpawn={agentCanSpawn}
              agentHistory={agentHistory}
              agentChecklist={agentChecklist}
              contained
              onCreateAgent={(cfg) => {
                vscode.postMessage({
                  type: 'openClaude',
                  folderPath: cfg.folderPath || undefined,
                  mode: cfg.plan ? 'planner' : undefined,
                  effort: cfg.effort !== 'none' ? cfg.effort : undefined,
                  bypassPermissions: cfg.bypassPermissions,
                  headless: cfg.isCeo ? false : cfg.headless,
                  isCeo: cfg.isCeo,
                });
                if (cfg.name || cfg.task) {
                  pendingAgentConfigRef.current = { name: cfg.name, task: cfg.task, mode: cfg.plan ? 'planner' : 'default' };
                }
              }}
              onCloseAgent={(id) => vscode.postMessage({ type: 'closeAgent', id })}
              onSendMessage={(id, message) => vscode.postMessage({ type: 'sendAgentMessage', id, message })}
              onSetMeta={(id, updates) => vscode.postMessage({ type: 'setAgentMeta', id, ...updates })}
            />
          </div>
        </div>
      )}

      {isStandaloneRuntime && isAdminOpen && (
        <AdminRoomsPanel
          rooms={adminRooms}
          onClose={() => setIsAdminOpen(false)}
          onLoadRoom={editor.handleApplyRoom}
          onGetCurrentLayout={() => getOfficeState().getLayout()}
          onSaveRooms={(rooms) => vscode.postMessage({ type: 'saveAdminRooms', rooms })}
        />
      )}

      <VersionIndicator
        currentVersion={extensionVersion}
        lastSeenVersion={lastSeenVersion}
        onDismiss={handleWhatsNewDismiss}
        onOpenChangelog={handleOpenChangelog}
      />

      <ChangelogModal
        isOpen={isChangelogOpen}
        onClose={() => setIsChangelogOpen(false)}
        currentVersion={extensionVersion}
      />

      <RoomsModal
        isOpen={isRoomsOpen}
        onClose={() => setIsRoomsOpen(false)}
        onApply={editor.handleApplyRoom}
        onStamp={(layout) => {
          editor.handleRoomStampStart(layout);
          setIsRoomsOpen(false);
        }}
      />

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        isDebugMode={isDebugMode}
        onToggleDebugMode={handleToggleDebugMode}
        alwaysShowOverlay={alwaysShowOverlay}
        onToggleAlwaysShowOverlay={handleToggleAlwaysShowOverlay}
        externalAssetDirectories={externalAssetDirectories}
        watchAllSessions={watchAllSessions}
        onToggleWatchAllSessions={() => {
          const newVal = !watchAllSessions;
          setWatchAllSessions(newVal);
          vscode.postMessage({ type: 'setWatchAllSessions', enabled: newVal });
        }}
        onResetLayout={handleResetLayout}
        hooksEnabled={hooksEnabled}
        onToggleHooksEnabled={() => {
          const newVal = !hooksEnabled;
          setHooksEnabled(newVal);
          vscode.postMessage({ type: 'setHooksEnabled', enabled: newVal });
        }}
      />

      {isNewAgentOpen && (
        <NewAgentModal
          workspaceFolders={workspaceFolders}
          onConfirm={handleNewAgentConfirm}
          onCancel={() => setIsNewAgentOpen(false)}
          externalFolderPath={newAgentFolderPath}
          ceoExists={hasCeoAgent}
        />
      )}

      {showMigrationNotice && (
        <MigrationNotice onDismiss={() => setMigrationNoticeDismissed(true)} />
      )}

      <PreviewPane open={isPreviewOpen} onClose={() => setIsPreviewOpen(false)} />

      {fleetState && <FleetPanel state={fleetState} lastError={lastError} />}

      <PhaseReviewModal
        isOpen={isPhaseReviewOpen}
        project={pendingPhaseReview?.project ?? ''}
        phase={pendingPhaseReview?.phase ?? 1}
        summaries={pendingPhaseReview?.summaries ?? []}
        ceoAgentId={ceoAgentIds.size > 0 ? [...ceoAgentIds][0] : null}
        onSendToCeo={(agentId, message) => {
          vscode.postMessage({ type: 'sendAgentMessage', id: agentId, message });
          setIsPhaseReviewOpen(false);
          clearPendingPhaseReview();
        }}
        onDismiss={() => {
          setIsPhaseReviewOpen(false);
          clearPendingPhaseReview();
        }}
      />
    </div>
  );
}

export default App;

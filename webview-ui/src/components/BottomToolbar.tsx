import type React from 'react';
import type { WorkspaceFolder } from '../hooks/useExtensionMessages.js';
import { Button } from './ui/Button.js';

interface BottomToolbarProps {
  onOpenClaude: () => void;
  isSettingsOpen: boolean;
  onToggleSettings: () => void;
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
  workspaceFolders: WorkspaceFolder[];
  isAdminOpen?: boolean;
  onToggleAdmin?: () => void;
  isEditMode?: boolean;
  onToggleEditMode?: () => void;
  hasCeoAgent?: boolean;
  onCeoCatchUp?: () => void;
  onReloadRoster?: () => void;
  isSimulationMode?: boolean;
  onToggleSimulation?: () => void;
  isPreviewOpen?: boolean;
  onTogglePreview?: () => void;
  onPhaseReview?: () => void;
  hasPhaseReview?: boolean;
  onSpawnTeam?: () => void;
}

export function BottomToolbar({
  onOpenClaude,
  isSettingsOpen,
  onToggleSettings,
  isSidebarOpen,
  onToggleSidebar,
  workspaceFolders: _workspaceFolders,
  isAdminOpen,
  onToggleAdmin,
  isEditMode,
  onToggleEditMode,
  hasCeoAgent,
  onCeoCatchUp,
  onReloadRoster,
  isSimulationMode,
  onToggleSimulation,
  isPreviewOpen,
  onTogglePreview,
  onPhaseReview,
  hasPhaseReview,
  onSpawnTeam,
}: BottomToolbarProps) {
  return (
    <div
      className="absolute bottom-10 z-20 flex items-center gap-4 pixel-panel p-4 overflow-x-auto no-scrollbar"
      style={{
        left: 94,
        maxWidth: 'calc(100vw - 118px)',
        flexWrap: 'nowrap',
      }}
    >
      {onToggleEditMode && (
        <Button
          variant={isEditMode ? 'active' : 'default'}
          onClick={onToggleEditMode}
          title={isEditMode ? 'Exit layout editor' : 'Edit layout'}
        >
          {isEditMode ? '✕ Done' : '✏ Edit'}
        </Button>
      )}
      <div className="relative">
        <Button
          variant="accent"
          onClick={onOpenClaude}
          className="bg-accent hover:bg-accent-bright"
        >
          + Agent
        </Button>
      </div>
      {onSpawnTeam && (
        <Button
          variant="default"
          onClick={onSpawnTeam}
          title="Spawn the full agent team — runs spawn-team.mjs in the background. Prompts for project name (default = 'default')."
        >
          ⚡ Spawn Team
        </Button>
      )}
      {hasCeoAgent && onCeoCatchUp && (
        <Button
          variant="default"
          onClick={onCeoCatchUp}
          title="Tell CEO agent to read CLAUDE.md and catch up on all previous sessions"
        >
          CEO Catch Up
        </Button>
      )}
      <Button
        variant={isSidebarOpen ? 'active' : 'default'}
        onClick={onToggleSidebar}
        title="Activity monitor"
      >
        Monitor
      </Button>
      {onToggleAdmin && (
        <Button
          variant={isAdminOpen ? 'active' : 'default'}
          onClick={onToggleAdmin}
          title="Admin: rooms & import"
        >
          Rooms
        </Button>
      )}
      {onToggleSimulation && (
        <Button
          variant={isSimulationMode ? 'active' : 'default'}
          onClick={onToggleSimulation}
          title="Simulation mode — activity monitor + network canvas side by side"
        >
          ⊡ Simulate
        </Button>
      )}
      {onTogglePreview && (
        <Button
          variant={isPreviewOpen ? 'active' : 'default'}
          onClick={onTogglePreview}
          title="Preview — embed the project's dev server (default localhost:3000)"
        >
          🌐 Preview
        </Button>
      )}
      {onPhaseReview && (
        <Button
          variant={hasPhaseReview ? 'active' : 'default'}
          onClick={onPhaseReview}
          title="Phase review — inspect agent output and send feedback to CEO"
          style={hasPhaseReview ? { animation: 'phase-review-pulse 1.5s ease-in-out infinite', position: 'relative' } as React.CSSProperties : undefined}
        >
          {hasPhaseReview && (
            <span style={{ position: 'absolute', top: -4, right: -4, width: 8, height: 8, background: '#f59e0b', borderRadius: '50%' }} />
          )}
          ◆ Phase Review
        </Button>
      )}
      {onReloadRoster && (
        <Button
          variant="default"
          onClick={onReloadRoster}
          title="Reload all agents from saved roster (~/.pixel-agents/roster.json)"
        >
          ⟳ Reload
        </Button>
      )}
      <Button
        variant={isSettingsOpen ? 'active' : 'default'}
        onClick={onToggleSettings}
        title="Settings"
      >
        Settings
      </Button>
    </div>
  );
}

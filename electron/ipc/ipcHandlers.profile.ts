/**
 * Profile handlers extracted from ipcHandlers.ts.
 * Handles profile intelligence features (requires premium).
 */

import { safeHandle } from './safeHandle';
import { AppState } from '../main';

export function registerProfileHandlers(appState: AppState): void {
  safeHandle("profile:get-status", async () => {
    try {
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) {
        return { hasProfile: false, profileMode: false };
      }
      const status = orchestrator.getStatus();
      return {
        hasProfile: status.hasResume,
        profileMode: status.activeMode,
        name: status.resumeSummary?.name,
        role: status.resumeSummary?.role,
        totalExperienceYears: status.resumeSummary?.totalExperienceYears
      };
    } catch (error: any) {
      return { hasProfile: false, profileMode: false };
    }
  });

  safeHandle("profile:set-mode", async (_, enabled: boolean) => {
    try {
      if (enabled) {
        const { LicenseManager } = require('../premium/electron/services/LicenseManager');
        if (!LicenseManager.getInstance().isPremium()) {
          return { success: false, error: 'Pro license required for profile features.' };
        }
      }
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) {
        return { success: false, error: 'Knowledge engine not initialized' };
      }
      orchestrator.setKnowledgeMode(enabled);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  safeHandle("profile:get-profile", async () => {
    try {
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) return { hasProfile: false };
      return orchestrator.getProfileData() || { hasProfile: false };
    } catch (error: any) {
      return { hasProfile: false };
    }
  });

  safeHandle("profile:get-negotiation-state", async () => {
    try {
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) return { success: false, error: 'Orchestrator not available' };
      const tracker = orchestrator.getNegotiationTracker();
      return { success: true, state: tracker.getState(), isActive: tracker.isActive() };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  safeHandle("profile:generate-negotiation", async (_, force: boolean = false) => {
    try {
      const { LicenseManager } = require('../premium/electron/services/LicenseManager');
      if (!LicenseManager.getInstance().isPremium()) {
        return { success: false, error: 'Pro license required for negotiation features.' };
      }
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) return { success: false, error: 'Orchestrator not available' };
      const status = orchestrator.getStatus();
      if (!status.hasResume) {
        return { success: false, error: 'No resume loaded' };
      }
      let script = null;
      if (!force) {
        script = orchestrator.getNegotiationScript();
      }
      if (!script) {
        script = await orchestrator.generateNegotiationScriptOnDemand();
      }
      return { success: true, script };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  safeHandle("profile:research-company", async (_, companyName: string) => {
    try {
      const { LicenseManager } = require('../premium/electron/services/LicenseManager');
      if (!LicenseManager.getInstance().isPremium()) {
        return { success: false, error: 'Pro license required. Please activate a license key to use Profile Intelligence features.' };
      }
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) {
        return { success: false, error: 'Knowledge engine not initialized' };
      }
      const engine = orchestrator.getCompanyResearchEngine();
      const { CredentialsManager } = require('../services/CredentialsManager');
      const cm = CredentialsManager.getInstance();
      const tavilyApiKey = cm.getTavilyApiKey();
      if (tavilyApiKey) {
        const { TavilySearchProvider } = require('../premium/electron/knowledge/TavilySearchProvider');
        engine.setSearchProvider(new TavilySearchProvider(tavilyApiKey));
      }
      const profileData = orchestrator.getProfileData();
      const activeJD = profileData?.activeJD;
      const jdCtx = activeJD ? {
        title: activeJD.title,
        location: activeJD.location,
        level: activeJD.level,
        technologies: activeJD.technologies,
        requirements: activeJD.requirements,
        keywords: activeJD.keywords,
        compensation_hint: activeJD.compensation_hint,
        min_years_experience: activeJD.min_years_experience,
      } : {};
      const dossier = await engine.researchCompany(companyName, jdCtx, true);
      return { success: true, dossier };
    } catch (error: any) {
      console.error('[IPC] profile:research-company error:', error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("profile:reset-negotiation", async () => {
    try {
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) return { success: true };
      orchestrator.resetNegotiationSession();
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  safeHandle("profile:delete", async () => {
    try {
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) return { success: false };
      await orchestrator.deleteDocumentsByType('resume');
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  safeHandle("profile:delete-jd", async () => {
    try {
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) return { success: false };
      await orchestrator.deleteDocumentsByType('jd');
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  safeHandle("profile:select-file", async () => {
    try {
      const { dialog } = require('electron');
      const result: any = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Resume Files', extensions: ['pdf', 'docx', 'txt'] }] });
      if (result.canceled || result.filePaths.length === 0) return { cancelled: true };
      return { success: true, filePath: result.filePaths[0] };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  safeHandle("profile:upload-jd", async (_, filePath: string) => {
    try {
      const { LicenseManager } = require('../premium/electron/services/LicenseManager');
      if (!LicenseManager.getInstance().isPremium()) {
        return { success: false, error: 'Pro license required. Please activate a license key to use Profile Intelligence features.' };
      }
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) return { success: false, error: 'Orchestrator not available' };
      const result = await orchestrator.ingestDocument(filePath, 'jd');
      return result;
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  safeHandle("profile:upload-resume", async (_, filePath: string) => {
    try {
      const { LicenseManager } = require('../premium/electron/services/LicenseManager');
      if (!LicenseManager.getInstance().isPremium()) {
        return { success: false, error: 'Pro license required. Please activate a license key to use Profile Intelligence features.' };
      }
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) return { success: false, error: 'Orchestrator not available' };
      const result = await orchestrator.ingestDocument(filePath, 'resume');
      return result;
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });
}
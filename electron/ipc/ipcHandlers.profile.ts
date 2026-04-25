/**
 * Profile handlers extracted from ipcHandlers.ts.
 * Handles profile intelligence features (requires premium).
 */

import { safeHandle } from './safeHandle';
import { AppState } from '../main';
import { CredentialsManager } from '../services/CredentialsManager';
import { DatabaseManager } from '../db/DatabaseManager';

export function registerProfileHandlers(appState: AppState): void {
  safeHandle("trial:get-local", async () => {
    try {
      const cm    = CredentialsManager.getInstance();
      const token = cm.getTrialToken();
      if (!token) return { hasToken: false, trialClaimed: cm.getTrialClaimed() };
      return {
        hasToken:     true,
        trialClaimed: true,
        trialToken:   token,
        expiresAt:    cm.getTrialExpiresAt(),
        startedAt:    cm.getTrialStartedAt(),
        expired:      cm.getTrialExpiresAt()
                      ? new Date(cm.getTrialExpiresAt()!).getTime() < Date.now()
                      : false,
      };
    } catch {
      return { hasToken: false, trialClaimed: false };
    }
  });

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

  safeHandle("profile:get-notes", async () => {
    try {
      const content = DatabaseManager.getInstance().getCustomNotes();
      return { success: true, content };
    } catch (error: any) {
      return { success: false, content: '', error: error.message };
    }
  });

  safeHandle("profile:save-notes", async (_, content: string) => {
    try {
      const trimmed = typeof content === 'string' ? content.slice(0, 4000) : '';
      DatabaseManager.getInstance().saveCustomNotes(trimmed);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  safeHandle("trial:wipe-profile-data", async () => {
    try {
      try {
        const orchestrator = appState.getKnowledgeOrchestrator();
        if (orchestrator) {
          orchestrator.setKnowledgeMode(false);
          const { DocType } = require('../premium/electron/knowledge/types');
          orchestrator.deleteDocumentsByType(DocType.RESUME);
          orchestrator.deleteDocumentsByType(DocType.JD);
        }
      } catch { /* ignore */ }

      try {
        const sqliteDb = DatabaseManager.getInstance().getDb();
        if (sqliteDb) {
          sqliteDb.exec(`
            DELETE FROM company_dossiers;
            DELETE FROM knowledge_documents;
            DELETE FROM resume_nodes;
            DELETE FROM user_profile;
          `);
        }
      } catch (dbErr: any) {
        console.warn('[IPC] trial:wipe-profile-data: SQLite wipe partial error:', dbErr.message);
      }

      return { success: true };
    } catch (error: any) {
      console.error('[IPC] trial:wipe-profile-data error:', error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("trial:start", async () => {
    try {
      const { CredentialsManager } = require('../services/CredentialsManager');
      const cm = CredentialsManager.getInstance();

      let hwid = 'unavailable';
      try {
        const { LicenseManager } = require('../premium/electron/services/LicenseManager');
        hwid = LicenseManager.getInstance().getHardwareId() || 'unavailable';
      } catch { /* fall back */ }

      const res = await fetch('https://api.natively.software/v1/trial/start', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ hwid }),
        signal:  AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as any;
        return { ok: false, error: body.error || 'request_failed', status: res.status };
      }

      const data = await res.json() as any;

      if (data.ok && data.trial_token && !data.expired) {
        cm.setTrialToken(data.trial_token, data.expires_at, data.started_at);

        const prevSttProvider = cm.getSttProvider();
        cm.setNativelyApiKey('__trial__');
        const newSttProvider = cm.getSttProvider();
        if (newSttProvider !== prevSttProvider) {
          await appState.reconfigureSttProvider();
        }
        const llmHelper = appState.processingHelper?.getLLMHelper?.();
        if (llmHelper) llmHelper.setNativelyKey('__trial__');
      }

      return { ok: true, ...data };
    } catch (error: any) {
      console.error('[IPC] trial:start failed:', error);
      return { ok: false, error: error.message || 'network_error' };
    }
  });

  safeHandle("trial:status", async () => {
    try {
      const { CredentialsManager } = require('../services/CredentialsManager');
      const token = CredentialsManager.getInstance().getTrialToken();
      if (!token) return { ok: false, error: 'no_trial_token' };

      const res = await fetch('https://api.natively.software/v1/trial/status', {
        headers: { 'x-trial-token': token },
        signal:  AbortSignal.timeout(8_000),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as any;
        return { ok: false, error: body.error || 'request_failed', status: res.status };
      }

      return await res.json();
    } catch (error: any) {
      return { ok: false, error: error.message || 'network_error' };
    }
  });

  safeHandle("trial:convert", async (_, choice: string) => {
    try {
      const { CredentialsManager } = require('../services/CredentialsManager');
      const token = CredentialsManager.getInstance().getTrialToken();
      if (!token) return { ok: true };

      await fetch('https://api.natively.software/v1/trial/convert', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'x-trial-token': token },
        body:    JSON.stringify({ choice }),
        signal:  AbortSignal.timeout(5_000),
      }).catch(() => {});

      return { ok: true };
    } catch {
      return { ok: true };
    }
  });

  safeHandle("trial:end-byok", async () => {
    try {
      const { CredentialsManager } = require('../services/CredentialsManager');
      const cm = CredentialsManager.getInstance();

      const token = cm.getTrialToken();
      if (token) {
        fetch('https://api.natively.software/v1/trial/convert', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', 'x-trial-token': token },
          body:    JSON.stringify({ choice: 'byok' }),
          signal:  AbortSignal.timeout(4_000),
        }).catch(() => {});
      }

      cm.clearTrialToken();
      cm.setNativelyApiKey('');
      const llmHelper = appState.processingHelper?.getLLMHelper?.();
      if (llmHelper) llmHelper.setNativelyKey(null);
      await appState.reconfigureSttProvider();

      try {
        const { LicenseManager } = require('../premium/electron/services/LicenseManager');
        await LicenseManager.getInstance().deactivate();
      } catch { /* not available */ }

      try {
        const orchestrator = appState.getKnowledgeOrchestrator();
        if (orchestrator) {
          orchestrator.setKnowledgeMode(false);
          const { DocType } = require('../premium/electron/knowledge/types');
          orchestrator.deleteDocumentsByType(DocType.RESUME);
          orchestrator.deleteDocumentsByType(DocType.JD);
        }
      } catch { /* ignore */ }

      try {
        const sqliteDb = DatabaseManager.getInstance().getDb();
        if (sqliteDb) {
          sqliteDb.exec(`
            DELETE FROM company_dossiers;
            DELETE FROM knowledge_documents;
            DELETE FROM resume_nodes;
            DELETE FROM user_profile;
          `);
        }
      } catch (dbErr: any) {
        console.warn('[IPC] trial:end-byok: SQLite wipe partial error:', dbErr.message);
      }

      return { success: true };
    } catch (error: any) {
      console.error('[IPC] trial:end-byok error:', error);
      return { success: false, error: error.message };
    }
  });
}
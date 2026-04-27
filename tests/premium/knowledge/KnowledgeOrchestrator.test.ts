/**
 * KnowledgeOrchestrator unit tests — premium-conditional.
 *
 * Tests the public API of KnowledgeOrchestrator by mocking its entire dependency
 * graph at the module level. This avoids the need for a real database or LLM.
 *
 * When premium is unavailable, all tests are skipped via describeIfPremium.
 *
 * Path convention: vi.mock() resolves relative to the test file (tests/premium/knowledge/).
 * - premiumSkip:   ../..                   → tests/helpers/premiumSkip
 * - premium modules: ../../../../premium/   → premium/ (sibling of tests/)
 */

import { beforeEach, expect, vi } from 'vitest'
import { describeIfPremium, itIfPremium } from '../../helpers/premiumSkip'

// ─── Mock all premium/knowledge sub-modules at module level ──────────────────

vi.mock(
  '../../../../premium/electron/knowledge/KnowledgeDatabaseManager',
  () => ({
    KnowledgeDatabaseManager: vi.fn().mockImplementation(() => ({
      initializeSchema: vi.fn(),
      getDocumentByType: vi.fn(),
      getAllNodes: vi.fn().mockReturnValue([]),
      getNodeCount: vi.fn().mockReturnValue(0),
      deleteDocumentsByType: vi.fn(),
      getGapAnalysis: vi.fn(),
      getNegotiationScript: vi.fn(),
      getMockQuestions: vi.fn(),
      getCultureMappings: vi.fn(),
      saveDocument: vi.fn().mockReturnValue(1),
      saveNodes: vi.fn(),
    })),
  }),
)

vi.mock('../../../../premium/electron/knowledge/DocumentReader', () => ({
  extractDocumentText: vi.fn().mockResolvedValue('mocked text content'),
}))

vi.mock('../../../../premium/electron/knowledge/StructuredExtractor', () => ({
  extractStructuredData: vi.fn().mockResolvedValue({}),
}))

vi.mock('../../../../premium/electron/knowledge/DocumentChunker', () => ({
  chunkAndEmbedDocument: vi.fn().mockResolvedValue([]),
}))

vi.mock('../../../../premium/electron/knowledge/PostProcessor', () => ({
  processResume: vi.fn().mockReturnValue({
    structured: {},
    totalExperienceYears: 5,
    skillExperienceMap: {},
  }),
}))

vi.mock('../../../../premium/electron/knowledge/HybridSearchEngine', () => ({
  getRelevantNodes: vi.fn().mockResolvedValue([]),
  formatDossierBlock: vi.fn().mockReturnValue(''),
  detectCategoryHints: vi.fn().mockReturnValue([]),
}))

vi.mock('../../../../premium/electron/knowledge/ContextAssembler', () => ({
  assemblePromptContext: vi.fn().mockResolvedValue({
    systemPromptInjection: '',
    contextBlock: '',
    isIntroQuestion: false,
  }),
}))

vi.mock('../../../../premium/electron/knowledge/IntentClassifier', () => ({
  classifyIntent: vi.fn().mockReturnValue('general'),
  needsCompanyResearch: vi.fn().mockReturnValue(false),
}))

vi.mock('../../../../premium/electron/knowledge/CompanyResearchEngine', () => {
  const mockEngine = {
    setGenerateContentFn: vi.fn(),
    researchCompany: vi.fn().mockResolvedValue({}),
    getCachedDossier: vi.fn().mockReturnValue(null),
  }
  return {
    CompanyResearchEngine: vi.fn().mockImplementation(() => mockEngine),
    jdContextFromStructured: vi.fn().mockReturnValue({}),
  }
})

vi.mock('../../../../premium/electron/knowledge/TechnicalDepthScorer', () => ({
  TechnicalDepthScorer: vi.fn().mockImplementation(() => ({
    addUtterance: vi.fn(),
    getToneXML: vi.fn().mockReturnValue(''),
    getToneDirective: vi.fn().mockReturnValue(''),
  })),
}))

vi.mock('../../../../premium/electron/knowledge/AOTPipeline', () => {
  const mockPipeline = {
    reset: vi.fn(),
    setGenerateContentFn: vi.fn(),
    runForJD: vi.fn().mockResolvedValue(undefined),
    getCachedGapAnalysis: vi.fn().mockReturnValue(null),
    getCachedNegotiationScript: vi.fn().mockReturnValue(null),
    getCachedDossier: vi.fn().mockReturnValue(null),
    getStatus: vi.fn().mockReturnValue({}),
    getCachedCultureMapping: vi.fn().mockReturnValue(null),
  }
  return {
    AOTPipeline: vi.fn().mockImplementation(() => mockPipeline),
  }
})

vi.mock('../../../../premium/electron/knowledge/StarStoryGenerator', () => ({
  generateStarStories: vi.fn().mockResolvedValue([]),
  generateStarStoryNodes: vi.fn().mockResolvedValue([]),
}))

vi.mock(
  '../../../../premium/electron/knowledge/MockInterviewGenerator',
  () => ({
    generateMockQuestions: vi.fn().mockResolvedValue([]),
  }),
)

vi.mock('../../../../premium/electron/knowledge/CultureValuesMapper', () => ({
  findRelevantValueAlignments: vi.fn().mockReturnValue([]),
  formatValueAlignmentBlock: vi.fn().mockReturnValue(''),
}))

vi.mock(
  '../../../../premium/electron/knowledge/SalaryIntelligenceEngine',
  () => {
    const mockEngine = {
      estimateFromResume: vi.fn().mockResolvedValue({}),
      getCachedEstimate: vi.fn().mockReturnValue(null),
      clearCache: vi.fn(),
    }
    return {
      SalaryIntelligenceEngine: vi.fn().mockImplementation(() => mockEngine),
    }
  },
)

vi.mock(
  '../../../../premium/electron/knowledge/NegotiationConversationTracker',
  () => {
    const mockTracker = {
      addUserUtterance: vi.fn(),
      addRecruiterUtterance: vi.fn(),
      isActive: vi.fn().mockReturnValue(false),
      getUserTarget: vi.fn(),
      setUserTarget: vi.fn(),
      reset: vi.fn(),
    }
    return {
      NegotiationConversationTracker: vi
        .fn()
        .mockImplementation(() => mockTracker),
    }
  },
)

vi.mock('../../../../premium/electron/knowledge/NegotiationEngine', () => ({
  generateNegotiationScript: vi.fn().mockResolvedValue(null),
}))

vi.mock(
  '../../../../premium/electron/knowledge/LiveNegotiationAdvisor',
  () => ({
    generateLiveCoachingResponse: vi.fn().mockResolvedValue(null),
  }),
)

// ─── Import after mocking ────────────────────────────────────────────────────
// These use the vitest alias from vitest.config.ts which maps 'premium' → premium/

import { KnowledgeOrchestrator } from '../../../../premium/electron/knowledge/KnowledgeOrchestrator'
import { DocType } from '../../../../premium/electron/knowledge/types'

// ─── Test Suite ─────────────────────────────────────────────────────────────

describeIfPremium('KnowledgeOrchestrator', () => {
  let mockDb: any
  let orchestrator: KnowledgeOrchestrator

  beforeEach(() => {
    vi.clearAllMocks()

    // Create a fresh mock DB instance for each test
    mockDb = {
      initializeSchema: vi.fn(),
      getDocumentByType: vi.fn().mockReturnValue(null),
      getAllNodes: vi.fn().mockReturnValue([]),
      getNodeCount: vi.fn().mockReturnValue(0),
      deleteDocumentsByType: vi.fn(),
      saveNodes: vi.fn(),
      saveDocument: vi.fn().mockReturnValue(1),
      getGapAnalysis: vi.fn().mockReturnValue(null),
      getNegotiationScript: vi.fn().mockReturnValue(null),
      getMockQuestions: vi.fn().mockReturnValue(null),
      getCultureMappings: vi.fn().mockReturnValue(null),
    }

    orchestrator = new KnowledgeOrchestrator(mockDb as any)
  })

  describeIfPremium('getStatus', () => {
    itIfPremium('returns hasResume false when no resume loaded', () => {
      const status = orchestrator.getStatus()
      expect(status.hasResume).toBe(false)
    })

    itIfPremium('returns hasActiveJD false when no JD loaded', () => {
      const status = orchestrator.getStatus()
      expect(status.hasActiveJD).toBe(false)
    })

    itIfPremium('returns activeMode false by default', () => {
      const status = orchestrator.getStatus()
      expect(status.activeMode).toBe(false)
    })

    itIfPremium('returns hasResume true when resume is loaded', () => {
      mockDb.getDocumentByType.mockImplementation((type: DocType) => {
        if (type === DocType.RESUME) {
          return {
            id: 1,
            type: DocType.RESUME,
            source_uri: '/fake/resume.pdf',
            structured_data: {
              identity: { name: 'Test User', role: 'Engineer' },
              experience: [],
            },
          }
        }
        return null
      })

      const status = orchestrator.getStatus()
      expect(status.hasResume).toBe(true)
    })

    itIfPremium('returns hasActiveJD true when JD is loaded', () => {
      mockDb.getDocumentByType.mockImplementation((type: DocType) => {
        if (type === DocType.JD) {
          return {
            id: 2,
            type: DocType.JD,
            source_uri: '/fake/jd.pdf',
            structured_data: {
              title: 'Software Engineer',
              company: 'Acme Corp',
            },
          }
        }
        return null
      })

      const status = orchestrator.getStatus()
      expect(status.hasActiveJD).toBe(true)
    })
  })

  describeIfPremium('isKnowledgeMode', () => {
    itIfPremium('returns false when no resume is loaded', () => {
      expect(orchestrator.isKnowledgeMode()).toBe(false)
    })

    itIfPremium('returns false when knowledge mode is not enabled', () => {
      mockDb.getDocumentByType.mockImplementation((type: DocType) => {
        if (type === DocType.RESUME) {
          return {
            id: 1,
            type: DocType.RESUME,
            source_uri: '/fake/resume.pdf',
            structured_data: { identity: { name: 'Test' }, experience: [] },
          }
        }
        return null
      })

      expect(orchestrator.isKnowledgeMode()).toBe(false)
    })

    itIfPremium(
      'returns true when resume loaded AND knowledge mode enabled',
      () => {
        mockDb.getDocumentByType.mockImplementation((type: DocType) => {
          if (type === DocType.RESUME) {
            return {
              id: 1,
              type: DocType.RESUME,
              source_uri: '/fake/resume.pdf',
              structured_data: { identity: { name: 'Test' }, experience: [] },
            }
          }
          return null
        })

        orchestrator.setKnowledgeMode(true)
        expect(orchestrator.isKnowledgeMode()).toBe(true)
      },
    )
  })

  describeIfPremium('setKnowledgeMode', () => {
    itIfPremium('warns when enabling knowledge mode without a resume', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      orchestrator.setKnowledgeMode(true)

      expect(warnSpy).toHaveBeenCalledWith(
        '[KnowledgeOrchestrator] Cannot enable knowledge mode: no resume loaded',
      )
      warnSpy.mockRestore()
    })

    itIfPremium(
      'does not warn when disabling knowledge mode without a resume',
      () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

        orchestrator.setKnowledgeMode(false)

        expect(warnSpy).not.toHaveBeenCalled()
        warnSpy.mockRestore()
      },
    )

    itIfPremium(
      'enables knowledge mode successfully when resume is loaded',
      () => {
        mockDb.getDocumentByType.mockImplementation((type: DocType) => {
          if (type === DocType.RESUME) {
            return {
              id: 1,
              type: DocType.RESUME,
              source_uri: '/fake/resume.pdf',
              structured_data: { identity: { name: 'Test' }, experience: [] },
            }
          }
          return null
        })

        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
        orchestrator.setKnowledgeMode(true)

        expect(logSpy).toHaveBeenCalledWith(
          '[KnowledgeOrchestrator] Knowledge mode ENABLED',
        )
        logSpy.mockRestore()
      },
    )
  })

  describeIfPremium('getGapAnalysis', () => {
    itIfPremium('returns null when no JD is loaded', () => {
      const gap = orchestrator.getGapAnalysis()
      expect(gap).toBe(null)
    })

    itIfPremium('returns cached value from DB when available', () => {
      const mockGap = { gaps: [{ skill: 'TypeScript', gap_type: 'missing' }] }
      mockDb.getGapAnalysis.mockReturnValue(mockGap)

      const gap = orchestrator.getGapAnalysis()
      expect(gap).toEqual(mockGap)
    })
  })

  describeIfPremium('getNegotiationScript', () => {
    itIfPremium('returns null when no JD is loaded', () => {
      const script = orchestrator.getNegotiationScript()
      expect(script).toBe(null)
    })
  })

  describeIfPremium('getMockQuestions', () => {
    itIfPremium('returns null when no JD is loaded', () => {
      const questions = orchestrator.getMockQuestions()
      expect(questions).toBe(null)
    })
  })

  describeIfPremium('getCultureMappings', () => {
    itIfPremium('returns null when no JD is loaded', () => {
      const mappings = orchestrator.getCultureMappings()
      expect(mappings).toBe(null)
    })
  })

  describeIfPremium('setGenerateContentFn', () => {
    itIfPremium(
      'attaches the content generation callback without throwing',
      () => {
        const mockFn = vi.fn().mockResolvedValue('generated content')
        expect(() => orchestrator.setGenerateContentFn(mockFn)).not.toThrow()
      },
    )
  })

  describeIfPremium('setEmbedFn', () => {
    itIfPremium('attaches the embedding callback without throwing', () => {
      const mockFn = vi.fn().mockResolvedValue([0.1, 0.2, 0.3])
      expect(() => orchestrator.setEmbedFn(mockFn)).not.toThrow()
    })
  })

  describeIfPremium('deleteDocumentsByType', () => {
    itIfPremium('calls db.deleteDocumentsByType for the given type', () => {
      orchestrator.deleteDocumentsByType(DocType.RESUME)
      expect(mockDb.deleteDocumentsByType).toHaveBeenCalledWith(DocType.RESUME)
    })

    itIfPremium('resets knowledge mode when deleting resume', () => {
      mockDb.getDocumentByType.mockImplementation((type: DocType) => {
        if (type === DocType.RESUME) {
          return {
            id: 1,
            type: DocType.RESUME,
            source_uri: '/fake/resume.pdf',
            structured_data: { identity: { name: 'Test' }, experience: [] },
          }
        }
        return null
      })

      orchestrator.setKnowledgeMode(true)
      expect(orchestrator.isKnowledgeMode()).toBe(true)

      orchestrator.deleteDocumentsByType(DocType.RESUME)
      expect(orchestrator.isKnowledgeMode()).toBe(false)
    })
  })

  describeIfPremium('processQuestion', () => {
    itIfPremium('returns null when knowledge mode not enabled', async () => {
      const result = await orchestrator.processQuestion(
        'Tell me about your experience',
      )
      expect(result).toBe(null)
    })

    itIfPremium(
      'returns null when no resume is loaded even in knowledge mode',
      async () => {
        mockDb.getDocumentByType.mockReturnValue(null)

        orchestrator.setKnowledgeMode(true)
        const result = await orchestrator.processQuestion(
          'Tell me about your experience',
        )
        expect(result).toBe(null)
      },
    )
  })

  describeIfPremium('getCompanyResearchEngine', () => {
    itIfPremium('returns the company research engine instance', () => {
      const engine = orchestrator.getCompanyResearchEngine()
      expect(engine).not.toBeNull()
    })
  })

  describeIfPremium('getAOTPipeline', () => {
    itIfPremium('returns the AOT pipeline instance', () => {
      const pipeline = orchestrator.getAOTPipeline()
      expect(pipeline).not.toBeNull()
    })
  })

  describeIfPremium('resetNegotiationSession', () => {
    itIfPremium('resets the negotiation session without throwing', () => {
      expect(() => orchestrator.resetNegotiationSession()).not.toThrow()
    })
  })
})
